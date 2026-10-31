// Harvest a claude stream-json transcript into a redacted action summary.
// Secrets (GLM_API_KEY value, Authorization headers, sk- tokens) are scrubbed
// from every derivative BEFORE it is written or fed to another session.
// Raw transcripts stay local under evaluation/runs/ (gitignored).
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join, basename } from "node:path";

function redactors() {
  const rules = [];
  const key = process.env.GLM_API_KEY;
  if (key && key.length > 8) rules.push({ re: new RegExp(key, "g"), to: "[REDACTED:GLM_API_KEY]" });
  rules.push({ re: /sk-[A-Za-z0-9_-]{8,}/g, to: "[REDACTED:token]" });
  rules.push({ re: /(Authorization\s*[:=]\s*)\S+/gi, to: "$1[REDACTED]" });
  rules.push({ re: /(x-api-key\s*[:=]\s*)\S+/gi, to: "$1[REDACTED]" });
  return rules;
}

export function redact(text) {
  if (typeof text !== "string") return text;
  let out = text;
  for (const { re, to } of redactors()) out = out.replace(re, to);
  return out;
}

function clip(s, n = 400) {
  if (typeof s !== "string") return s;
  return s.length > n ? s.slice(0, n) + `…(+${s.length - n} chars)` : s;
}

// Extract tool_use / tool_result pairs, assistant text blocks, images.
export function harvest({
  transcriptPath,
  screenshotDir,
  outPath,
}) {
  if (!existsSync(transcriptPath))
    throw new Error("Missing transcript " + transcriptPath);
  const lines = readFileSync(transcriptPath, "utf8")
    .split(/\r?\n/)
    .filter(Boolean);
  const actions = [];
  const images = [];
  let finalText = "";
  let subtype = null;
  let usage = null;
  let idx = 0;
  for (const line of lines) {
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      continue;
    }
    idx++;
    if (msg.type === "assistant" && Array.isArray(msg.message?.content)) {
      for (const block of msg.message.content) {
        if (block.type === "tool_use") {
          actions.push({
            i: actions.length,
            kind: "tool_use",
            tool: block.name,
            input: redact(
              typeof block.input === "string"
                ? clip(block.input, 800)
                : clip(JSON.stringify(block.input ?? {}), 800),
            ),
          });
        } else if (block.type === "text" && block.text) {
          actions.push({
            i: actions.length,
            kind: "assistant_text",
            text: redact(clip(block.text, 1500)),
          });
        }
      }
    } else if (msg.type === "user" && Array.isArray(msg.message?.content)) {
      for (const block of msg.message.content) {
        if (block.type === "tool_result") {
          const content = Array.isArray(block.content)
            ? block.content
            : [block.content];
          let textOut = "";
          for (const c of content) {
            if (typeof c === "string") textOut += c;
            else if (c?.type === "text" && c.text) textOut += c.text;
            else if (c?.type === "image" && c.source?.type === "base64") {
              images.push({ data: c.source.data, media: c.source.media_type ?? "image/png" });
            }
          }
          actions.push({
            i: actions.length,
            kind: "tool_result",
            text: redact(clip(textOut, 1200)),
          });
        }
      }
    } else if (msg.type === "result") {
      subtype = msg.subtype ?? null;
      if (typeof msg.result === "string") finalText = redact(msg.result);
      usage = msg.usage ?? null;
    }
  }
  // Persist images (screenshots taken by the role) into the run evidence.
  const savedImages = [];
  if (screenshotDir && images.length) {
    mkdirSync(screenshotDir, { recursive: true });
    images.forEach((img, n) => {
      const name = `harvested-${basename(transcriptPath, ".jsonl")}-${String(n).padStart(3, "0")}.png`;
      const p = join(screenshotDir, name);
      try {
        writeFileSync(p, Buffer.from(img.data, "base64"));
        savedImages.push(name);
      } catch {
        /* skip unwritable image */
      }
    });
  }
  const summary = {
    transcript: basename(transcriptPath),
    subtype,
    actionCount: actions.length,
    actions,
    finalText,
    usage,
    savedImages,
    harvestedAt: new Date().toISOString(),
  };
  if (outPath) {
    mkdirSync(join(outPath, ".."), { recursive: true });
    writeFileSync(outPath, JSON.stringify(summary, null, 2), "utf8");
  }
  return summary;
}

// Pull the trailing PROGRESS LOG section (if any) out of a final message.
export function extractProgressLog(finalText) {
  const m = /PROGRESS LOG([\s\S]*)$/i.exec(finalText ?? "");
  return m ? m[1].trim() : "";
}

export function detectCheckpoint(finalText) {
  const m = /^[ \t]*CHECKPOINT:[ \t]*(.+?)\s*$/im.exec(finalText ?? "");
  return m ? m[1].trim() : null;
}
