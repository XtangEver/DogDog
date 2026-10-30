import type { Task, Trace } from "./types";
export function selectEvents(trace: Trace, task: Task) {
  return trace.events.filter(
    (e) =>
      e.turn >= task.fromTurn &&
      e.turn <= task.toTurn &&
      (task.fromLine == null || e.line >= task.fromLine) &&
      (task.toLine == null || e.line <= task.toLine),
  );
}
export function eventBounds(trace: Trace) {
  return trace.events.reduce(
    (b, e) => ({
      firstTurn: Math.min(b.firstTurn, e.turn),
      lastTurn: Math.max(b.lastTurn, e.turn),
      firstLine: Math.min(b.firstLine, e.line),
      lastLine: Math.max(b.lastLine, e.line),
    }),
    { firstTurn: Infinity, lastTurn: 1, firstLine: Infinity, lastLine: 1 },
  );
}
