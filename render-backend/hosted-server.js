import path from "node:path";
import process from "node:process";
import { createHostedApp } from "./hosted/app.js";
import { createSecretBox, loadMasterKey } from "./hosted/crypto.js";
import { createGameExecutor } from "./hosted/game-actions.js";
import { parseTaskConcurrency, TaskRunner } from "./hosted/runner.js";
import { HostedStore } from "./hosted/store.js";
import "dotenv/config";

async function main() {
  const dataDir = path.resolve(process.env.DATA_DIR || "/data");
  const dbPath = path.join(dataDir, "hosted.sqlite");
  const concurrency = parseTaskConcurrency(process.env.HOSTED_TASK_CONCURRENCY);
  const secretBox = createSecretBox(await loadMasterKey(dataDir, dbPath));
  const store = new HostedStore({ dbPath });
  const runner = new TaskRunner({
    store,
    executeAction: createGameExecutor({ secretBox }),
    concurrency,
    log: (event, details) =>
      console.info(JSON.stringify({ event, ...details })),
  });
  const app = createHostedApp({
    store,
    secretBox,
    runner,
    allowRegistration: process.env.ALLOW_REGISTRATION !== "false",
    cookieSecure: /^(?:1|true|yes)$/i.test(process.env.COOKIE_SECURE || ""),
  });
  const port = Number(process.env.PORT || 3000);
  const server = app.listen(port, "0.0.0.0", () => {
    runner.start();
    console.info(
      `Hosted task manager listening on ${port}; concurrency: ${concurrency}; data directory: ${dataDir}`,
    );
  });
  let shuttingDown = false;
  async function shutdown() {
    if (shuttingDown) return;
    shuttingDown = true;
    const force = setTimeout(() => process.exit(1), 10000);
    force.unref();
    await runner.stop();
    server.close(() => {
      clearTimeout(force);
      store.close();
      process.exit(0);
    });
  }
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

main().catch((error) => {
  console.error("Hosted server failed to start:", error.message);
  process.exitCode = 1;
});
