import { createServer } from "node:http";
import { mkdir, appendFile, writeFile, readFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";
import { stream } from "../../tools/mock-service.mjs";
const args = process.argv.slice(2),
  get = (k, d) =>
    args.includes("--" + k) ? args[args.indexOf("--" + k) + 1] : d;
if (!get("plan") || !get("out"))
  throw new Error(
    "usage: node desktop-service.mjs --plan CASE/mock-plan.json --out NEW_ISOLATED_DIR",
  );
const plan = JSON.parse(await readFile(resolve(get("plan")), "utf8")),
  out = resolve(get("out"));
await mkdir(out, { recursive: true });
let mode = plan.mode,
  stage = 0,
  queue = Promise.resolve();
const pending = new Set(),
  sockets = new Set();
const audit = (x) => {
  queue = queue.then(() =>
    appendFile(join(out, "requests.jsonl"), JSON.stringify(x) + "\n"),
  );
  return queue;
};
const send = (res, p, text, calls = [], fragmented = false) => {
  if (res.destroyed) return;
  res.writeHead(200, { "Content-Type": "text/event-stream" });
  const bytes = Buffer.from(stream(p, text, calls));
  for (let i = 0; i < bytes.length; i += fragmented ? 7 : bytes.length)
    res.write(bytes.subarray(i, i + (fragmented ? 7 : bytes.length)));
  res.end();
};
const tool = (name, arguments_) => ({
  id: "synthetic-" + stage + "-" + name,
  name,
  arguments: arguments_,
});
const server = createServer(async (req, res) => {
  try {
    let raw = "";
    for await (const b of req) raw += b;
    const body = JSON.parse(raw || "{}");
    if (req.url === "/control" && req.method === "POST") {
      if (body.mode) {
        mode = body.mode;
        stage = 0;
      }
      if (body.release) {
        for (const held of pending) {
          if (!held.res.destroyed)
            send(held.res, held.p, "", [
              tool("search_traces", { query: "启动" }),
            ]);
        }
        pending.clear();
      }
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ mode, stage }));
      return;
    }
    if (req.url === "/health") {
      res.end("ok");
      return;
    }
    const allowed =
      mode === "text-exact-path"
        ? ["/gateway/team-a/custom-response"]
        : ["/responses", "/chat", "/messages"];
    if (!allowed.includes(req.url)) {
      await audit({
        at: new Date().toISOString(),
        path: req.url,
        rejectedPath: true,
      });
      res.writeHead(404).end();
      return;
    }
    const credential = String(
      req.headers.authorization || req.headers["x-api-key"] || "",
    );
    await audit({
      at: new Date().toISOString(),
      path: req.url,
      mode,
      credentialSha256: createHash("sha256").update(credential).digest("hex"),
      body,
    });
    const p =
      mode === "anthropic-only"
        ? "anthropic"
        : req.url === "/messages"
          ? "anthropic"
          : req.url === "/chat"
            ? "openai-chat"
            : "openai-responses";
    if (mode === "http503-secret") {
      res.writeHead(503, { "Content-Type": "application/json" }).end(
        JSON.stringify({
          error: "INTERNAL_SYNTHETIC_ERROR DD-SYNTHETIC-SECRET",
        }),
      );
      return;
    }
    if (mode === "slow") {
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.write(
        "data: " +
          JSON.stringify({
            type: "response.output_text.delta",
            delta: "开始查证：受控未完成片段。",
          }) +
          "\n\n",
      );
      return;
    }
    if (mode === "delayed-tool") {
      pending.add({ res, p });
      return;
    }
    if (mode === "invalid-citation") {
      send(res, p, "已经解决 [S99:L999]。");
      return;
    }
    if (mode === "ask-user") {
      if (stage++ === 0)
        send(res, p, "", [tool("ask_user", { question: "验收目标是什么？" })]);
      else
        send(
          res,
          p,
          "根据你补充的目标，验收需要启动成功且健康检查通过；本次仍应核对实际记录。",
        );
      return;
    }
    if (mode === "fragmented-tools") {
      const n = stage++ % 3;
      if (n === 0) send(res, p, "", [tool("list_sources", {})], true);
      else if (n === 1)
        send(
          res,
          p,
          "",
          [tool("read_trace", { sourceId: "S1", fromLine: 2, toLine: 3 })],
          true,
        );
      else send(res, p, "已读取合成记录，可查看对应原文 [S1:L3]。", [], true);
      return;
    }
    send(res, p, plan.normalText || "配置检查完成。");
  } catch (e) {
    if (!res.headersSent) res.writeHead(400);
    res.end(JSON.stringify({ error: "synthetic_request_error" }));
  }
});
server.on("connection", (s) => {
  sockets.add(s);
  s.on("close", () => sockets.delete(s));
});
await new Promise((r) =>
  server.listen(Number(get("port", "0")), "127.0.0.1", r),
);
const base = "http://127.0.0.1:" + server.address().port;
const status = {
  url: base,
  endpoint:
    base +
    (mode === "text-exact-path"
      ? "/gateway/team-a/custom-response"
      : "/responses"),
  pid: process.pid,
  mode,
  syntheticOnly: true,
};
await writeFile(join(out, "status.json"), JSON.stringify(status, null, 2));
process.stdout.write(JSON.stringify(status) + "\n");
process.on("SIGINT", async () => {
  for (const s of sockets) s.destroy();
  server.close();
  await queue;
  process.exit(0);
});
