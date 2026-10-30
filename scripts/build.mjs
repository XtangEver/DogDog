import { build } from "esbuild";
import { build as viteBuild } from "vite";
import { mkdir, copyFile } from "node:fs/promises";
await build({
  entryPoints: ["src/main/main.ts", "src/main/preload.ts"],
  outdir: "dist",
  entryNames: "[name]",
  outExtension: { ".js": ".cjs" },
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  external: ["electron"],
  sourcemap: false,
});
await viteBuild();
await mkdir("dist/assets", { recursive: true });
await copyFile("assets/dogdog.ico", "dist/assets/dogdog.ico");
