/* eslint-disable test/no-import-node-test -- project acceptance runs these with node --test. */
import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_TASK_CONCURRENCY,
  parseTaskConcurrency,
  TaskRunner,
} from "./runner.js";
import { HostedStore } from "./store.js";

const sleep = (ms = 10) => new Promise((resolve) => setTimeout(resolve, ms));
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};
async function until(fn, message = "Timed out waiting for task runner") {
  for (let i = 0; i < 500; i++) {
    const value = fn();
    if (value) return value;
    await sleep();
  }
  throw new Error(message);
}
function makeFixture(t, { accountCount = 3, concurrency } = {}) {
  const store = new HostedStore({ dbPath: ":memory:" });
  t.after(() => store.close());
  const userId = store.createUser("u", "test-hash").id;
  const accounts = Array.from({ length: accountCount }, (_, index) =>
    store.insertAccount({
      userId,
      name: `role-${index}`,
      roleId: `r-${index}`,
      credentialEnc: "encrypted",
    }),
  );
  const makeJob = (ids, actions = ["signIn"]) =>
    store.insertJob({
      userId,
      name: "job",
      accountIds: ids,
      actions,
      enabled: true,
      scheduleType: "manual",
      scheduleValue: "",
      timezone: "Asia/Shanghai",
    });
  const makeRunner = (executeAction) => {
    const runner = new TaskRunner({
      store,
      executeAction,
      ...(concurrency === undefined ? {} : { concurrency }),
    });
    t.after(() => runner.stop());
    return runner;
  };
  return { store, userId, accounts, makeJob, makeRunner };
}

test("concurrency defaults to five and validates its configured range", () => {
  assert.equal(DEFAULT_TASK_CONCURRENCY, 5);
  assert.equal(parseTaskConcurrency(), 5);
  assert.equal(parseTaskConcurrency(" 2 "), 2);
  assert.equal(parseTaskConcurrency(""), 5);
  for (const value of [0, -1, 1.5, 21, Number.NaN, Infinity, null, "1.5", "five", "-2"])
    assert.throws(() => parseTaskConcurrency(value));
});

test("default runner executes five distinct accounts and starts the sixth when a slot frees", async (t) => {
  const { store, userId, accounts, makeJob, makeRunner } = makeFixture(t, {
    accountCount: 6,
  });
  const gates = new Map(accounts.map((account) => [account.id, deferred()]));
  const started = [];
  let active = 0;
  let maxActive = 0;
  const runner = makeRunner(async (account) => {
    active++;
    maxActive = Math.max(maxActive, active);
    started.push(account.id);
    try {
      await gates.get(account.id).promise;
    } finally {
      active--;
    }
  });
  const result = runner.enqueue(makeJob(accounts.map((a) => a.id)), userId);
  await until(() => started.length === 5);
  assert.equal(runner.concurrency, 5);
  assert.equal(maxActive, 5);
  assert.equal(started.includes(accounts[5].id), false);
  gates.get(accounts[0].id).resolve();
  await until(() => started.length === 6);
  for (const gate of gates.values()) gate.resolve();
  await until(() => result.runIds.every((id) => store.getRun(userId, id).status === "succeeded"));
  assert.equal(maxActive, 5);
  await runner.stop();
});

