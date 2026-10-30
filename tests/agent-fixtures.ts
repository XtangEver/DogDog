import type { ModelProtocol, ToolCall } from "../src/shared/types";
export function traceFixture(id = "a", marker = "TRACE_ONLY_A") {
  const row = (type: string, payload: unknown) =>
    JSON.stringify({ timestamp: "2026-10-30T00:00:00Z", type, payload });
  return [
    row("session_meta", { id, cwd: "D:\\合成项目", cli_version: "fixture" }),
    row("response_item", {
      type: "message",
      role: "user",
      content: [{ text: `合成任务 ${id}：实现导出，要求全部测试通过。` }],
    }),
    row("response_item", {
      type: "function_call",
      name: "exec_command",
      call_id: "c1",
      arguments: "npm test",
    }),
    row("response_item", {
      type: "function_call_output",
      call_id: "c1",
      output: `1 test failed ${marker}`,
    }),
    row("response_item", {
      type: "message",
      role: "assistant",
      content: [{ text: "已经完成。" }],
    }),
  ].join("\n");
}
export function toolCall(
  name: string,
  args: unknown = {},
  id = `call-${name}`,
): ToolCall {
  return { id, name, arguments: JSON.stringify(args) };
}
export function streamTurn(
  protocol: ModelProtocol,
  text = "",
  calls: ToolCall[] = [],
) {
  const frames: unknown[] = [];
  if (protocol === "openai-responses") {
    const output: unknown[] = [];
    if (text) {
      output.push({
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text }],
      });
      frames.push(
        { type: "response.output_text.delta", delta: text.slice(0, 3) },
        { type: "response.output_text.delta", delta: text.slice(3) },
      );
    }
    calls.forEach((c, index) => {
      const item = {
        type: "function_call",
        call_id: c.id,
        name: c.name,
        arguments: c.arguments,
      };
      frames.push(
        {
          type: "response.output_item.added",
          output_index: index,
          item: { ...item, arguments: "" },
        },
        {
          type: "response.function_call_arguments.delta",
          output_index: index,
          delta: c.arguments.slice(0, 3),
        },
        {
          type: "response.function_call_arguments.delta",
          output_index: index,
          delta: c.arguments.slice(3),
        },
        {
          type: "response.function_call_arguments.done",
          output_index: index,
          arguments: c.arguments,
        },
        { type: "response.output_item.done", output_index: index, item },
      );
      output.push(item);
    });
    frames.push({
      type: "response.completed",
      response: { status: "completed", output },
    });
  } else if (protocol === "anthropic") {
    frames.push({ type: "message_start", message: { content: [] } });
    let index = 0;
    if (text) {
      frames.push(
        {
          type: "content_block_start",
          index,
          content_block: { type: "text", text: "" },
        },
        {
          type: "content_block_delta",
          index,
          delta: { type: "text_delta", text },
        },
        { type: "content_block_stop", index },
      );
      index++;
    }
    for (const c of calls) {
      frames.push(
        {
          type: "content_block_start",
          index,
          content_block: {
            type: "tool_use",
            id: c.id,
            name: c.name,
            input: {},
          },
        },
        {
          type: "content_block_delta",
          index,
          delta: {
            type: "input_json_delta",
            partial_json: c.arguments.slice(0, 3),
          },
        },
        {
          type: "content_block_delta",
          index,
          delta: {
            type: "input_json_delta",
            partial_json: c.arguments.slice(3),
          },
        },
        { type: "content_block_stop", index },
      );
      index++;
    }
    frames.push(
      {
        type: "message_delta",
        delta: { stop_reason: calls.length ? "tool_use" : "end_turn" },
      },
      { type: "message_stop" },
    );
  } else {
    if (text) frames.push({ choices: [{ delta: { content: text } }] });
    calls.forEach((c, index) => {
      frames.push(
        {
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index,
                    id: c.id,
                    function: {
                      name: c.name,
                      arguments: c.arguments.slice(0, 3),
                    },
                  },
                ],
              },
            },
          ],
        },
        {
          choices: [
            {
              delta: {
                tool_calls: [
                  { index, function: { arguments: c.arguments.slice(3) } },
                ],
              },
            },
          ],
        },
      );
    });
    frames.push({
      choices: [
        { delta: {}, finish_reason: calls.length ? "tool_calls" : "stop" },
      ],
    });
  }
  return (
    frames.map((f) => `data: ${JSON.stringify(f)}\r\n\r\n`).join("") +
    (protocol === "openai-chat" ? "data: [DONE]\r\n\r\n" : "")
  );
}
