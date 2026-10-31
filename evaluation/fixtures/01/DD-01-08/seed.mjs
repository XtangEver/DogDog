import { readFile, writeFile, mkdir, copyFile } from "node:fs/promises";
import { resolve, join } from "node:path";
const runDir = resolve(process.argv[2] || "");
if (!process.argv[2])
  throw new Error("usage: node seed.mjs PREPARED_ABSOLUTE_RUN_DIR [ENDPOINT]");
await readFile(join(runDir, "launch-env.json"), "utf8");
const endpoint = process.argv[3];
if (!endpoint) throw new Error("provide loopback endpoint");
const s = JSON.parse(
  await readFile(new URL("./legacy-settings.json", import.meta.url), "utf8"),
);
s.baseUrl = endpoint;
await writeFile(
  join(runDir, "profile", "settings.json"),
  JSON.stringify(s, null, 2),
);
