/* eslint-disable test/no-import-node-test -- project acceptance runs these with node --test. */
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { TaskRunner } from "./runner.js";
import { HostedStore } from "./store.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn) {
  for (let i = 0; i < 100; i++) {
    const v = fn();
    if (v) return v;
    await sleep(10);
  }
  throw new Error("Timed out waiting for task runner");
}
function addAccount(store, userId) {
  return store.insertAccount({
    userId,
    name: "role",
    roleId: "r",
    credentialEnc: "encrypted",
  });
}

test("queue runs serially, records failures, and scheduler occurrences are deduplicated", async (t) => {
  const store = new HostedStore({ dbPath: ":memory:" });
  t.after(() => store.close());
  const userId = store.createUser("u", "test-hash").id;
  const a = addAccount(store, userId);
  const b = addAccount(store, userId);
  const job = store.insertJob({
    userId,
    name: "job",
    accountIds: [a.id, b.id],
    actions: ["signIn"],
    enabled: true,
    scheduleType: "daily",
    scheduleValue: "1 8 * * *",
    timezone: "Asia/Shanghai",
  });
  let active = 0;
  let maxActive = 0;
  let calls = 0;
  const runner = new TaskRunner({
    store,
    concurrency: 1,
    executeAction: async (account, action) => {
      assert.equal(action, "signIn");
      active++;
      maxActive = Math.max(active, maxActive);
      calls++;
      await sleep(15);
      active--;
      if (account.id === b.id) throw new Error("game operation rejected");
    },
  });
  const result = runner.enqueue(job, userId);
  assert.equal(result.count, 2);
  await until(
    () =>
      store.getRun(userId, result.runIds[0])?.status === "succeeded" &&
      store.getRun(userId, result.runIds[1])?.status === "failed",
  );
  assert.equal(maxActive, 1);
  assert.equal(calls, 2);
  assert.match(
    store.getRun(userId, result.runIds[1]).message,
    /game operation rejected/,
  );
  const now = Date.parse("2026-10-29T15:01:00Z");
  let transactionDepthAtExecution;
  const scheduledRunner = new TaskRunner({
    store,
    executeAction: async () => {
      transactionDepthAtExecution = store.transactionDepth;
    },
    clock: () => now,
  });
  scheduledRunner.scheduleOccurrence(job.id);
  scheduledRunner.scheduleOccurrence(job.id);
  assert.equal(
    store.listRuns(userId, 100).filter((r) => r.job_id === job.id).length,
    4,
  );
  await until(() => transactionDepthAtExecution !== undefined);
  assert.equal(transactionDepthAtExecution, 0);
  await scheduledRunner.stop();
  await runner.stop();
});

test("restart keeps queued work and sessions, marks uncertain running work failed without retry", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "xyzw-hosted-restart-"));
  const dbPath = path.join(dir, "db.sqlite");
  const first = new HostedStore({ dbPath });
  const userId = first.createUser("u", "test-hash").id;
  const account = addAccount(first, userId);
  const job = first.insertJob({
    userId,
    name: "job",
    accountIds: [account.id],
    actions: ["signIn"],
    scheduleType: "daily",
    scheduleValue: "0 8 * * *",
    timezone: "Asia/Shanghai",
  });
  first.createSession("session-hash", userId, Date.now() + 60000);
  const [queuedId, runningId] = ["queued", "running"].map(() =>
    Math.random().toString(36).slice(2),
  );
  first.insertRuns([
    {
      id: queuedId,
      userId,
      jobId: job.id,
      groupId: "g",
      accountId: account.id,
      accountName: "role",
      action: "signIn",
    },
    {
      id: runningId,
      userId,
      jobId: job.id,
      groupId: "g",
      accountId: account.id,
      accountName: "role",
      action: "signIn",
    },
  ]);
  first.startRun(runningId);
  first.close();
  const second = new HostedStore({ dbPath });
  t.after(async () => {
    second.close();
    await rm(dir, { recursive: true, force: true });
  });
  assert.equal(second.getSession("session-hash").user_id, userId);
  assert.equal(second.getRun(userId, queuedId).status, "queued");
  assert.equal(second.getRun(userId, runningId).status, "failed");
  assert.match(second.getRun(userId, runningId).message, /result is unknown/);
  let actions = 0;
  const runner = new TaskRunner({
    store: second,
    executeAction: async () => {
      actions++;
    },
  });
  runner.start();
  await until(() => second.getRun(userId, queuedId).status === "succeeded");
  assert.equal(actions, 1);
  await runner.stop();
});


test("partial outcomes persist completed skipped failed counts and all-failed stays failed", async (t) => {
  const store = new HostedStore({ dbPath: ":memory:" });
  t.after(() => store.close());
  const userId = store.createUser("u", "test-hash").id;
  const account = addAccount(store, userId);
  const job = store.insertJob({
    userId, name: "partial", accountIds: [account.id], actions: ["batchPlan"],
    scheduleType: "daily", scheduleValue: "0 8 * * *", timezone: "Asia/Shanghai",
  });
  const runner = new TaskRunner({
    store,
    executeAction: async (_account, _action, _config, context) => {
      context.onProgress("task result recorded");
      return { completed: 2, skipped: 1, failed: 1, commandCount: 9 };
    },
  });
  const result = runner.enqueue(job, userId);
  await until(() => store.getRun(userId, result.runIds[0])?.status === "partial");
  const run = store.getRun(userId, result.runIds[0]);
  assert.match(run.message, /已完成 2 项，跳过 1 项，失败 1 项/);
  assert.deepEqual(JSON.parse(run.logs_json), ["task result recorded"]);
  await runner.stop();

  const allFailedRunner = new TaskRunner({
    store,
    executeAction: async () => ({ completed: 0, skipped: 2, failed: 1, commandCount: 4 }),
  });
  const failed = allFailedRunner.enqueue(job, userId);
  await until(() => store.getRun(userId, failed.runIds[0])?.status === "failed");
  assert.match(store.getRun(userId, failed.runIds[0]).message, /失败 1 项/);
  await allFailedRunner.stop();
});
