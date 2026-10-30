import {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  clipboard,
  shell,
  safeStorage,
} from "electron";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { Store, validateReview } from "../core/store";
import { parseTraceFile } from "../core/trace";
import { buildPreview, requestDiagnosis } from "../core/diagnosis";
import { GUIDE_VERSION, guides } from "../shared/guides";
import { selectEvents } from "../shared/selection";
import type { Review, SessionSummary } from "../shared/types";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  ConversationStore,
  attachSnapshot,
  newConversation,
  revokeSource,
  sourceFingerprint,
} from "../core/conversations";
import {
  agentInstructions,
  agentTools,
  initialWire,
  runConversation,
} from "../core/agent";
import { buildAgentRequest } from "../core/agent-provider";
import type { Conversation } from "../shared/types";

app.setName("DogDog");
if (process.env.DOGDOG_USER_DATA)
  app.setPath("userData", resolve(process.env.DOGDOG_USER_DATA));
let window: BrowserWindow;
let controller: AbortController | undefined;
let store: Store;
let conversationStore: ConversationStore;
let conversationMutation = false;
let recoveryWarning = "";
const grants = new Map<
  string,
  { id: string; fingerprint: string; expiresAt: number }
>();
async function editConversation(
  id: string,
  work: (c: Conversation) => Promise<void> | void,
) {
  if (controller || conversationMutation)
    throw new Error("请等待当前操作完成，或先停止分析。");
  conversationMutation = true;
  try {
    const c = await conversationStore.load(id);
    await work(c);
    return await conversationStore.save(c);
  } finally {
    conversationMutation = false;
  }
}
const allowedPaths = new Set<string>();
async function sessions() {
  const codexHome = process.env.CODEX_HOME || join(homedir(), ".codex");
  const root = join(codexHome, "sessions");
  const titles = new Map<string, string>();
  try {
    const indexPath = join(codexHome, "session_index.jsonl");
    if ((await stat(indexPath)).size <= 10 * 1024 * 1024) {
      for (const line of (await readFile(indexPath, "utf8")).split(/\r?\n/)) {
        try {
          const entry = JSON.parse(line);
          if (
            typeof entry.id === "string" &&
            typeof entry.thread_name === "string"
          )
            titles.set(entry.id, entry.thread_name);
        } catch {
          /* partial index rows are optional */
        }
      }
    }
  } catch {
    /* index is optional; filenames remain available */
  }
  const entries: SessionSummary[] = [];
  const warnings: string[] = [];
  let visited = 0;
  async function walk(dir: string, depth = 0) {
    if (depth > 6 || visited > 30000) return;
    for (const item of await readdir(dir, { withFileTypes: true })) {
      if (++visited > 30000) {
        warnings.push("会话目录过大，只扫描前 30000 项；可手动导入其他记录。");
        return;
      }
      const path = join(dir, item.name);
      if (item.isSymbolicLink()) continue;
      if (item.isDirectory()) await walk(path, depth + 1);
      else if (item.isFile() && item.name.endsWith(".jsonl")) {
        try {
          const s = await stat(path);
          entries.push({
            path,
            name: item.name,
            title: titles.get(
              item.name.match(/([0-9a-f]{8}-[0-9a-f-]{27})\.jsonl$/i)?.[1] ??
                "",
            ),
            modified: s.mtime.toISOString(),
            size: s.size,
          });
        } catch {
          warnings.push(`无法读取 ${item.name} 的文件信息。`);
        }
      }
    }
  }
  try {
    await walk(root);
  } catch {
    warnings.push(`未能完整读取 ${root}，可手动导入 JSONL。`);
  }
  entries.sort((a, b) => b.modified.localeCompare(a.modified));
  const recent = entries.slice(0, 150);
  if (entries.length > recent.length)
    warnings.push(
      `显示最近 ${recent.length} 个会话，共发现 ${entries.length} 个；其他记录可手动导入。`,
    );
  recent.forEach((e) => allowedPaths.add(e.path));
  return { sessions: recent, warnings };
}
function handle(
  name: string,
  fn: (...args: any[]) => Promise<unknown> | unknown,
) {
  ipcMain.handle(`dogdog:${name}`, async (event, ...args) => {
    if (
      event.sender !== window.webContents ||
      event.senderFrame !== window.webContents.mainFrame
    )
      return { ok: false, error: "非法调用来源。" };
    try {
      return { ok: true, value: await fn(...args) };
    } catch (error) {
      const message = error instanceof Error ? error.message : "操作失败。";
      // Do not return raw network bodies, filesystem errors or validation input to the renderer.
      return {
        ok: false,
        error:
          /[\u3400-\u9fff]/.test(message) && message.length < 1000
            ? message
            : "操作失败，请检查输入、文件和本地数据目录。",
      };
    }
  });
}
app.whenReady().then(async () => {
  const crypto = {
    async encrypt(text: string) {
      if (typeof safeStorage.encryptStringAsync === "function") {
        if (!(await safeStorage.isAsyncEncryptionAvailable()))
          throw new Error("系统加密服务不可用，无法保存 API Key。");
        return (await safeStorage.encryptStringAsync(text)).toString("base64");
      }
      if (!safeStorage.isEncryptionAvailable())
        throw new Error("系统加密服务不可用，无法保存 API Key。");
      return safeStorage.encryptString(text).toString("base64");
    },
    async decrypt(cipher: string) {
      if (typeof safeStorage.decryptStringAsync === "function")
        return (
          await safeStorage.decryptStringAsync(Buffer.from(cipher, "base64"))
        ).result;
      return safeStorage.decryptString(Buffer.from(cipher, "base64"));
    },
  };
  store = new Store(join(app.getPath("userData"), "reviews"), crypto);
  conversationStore = new ConversationStore(
    join(app.getPath("userData"), "conversations"),
  );
  await conversationStore.recover().catch(() => {
    recoveryWarning = "部分对话无法恢复，原文件已保留，请检查本地对话目录。";
  });
  // Explicit isolated real-service harness. Never activate for a normal profile.
  if (process.env.DOGDOG_REAL_CHECK === "1" && process.env.DOGDOG_USER_DATA) {
    if (!process.env.GLM_API_KEY) throw new Error("真实测试缺少 GLM_API_KEY。");
    await store.saveSettings({
      protocol: "openai-responses",
      baseUrl:
        process.env.DOGDOG_CHECK_ENDPOINT ||
        "https://open.bigmodel.cn/api/v1/responses",
      model: process.env.DOGDOG_CHECK_MODEL || "GLM-5.3",
      maxInputChars: 120000,
      apiKey: process.env.GLM_API_KEY,
    });
  }
  window = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1120,
    minHeight: 760,
    backgroundColor: "#f7f5f0",
    title: "DogDog · 狗狗",
    autoHideMenuBar: true,
    icon: join(__dirname, "assets/dogdog.ico"),
    show: false,
    webPreferences: {
      preload: join(__dirname, "preload.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (e) => e.preventDefault());
  window.webContents.session.setPermissionRequestHandler(
    (_wc, _permission, callback) => callback(false),
  );
  handle("boot", async () => {
    const [s, r, settings] = await Promise.all([
      sessions(),
      store.reviews(),
      store.settings(),
    ]);
    return {
      sessions: s.sessions,
      sessionWarnings: [
        ...s.warnings,
        ...r.warnings,
        ...(recoveryWarning ? [recoveryWarning] : []),
      ],
      reviews: r.reviews,
      settings,
      dataPath: store.dir,
    };
  });
  handle("refreshSessions", sessions);
  handle("conversations", () => conversationStore.list());
  handle("conversation", (id: string) => conversationStore.load(id));
  handle("createConversation", () => {
    if (controller || conversationMutation)
      throw new Error("请先停止当前分析。");
    return conversationStore.save(newConversation());
  });
  handle("attachSources", (id: string, path?: string) =>
    editConversation(id, async (c) => {
      let paths: string[];
      if (path !== undefined) {
        if (typeof path !== "string" || !allowedPaths.has(path))
          throw new Error("请从会话列表或文件选择器选择轨迹。");
        paths = [path];
      } else {
        const result = await dialog.showOpenDialog(window, {
          title: "关联轨迹（可多选）",
          filters: [{ name: "Codex 轨迹", extensions: ["jsonl"] }],
          properties: ["openFile", "multiSelections"],
        });
        if (result.canceled) return;
        paths = result.filePaths;
      }
      for (const p of paths) {
        const trace = await parseTraceFile(p);
        allowedPaths.add(p);
        attachSnapshot(c, trace);
      }
    }),
  );
  handle("refreshSource", (id: string, sourceId: string) =>
    editConversation(id, async (c) => {
      const source = c.sources.find((s) => s.id === sourceId && s.active);
      if (!source) throw new Error("来源不存在或已移除。");
      const trace = await parseTraceFile(source.trace.path);
      if (trace.hash === source.trace.hash) return;
      revokeSource(c, sourceId);
      attachSnapshot(c, trace);
    }),
  );
  handle("removeSource", (id: string, sourceId: string) =>
    editConversation(id, (c) => {
      revokeSource(c, sourceId);
    }),
  );
  handle("previewConversation", async (id: string, text: string) => {
    text = z.string().trim().min(1).max(100000).parse(text);
    const c = await conversationStore.load(id),
      settings = await store.settings();
    const fingerprint = sourceFingerprint(c, settings);
    const waiting = [...c.runs]
      .reverse()
      .find((r) => r.status === "waiting" && r.fingerprint === fingerprint);
    const wire = waiting
      ? [
          ...waiting.wire,
          {
            role: "tool" as const,
            callId: waiting.questionCallId,
            text: JSON.stringify({ answer: text }),
          },
        ]
      : initialWire(c, text);
    const request = buildAgentRequest(
        settings,
        agentInstructions,
        wire,
        agentTools,
      ),
      token = randomUUID();
    for (const [t, g] of grants) if (g.expiresAt < Date.now()) grants.delete(t);
    grants.set(token, {
      id: c.id,
      fingerprint,
      expiresAt: Date.now() + 600000,
    });
    const sources = c.sources.filter((s) => s.active);
    return {
      token,
      requiresAuthorization: c.grant?.fingerprint !== fingerprint,
      protocol: settings.protocol,
      endpoint: request.endpoint,
      model: settings.model,
      chars: request.chars,
      sourceIds: sources.map((s) => s.id),
      payload: JSON.stringify(
        {
          initialRequest: JSON.parse(request.payload),
          authorizedSources: sources.map((s) => ({
            id: s.id,
            hash: s.trace.hash,
            title: s.trace.title,
            events: s.trace.events,
          })),
        },
        null,
        2,
      ),
    };
  });
  handle("authorizeConversation", (id: string, token: string) =>
    editConversation(id, async (c) => {
      const grant = grants.get(token),
        fingerprint = sourceFingerprint(c, await store.settings());
      if (
        !grant ||
        grant.id !== id ||
        grant.expiresAt < Date.now() ||
        grant.fingerprint !== fingerprint
      )
        throw new Error("发送范围已变化或预览已过期，请重新检查。");
      c.grant = { fingerprint, at: new Date().toISOString() };
      grants.delete(token);
    }),
  );
  handle("sendMessage", async (id: string, text: string) => {
    if (controller || conversationMutation)
      throw new Error("已有分析或来源操作正在进行。");
    controller = new AbortController();
    const current = controller;
    try {
      const c = await conversationStore.load(id),
        settings = await store.settings();
      return await runConversation(
        c,
        text,
        settings,
        await store.key(),
        current.signal,
        (value) => conversationStore.save(value),
        (event) => {
          if (!window.isDestroyed())
            window.webContents.send("dogdog:agentEvent", event);
        },
      );
    } finally {
      if (controller === current) controller = undefined;
    }
  });
  handle("saveConversationReport", (id: string, messageId: string) =>
    editConversation(id, (c) => {
      const message = c.messages.find(
        (m) =>
          m.id === messageId &&
          m.role === "assistant" &&
          m.status === "complete" &&
          m.kind === "answer",
      );
      if (!message) throw new Error("只能将完整回答保存为报告。");
      c.reports.push({
        id: randomUUID(),
        version: c.reports.length + 1,
        messageId,
        text: message.text,
        evidenceIds: [...message.evidenceIds],
        createdAt: new Date().toISOString(),
      });
    }),
  );
  handle("openTrace", async (path: string) => {
    if (typeof path !== "string" || !allowedPaths.has(path))
      throw new Error("请从会话列表或文件选择器选择轨迹。");
    return parseTraceFile(path);
  });
  handle("importTrace", async () => {
    const r = await dialog.showOpenDialog(window, {
      title: "选择 Codex 轨迹",
      filters: [{ name: "Codex 轨迹", extensions: ["jsonl"] }],
      properties: ["openFile"],
    });
    if (r.canceled) return null;
    const path = r.filePaths[0];
    allowedPaths.add(path);
    return parseTraceFile(path);
  });
  handle("saveReview", (r: Review) => store.saveReview(r));
  handle("saveSettings", async (s) => {
    if (controller || conversationMutation)
      throw new Error("请先停止当前分析，再修改模型设置。");
    conversationMutation = true;
    try {
      return await store.saveSettings(s);
    } finally {
      conversationMutation = false;
    }
  });
  handle("preview", async (r: Review) =>
    buildPreview(validateReview(r), await store.settings()),
  );
  handle("diagnose", async (input: Review) => {
    if (controller || conversationMutation)
      throw new Error("已有分析正在进行。");
    const r = validateReview(input);
    controller = new AbortController();
    const current = controller;
    try {
      const settings = await store.settings();
      const preview = buildPreview(r, settings);
      const report = await requestDiagnosis(
        preview,
        await store.key(),
        current.signal,
      );
      if (current.signal.aborted) throw new Error("已取消诊断，未生成报告。");
      return await store.saveReview({
        ...r,
        report,
        retry: undefined,
        analyzedTask: { ...r.task },
        analyzedEventIds: selectEvents(r.trace, r.task).map((e) => e.id),
        analysisMeta: {
          model: settings.model,
          endpoint: preview.endpoint,
          at: new Date().toISOString(),
          guideVersion: GUIDE_VERSION,
        },
      });
    } finally {
      if (controller === current) controller = undefined;
    }
  });
  handle("cancel", () => {
    controller?.abort();
  });
  handle("copy", (text: string) => {
    if (typeof text !== "string" || text.length > 1_000_000)
      throw new Error("复制内容无效。");
    clipboard.writeText(text);
  });
  handle("openGuide", async (id: string) => {
    const guide = guides.find((g) => g.id === id);
    if (!guide) throw new Error("功能来源不存在。");
    await shell.openExternal(guide.url);
  });
  handle("exportReview", async (input: Review) => {
    const r = validateReview(input);
    r.trace.events = selectEvents(r.trace, r.task);
    const result = await dialog.showSaveDialog(window, {
      title: "导出复盘（包含所选任务轨迹）",
      defaultPath: `DogDog-${r.id.slice(0, 8)}.json`,
      filters: [{ name: "复盘数据", extensions: ["json"] }],
    });
    if (result.canceled || !result.filePath) return false;
    await writeFile(result.filePath, JSON.stringify(r, null, 2), "utf8");
    return true;
  });
  window.once("ready-to-show", () => window.show());
  window.on("closed", () => controller?.abort());
  if (!app.isPackaged && process.env.DOGDOG_DEV_URL)
    await window.loadURL(process.env.DOGDOG_DEV_URL);
  else await window.loadFile(join(__dirname, "renderer/index.html"));
});
app.on("window-all-closed", () => app.quit());
