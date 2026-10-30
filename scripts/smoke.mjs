import { _electron } from "@playwright/test";
import electronPath from "electron";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
const data = await mkdtemp(join(tmpdir(), "dogdog-smoke-"));
const target = process.argv.includes("--dev") ? "dev" : "packaged";
const env = { ...process.env, DOGDOG_USER_DATA: data };
delete env.ELECTRON_RUN_AS_NODE;
if (target === "dev") env.DOGDOG_DEV_URL = "http://127.0.0.1:5173/";
const app = await _electron.launch({
  executablePath:
    target === "dev"
      ? electronPath
      : resolve("release/win-unpacked/DogDog.exe"),
  args: target === "dev" ? [resolve(".")] : [],
  env,
});
try {
  const page = await app.firstWindow();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page
    .getByRole("button", { name: "新建讨论" })
    .waitFor({ timeout: 15000 });
  const state = await app.evaluate(({ app, BrowserWindow }) => ({
    packaged: app.isPackaged,
    visible: BrowserWindow.getAllWindows()[0].isVisible(),
    url: BrowserWindow.getAllWindows()[0].webContents.getURL(),
    version: app.getVersion(),
  }));
  const boundaries = await page.evaluate(() => ({
    requireAvailable: typeof window.require !== "undefined",
    apiAvailable: typeof window.dogdog?.boot === "function",
  }));
  const boot = await page.evaluate(() => window.dogdog.boot());
  if (boundaries.requireAvailable || !boundaries.apiAvailable || errors.length)
    throw new Error(JSON.stringify({ boundaries, errors }));
  await mkdir("verification/screenshots", { recursive: true });
  await page.screenshot({ path: `verification/screenshots/04-${target}.png` });
  const report = {
    target,
    ...state,
    boundaries,
    sessionCount: boot.sessions.length,
    rendererErrors: errors,
  };
  await writeFile(
    `verification/${target}-smoke.json`,
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
} catch (e) {
  console.error(e);
  console.error(
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().map((w) => ({
        visible: w.isVisible(),
        url: w.webContents.getURL(),
        loading: w.webContents.isLoading(),
      })),
    ),
  );
  process.exitCode = 1;
} finally {
  await app.close();
  if (!resolve(data).startsWith(resolve(tmpdir(), "dogdog-smoke-")))
    throw new Error("Unsafe cleanup path");
  await rm(data, { recursive: true, force: true });
}
