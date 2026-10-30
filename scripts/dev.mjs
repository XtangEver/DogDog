import { build } from "esbuild";
import { createServer } from "vite";
import { spawn } from "node:child_process";
import electron from "electron";
await build({
  entryPoints: ["src/main/main.ts", "src/main/preload.ts"],
  outdir: "dist",
  outExtension: { ".js": ".cjs" },
  bundle: true,
  platform: "node",
  format: "cjs",
  external: ["electron"],
});
const server = await createServer();
await server.listen();
const env = { ...process.env, DOGDOG_DEV_URL: server.resolvedUrls.local[0] };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, ["."], {
  env,
  stdio: "inherit",
  // This is the interactive application, not a background helper.
  windowsHide: false,
});
const close = async () => {
  child.kill();
  await server.close();
};
child.on("exit", async (code) => {
  await server.close();
  process.exit(code ?? 0);
});
process.on("SIGINT", close);
process.on("SIGTERM", close);