test("configured limit two is respected, same-account groups stay serial, and enqueue wakes a free slot", async (t) => {
  const { store, userId, accounts, makeJob, makeRunner } = makeFixture(t, {
    concurrency: "2",
  });
  const [a, b, c] = accounts;
  const aGates = [deferred(), deferred(), deferred(), deferred()];
  const bGate = deferred();
  const cGate = deferred();
  const started = [];
  const counts = new Map();
  let active = 0;
  let maxActive = 0;
  const runner = makeRunner(async (account) => {
    active++;
    maxActive = Math.max(maxActive, active);
    const index = counts.get(account.id) || 0;
    counts.set(account.id, index + 1);
    started.push(account.id);
    const gate = account.id === a.id ? aGates[index] : account.id === b.id ? bGate : cGate;
    try {
      await gate.promise;
    } finally {
      active--;
    }
  });
  const aJob = makeJob([a.id], ["one", "two"]);
  const first = runner.enqueue(aJob, userId);
  const second = runner.enqueue(aJob, userId);
  await until(() => started.length === 1);
  const bRun = runner.enqueue(makeJob([b.id]), userId);
  await until(() => started.length === 2);
  assert.deepEqual(started, [a.id, b.id]);
  const cRun = runner.enqueue(makeJob([c.id]), userId);
  await sleep(20);
  assert.equal(started.length, 2, "third account must wait while two slots are full");
  bGate.resolve();
  await until(() => started.length === 3);
  assert.equal(started[2], c.id, "a new enqueue uses the available slot immediately");
  aGates[0].resolve();
  await until(() => started.length === 4);
  assert.equal(started[3], a.id, "same account resumes in FIFO order");
  cGate.resolve();
  aGates[1].resolve();
  await until(() => started.length === 5);
  aGates[2].resolve();
  await until(() => started.length === 6);
  aGates[3].resolve();
  for (const result of [first, second, bRun, cRun])
    await until(() => result.runIds.every((id) => store.getRun(userId, id).status === "succeeded"));
  assert.equal(maxActive, 2);
  assert.equal(counts.get(a.id), 4);
  await runner.stop();
});

test("a long FIFO prefix for a busy account does not starve a different account", async (t) => {
  const { accounts, userId, makeJob, makeRunner } = makeFixture(t, {
    accountCount: 2,
    concurrency: 2,
  });
  const [a, b] = accounts;
  const gate = deferred();
  const started = [];
  const runner = makeRunner(async (account, action) => {
    started.push([account.id, action]);
    if (account.id === a.id && action === "0") await gate.promise;
  });
  const queued = runner.enqueue(
    makeJob([a.id], Array.from({ length: 120 }, (_, i) => String(i))),
    userId,
  );
  await until(() => started.length === 1);
  runner.enqueue(makeJob([b.id]), userId);
  await until(() => started.length === 2);
  assert.deepEqual(started[1], [b.id, "signIn"]);
  gate.resolve();
  await until(() => queued.runIds.every((id) => runner.store.getRun(userId, id).status === "succeeded"));
  await runner.stop();
});

test("a failed action does not block another account or the next action for the same account", async (t) => {
  const { store, accounts, userId, makeJob, makeRunner } = makeFixture(t, {
    concurrency: 2,
  });
  const [a, b] = accounts;
  const started = [];
  const runner = makeRunner(async (account, action) => {
    started.push([account.id, action]);
    if (account.id === a.id && action === "fail") throw new Error("expected failure");
  });
  const first = runner.enqueue(makeJob([a.id], ["fail", "recover"]), userId);
  const parallel = runner.enqueue(makeJob([b.id]), userId);
  await until(() =>
    [...first.runIds, ...parallel.runIds].every((id) => {
      const status = store.getRun(userId, id).status;
      return status === "succeeded" || status === "failed";
    }),
  );
  assert.equal(store.getRun(userId, first.runIds[0]).status, "failed");
  assert.equal(store.getRun(userId, first.runIds[1]).status, "succeeded");
  assert.equal(store.getRun(userId, parallel.runIds[0]).status, "succeeded");
  assert.deepEqual(started.slice(0, 2).map((x) => x[0]).sort(), [a.id, b.id].sort());
  await runner.stop();
});

test("cancelling one group aborts only its running tasks and retains other groups", async (t) => {
  const { store, accounts, userId, makeJob, makeRunner } = makeFixture(t, {
    accountCount: 4,
    concurrency: 3,
  });
  const [a, b, c, d] = accounts;
  const release = new Map([[c.id, deferred()], [d.id, deferred()]]);
  const started = [];
  const runner = makeRunner((account, _action, _config, { signal }) => {
    started.push(account.id);
    if (account.id === a.id || account.id === b.id)
      return new Promise((_, reject) => {
        if (signal.aborted) reject(signal.reason);
        else signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      });
    return release.get(account.id).promise;
  });
  const targeted = runner.enqueue(makeJob([a.id, b.id]), userId);
  const retained = runner.enqueue(makeJob([c.id, d.id]), userId);
  await until(() => started.length === 3);
  assert.deepEqual(new Set(started), new Set([a.id, b.id, c.id]));
  assert.equal(store.getRun(userId, retained.runIds[1]).status, "queued");
  const result = runner.cancelGroup(userId, targeted.groupId);
  assert.deepEqual(result, { groupId: targeted.groupId, cancelledQueued: 0, stopping: 2 });
  await until(() => started.length === 4);
  assert.equal(started[3], d.id);
  assert.equal(store.getRun(userId, retained.runIds[0]).status, "running");
  release.get(c.id).resolve();
  release.get(d.id).resolve();
  await until(() =>
    [...targeted.runIds, ...retained.runIds].every((id) => {
      const status = store.getRun(userId, id).status;
      return ["cancelled", "succeeded"].includes(status);
    }),
  );
  assert.ok(targeted.runIds.every((id) => store.getRun(userId, id).status === "cancelled"));
  assert.ok(retained.runIds.every((id) => store.getRun(userId, id).status === "succeeded"));
  await runner.stop();
});

