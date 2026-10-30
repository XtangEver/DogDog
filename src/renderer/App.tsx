import { useEffect, useState, type ReactNode } from "react";
import { Dog } from "./Dog";
import { guides } from "../shared/guides";
import { selectEvents, eventBounds } from "../shared/selection";
import { protocolLabels } from "../shared/protocol";
import type {
  BootData,
  DogDogAPI,
  Preview,
  Review,
  Settings,
  Trace,
  TraceEvent,
  RetryReview,
  SaveSettings,
  ModelProtocol,
} from "../shared/types";
declare global {
  interface Window {
    dogdog: DogDogAPI;
  }
}
const api = window.dogdog;
const date = (s: string) =>
  new Date(s).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
const count = (n?: number) => (n == null ? "未记录" : n.toLocaleString());
function Icon({ name }: { name: string }) {
  const paths: Record<string, ReactNode> = {
    plus: <path d="M12 5v14M5 12h14" />,
    settings: (
      <>
        <path d="M4 7h16M4 17h16" />
        <circle cx="9" cy="7" r="3" />
        <circle cx="15" cy="17" r="3" />
      </>
    ),
    arrow: <path d="M5 12h14m-6-6 6 6-6 6" />,
    file: (
      <>
        <path d="M14 3H5v18h14V8Z" />
        <path d="M14 3v5h5M8 12h8M8 16h5" />
      </>
    ),
    refresh: (
      <>
        <path d="M20 7v5h-5M4 17v-5h5" />
        <path d="M19 9a7 7 0 0 0-12-4L4 8m1 7a7 7 0 0 0 12 4l3-3" />
      </>
    ),
    close: <path d="m6 6 12 12M6 18 18 6" />,
    check: <path d="m5 12 4 4L19 6" />,
    copy: (
      <>
        <rect x="8" y="8" width="12" height="13" rx="2" />
        <path d="M16 8V3H3v13h5" />
      </>
    ),
    export: (
      <>
        <path d="M12 15V3m-4 4 4-4 4 4M4 14v7h16v-7" />
      </>
    ),
    search: (
      <>
        <circle cx="10" cy="10" r="6" />
        <path d="m15 15 5 5" />
      </>
    ),
    chevron: <path d="m9 5 7 7-7 7" />,
    clock: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 6v6l4 2" />
      </>
    ),
  };
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name] ?? paths.file}
    </svg>
  );
}
function Modal({
  title,
  children,
  close,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  close: () => void;
  wide?: boolean;
}) {
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <section
        className={`modal ${wide ? "modal-wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onKeyDown={(e) => {
          if (e.key === "Escape") close();
        }}
      >
        <header>
          <h2>{title}</h2>
          <button className="icon-button" onClick={close} aria-label="关闭">
            <Icon name="close" />
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}
function newReview(trace: Trace): Review {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    createdAt: now,
    updatedAt: now,
    trace,
    task: {
      goal: trace.title,
      criteria: "",
      complaint: "",
      fromTurn: eventBounds(trace).firstTurn,
      toTurn: eventBounds(trace).lastTurn,
    },
  };
}
function duration(trace: Trace, from = 1, to = trace.turns) {
  const times = trace.events
    .filter((e) => e.turn >= from && e.turn <= to && e.timestamp)
    .map((e) => Date.parse(e.timestamp!))
    .filter(Number.isFinite);
  return times.length > 1
    ? `${Math.round((times.reduce((a, b) => Math.max(a, b), -Infinity) - times.reduce((a, b) => Math.min(a, b), Infinity)) / 60000)} 分钟`
    : "未记录";
}
export function App() {
  const [boot, setBoot] = useState<BootData>();
  const [review, setReview] = useState<Review>();
  const [tab, setTab] = useState(0);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [preview, setPreview] = useState<Preview>();
  const [evidence, setEvidence] = useState<
    TraceEvent & { sourcePath?: string }
  >();
  const [retryOpen, setRetryOpen] = useState(false);
  const [retryTrace, setRetryTrace] = useState<Trace>();
  const [retryFrom, setRetryFrom] = useState(1);
  const [retryTo, setRetryTo] = useState(1);
  const [adopted, setAdopted] = useState<string[]>([]);
  const [outcome, setOutcome] = useState<RetryReview["outcome"]>("无法判断");
  const [criteriaResults, setCriteriaResults] = useState("");
  const [notes, setNotes] = useState("");
  async function run<T>(fn: () => Promise<T>): Promise<T | undefined> {
    setError("");
    try {
      return await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作失败");
      return undefined;
    }
  }
  useEffect(() => {
    if (api)
      void run(async () => {
        const b = await api.boot();
        setBoot(b);
      });
  }, []);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 3500);
    return () => clearTimeout(timer);
  }, [notice]);
  async function remember(r: Review) {
    const saved = await api.saveReview(r);
    setReview(saved);
    setBoot(
      (b) =>
        b && {
          ...b,
          reviews: [saved, ...b.reviews.filter((x) => x.id !== saved.id)],
        },
    );
    return saved;
  }
  async function openTrace(path?: string) {
    if (busy || loading) return;
    setLoading(true);
    await run(async () => {
      if (review) await remember(review);
      const t = path ? await api.openTrace(path) : await api.importTrace();
      if (t) {
        setReview(newReview(t));
        setTab(0);
      }
    });
    setLoading(false);
  }
  async function openSaved(r: Review) {
    if (busy || loading) return;
    await run(async () => {
      if (review && review.id !== r.id) await remember(review);
      setReview(r);
      setTab(r.report ? 1 : 0);
    });
  }
  async function prepare() {
    if (!review || busy) return;
    setLoading(true);
    await run(async () => {
      const saved = await remember(review);
      setPreview(await api.preview(saved));
    });
    setLoading(false);
  }
  async function diagnose() {
    if (!review || busy) return;
    setPreview(undefined);
    setBusy(true);
    setTab(1);
    await run(async () => {
      const saved = await api.diagnose(review);
      setReview(saved);
      setBoot(
        (b) =>
          b && {
            ...b,
            reviews: [saved, ...b.reviews.filter((r) => r.id !== saved.id)],
          },
      );
      setNotice(
        saved.report?.findings.length
          ? "复盘完成，先试一个最重要的改动。"
          : "复盘完成，保留有效做法，继续观察。",
      );
    });
    setBusy(false);
  }
  function updateTask(k: string, v: string | number | undefined) {
    setReview((r) =>
      r && !r.report
        ? {
            ...r,
            task: {
              ...r.task,
              ...(["fromTurn", "toTurn"].includes(k)
                ? { fromLine: undefined, toLine: undefined }
                : {}),
              [k]: v,
            },
          }
        : r,
    );
  }
  function chooseRetry(t: Trace) {
    setRetryTrace(t);
    const min = eventBounds(t).firstTurn;
    const same = t.id === review?.trace.id;
    setRetryFrom(
      same && t.turns > review!.task.toTurn ? review!.task.toTurn + 1 : min,
    );
    setRetryTo(t.turns);
  }
  function startRetry() {
    if (!review) return;
    setRetryTrace(review.retry?.trace);
    setRetryFrom(
      review.retry
        ? Math.min(...review.retry.trace.events.map((e) => e.turn))
        : 1,
    );
    setRetryTo(
      review.retry
        ? Math.max(...review.retry.trace.events.map((e) => e.turn))
        : 1,
    );
    setAdopted(review.retry?.adopted ?? []);
    setOutcome(review.retry?.outcome ?? "无法判断");
    setCriteriaResults(review.retry?.criteriaResults ?? "");
    setNotes(review.retry?.notes ?? "");
    setRetryOpen(true);
  }
  async function saveRetry() {
    if (!review || !retryTrace) return;
    await run(async () => {
      if (!criteriaResults.trim())
        throw new Error("请逐项记录原验收标准是否达成。");
      if (
        !Number.isInteger(retryFrom) ||
        !Number.isInteger(retryTo) ||
        retryFrom < 1 ||
        retryTo < retryFrom ||
        retryTo > retryTrace.turns
      )
        throw new Error("重试轮次范围无效。");
      const events = retryTrace.events.filter(
        (e) => e.turn >= retryFrom && e.turn <= retryTo,
      );
      if (!events.some((e) => e.kind !== "context"))
        throw new Error("重试范围没有可读事件。");
      if (
        retryTrace.id === review.trace.id &&
        events.some((e) =>
          review.trace.events.some(
            (old) => old.id === e.id && old.text === e.text,
          ),
        )
      )
        throw new Error("重试范围与原复盘重叠，请选择后续轮次。");
      await remember({
        ...review,
        retry: {
          trace: { ...retryTrace, events },
          adopted,
          outcome,
          criteriaResults,
          notes,
          savedAt: new Date().toISOString(),
        },
      });
      setRetryOpen(false);
      setTab(2);
      setNotice("重试结果已保存。");
    });
  }
  if (!api)
    return <div className="fatal">请通过 DogDog 桌面应用打开此界面。</div>;
  const selectedEvents = review ? selectEvents(review.trace, review.task) : [];
  const filteredSessions =
    boot?.sessions.filter((s) =>
      `${s.title ?? ""} ${s.name} ${s.path}`
        .toLowerCase()
        .includes(query.toLowerCase()),
    ) ?? [];
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <Dog small />
          <div>
            <strong>
              DogDog<span>狗狗</span>
            </strong>
            <small>让每次协作，都更进一步</small>
          </div>
        </div>
        <div className="workspace-label">
          你的工作空间 <span className="beta">MVP</span>
        </div>
        <button
          className="new-button"
          disabled={busy || loading}
          onClick={() => void openTrace()}
        >
          <Icon name="plus" />
          导入任务轨迹<span>JSONL</span>
        </button>
        <div className="sidebar-section">
          <span>本机 Codex 会话</span>
          <button
            className="icon-button"
            title="刷新会话"
            aria-label="刷新会话"
            disabled={loading}
            onClick={() =>
              void run(async () => {
                const s = await api.refreshSessions();
                setBoot(
                  (b) =>
                    b && {
                      ...b,
                      sessions: s.sessions,
                      sessionWarnings: s.warnings,
                    },
                );
              })
            }
          >
            <Icon name="refresh" />
          </button>
        </div>
        <div className="search">
          <Icon name="search" />
          <input
            aria-label="搜索会话"
            placeholder="搜索文件名或路径"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="session-list">
          {!boot ? (
            <p className="muted">正在读取本机记录…</p>
          ) : filteredSessions.length === 0 ? (
            <p className="muted">未找到会话，可手动导入。</p>
          ) : (
            filteredSessions.map((s) => (
              <button
                disabled={busy || loading}
                className={`session ${review?.trace.path === s.path ? "active" : ""}`}
                key={s.path}
                title={s.path}
                onClick={() => void openTrace(s.path)}
              >
                <Icon name="file" />
                <span>
                  <strong>
                    {s.title ||
                      s.name
                        .replace(/^rollout-/, "")
                        .replace(/T/, " · ")
                        .slice(0, 23)}
                  </strong>
                  <small>
                    {date(s.modified)} · {(s.size / 1024).toFixed(0)} KB
                  </small>
                </span>
                <Icon name="chevron" />
              </button>
            ))
          )}
        </div>
        <div className="sidebar-section">
          <span>我的复盘</span>
          <span className="count-pill">{boot?.reviews.length ?? 0}</span>
        </div>
        <div className="review-list">
          {boot?.reviews.length === 0 && (
            <p className="muted">第一份复盘，从一次真实协作开始。</p>
          )}
          {boot?.reviews.map((r) => (
            <button
              disabled={busy || loading}
              className={`saved-review ${r.id === review?.id ? "active" : ""}`}
              key={r.id}
              onClick={() => void openSaved(r)}
            >
              <i className={r.retry ? "green" : r.report ? "orange" : ""} />
              <span>{r.task.goal.slice(0, 45) || "未命名任务"}</span>
              <small>{r.retry ? "已验证" : r.report ? "已诊断" : "草稿"}</small>
            </button>
          ))}
        </div>
        <button
          className="settings-button"
          disabled={busy}
          onClick={() => setSettingsOpen(true)}
        >
          <Icon name="settings" />
          <span>模型设置</span>
          <i className={boot?.settings.model ? "connected" : ""} />
        </button>
        <div className="local-note">
          <span>◉</span> 记录保存在这台电脑上
        </div>
      </aside>
      <main className="main">
        <header className="topbar">
          <div>
            <span className="breadcrumb">工作台</span>
            <Icon name="chevron" />
            <span>{review ? "任务复盘" : "开始一次复盘"}</span>
          </div>
          <span className="model-pill">
            <i />
            {boot?.settings.model || "尚未配置诊断模型"}
          </span>
        </header>
        {error && (
          <div className="error-banner" role="alert">
            <span>{error}</span>
            <button onClick={() => setError("")} aria-label="关闭错误">
              <Icon name="close" />
            </button>
          </div>
        )}
        {notice && (
          <div className="toast" role="status">
            <Icon name="check" />
            {notice}
          </div>
        )}
        <div className="main-scroll">
          {!review ? (
            <>
              <section className="welcome">
                <div className="eyebrow">A BETTER WAY TO WORK TOGETHER</div>
                <h1>下一次，让协作更顺一点。</h1>
                <p>
                  把一次真实的 Agent 协作交给狗狗，
                  <br />
                  看看做得好的地方，也找到下一次的改进空间。
                </p>
                <button
                  className="primary"
                  disabled={loading}
                  onClick={() => void openTrace()}
                >
                  <Icon name="plus" />
                  选择一份任务轨迹
                </button>
                <div className="welcome-dog">
                  <Dog />
                  <span>我在这里，一起把事情做好。</span>
                </div>
              </section>
              <div className="section-heading">
                <h2>一次复盘，三个小步骤</h2>
                <span>从真实任务开始，用结果检验建议</span>
              </div>
              <div className="intro-grid">
                {[
                  [
                    "01",
                    "对齐目标与预期",
                    "选一份 Codex 轨迹，确认目标与验收标准；没有明显问题，也可以复盘。",
                    "file",
                  ],
                  [
                    "02",
                    "一起找到改进点",
                    "沿着原文保留有效做法，找到值得尝试的提示词和协作方式。",
                    "search",
                  ],
                  [
                    "03",
                    "再试一次，看结果",
                    "关联重试轨迹，对照原来的标准，记录哪些改动真的有帮助。",
                    "check",
                  ],
                ].map(([n, t, d, i]) => (
                  <article className="intro-card" key={n}>
                    <div>
                      <span>{n}</span>
                      <Icon name={i} />
                    </div>
                    <h3>{t}</h3>
                    <p>{d}</p>
                  </article>
                ))}
              </div>
              <section className="principle">
                <span className="principle-icon">✦</span>
                <div>
                  <strong>每一条判断，都应该有来处。</strong>
                  <p>
                    狗狗会区分观察到的事实与待验证的推测；证据不足时，就明确说无法判断。
                  </p>
                </div>
                <span className="tag">证据优先</span>
              </section>
              {(boot?.sessionWarnings.length ?? 0) > 0 && (
                <details className="warnings">
                  <summary>读取提示（{boot!.sessionWarnings.length}）</summary>
                  {boot!.sessionWarnings.map((w, i) => (
                    <p key={i}>{w}</p>
                  ))}
                </details>
              )}
            </>
          ) : (
            <>
              <section className="task-heading">
                <div>
                  <div className="eyebrow">YOUR WORK, A LITTLE BETTER</div>
                  <h1>
                    {review.task.goal.slice(0, 52) ||
                      "这次任务，哪里可以更好？"}
                  </h1>
                  <p title={review.trace.path}>
                    {review.trace.cwd || review.trace.path}
                    <span>Codex {review.trace.version || "版本未记录"}</span>
                  </p>
                </div>
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      if (await api.exportReview(review))
                        setNotice("复盘已导出（包含轨迹快照）。");
                    })
                  }
                >
                  <Icon name="export" />
                  导出复盘
                </button>
              </section>
              <nav className="step-tabs" aria-label="复盘步骤">
                {["任务与轨迹", "诊断与建议", "重试与对比"].map((t, i) => (
                  <button
                    className={tab === i ? "active" : ""}
                    key={t}
                    onClick={() => setTab(i)}
                  >
                    <span>{i + 1}</span>
                    {t}
                    {i < 2 && <Icon name="chevron" />}
                  </button>
                ))}
              </nav>
              <div className="work-grid">
                <div className="work-content">
                  {tab === 0 && (
                    <>
                      <section className="panel">
                        <div className="panel-heading">
                          <h2>先对齐，这次想做好什么</h2>
                          <span className="tag">
                            {review.report ? "诊断时的任务" : "由你定义成功"}
                          </span>
                        </div>
                        <fieldset disabled={busy || !!review.report}>
                          <label>
                            任务目标
                            <textarea
                              aria-label="任务目标"
                              rows={3}
                              value={review.task.goal}
                              onChange={(e) =>
                                updateTask("goal", e.target.value)
                              }
                              placeholder="这次希望 Agent 完成什么？"
                            />
                          </label>
                          <label>
                            验收标准
                            <textarea
                              aria-label="验收标准"
                              rows={3}
                              value={review.task.criteria}
                              onChange={(e) =>
                                updateTask("criteria", e.target.value)
                              }
                              placeholder="什么结果算完成？建议逐行写出可检查的标准。"
                            />
                          </label>
                          <label>
                            重点关注（可选）
                            <textarea
                              aria-label="重点关注"
                              rows={3}
                              value={review.task.complaint}
                              onChange={(e) =>
                                updateTask("complaint", e.target.value)
                              }
                              placeholder="有想重点检查的地方吗？留空时，狗狗会从目标表达、协作方式和执行过程做整体复盘。"
                            />
                          </label>
                        </fieldset>
                        {!review.report ? (
                          <div className="form-actions">
                            <button
                              className="secondary"
                              disabled={busy || loading}
                              onClick={() =>
                                void run(async () => {
                                  await remember(review);
                                  setNotice("任务草稿已保存。");
                                })
                              }
                            >
                              保存草稿
                            </button>
                            <button
                              className="primary"
                              disabled={busy || loading}
                              onClick={() => void prepare()}
                            >
                              检查发送内容
                              <Icon name="arrow" />
                            </button>
                          </div>
                        ) : (
                          <div className="form-actions">
                            <button
                              className="secondary"
                              onClick={() => {
                                const r = newReview(review.trace);
                                r.task = { ...review.task };
                                setReview(r);
                              }}
                            >
                              以此任务新建复盘
                            </button>
                            <button
                              className="primary"
                              onClick={() => setTab(1)}
                            >
                              查看诊断
                              <Icon name="arrow" />
                            </button>
                          </div>
                        )}
                      </section>
                      <section className="panel">
                        <div className="panel-heading">
                          <h2>任务轨迹</h2>
                          <span className="muted">
                            {selectedEvents.length} 个可读事件
                          </span>
                        </div>
                        <div className="range-row">
                          <span>选择轮次</span>
                          <input
                            aria-label="起始轮次"
                            type="number"
                            min={eventBounds(review.trace).firstTurn}
                            max={review.trace.turns}
                            disabled={!!review.report || busy}
                            value={review.task.fromTurn}
                            onChange={(e) =>
                              updateTask("fromTurn", Number(e.target.value))
                            }
                          />
                          <span>至</span>
                          <input
                            aria-label="结束轮次"
                            type="number"
                            min={review.task.fromTurn}
                            max={review.trace.turns}
                            disabled={!!review.report || busy}
                            value={review.task.toTurn}
                            onChange={(e) =>
                              updateTask("toTurn", Number(e.target.value))
                            }
                          />
                          <small>仅发送所选轮次，超限时需缩小范围</small>
                        </div>
                        <details className="event-range">
                          <summary>长任务：精确选择原文行范围（可选）</summary>
                          <div className="range-row">
                            <span>原文行</span>
                            <input
                              aria-label="起始事件行"
                              type="number"
                              min={1}
                              disabled={!!review.report || busy}
                              placeholder={String(
                                eventBounds(review.trace).firstLine,
                              )}
                              value={review.task.fromLine ?? ""}
                              onChange={(e) =>
                                updateTask(
                                  "fromLine",
                                  e.target.value
                                    ? Number(e.target.value)
                                    : undefined,
                                )
                              }
                            />
                            <span>至</span>
                            <input
                              aria-label="结束事件行"
                              type="number"
                              min={review.task.fromLine ?? 1}
                              disabled={!!review.report || busy}
                              placeholder={String(
                                eventBounds(review.trace).lastLine,
                              )}
                              value={review.task.toLine ?? ""}
                              onChange={(e) =>
                                updateTask(
                                  "toLine",
                                  e.target.value
                                    ? Number(e.target.value)
                                    : undefined,
                                )
                              }
                            />
                          </div>
                          <p className="footnote">
                            与轮次范围共同生效；尽量保留相关工具调用及结果。留空包含所选轮次全部事件，未选部分不发送。
                          </p>
                        </details>
                        <div className="timeline">
                          {selectedEvents.slice(0, 100).map((e) => (
                            <button
                              className={`event event-${e.kind}`}
                              key={e.id}
                              onClick={() =>
                                setEvidence({
                                  ...e,
                                  sourcePath: review.trace.path,
                                })
                              }
                            >
                              <div>
                                <span>
                                  {e.kind === "message"
                                    ? e.role
                                    : e.kind === "context"
                                      ? "执行上下文"
                                      : e.name || e.kind}
                                </span>
                                <small>
                                  轮次 {e.turn} · {e.id}
                                </small>
                              </div>
                              <p>{e.text.slice(0, 220)}</p>
                            </button>
                          ))}
                          {selectedEvents.length > 100 && (
                            <p className="muted">
                              预览显示前 100 个事件；发送内容包含范围内全部{" "}
                              {selectedEvents.length}{" "}
                              个事件，可在发送前展开检查。
                            </p>
                          )}
                        </div>
                        <details className="warnings">
                          <summary>
                            解析说明与提示（{review.trace.warnings.length}）
                          </summary>
                          <p>
                            加密推理不会解析；未自动合并其他聊天或子 Agent
                            记录。草稿保存当前所选轮次的快照，重新选择原文件可读取其他轮次。
                          </p>
                          {review.trace.warnings.map((w, i) => (
                            <p key={i}>{w}</p>
                          ))}
                        </details>
                      </section>
                    </>
                  )}
                  {tab === 1 &&
                    (busy ? (
                      <section className="panel thinking-panel">
                        <Dog state="thinking" />
                        <div className="eyebrow">
                          LOOKING FOR THE LITTLE THINGS
                        </div>
                        <h2>狗狗正在顺着证据找线索…</h2>
                        <p>看清问题，也把暂时不能确认的部分留下来。</p>
                        <button
                          className="secondary"
                          onClick={() => void run(() => api.cancel())}
                        >
                          取消诊断
                        </button>
                      </section>
                    ) : review.report ? (
                      <>
                        <section className="report-summary">
                          <span className="eyebrow">
                            复盘完成 · {review.report.findings.length}{" "}
                            个优先改进点
                          </span>
                          <h2>保留有效做法，找到下一步。</h2>
                          <p>{review.report.summary}</p>
                          <small>
                            {review.analysisMeta?.model} ·{" "}
                            {review.analysisMeta?.at &&
                              date(review.analysisMeta.at)}
                          </small>
                        </section>
                        {!!review.report.strengths?.length && (
                          <section className="panel strengths">
                            <h2>值得保留的做法</h2>
                            {review.report.strengths.map((s, i) => (
                              <div key={i}>
                                <p>{s.text}</p>
                                <div className="evidence-links">
                                  {s.evidenceIds.map((id) => (
                                    <button
                                      key={id}
                                      onClick={() =>
                                        setEvidence({
                                          ...review.trace.events.find(
                                            (e) => e.id === id,
                                          )!,
                                          sourcePath: review.trace.path,
                                        })
                                      }
                                    >
                                      {id}
                                      <Icon name="chevron" />
                                    </button>
                                  ))}
                                </div>
                              </div>
                            ))}
                          </section>
                        )}
                        {!review.report.findings.length && (
                          <section className="panel">
                            <h2>本次没有足够证据支持优先改进项</h2>
                            <p className="muted">
                              这不证明当前方法最优；保留有效做法，在下一次任务中继续观察。
                            </p>
                          </section>
                        )}
                        {review.report.findings.map((f, i) => (
                          <article className="finding panel" key={f.id}>
                            <div className="finding-top">
                              <span className="finding-number">0{i + 1}</span>
                              <span className="tag">{f.category}</span>
                              <span
                                className={`certainty ${f.certainty === "事实" ? "fact" : ""}`}
                              >
                                {f.certainty === "事实"
                                  ? "可观察事实"
                                  : "待验证推测"}
                              </span>
                            </div>
                            <h2>{f.title}</h2>
                            <p>{f.explanation}</p>
                            <div className="evidence-links">
                              <span>轨迹依据</span>
                              {f.evidenceIds.map((id) => (
                                <button
                                  key={id}
                                  onClick={() =>
                                    setEvidence({
                                      ...review.trace.events.find(
                                        (e) => e.id === id,
                                      )!,
                                      sourcePath: review.trace.path,
                                    })
                                  }
                                >
                                  {id}
                                  <Icon name="chevron" />
                                </button>
                              ))}
                            </div>
                            <div className="action-box">
                              <strong>具体怎么改</strong>
                              <p>{f.action}</p>
                              <strong>下次怎么验证</strong>
                              <p>{f.verification}</p>
                            </div>
                            {f.featureIds.map((id) => {
                              const g = guides.find((g) => g.id === id)!;
                              return (
                                <div className="guide" key={id}>
                                  <button
                                    onClick={() =>
                                      void run(() => api.openGuide(id))
                                    }
                                  >
                                    {g.name} ↗
                                  </button>
                                  <p>{g.when}</p>
                                  <small>官方来源 · 核验于 {g.checkedAt}</small>
                                </div>
                              );
                            })}
                          </article>
                        ))}
                        <section className="panel">
                          <div className="panel-heading">
                            <h2>带到下一次协作</h2>
                            <button
                              className="secondary"
                              onClick={() =>
                                void run(async () => {
                                  await api.copy(review.report!.nextPrompt);
                                  setNotice("下一轮提示词已复制。");
                                })
                              }
                            >
                              <Icon name="copy" />
                              复制提示词
                            </button>
                          </div>
                          <pre className="prompt-text">
                            {review.report.nextPrompt}
                          </pre>
                        </section>
                        <section className="panel limitations">
                          <h3>这次还不能确认的部分</h3>
                          {review.report.limitations.map((l, i) => (
                            <p key={i}>· {l}</p>
                          ))}
                        </section>
                        <div className="form-actions">
                          <button className="primary" onClick={startRetry}>
                            关联一次重试
                            <Icon name="arrow" />
                          </button>
                        </div>
                      </>
                    ) : (
                      <section className="panel empty-state">
                        <Dog />
                        <h2>先把任务和预期对齐</h2>
                        <p>确认任务目标与验收标准，就可以开始日常复盘。</p>
                        <button className="primary" onClick={() => setTab(0)}>
                          返回任务与轨迹
                          <Icon name="arrow" />
                        </button>
                      </section>
                    ))}
                  {tab === 2 &&
                    (review.retry ? (
                      <>
                        <section className="panel">
                          <div className="panel-heading">
                            <h2>这一次，有没有更接近目标？</h2>
                            <span
                              className={`outcome ${review.retry.outcome === "改善" ? "improved" : ""}`}
                            >
                              {review.retry.outcome}
                            </span>
                          </div>
                          <p className="muted">
                            以原验收标准判断，以下结论由你记录；单次对比不能证明因果。
                          </p>
                          <h3>采用的改进</h3>
                          {review.report?.findings
                            .filter((f) => review.retry!.adopted.includes(f.id))
                            .map((f) => (
                              <div className="adopted" key={f.id}>
                                <Icon name="check" />
                                {f.title}
                              </div>
                            ))}
                          <h3>验收结果</h3>
                          <p className="preserve">
                            {review.retry.criteriaResults}
                          </p>
                          {review.retry.notes && (
                            <>
                              <h3>补充观察</h3>
                              <p className="preserve">{review.retry.notes}</p>
                            </>
                          )}
                        </section>
                        <section className="panel">
                          <h2>辅助观察</h2>
                          <table>
                            <thead>
                              <tr>
                                <th>指标</th>
                                <th>原任务所选轮次</th>
                                <th>重试所选轮次</th>
                              </tr>
                            </thead>
                            <tbody>
                              <tr>
                                <td>轮次数</td>
                                <td>
                                  {
                                    new Set(
                                      review.trace.events.map((e) => e.turn),
                                    ).size
                                  }
                                </td>
                                <td>
                                  {
                                    new Set(
                                      review.retry.trace.events.map(
                                        (e) => e.turn,
                                      ),
                                    ).size
                                  }
                                </td>
                              </tr>
                              <tr>
                                <td>工具调用</td>
                                <td>
                                  {
                                    review.trace.events.filter(
                                      (e) => e.kind === "tool_call",
                                    ).length
                                  }
                                </td>
                                <td>
                                  {
                                    review.retry.trace.events.filter(
                                      (e) => e.kind === "tool_call",
                                    ).length
                                  }
                                </td>
                              </tr>
                              <tr>
                                <td>日志时间跨度</td>
                                <td>{duration(review.trace)}</td>
                                <td>{duration(review.retry.trace)}</td>
                              </tr>
                              <tr>
                                <td>全会话累计 token *</td>
                                <td>{count(review.trace.stats.totalTokens)}</td>
                                <td>
                                  {count(review.retry.trace.stats.totalTokens)}
                                </td>
                              </tr>
                            </tbody>
                          </table>
                          <p className="footnote">
                            * token
                            为来源日志的全会话累计值，可能包含范围之外的工作，不用于计算优化比例；日志时间跨度包含等待时间。
                          </p>
                          <details>
                            <summary>查看重试轨迹快照</summary>
                            <div className="timeline">
                              {review.retry.trace.events
                                .slice(0, 100)
                                .map((e) => (
                                  <button
                                    className="event"
                                    key={e.id}
                                    onClick={() =>
                                      setEvidence({
                                        ...e,
                                        sourcePath: review.retry!.trace.path,
                                      })
                                    }
                                  >
                                    <div>
                                      <span>{e.name || e.role || e.kind}</span>
                                      <small>
                                        轮次 {e.turn} · {e.id}
                                      </small>
                                    </div>
                                    <p>{e.text.slice(0, 180)}</p>
                                  </button>
                                ))}
                            </div>
                          </details>
                          <div className="form-actions">
                            <button className="secondary" onClick={startRetry}>
                              更新验证记录
                            </button>
                          </div>
                        </section>
                      </>
                    ) : (
                      <section className="panel empty-state">
                        <Dog state={review.report ? "done" : "idle"} />
                        <h2>建议有没有用，再试一次才知道。</h2>
                        <p>
                          在原 Agent
                          中采用建议完成重试，再关联轨迹、记录验收结果。
                        </p>
                        <button
                          className="primary"
                          disabled={!review.report}
                          onClick={startRetry}
                        >
                          关联重试轨迹
                          <Icon name="arrow" />
                        </button>
                      </section>
                    ))}
                </div>
                <aside className="context-column">
                  <section className="companion-card">
                    <Dog
                      state={
                        busy ? "thinking" : review.report ? "done" : "idle"
                      }
                    />
                    <h3>
                      {busy
                        ? "我在认真找线索。"
                        : review.retry
                          ? "每次尝试，都值得留下。"
                          : review.report
                            ? "先试一个小小的改变。"
                            : "你定义目标，我陪你找路。"}
                    </h3>
                    <p>
                      {review.report
                        ? "建议是待检验的改法，真实任务的结果才是反馈。"
                        : "确认这次的目标，让每一次协作都成为经验。"}
                    </p>
                  </section>
                  <section className="panel compact">
                    <h3>本次任务</h3>
                    <dl>
                      <div>
                        <dt>所选轮次</dt>
                        <dd>
                          {review.task.fromTurn}–{review.task.toTurn}
                        </dd>
                      </div>
                      <div>
                        <dt>可读事件</dt>
                        <dd>{selectedEvents.length}</dd>
                      </div>
                      <div>
                        <dt>执行模型</dt>
                        <dd>{review.trace.model || "未记录"}</dd>
                      </div>
                      <div>
                        <dt>当前状态</dt>
                        <dd>
                          {busy
                            ? "正在分析"
                            : review.retry
                              ? "已记录验证"
                              : review.report
                                ? "等待重试"
                                : "准备复盘"}
                        </dd>
                      </div>
                    </dl>
                  </section>
                  <div className="side-note">
                    <Icon name="file" />
                    <p>
                      原始轨迹只读。诊断仅在你检查发送内容并点击发送后调用模型。
                    </p>
                  </div>
                </aside>
              </div>
            </>
          )}
          <footer>
            DogDog 狗狗<span>陪你把每次协作，变成下一次的经验。</span>
            <small>v0.1.0</small>
          </footer>
        </div>
      </main>
      {settingsOpen && boot && (
        <SettingsModal
          settings={boot.settings}
          dataPath={boot.dataPath}
          close={() => setSettingsOpen(false)}
          save={(s) =>
            run(async () => {
              const settings = await api.saveSettings(s);
              setBoot((b) => b && { ...b, settings });
              setSettingsOpen(false);
              setNotice("模型配置已保存。");
            })
          }
        />
      )}
      {preview && (
        <Modal
          title="发送前，检查一下"
          wide
          close={() => setPreview(undefined)}
        >
          <p>
            以下内容将发送给你指定的模型服务。包含所选轮次的可读消息、工具输入与输出、任务描述及诊断指南。
          </p>
          <dl className="preview-info">
            <div>
              <dt>目标服务</dt>
              <dd>{preview.endpoint}</dd>
            </div>
            <div>
              <dt>诊断模型</dt>
              <dd>{preview.model}</dd>
            </div>
            <div>
              <dt>接口协议</dt>
              <dd>{protocolLabels[preview.protocol]}</dd>
            </div>
            <div>
              <dt>发送范围</dt>
              <dd>
                轮次 {preview.turns} · {preview.events} 个事件 ·{" "}
                {count(preview.chars)} 字符
              </dd>
            </div>
          </dl>
          <p className="footnote">
            检查是否包含不希望发送的源码或其他内容；若需调整，请返回选择轮次。字符上限不等同于模型
            token 容量。
          </p>
          <details>
            <summary>展开完整待发送数据</summary>
            <textarea
              className="payload"
              readOnly
              value={preview.payload}
              aria-label="完整待发送数据"
            />
          </details>
          {review?.report && <p>重新诊断会替换当前报告并清除重试关联。</p>}
          <div className="form-actions">
            <button className="secondary" onClick={() => setPreview(undefined)}>
              返回调整
            </button>
            <button className="primary" onClick={() => void diagnose()}>
              发送并开始诊断
              <Icon name="arrow" />
            </button>
          </div>
        </Modal>
      )}
      {evidence && (
        <Modal
          title={`轨迹证据 · ${evidence.id}`}
          wide
          close={() => setEvidence(undefined)}
        >
          <div className="evidence-meta">
            {evidence.sourcePath && <p>{evidence.sourcePath}</p>}第{" "}
            {evidence.line} 行 · 轮次 {evidence.turn} ·{" "}
            {evidence.name || evidence.role || evidence.kind}
          </div>
          <pre className="evidence-text">{evidence.text}</pre>
        </Modal>
      )}
      {retryOpen && review && (
        <Modal
          title="把建议，放回真实任务里验证"
          wide
          close={() => setRetryOpen(false)}
        >
          <label>
            选择重试会话
            <select
              aria-label="选择重试会话"
              value=""
              onChange={(e) => {
                if (e.target.value)
                  void run(async () =>
                    chooseRetry(await api.openTrace(e.target.value)),
                  );
              }}
            >
              <option value="">从本机 Codex 记录中选择…</option>
              {boot?.sessions.map((s) => (
                <option value={s.path} key={s.path}>
                  {s.title || s.name}
                </option>
              ))}
            </select>
          </label>
          <button
            className="secondary"
            onClick={() =>
              void run(async () => {
                const t = await api.importTrace();
                if (t) chooseRetry(t);
              })
            }
          >
            <Icon name="plus" />
            手动导入重试轨迹
          </button>
          {retryTrace && (
            <div className="retry-selected">
              <strong>{retryTrace.title}</strong>
              <div className="range-row">
                <span>重试轮次</span>
                <input
                  type="number"
                  aria-label="重试起始轮次"
                  min={1}
                  max={retryTrace.turns}
                  value={retryFrom}
                  onChange={(e) => setRetryFrom(Number(e.target.value))}
                />
                <span>至</span>
                <input
                  type="number"
                  aria-label="重试结束轮次"
                  min={retryFrom}
                  max={retryTrace.turns}
                  value={retryTo}
                  onChange={(e) => setRetryTo(Number(e.target.value))}
                />
              </div>
              <small>同一聊天内重试时，选择原任务之后的轮次。</small>
            </div>
          )}
          <h3>实际采用了哪些建议？（可选）</h3>
          <p className="footnote">
            未采用建议时可保持为空，结果作为后续观察记录。
          </p>
          {review.report?.findings.map((f) => (
            <label className="checkbox" key={f.id}>
              <input
                type="checkbox"
                checked={adopted.includes(f.id)}
                onChange={(e) =>
                  setAdopted(
                    e.target.checked
                      ? [...adopted, f.id]
                      : adopted.filter((id) => id !== f.id),
                  )
                }
              />
              {f.title}
            </label>
          ))}
          <label>
            对照原验收标准的结果
            <textarea
              aria-label="验收结果"
              rows={3}
              value={criteriaResults}
              onChange={(e) => setCriteriaResults(e.target.value)}
              placeholder={review.task.criteria}
            />
          </label>
          <label>
            整体结果
            <select
              aria-label="整体结果"
              value={outcome}
              onChange={(e) =>
                setOutcome(e.target.value as RetryReview["outcome"])
              }
            >
              <option>无法判断</option>
              <option>改善</option>
              <option>无改善</option>
            </select>
          </label>
          <label>
            补充观察（可选）
            <textarea
              aria-label="补充观察"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="模型、环境、任务难度是否也有变化？"
            />
          </label>
          <div className="form-actions">
            <button
              className="primary"
              disabled={!retryTrace}
              onClick={() => void saveRetry()}
            >
              保存验证结果
              <Icon name="check" />
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
export function SettingsModal({
  settings,
  dataPath,
  close,
  save,
}: {
  settings: Settings;
  dataPath: string;
  close: () => void;
  save: (s: SaveSettings) => Promise<unknown>;
}) {
  const [protocol, setProtocol] = useState(settings.protocol);
  const [baseUrl, setBaseUrl] = useState(settings.baseUrl);
  const [model, setModel] = useState(settings.model);
  const [apiKey, setKey] = useState("");
  const [max, setMax] = useState(settings.maxInputChars);
  const [clear, setClear] = useState(false);
  const [saving, setSaving] = useState(false);
  return (
    <Modal title="选择狗狗的协作模型" close={close}>
      <p>选择接口协议，并填写服务提供的完整请求 URL。</p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setSaving(true);
          void save({
            protocol,
            baseUrl,
            model,
            maxInputChars: max,
            apiKey: apiKey || undefined,
            clearKey: clear,
          }).finally(() => {
            setKey("");
            setSaving(false);
          });
        }}
      >
        <label>
          接口协议
          <select
            aria-label="接口协议"
            value={protocol}
            onChange={(e) => setProtocol(e.target.value as ModelProtocol)}
          >
            {Object.entries(protocolLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          服务地址
          <input
            aria-label="服务地址"
            required
            type="url"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder={
              protocol === "anthropic"
                ? "https://your-provider.example/v1/messages"
                : protocol === "openai-responses"
                  ? "https://your-provider.example/v1/responses"
                  : "https://your-provider.example/v1/chat/completions"
            }
          />
        </label>
        <small className="field-help">
          填写完整接口 URL，按原地址发送，不追加路径；更换地址时需重新填写密钥。
        </small>
        <label>
          模型名
          <input
            aria-label="模型名"
            required
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder="填写服务支持的准确模型 ID"
          />
        </label>
        <label>
          API Key
          <input
            aria-label="API Key"
            type="password"
            autoComplete="off"
            value={apiKey}
            onChange={(e) => setKey(e.target.value)}
            placeholder={
              settings.hasKey
                ? "已加密保存，留空保持原值"
                : "填写密钥；无需鉴权的服务可留空"
            }
          />
        </label>
        {settings.hasKey && (
          <label className="checkbox">
            <input
              type="checkbox"
              checked={clear}
              onChange={(e) => setClear(e.target.checked)}
            />
            清除已保存密钥
          </label>
        )}
        <label>
          输入字符上限
          <input
            aria-label="输入字符上限"
            required
            type="number"
            min={5000}
            max={1000000}
            value={max}
            onChange={(e) => setMax(Number(e.target.value))}
          />
        </label>
        <small className="field-help">
          包含诊断指令与轨迹，不等同于 token 数；默认
          60000，请根据模型容量调整。
        </small>
        <div className="data-path">
          <strong>本地复盘目录</strong>
          <code>{dataPath}</code>
          <small>
            草稿、轨迹快照与报告保存在本机；持续对话位于同级 conversations
            目录。已保存密钥不会回传界面。
          </small>
        </div>
        <div className="form-actions">
          <button className="secondary" type="button" onClick={close}>
            取消
          </button>
          <button className="primary" disabled={saving} type="submit">
            {saving ? "正在保存…" : "保存配置"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
