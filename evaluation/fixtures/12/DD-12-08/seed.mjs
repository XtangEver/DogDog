import { readFile, writeFile, mkdir, copyFile } from "node:fs/promises";
import { resolve, join } from "node:path";
const runDir = resolve(process.argv[2] || "");
if (!process.argv[2])
  throw new Error("usage: node seed.mjs PREPARED_ABSOLUTE_RUN_DIR [ENDPOINT]");
await readFile(join(runDir, "launch-env.json"), "utf8");
const source = join(runDir, "legacy-source.jsonl");
await copyFile(new URL("./legacy-source.jsonl", import.meta.url), source);
const r = JSON.parse(
  await readFile(new URL("./legacy-review.json", import.meta.url), "utf8"),
);
r.trace.path = source;
const reviews = join(runDir, "profile", "reviews");
await mkdir(reviews, { recursive: true });
await writeFile(join(reviews, r.id + ".json"), JSON.stringify(r, null, 2));
