import { useEffect, useRef, useState, type ReactNode } from "react";
import { App, SettingsModal } from "./App";
import { Dog } from "./Dog";
import { protocolLabels } from "../shared/protocol";
import type {
  BootData,
  Conversation,
  ConversationPreview,
  ConversationReport,
  SourceSnapshot,
  TraceEvent,
} from "../shared/types";

const api = window.dogdog;
const date = (s: string) =>
  new Date(s).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
function Dialog({
  title,
  children,
  close,
}: {
  title: string;
  children: ReactNode;
  close: () => void;
}) {
  return (
    <div className="modal-backdrop">
      <section
        className="modal modal-wide"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onKeyDown={(e) => {
          if (e.key === "Escape") close();
        }}
      >
        <header>
          <h2>{title}</h2>
          <button className="icon-button" aria-label="关闭" onClick={close}>
            ×
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}
export function ChatApp() {
  const [legacy, setLegacy] = useState(false);
  const [boot, setBoot] = useState<BootData>();
  const [all, setAll] = useState<Conversation[]>([]);
  const [c, setC] = useState<Conversation>();
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [preview, setPreview] = useState<ConversationPreview>();
  const [toolStatus, setToolStatus] = useState("");
  const [evidence, setEvidence] = useState<{
    source: SourceSnapshot;
    event: TraceEvent;
  }>();
  const [report, setReport] = useState<ConversationReport>();
  const [audit, setAudit] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);
  const selected = useRef<string | undefined>(undefined);
  const upsert = (value: Conversation) => {
    selected.current = value.id;
    setC(value);
    setAll((previous) => [value, ...previous.filter((x) => x.id !== value.id)]);
  };
  async function action<T>(work: () => Promise<T>) {
    setError("");
    try {
      return await work();
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作失败。");
      return undefined;
    }
  }
  useEffect(() => {
    void action(async () => {
      const b = await api.boot();
      setBoot(b);
      const conversations = await api.conversations();
      setAll(conversations);
      if (conversations[0]) {
        selected.current = conversations[0].id;
        setC(conversations[0]);
      }
    });
  }, []);
  useEffect(
    () =>
      api.onAgentEvent((event) => {
        if (event.conversationId !== selected.current) return;
        if (event.toolStatus) setToolStatus(event.toolStatus);
        if (event.type === "delta")
          setC((value) => {
            if (!value || value.id !== event.conversationId) return value;
            const messages = value.messages.map((m) =>
              m.runId === event.runId && m.status === "generating"
                ? { ...m, text: m.text + (event.text ?? "") }
                : m,
            );
            return { ...value, messages };
          });
        else if (event.messages && event.run)
          setC((value) => {
            if (!value || value.id !== event.conversationId) return value;
            return {
              ...value,
              title: event.title ?? value.title,
              sources: event.sources ?? value.sources,
              messages: event.messages!,
              runs: [
                ...value.runs.filter((r) => r.id !== event.runId),
                event.run!,
              ],
            };
          });
      }),
    [],
  );
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [c?.messages.at(-1)?.text, c?.id]);
  async function ensureConversation() {
    if (c) return c;
    const value = await api.createConversation();
    upsert(value);
    return value;
  }
  async function modify(work: (value: Conversation) => Promise<Conversation>) {
    setBusy(true);
    await action(async () => upsert(await work(await ensureConversation())));
    setBusy(false);
  }
  async function send(value: Conversation, text: string) {
    setBusy(true);
    setToolStatus("正在思考…");
    setInput("");
    const result = await action(() => api.sendMessage(value.id, text));
    if (result) upsert(result);
    else setInput(text);
    setBusy(false);
  }
  async function prepare() {
    const text = input.trim();
    if (!text || busy || settingsOpen || preview) return;
    setBusy(true);
    if (!boot?.settings.allowTraceSend) {
      setSettingsOpen(true);
      setBusy(false);
      return;
    }
    await action(async () => send(await ensureConversation(), text));
    setBusy(false);
  }
  async function showPreview() {
    if (!input.trim() || busy) return;
    setBusy(true);
    await action(async () =>
      setPreview(
        await api.previewConversation(
          (await ensureConversation()).id,
          input.trim(),
        ),
      ),
    );
    setBusy(false);
  }

  function openEvidence(id: string) {
    const match = /^(S\d+):L(\d+)$/.exec(id);
    const source = c?.sources.find((s) => s.id === match?.[1]);
    const event = source?.trace.events.find(
      (e) => e.line === Number(match?.[2]),
    );
    if (source && event) {
      setReport(undefined);
      setEvidence({ source, event });
    }
  }
  function answer(text: string, ids: string[]) {
    const inline = (value: string): ReactNode =>
      value
        .split(/(\[S\d+:L\d+\]|\*\*[^*\n]+\*\*|`[^`\n]+`)/g)
        .map((part, i) => {
          const id = part.slice(1, -1);
          if (part.startsWith("**") && part.endsWith("**"))
            return <strong key={i}>{inline(part.slice(2, -2))}</strong>;
          if (part.startsWith("`") && part.endsWith("`"))
            return <code key={i}>{part.slice(1, -1)}</code>;
          return ids.includes(id) ? (
            <button
              key={i}
              className="chat-citation"
              onClick={() => openEvidence(id)}
              aria-label={`查看证据 ${id}`}
            >
              {id}
            </button>
          ) : (
            <span key={i}>{part}</span>
          );
        });
    return <div className="chat-answer">{inline(text)}</div>;
  }
  if (legacy)
    return (
      <>
        <button
          className="chat-back"
          onClick={() => {
            setLegacy(false);
            void action(async () => setBoot(await api.boot()));
          }}
        >
          ← 返回持续对话
        </button>
        <App />
      </>
    );
  const active = c?.sources.filter((s) => s.active) ?? [],
    run = c?.runs.at(-1);
  return (
    <div className="chat-shell">
      <aside className="chat-sidebar">
        <div className="chat-brand">
          <Dog state="idle" />
          <div>
            <strong>
              DogDog <small>狗狗</small>
            </strong>
            <p>持续讨论，一起找到更好的做法。</p>
          </div>
        </div>
        <button
          className="primary chat-new"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void action(async () => {
              upsert(await api.createConversation());
              setInput("");
            }).finally(() => setBusy(false));
          }}
        >
          ＋ 新建讨论
        </button>
        <div className="chat-nav-label">
          你的讨论 <span>{all.length}</span>
        </div>
        <nav className="chat-conversations" aria-label="讨论列表">
          {all.map((value) => (
            <button
              disabled={busy}
              className={c?.id === value.id ? "selected" : ""}
              key={value.id}
              onClick={() => {
                upsert(value);
                setInput("");
                setError("");
              }}
            >
              <strong>{value.title}</strong>
              <small>
                {date(value.updatedAt)} ·{" "}
                {value.sources.filter((s) => s.active).length} 份轨迹
              </small>
            </button>
          ))}
          {!all.length && (
            <p className="chat-muted">从一个问题开始，也可以先关联轨迹。</p>
          )}
        </nav>
        <div className="chat-sidebar-bottom">
          <button
            aria-label="旧版复盘"
            disabled={busy}
            onClick={() => setLegacy(true)}
          >
            ↗ 旧版复盘
          </button>
          <button
            aria-label="模型设置"
            disabled={busy}
            onClick={() => setSettingsOpen(true)}
          >
            ⚙ 模型设置
          </button>
          <small>记录保存在本机 · v0.3.0</small>
        </div>
      </aside>
      <main className="chat-main">
        <header className="chat-topbar">
          <span>
            工作台 <span className="chat-muted"> / </span> 持续对话
          </span>
          <span className="chat-model">
            ● {boot?.settings.model || "尚未配置模型"}
          </span>
        </header>
        <div className="chat-workspace">
          <section className="chat-discussion">
            <header className="chat-discussion-header">
              <div>
                <small className="chat-eyebrow">
                  A BETTER WAY TO WORK TOGETHER
                </small>
                <h1>{c?.title || "把你的问题，交给狗狗。"}</h1>
                <p>
                  {active.length
                    ? `${active.length} 份固定轨迹快照 · 按问题查证，按原文讨论`
                    : "可以聊方法，也可以关联多份轨迹，一起复盘。"}
                </p>
              </div>
              <button
                className="secondary"
                disabled={!c}
                onClick={() => setAudit(true)}
              >
                发送记录
              </button>
            </header>
            {(error || run?.error) && (
              <div className="chat-error" role="alert">
                {error || run?.error}
              </div>
            )}
            {!!boot?.sessionWarnings.length && (
              <details className="chat-warnings">
                <summary>本地记录提示（{boot.sessionWarnings.length}）</summary>
                {boot.sessionWarnings.map((w, i) => (
                  <p key={i}>{w}</p>
                ))}
              </details>
            )}
            {!!c?.contextStart && (
              <p className="chat-scope-note">
                来源移除或更新后，模型从新的上下文继续；历史讨论与证据仍保留在本机。
              </p>
            )}
            <div
              className="chat-timeline"
              aria-label="对话消息"
              aria-busy={busy}
            >
              {!c?.messages.length && (
                <div className="chat-welcome">
                  <Dog state="idle" />
                  <h2>每一次协作，都可以成为经验。</h2>
                  <p>
                    直接提问，我会自主检索本机 Codex 历史。
                    <br />
                    我会查找线索，也会在缺少关键背景时向你询问。
                  </p>
                  <div className="chat-starters">
                    {[
                      "怎样把需求和验收条件表达得更清楚？",
                      "帮我比较这些任务中反复出现的问题。",
                      "这次有哪些值得继续保留的协作方式？",
                    ].map((s) => (
                      <button key={s} onClick={() => setInput(s)}>
                        {s}
                        <span>↗</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {c?.messages.map((m) => (
                <article
                  key={m.id}
                  className={`chat-message chat-message-${m.role}`}
                  data-status={m.status}
                >
                  <div className="chat-message-label">
                    {m.role === "user" ? "你" : "DogDog 狗狗"}
                    <small>
                      {m.kind === "question"
                        ? "需要你的补充"
                        : m.status === "generating"
                          ? "正在查证与组织回答…"
                          : m.status === "incomplete"
                            ? "未完成 · 不作为已确认结论"
                            : date(m.createdAt)}
                    </small>
                  </div>
                  {answer(
                    m.text || "正在思考…",
                    m.status === "complete" ? m.evidenceIds : [],
                  )}
                  {m.role === "assistant" &&
                    m.kind === "answer" &&
                    m.status === "complete" && (
                      <button
                        className="chat-save-report"
                        disabled={busy}
                        onClick={() =>
                          void modify((value) =>
                            api.saveConversationReport(value.id, m.id),
                          )
                        }
                      >
                        保存为报告
                      </button>
                    )}
                </article>
              ))}
              <div ref={bottom} />
            </div>
            <form
              className="chat-composer"
              onSubmit={(e) => {
                e.preventDefault();
                void prepare();
              }}
            >
              <label className="chat-sr-only" htmlFor="chat-question">
                你的问题
              </label>
              <textarea
                id="chat-question"
                value={input}
                disabled={busy || settingsOpen || !!preview}
                onChange={(e) => setInput(e.target.value)}
                placeholder={
                  run?.status === "waiting"
                    ? "补充你的回答，狗狗会继续分析…"
                    : "直接提问，狗狗会按需检索 Codex 历史…"
                }
                rows={3}
                onKeyDown={(e) => {
                  if (
                    e.key === "Enter" &&
                    !e.shiftKey &&
                    !e.nativeEvent.isComposing
                  ) {
                    e.preventDefault();
                    void prepare();
                  }
                }}
              />
              <div>
                <button
                  type="button"
                  className="secondary"
                  disabled={busy || !input.trim()}
                  onClick={() => void showPreview()}
                >
                  发送预览
                </button>
                <small>
                  {run?.status === "waiting"
                    ? "等待你的补充"
                    : busy
                      ? toolStatus
                      : "Enter 发送 · Shift + Enter 换行"}
                </small>
                {busy ? (
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => void action(() => api.cancel())}
                  >
                    停止分析
                  </button>
                ) : (
                  <button
                    className="primary"
                    type="submit"
                    disabled={!input.trim()}
                  >
                    发送 ↗
                  </button>
                )}
              </div>
            </form>
          </section>
          <aside className="chat-context">
            <section className="chat-source-panel">
              <div className="chat-section-heading">
                <h2>讨论的证据</h2>
                <span>{active.length}</span>
              </div>
              <p>
                相关轨迹会自动检索并加入证据。
                <br />
                原始轨迹始终只读。
              </p>
              <button
                className="secondary"
                disabled={busy}
                onClick={() =>
                  void modify((value) => api.attachSources(value.id))
                }
              >
                ＋ 关联轨迹
              </button>
              <select
                aria-label="关联本机会话"
                disabled={busy}
                value=""
                onChange={(e) => {
                  if (e.target.value) {
                    const path = e.target.value;
                    void modify((value) => api.attachSources(value.id, path));
                  }
                }}
              >
                <option value="">从本机 Codex 会话选择…</option>
                {boot?.sessions.map((s) => (
                  <option key={s.path} value={s.path}>
                    {s.title || s.name}
                  </option>
                ))}
              </select>
              <div className="chat-source-list">
                {active.map((s) => (
                  <article key={s.id}>
                    <small>
                      {s.id} · {s.trace.turns} 轮 · {s.trace.events.length}{" "}
                      个事件
                    </small>
                    <strong>{s.trace.title}</strong>
                    <details>
                      <summary>范围与快照</summary>
                      <p>{s.trace.path}</p>
                      <code>SHA-256 {s.trace.hash}</code>
                      <p>快照包含全部已解析事件；更新原文件后需点击刷新。</p>
                      {s.trace.warnings.map((w, i) => (
                        <p key={i}>{w}</p>
                      ))}
                    </details>
                    <div>
                      <button
                        disabled={busy}
                        onClick={() =>
                          void modify((value) =>
                            api.refreshSource(value.id, s.id),
                          )
                        }
                      >
                        刷新快照
                      </button>
                      <button
                        disabled={busy}
                        onClick={() =>
                          void modify((value) =>
                            api.removeSource(value.id, s.id),
                          )
                        }
                      >
                        移除
                      </button>
                    </div>
                  </article>
                ))}
              </div>
              {!active.length && (
                <p className="chat-source-empty">
                  尚未建立证据快照
                  <br />
                  提问后会按需检索本机历史。
                </p>
              )}
            </section>
            <section className="chat-report-panel">
              <h2>
                讨论成果 <span>{c?.reports.length ?? 0}</span>
              </h2>
              {c?.reports.map((r) => (
                <button key={r.id} onClick={() => setReport(r)}>
                  报告 v{r.version}
                  <small>{date(r.createdAt)}</small>
                </button>
              ))}
              {!c?.reports.length && (
                <p>将有用的回答保存成报告，保留每一版结论。</p>
              )}
            </section>
            {run && (
              <section className="chat-progress">
                <h3>
                  {run.status === "waiting"
                    ? "需要你的补充"
                    : run.status === "running"
                      ? "狗狗正在查证"
                      : "本轮分析记录"}
                </h3>
                <p>
                  {run.requests.length} 次模型请求 · {run.tools.length}{" "}
                  次工具调用
                </p>
                <ol>
                  {run.tools.slice(-6).map((t, i) => (
                    <li key={i}>
                      {(
                        {
                          discover_sessions: "发现会话",
                          list_sources: "查看来源",
                          search_traces: "搜索轨迹",
                          read_trace: "阅读原文",
                          ask_user: "询问背景",
                        } as Record<string, string>
                      )[t.name] || t.name}
                      {(() => {
                        try {
                          const result = JSON.parse(t.result);
                          return (
                            <small>
                              {result.error
                                ? ` · ${result.error}`
                                : typeof result.total === "number"
                                  ? ` · ${result.total} 条匹配${result.nextOffset !== null ? "（可继续翻页）" : ""}`
                                  : ""}
                              {result.warnings
                                ?.slice(0, 2)
                                .map((warning: string, n: number) => (
                                  <span key={n}> · {warning}</span>
                                ))}
                            </small>
                          );
                        } catch {
                          return null;
                        }
                      })()}
                    </li>
                  ))}
                </ol>
              </section>
            )}
            <p className="chat-context-note">
              一般建议与轨迹判断会区分表达。证据不足时，结论可以保持开放。
            </p>
          </aside>
        </div>
      </main>
      {settingsOpen && boot && (
        <SettingsModal
          settings={boot.settings}
          dataPath={boot.dataPath}
          close={() => setSettingsOpen(false)}
          save={async (s) => {
            await action(async () => {
              const settings = await api.saveSettings(s);
              setBoot({ ...boot, settings });
              const conversations = await api.conversations();
              setAll(conversations);
              if (c) {
                const updated = conversations.find((x) => x.id === c.id);
                if (updated) upsert(updated);
              }
              setSettingsOpen(false);
            });
          }}
        />
      )}
      {preview && (
        <Dialog title="对话发送预览" close={() => setPreview(undefined)}>
          <p>
            已配置目录内的相关片段会按需发送；这份预览展示首次请求，后续检索片段可在发送记录查看。
          </p>
          <dl className="preview-info">
            <div>
              <dt>目标服务</dt>
              <dd>{preview.endpoint}</dd>
            </div>
            <div>
              <dt>模型 / 协议</dt>
              <dd>
                {preview.model} / {protocolLabels[preview.protocol]}
              </dd>
            </div>
            <div>
              <dt>来源范围</dt>
              <dd>
                {boot?.settings.traceRoots?.join("；") || "仅手动导入来源"}
              </dd>
            </div>
            <div>
              <dt>首次请求</dt>
              <dd>{preview.chars.toLocaleString()} 字符</dd>
            </div>
          </dl>
          <details>
            <summary>查看完整来源范围与首次请求</summary>
            <textarea
              aria-label="对话发送范围"
              className="payload"
              readOnly
              value={preview.payload}
            />
          </details>
          <p className="footnote">
            后续实际请求可在「发送记录」查看；原始文件不会被修改。
          </p>
          <div className="form-actions">
            <button className="secondary" onClick={() => setPreview(undefined)}>
              返回调整
            </button>
          </div>
        </Dialog>
      )}
      {evidence && (
        <Dialog
          title={`轨迹证据 · ${evidence.source.id}:L${evidence.event.line}`}
          close={() => setEvidence(undefined)}
        >
          <p>{evidence.source.trace.title}</p>
          <p className="chat-muted">
            {evidence.source.trace.path}
            <br />
            原文第 {evidence.event.line} 行 · 轮次 {evidence.event.turn}
            {!evidence.source.active && " · 历史快照"}
          </p>
          <code className="chat-hash">
            SHA-256 {evidence.source.trace.hash}
          </code>
          <pre className="evidence-text">{evidence.event.text}</pre>
        </Dialog>
      )}
      {report && (
        <Dialog
          title={`讨论报告 · v${report.version}`}
          close={() => setReport(undefined)}
        >
          {answer(report.text, report.evidenceIds)}
        </Dialog>
      )}
      {audit && (
        <Dialog title="实际发送记录" close={() => setAudit(false)}>
          <p>
            以下为发往模型的实际请求内容，不包含鉴权头。失败或取消的请求可能已经被服务处理。
          </p>
          <div className="chat-audit-list">
            {c?.runs.flatMap((r) =>
              r.requests.map((request, i) => (
                <details key={`${r.id}-${i}`}>
                  <summary>
                    {date(request.at)} · {request.model} ·{" "}
                    {request.chars.toLocaleString()} 字符
                  </summary>
                  <p>{request.endpoint}</p>
                  <pre>{request.payload}</pre>
                </details>
              )),
            )}
            {!c?.runs.some((r) => r.requests.length) && <p>尚未发送请求。</p>}
          </div>
        </Dialog>
      )}
    </div>
  );
}
