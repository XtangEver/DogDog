export type EventKind = "message" | "tool_call" | "tool_result" | "context";
export interface TraceEvent {
  id: string;
  kind: EventKind;
  role?: string;
  text: string;
  line: number;
  turn: number;
  timestamp?: string;
  callId?: string;
  name?: string;
}
export interface TraceStats {
  turns: number;
  toolCalls: number;
  durationMs?: number;
  totalTokens?: number;
}
export interface Trace {
  id: string;
  path: string;
  hash: string;
  title: string;
  cwd: string;
  model?: string;
  version?: string;
  startedAt?: string;
  events: TraceEvent[];
  turns: number;
  warnings: string[];
  stats: TraceStats;
}
export interface SessionSummary {
  path: string;
  name: string;
  title?: string;
  modified: string;
  size: number;
}
export interface Task {
  goal: string;
  criteria: string;
  complaint: string;
  fromTurn: number;
  toTurn: number;
  fromLine?: number;
  toLine?: number;
}
export const categories = [
  "需求表达",
  "协作方式",
  "工具环境",
  "模型能力",
] as const;
export interface Finding {
  id: string;
  category: (typeof categories)[number];
  title: string;
  certainty: "事实" | "推测";
  explanation: string;
  evidenceIds: string[];
  action: string;
  verification: string;
  featureIds: string[];
}
export interface Report {
  summary: string;
  strengths: Array<{ text: string; evidenceIds: string[] }>;
  findings: Finding[];
  nextPrompt: string;
  limitations: string[];
}
export interface RetryReview {
  trace: Trace;
  adopted: string[];
  outcome: "改善" | "无改善" | "无法判断";
  criteriaResults: string;
  notes: string;
  savedAt: string;
}
export interface Review {
  id: string;
  createdAt: string;
  updatedAt: string;
  trace: Trace;
  task: Task;
  report?: Report;
  analyzedTask?: Task;
  analyzedEventIds?: string[];
  analysisMeta?: {
    model: string;
    endpoint: string;
    at: string;
    guideVersion: string;
  };
  retry?: RetryReview;
}
export const modelProtocols = [
  "openai-responses",
  "anthropic",
  "openai-chat",
] as const;
export type ModelProtocol = (typeof modelProtocols)[number];
export interface Settings {
  protocol: ModelProtocol;
  baseUrl: string;
  model: string;
  maxInputChars: number;
  hasKey: boolean;
}
export interface SaveSettings {
  protocol: ModelProtocol;
  baseUrl: string;
  model: string;
  maxInputChars: number;
  apiKey?: string;
  clearKey?: boolean;
}
export interface Preview {
  protocol: ModelProtocol;
  endpoint: string;
  model: string;
  chars: number;
  maxChars: number;
  events: number;
  turns: string;
  payload: string;
}
export interface FeatureGuide {
  id: string;
  name: string;
  description: string;
  when: string;
  url: string;
  checkedAt: string;
}
export interface BootData {
  sessions: SessionSummary[];
  sessionWarnings: string[];
  reviews: Review[];
  settings: Settings;
  dataPath: string;
}
export interface DogDogAPI {
  boot(): Promise<BootData>;
  refreshSessions(): Promise<{
    sessions: SessionSummary[];
    warnings: string[];
  }>;
  importTrace(): Promise<Trace | null>;
  openTrace(path: string): Promise<Trace>;
  saveReview(review: Review): Promise<Review>;
  saveSettings(settings: SaveSettings): Promise<Settings>;
  preview(review: Review): Promise<Preview>;
  diagnose(review: Review): Promise<Review>;
  cancel(): Promise<void>;
  copy(text: string): Promise<void>;
  exportReview(review: Review): Promise<boolean>;
  openGuide(id: string): Promise<void>;
}
