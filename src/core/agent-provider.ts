import { endpointUrl } from "./diagnosis";
import type {
  AgentRequest,
  AgentWireMessage,
  ModelProtocol,
  Settings,
  ToolCall,
} from "../shared/types";

type Obj = Record<string, any>;
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Obj;
}
export interface ModelTurn {
  text: string;
  calls: ToolCall[];
  native?: unknown[];
}
export function buildAgentRequest(
  settings: Settings,
  instructions: string,
  wire: AgentWireMessage[],
  tools: ToolDefinition[],
): AgentRequest {
  if (!settings.model.trim()) throw new Error("请先配置模型和完整接口地址。");
  let body: Obj;
  if (settings.protocol === "openai-responses") {
    const input = wire.flatMap((m): Obj[] => {
      if (m.role === "tool")
        return [
          { type: "function_call_output", call_id: m.callId, output: m.text },
        ];
      if (m.role === "assistant" && m.native) return m.native as Obj[];
      return [
        ...(m.text ? [{ role: m.role, content: m.text }] : []),
        ...(m.calls ?? []).map((c) => ({
          type: "function_call",
          call_id: c.id,
          name: c.name,
          arguments: c.arguments,
        })),
      ];
    });
    body = {
      model: settings.model,
      stream: true,
      store: false,
      instructions,
      input,
      include: ["reasoning.encrypted_content"],
      tools: tools.map((t) => ({ type: "function", ...t, strict: false })),
    };
  } else if (settings.protocol === "anthropic") {
    const messages: Obj[] = [];
    for (const m of wire) {
      const role = m.role === "tool" ? "user" : m.role;
      const content =
        m.role === "tool"
          ? [{ type: "tool_result", tool_use_id: m.callId, content: m.text }]
          : (m.native ?? [
              ...(m.text ? [{ type: "text", text: m.text }] : []),
              ...(m.calls ?? []).map((c) => ({
                type: "tool_use",
                id: c.id,
                name: c.name,
                input: JSON.parse(c.arguments),
              })),
            ]);
      if (messages.at(-1)?.role === role)
        messages.at(-1)!.content.push(...content);
      else messages.push({ role, content: [...content] });
    }
    body = {
      model: settings.model,
      stream: true,
      max_tokens: 8192,
      system: instructions,
      messages,
      tools: tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.parameters,
      })),
    };
  } else {
    body = {
      model: settings.model,
      stream: true,
      messages: [
        { role: "system", content: instructions },
        ...wire.map((m) => {
          if (m.role === "tool")
            return { role: "tool", tool_call_id: m.callId, content: m.text };
          return {
            role: m.role,
            content: m.text || null,
            ...(m.calls?.length
              ? {
                  tool_calls: m.calls.map((c) => ({
                    id: c.id,
                    type: "function",
                    function: { name: c.name, arguments: c.arguments },
                  })),
                }
              : {}),
          };
        }),
      ],
      tools: tools.map((t) => ({
        type: "function",
        function: { ...t, strict: false },
      })),
    };
  }
  const payload = JSON.stringify(body);
  if (payload.length > settings.maxInputChars)
    throw new Error(
      `请求共 ${payload.length} 字符，超过上限 ${settings.maxInputChars}；请新建讨论或缩小来源范围，未发送本次请求。`,
    );
  return {
    at: new Date().toISOString(),
    protocol: settings.protocol,
    endpoint: endpointUrl(settings.baseUrl),
    model: settings.model,
    payload,
    chars: payload.length,
  };
}
function normalize(protocol: ModelProtocol, body: Obj): ModelTurn {
  if (body.error) throw new Error("模型服务返回错误，未保存为完整回答。");
  let text = "",
    calls: ToolCall[] = [],
    native: unknown[] | undefined;
  if (protocol === "openai-responses") {
    if (body.status && body.status !== "completed")
      throw new Error("模型响应未完成，请手动重试。");
    if (!Array.isArray(body.output))
      throw new Error("模型响应与 Responses 协议不匹配。");
    native = body.output;
    for (const item of body.output) {
      if (item.type === "function_call")
        calls.push({
          id: item.call_id,
          name: item.name,
          arguments: item.arguments,
        });
      if (item.type === "message")
        for (const p of item.content ?? [])
          if (p.type === "output_text") text += p.text;
    }
  } else if (protocol === "anthropic") {
    if (!["end_turn", "tool_use", "stop_sequence"].includes(body.stop_reason))
      throw new Error("模型响应被截断或未完成。");
    if (!Array.isArray(body.content))
      throw new Error("模型响应与 Messages 协议不匹配。");
    native = body.content;
    for (const p of body.content) {
      if (p.type === "text") text += p.text;
      if (p.type === "tool_use")
        calls.push({
          id: p.id,
          name: p.name,
          arguments: JSON.stringify(p.input),
        });
    }
  } else {
    const choice = body.choices?.[0];
    if (!choice || !["stop", "tool_calls"].includes(choice.finish_reason))
      throw new Error("模型响应被截断或协议不匹配。");
    text = choice.message?.content ?? "";
    calls = (choice.message?.tool_calls ?? []).map((c: Obj) => ({
      id: c.id,
      name: c.function?.name,
      arguments: c.function?.arguments,
    }));
  }
  if (
    typeof text !== "string" ||
    calls.length > 24 ||
    calls.some(
      (c) =>
        !c.id || typeof c.name !== "string" || typeof c.arguments !== "string",
    ) ||
    new Set(calls.map((c) => c.id)).size !== calls.length
  )
    throw new Error("模型返回无效的文本或工具调用。");
  if (!text.trim() && !calls.length)
    throw new Error("模型没有返回文本或工具调用。");
  return { text, calls, native };
}
export async function requestAgentTurn(
  request: AgentRequest,
  key: string,
  signal: AbortSignal,
  onDelta: (text: string) => void,
  fetcher: typeof fetch = fetch,
): Promise<ModelTurn> {
  const timeout = AbortSignal.timeout(120000),
    combined = AbortSignal.any([signal, timeout]);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (request.protocol === "anthropic") {
    headers["anthropic-version"] = "2023-06-01";
    if (key) headers["x-api-key"] = key;
  } else if (key) headers.Authorization = `Bearer ${key}`;
  try {
    const response = await fetcher(request.endpoint, {
      method: "POST",
      body: request.payload,
      headers,
      signal: combined,
      redirect: "error",
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(
        `模型服务返回 HTTP ${response.status}，请检查配置或额度后手动重试。`,
      );
    }
    const reader = response.body?.getReader();
    if (!reader) throw new Error("模型响应为空。");
    const decoder = new TextDecoder(),
      sse = response.headers.get("content-type")?.includes("text/event-stream");
    let size = 0,
      buffer = "",
      raw = "",
      text = "",
      ended = false,
      reason = "";
    let finalBody: Obj | undefined;
    const items = new Map<number, Obj>(),
      blocks = new Map<number, Obj>(),
      chatCalls = new Map<number, Obj>();
    const safe = (value: string) =>
      key ? value.replaceAll(key, "[密钥已隐藏]") : value;
    const processEvent = (data: string) => {
      if (data === "[DONE]") {
        if (request.protocol === "openai-chat") ended = true;
        return;
      }
      const e = JSON.parse(safe(data));
      if (
        e.type === "error" ||
        e.error ||
        ["response.failed", "response.incomplete"].includes(e.type)
      )
        throw new Error("模型流式响应失败或被截断。");
      if (request.protocol === "openai-responses") {
        if (e.type === "response.output_text.delta") {
          text += e.delta;
          onDelta(e.delta);
        }
        if (
          e.type === "response.output_item.added" ||
          e.type === "response.output_item.done"
        )
          items.set(e.output_index, e.item);
        if (e.type === "response.function_call_arguments.delta") {
          const item = items.get(e.output_index);
          if (item) item.arguments = (item.arguments ?? "") + e.delta;
        }
        if (e.type === "response.function_call_arguments.done") {
          const item = items.get(e.output_index);
          if (item) item.arguments = e.arguments;
        }
        if (e.type === "response.completed") {
          ended = true;
          finalBody = e.response;
        }
      } else if (request.protocol === "anthropic") {
        if (e.type === "content_block_start")
          blocks.set(e.index, { ...e.content_block, _arguments: "" });
        if (e.type === "content_block_delta") {
          const block = blocks.get(e.index);
          if (!block) throw new Error("流式内容缺少开始事件。");
          if (e.delta.type === "text_delta") {
            block.text = (block.text ?? "") + e.delta.text;
            text += e.delta.text;
            onDelta(e.delta.text);
          }
          if (e.delta.type === "input_json_delta")
            block._arguments += e.delta.partial_json;
          if (e.delta.type === "thinking_delta")
            block.thinking = (block.thinking ?? "") + e.delta.thinking;
          if (e.delta.type === "signature_delta")
            block.signature = (block.signature ?? "") + e.delta.signature;
        }
        if (e.type === "message_delta") reason = e.delta?.stop_reason ?? reason;
        if (e.type === "message_stop") ended = true;
      } else {
        const choice = e.choices?.[0];
        if (!choice) return;
        reason = choice.finish_reason ?? reason;
        if (choice.delta?.content) {
          text += choice.delta.content;
          onDelta(choice.delta.content);
        }
        for (const c of choice.delta?.tool_calls ?? []) {
          const item = chatCalls.get(c.index) ?? {
            id: "",
            type: "function",
            function: { name: "", arguments: "" },
          };
          if (c.id) item.id = c.id;
          if (c.function?.name) item.function.name += c.function.name;
          if (c.function?.arguments)
            item.function.arguments += c.function.arguments;
          chatCalls.set(c.index, item);
        }
      }
    };
    try {
      for (;;) {
        if (combined.aborted) throw new Error();
        const { value, done } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 2_000_000)
          throw new Error("模型响应超过 2 MB，已停止读取。");
        const chunk = decoder.decode(value, { stream: true });
        if (!sse) {
          raw += chunk;
          continue;
        }
        buffer += chunk;
        // SSE event boundaries can cross network chunks, including CRLF pairs.
        for (;;) {
          const match = /\r?\n\r?\n/.exec(buffer);
          if (!match) break;
          const frame = buffer.slice(0, match.index);
          buffer = buffer.slice(match.index + match[0].length);
          const data = frame
            .split(/\r?\n/)
            .filter((l) => l.startsWith("data:"))
            .map((l) => l.slice(5).trimStart())
            .join("\n");
          if (data) processEvent(data);
        }
      }
      if (combined.aborted) throw new Error();
      if (!sse) {
        const result = normalize(
          request.protocol,
          JSON.parse(safe(raw + decoder.decode())),
        );
        if (result.text) onDelta(result.text);
        return result;
      }
      if (!ended) throw new Error("流式响应意外结束，请手动重试。");
      if (request.protocol === "openai-responses")
        finalBody ??= {
          status: "completed",
          output: [...items.entries()]
            .sort((a, b) => a[0] - b[0])
            .map(([, v]) => v),
        };
      else if (request.protocol === "anthropic")
        finalBody = {
          stop_reason: reason,
          content: [...blocks.entries()]
            .sort((a, b) => a[0] - b[0])
            .map(([, b]) => {
              const { _arguments, ...block } = b;
              if (block.type === "tool_use" && _arguments)
                block.input = JSON.parse(_arguments);
              return block;
            }),
        };
      else
        finalBody = {
          choices: [
            {
              finish_reason: reason,
              message: {
                content: text,
                tool_calls: [...chatCalls.entries()]
                  .sort((a, b) => a[0] - b[0])
                  .map(([, c]) => c),
              },
            },
          ],
        };
      const result = normalize(request.protocol, finalBody!);
      if (!text && result.text) onDelta(result.text);
      return result;
    } finally {
      await reader.cancel().catch(() => {});
    }
  } catch (error) {
    if (signal.aborted) throw new Error("已停止分析，未完成回答已保留。");
    if (timeout.aborted) throw new Error("模型请求超过 120 秒，请手动重试。");
    if (
      error instanceof Error &&
      /[\u3400-\u9fff]/.test(error.message) &&
      error.message.length < 500
    )
      throw error;
    throw new Error("模型连接失败或响应无效，请检查协议及接口地址后手动重试。");
  }
}
