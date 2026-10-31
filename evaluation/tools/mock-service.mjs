import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { mkdir, appendFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

export function stream(protocol, text = "", calls = []) {
  const frames = [];
  if (protocol === "openai-responses") {
    const output = [];
    if (text) {
      frames.push({ type: "response.output_text.delta", delta: text });
      output.push({
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text }],
      });
    }
    calls.forEach((c, index) => {
      const item = {
        type: "function_call",
        call_id: c.id,
        name: c.name,
        arguments: JSON.stringify(c.arguments),
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
          delta: item.arguments,
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
            partial_json: JSON.stringify(c.arguments),
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
    calls.forEach((c, index) =>
      frames.push({
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index,
                  id: c.id,
                  function: {
                    name: c.name,
                    arguments: JSON.stringify(c.arguments),
                  },
                },
              ],
            },
          },
        ],
      }),
    );
    frames.push({
      choices: [
        { delta: {}, finish_reason: calls.length ? "tool_calls" : "stop" },
      ],
    });
  }
  return (
    frames.map((f) => "data: " + JSON.stringify(f) + "\r\n\r\n").join("") +
    (protocol === "openai-chat" ? "data: [DONE]\r\n\r\n" : "")
  );
}

export async function startMock({
  out,
  port = 0,
  mode = "text",
  text = "通用建议：先明确目标、约束和可验证的验收条件。",
} = {}) {
  if (!out) throw new Error("An isolated output directory is required");
  out = resolve(out);
  await mkdir(out, { recursive: true });
  const calls = [],
    connections = new Set();
  let stage = 0,
    control = { mode, text },
    serial = Promise.resolve();
  const audit = (value) => {
    serial = serial.then(() =>
      appendFile(
        join(out, "requests.jsonl"),
        JSON.stringify(value) + "\n",
        "utf8",
      ),
    );
    return serial;
  };
  const tool = (name, args, id = "call-" + name) => ({
    id,
    name,
    arguments: args,
  });
  const server = createServer(async (req, res) => {
    try {
      let raw = "";
      for await (const chunk of req) {
        raw += chunk;
        if (raw.length > 4_000_000) {
          res.writeHead(413).end();
          return;
        }
      }
      if (req.url === "/control" && req.method === "POST") {
        const next = JSON.parse(raw);
        control = { ...control, ...next };
        stage = 0;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ mode: control.mode }));
        return;
      }
      if (req.url === "/health") {
        res.end("ok");
        return;
      }
      if (!["/responses", "/chat", "/messages"].includes(req.url)) {
        res.writeHead(404).end();
        return;
      }
      const body = JSON.parse(raw || "{}"),
        credential = String(
          req.headers.authorization || req.headers["x-api-key"] || "",
        );
      const entry = {
        index: calls.length + 1,
        at: new Date().toISOString(),
        path: req.url,
        mode: control.mode,
        credentialSha256: createHash("sha256").update(credential).digest("hex"),
        body,
      };
      calls.push(entry);
      await audit(entry);
      if (control.mode === "http401" || control.mode === "http503") {
        res
          .writeHead(control.mode === "http401" ? 401 : 503, {
            "Content-Type": "application/json",
          })
          .end(
            JSON.stringify({
              error: "SYNTHETIC_ERROR_ECHO_KEY=MOCK-NEVER-REAL",
            }),
          );
        return;
      }
      if (control.mode === "redirect") {
        res
          .writeHead(302, { Location: status.url + "/redirect-destination" })
          .end();
        return;
      }
      const p =
        req.url === "/messages"
          ? "anthropic"
          : req.url === "/chat"
            ? "openai-chat"
            : "openai-responses";
      let message = control.text,
        tools = [];
      if (control.mode === "slow") {
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        res.write(
          "data: " +
            JSON.stringify({
              type: "response.output_text.delta",
              delta: "正在生成的部分回答",
            }) +
            "\n\n",
        );
        return;
      }
      if (control.mode === "disconnect") {
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        res.end(
          "data: " +
            JSON.stringify({
              type: "response.output_text.delta",
              delta: "未完成片段",
            }) +
            "\n\n",
        );
        return;
      }
      if (control.mode === "bad-citation") message = "伪造的结论 [S99:L999]。";
      if (control.mode === "ask") {
        if (stage++ === 0) {
          message = "";
          tools = [tool("ask_user", { question: "你希望怎样验收这次改进？" })];
        } else
          message = "根据补充条件，先检查全部测试通过，再检查实际产物可打开。";
      }
      if (control.mode === "auto") {
        const n = stage++;
        if (n === 0) {
          message = "";
          tools = [tool("discover_sessions", { query: "启动" })];
        } else if (n === 1) {
          message = "";
          tools = [tool("search_traces", { query: "启动" })];
        } else if (n === 2) {
          message = "";
          tools = [
            tool(
              "read_trace",
              { sourceId: "S1", fromLine: 2, toLine: 5 },
              "read-1",
            ),
            tool(
              "read_trace",
              { sourceId: "S2", fromLine: 2, toLine: 5 },
              "read-2",
            ),
          ];
        } else
          message =
            "两份合成记录分别包含启动配置修改与后续复测通过的结果 [S1:L4] [S2:L4]。";
      }
      if (control.mode === "script") {
        const next = control.stages?.[stage++];
        message = next?.text || "";
        tools = (next?.tools || []).map((c, i) =>
          tool(c.name, c.args || {}, c.id || `script-${stage}-${i}`),
        );
        if (!next) message = control.text || "合成脚本完成。";
      }
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      const bytes = Buffer.from(stream(p, message, tools));
      const step = control.mode === "fragmented" ? 7 : bytes.length;
      for (let i = 0; i < bytes.length; i += step)
        res.write(bytes.subarray(i, i + step));
      res.end();
    } catch (e) {
      if (!res.headersSent) res.writeHead(400);
      res.end(JSON.stringify({ error: "mock_request_error" }));
    }
  });
  server.on("connection", (socket) => {
    connections.add(socket);
    socket.on("close", () => connections.delete(socket));
  });
  await new Promise((r) => server.listen(port, "127.0.0.1", r));
  const status = {
    url: `http://127.0.0.1:${server.address().port}`,
    pid: process.pid,
    mode,
    syntheticOnly: true,
  };
  await writeFile(join(out, "status.json"), JSON.stringify(status, null, 2));
  return {
    server,
    status,
    calls,
    setMode(next) {
      control = { ...control, ...next };
      stage = 0;
    },
    async close() {
      for (const socket of connections) socket.destroy();
      await new Promise((r) => server.close(r));
      await serial;
    },
  };
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const args = process.argv.slice(2),
    arg = (k) => args[args.indexOf("--" + k) + 1];
  const get = (k, f) => (args.includes("--" + k) ? arg(k) : f);
  const mock = await startMock({
    out: get("out"),
    mode: get("mode", "text"),
    port: Number(get("port", 0)),
    text: get("text", "通用建议：先明确目标、约束和可验证的验收条件。"),
  });
  console.log(JSON.stringify(mock.status));
  process.on("SIGINT", async () => {
    await mock.close();
    process.exit(0);
  });
}