test("stop aborts all active tasks, waits for cleanup, and leaves queued work untouched", async (t) => {
  const { store, accounts, userId, makeJob, makeRunner } = makeFixture(t, {
    concurrency: 2,
  });
  const [a, b, c] = accounts;
  let abortCount = 0;
  const cleanup = [deferred(), deferred()];
  const runner = makeRunner((account, _action, _config, { signal }) => {
    const index = account.id === a.id ? 0 : account.id === b.id ? 1 : -1;
    if (index < 0) throw new Error("queued account must not start after stop");
    return new Promise((_, reject) => {
      signal.addEventListener("abort", () => {
        abortCount++;
        cleanup[index].promise.then(() => reject(signal.reason));
      }, { once: true });
    });
  });
  const result = runner.enqueue(makeJob([a.id, b.id, c.id]), userId);
  await until(() => runner.activeRuns.size === 2);
  let stopped = false;
  const stopPromise = runner.stop().then(() => { stopped = true; });
  await until(() => abortCount === 2);
  assert.equal(stopped, false, "stop waits for the active handlers to clean up");
  assert.equal(store.getRun(userId, result.runIds[2]).status, "queued");
  cleanup.forEach((gate) => gate.resolve());
  await stopPromise;
  assert.equal(stopped, true);
  assert.equal(store.getRun(userId, result.runIds[0]).status, "failed");
  assert.equal(store.getRun(userId, result.runIds[1]).status, "failed");
  assert.equal(store.getRun(userId, result.runIds[2]).status, "queued");
});

test("immediate group cancellation prevents execution and preserves another queued group", async (t) => {
  const { store, accounts, userId, makeJob, makeRunner } = makeFixture(t, {
    accountCount: 2,
    concurrency: 1,
  });
  const [a, b] = accounts;
  let calls = 0;
  const runner = makeRunner(async () => {
    calls++;
  });
  const targeted = runner.enqueue(makeJob([a.id]), userId);
  const retained = runner.enqueue(makeJob([b.id]), userId);
  assert.equal(store.getRun(userId, targeted.runIds[0]).status, "running");
  assert.equal(store.getRun(userId, retained.runIds[0]).status, "queued");
  runner.cancelGroup(userId, targeted.groupId);
  assert.equal(calls, 0);
  assert.equal(store.getRun(userId, retained.runIds[0]).status, "queued");
  await runner.pumpPromise;
  assert.equal(store.getRun(userId, targeted.runIds[0]).status, "cancelled");
  assert.equal(store.getRun(userId, retained.runIds[0]).status, "succeeded");
  assert.equal(calls, 1);
});

test("immediate stop prevents execution and keeps the remaining queue persisted", async (t) => {
  const { store, accounts, userId, makeJob, makeRunner } = makeFixture(t, {
    accountCount: 3,
    concurrency: 1,
  });
  let calls = 0;
  const runner = makeRunner(async () => {
    calls++;
  });
  const result = runner.enqueue(makeJob(accounts.map((account) => account.id)), userId);
  assert.equal(store.getRun(userId, result.runIds[0]).status, "running");
  assert.deepEqual(result.runIds.slice(1).map((id) => store.getRun(userId, id).status), ["queued", "queued"]);
  await runner.stop();
  assert.equal(calls, 0);
  assert.equal(store.getRun(userId, result.runIds[0]).status, "failed");
  assert.deepEqual(result.runIds.slice(1).map((id) => store.getRun(userId, id).status), ["queued", "queued"]);
});
