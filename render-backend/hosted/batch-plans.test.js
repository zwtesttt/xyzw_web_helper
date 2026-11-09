import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
/* eslint-disable test/no-import-node-test -- project acceptance runs these with node --test. */
import test from "node:test";
import { createHostedApp } from "./app.js";
import { createSecretBox } from "./crypto.js";
import { TaskRunner } from "./runner.js";
import { HostedStore } from "./store.js";

const token = (value) => JSON.stringify({ roleToken: `fake-token-${value}`, roleId: `role-${value}` });
const payload = (overrides = {}) => ({
  name: "晚间日常",
  enabled: false,
  accountLocalIds: ["local-a"],
  accounts: [{
    localId: "local-a",
    name: "角色甲",
    server: "2服",
    roleId: "role-a",
    roleToken: token("a"),
    binBase64: "AQID",
  }],
  taskIds: ["startBatch", "batchclubsign"],
  dailySettingsByAccount: { "local-a": { arenaFormation: 4, claimBottle: false } },
  delaySettings: { commandDelay: 700, taskDelay: 900 },
  schedule: { type: "daily", time: "08:30", timezone: "Asia/Shanghai" },
  ...overrides,
});

async function setup(t, executeAction = async () => {}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "xyzw-batch-plans-"));
  const store = new HostedStore({ dbPath: path.join(dir, "hosted.sqlite") });
  const secretBox = createSecretBox(randomBytes(32));
  const runner = new TaskRunner({ store, executeAction });
  const server = createHostedApp({ store, secretBox, runner }).listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const url = `http://127.0.0.1:${server.address().port}`;
  const api = (cookie = "") => async (route, { method = "GET", body } = {}) => {
    return fetch(`${url}/api/server${route}`, {
      method,
      headers: {
        origin: url,
        ...(method === "GET" ? {} : { "x-requested-with": "XMLHttpRequest" }),
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...(cookie ? { cookie } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  };
  t.after(async () => {
    await runner.stop();
    await new Promise((resolve) => server.close(resolve));
    store.close();
    await rm(dir, { recursive: true, force: true });
  });
  const anonymous = api();
  async function register(username) {
    const response = await anonymous("/auth/register", {
      method: "POST",
      body: { username, password: "a-secure-password-123" },
    });
    assert.equal(response.status, 201);
    return api(response.headers.get("set-cookie").split(";")[0]);
  }
  return { api, anonymous, register, store, secretBox, runner, server, url };
}

async function putPlan(api, body = payload(), planId = "plan_local_1") {
  return api(`/batch-plans/${planId}`, { method: "PUT", body });
}

test("batch plan sync is owner-scoped, idempotent, atomic, encrypted, and queues immutable snapshots", async (t) => {
  let markStarted;
  let release;
  const started = new Promise((resolve) => { markStarted = resolve; });
  const blocked = new Promise((resolve) => { release = resolve; });
  const dispatched = [];
  const ctx = await setup(t, async (account, action, config) => {
    dispatched.push({ accountId: account.id, action, config: structuredClone(config) });
    markStarted();
    await blocked;
  });
  const a = await ctx.register("plan-user-a");
  const b = await ctx.register("plan-user-b");

  assert.equal((await ctx.anonymous("/batch-plans")).status, 401);
  const created = await putPlan(a);
  assert.equal(created.status, 200);
  const { job } = await created.json();
  assert.equal(job.actions[0], "batchPlan");
  assert.equal(job.ownerId, (await (await a("/auth/me")).json()).user.id);
  assert.deepEqual(job.localPlan.taskIds, ["startBatch", "batchclubsign"]);
  assert.equal(JSON.stringify(job).includes("fake-token-a"), false);
  const definitions = await (await a("/task-definitions")).json();
  assert.equal(definitions.actions.some((action) => action.id === "batchPlan"), false);

  const stored = ctx.store.getAccountBySourceLocalId(job.ownerId, "local-a");
  assert.ok(stored?.bin_enc);
  assert.equal(stored.credential_enc.includes("fake-token-a"), false);
  const oldBin = stored.bin_enc;
  const oldJobId = job.id;

  const invalidInputs = [
    payload({ accounts: [{ ...payload().accounts[0], wsUrl: "wss://custom.invalid" }] }),
    payload({ accounts: [{ ...payload().accounts[0], roleToken: "not-a-token" }] }),
    payload({ accounts: [{ ...payload().accounts[0], roleToken: 42 }] }),
    payload({ taskIds: ["unknown-task"] }),
    payload({ dailySettingsByAccount: { "local-a": { unsafeCommand: "anything" } } }),
    payload({ delaySettings: { commandDelay: -1 } }),
  ];
  const accountCount = ctx.store.db.prepare("SELECT COUNT(*) AS n FROM accounts").get().n;
  const jobCount = ctx.store.db.prepare("SELECT COUNT(*) AS n FROM jobs").get().n;
  for (const invalid of invalidInputs) {
    const response = await putPlan(a, invalid, `bad_${Math.random().toString(36).slice(2)}`);
    assert.equal(response.status, 400);
  }
  assert.equal(ctx.store.db.prepare("SELECT COUNT(*) AS n FROM accounts").get().n, accountCount);
  assert.equal(ctx.store.db.prepare("SELECT COUNT(*) AS n FROM jobs").get().n, jobCount);

  const retry = await putPlan(a, payload({
    accounts: [{ ...payload().accounts[0], binBase64: undefined }],
    dailySettingsByAccount: {},
    schedule: { type: "daily", time: "09:00", timezone: "Asia/Shanghai" },
  }));
  assert.equal(retry.status, 200);
  const retriedJob = (await retry.json()).job;
  assert.equal(retriedJob.id, oldJobId);
  assert.equal(ctx.store.db.prepare("SELECT COUNT(*) AS n FROM accounts").get().n, 1);
  assert.equal(ctx.store.db.prepare("SELECT COUNT(*) AS n FROM jobs").get().n, 1);
  assert.equal(ctx.store.getAccountBySourceLocalId(job.ownerId, "local-a").bin_enc, oldBin);
  assert.equal(ctx.store.getJob(job.ownerId, job.id).config.dailySettingsByAccount[stored.id].arenaFormation, 4);

  assert.deepEqual((await (await b("/batch-plans")).json()).plans, []);
  assert.equal((await b(`/jobs/${job.id}`, { method: "PATCH", body: { enabled: true } })).status, 404);
  assert.equal((await b(`/jobs/${job.id}/run`, { method: "POST", body: {} })).status, 404);
  assert.equal((await b(`/batch-plans/${job.sourcePlanId}`, { method: "PATCH", body: { enabled: true } })).status, 404);

  const queued = await a(`/jobs/${job.id}/run`, { method: "POST", body: {} });
  assert.equal(queued.status, 202);
  await started;
  assert.equal(dispatched[0].action, "batchPlan");
  assert.equal(dispatched[0].config.dailySettingsByAccount[stored.id].arenaFormation, 4);
  assert.deepEqual(dispatched[0].config.delaySettings, {
    commandDelay: 700,
    taskDelay: 900,
    actionDelay: 300,
    battleDelay: 500,
    refreshDelay: 1000,
    longDelay: 3000,
  });
  await putPlan(a, payload({
    taskIds: ["batchclubsign"],
    accounts: [{ localId: "local-a" }],
    dailySettingsByAccount: {},
  }));
  assert.deepEqual(dispatched[0].config.localTaskIds, ["startBatch", "batchclubsign"]);
  await new Promise((resolve) => ctx.server.close(resolve));
  release();
  await ctx.runner.pumpPromise;
  assert.equal(ctx.store.listRuns(job.ownerId, 10)[0].status, "succeeded");
});

test("source plan edits and account cleanup preserve task metadata and configuration", async (t) => {
  const ctx = await setup(t);
  const owner = await ctx.register("plan-update-user");
  const secondAccount = {
    ...payload().accounts[0],
    localId: "local-b",
    name: "角色乙",
    roleId: "role-b",
    roleToken: JSON.parse(token("b")),
    binBase64: undefined,
  };
  const body = payload({
    accountLocalIds: ["local-a", "local-b"],
    accounts: [payload().accounts[0], secondAccount],
    dailySettingsByAccount: {
      "local-a": { arenaFormation: 4 },
      "local-b": { arenaFormation: 2 },
    },
  });
  const created = await putPlan(owner, body, "two_account_plan");
  assert.equal(created.status, 200);
  const { job } = await created.json();
  const ownerId = job.ownerId;

  for (const enabled of [true, false]) {
    const response = await owner("/batch-plans/two_account_plan", {
      method: "PATCH",
      body: { enabled },
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).job.enabled, enabled);
  }

  const edited = await owner(`/jobs/${  job.id}`, {
    method: "PATCH",
    body: {
      name: "由控制台改名",
      accountIds: job.accountIds,
      actions: ["batchPlan"],
      enabled: true,
      schedule: { type: "daily", time: "10:30", timezone: "Asia/Shanghai" },
    },
  });
  assert.equal(edited.status, 200);
  const editedJob = ctx.store.getJob(ownerId, job.id);
  assert.equal(editedJob.name, "由控制台改名");
  assert.equal(editedJob.schedule_value, "30 10 * * *");
  assert.deepEqual(editedJob.local_task_ids, ["startBatch", "batchclubsign"]);
  assert.deepEqual(editedJob.config.localTaskIds, ["startBatch", "batchclubsign"]);

  const deleted = await owner(`/accounts/${  job.accountIds[0]}`, { method: "DELETE" });
  assert.equal(deleted.status, 204);
  const afterDelete = ctx.store.getJob(ownerId, job.id);
  assert.deepEqual(afterDelete.account_ids, [job.accountIds[1]]);
  assert.deepEqual(afterDelete.local_task_ids, ["startBatch", "batchclubsign"]);
  assert.deepEqual(afterDelete.config.accountLocalIds, ["local-b"]);
  assert.deepEqual(Object.keys(afterDelete.config.dailySettingsByAccount), [job.accountIds[1]]);
});

test("account setting sync updates only matching hosted plans and preserves queued snapshots", async (t) => {
  let markStarted;
  let release;
  const started = new Promise((resolve) => { markStarted = resolve; });
  const blocked = new Promise((resolve) => { release = resolve; });
  const dispatched = [];
  const ctx = await setup(t, async (account, action, config) => {
    dispatched.push({ accountId: account.id, action, config: structuredClone(config) });
    markStarted();
    await blocked;
  });
  const owner = await ctx.register("account-settings-user");
  const otherOwner = await ctx.register("account-settings-other");
  const accountB = {
    ...payload().accounts[0],
    localId: "local-b",
    name: "角色乙",
    roleId: "role-b",
    roleToken: JSON.parse(token("b")),
    binBase64: undefined,
  };
  const sharedCreated = await putPlan(owner, payload({
    name: "甲乙共享计划",
    accountLocalIds: ["local-a", "local-b"],
    accounts: [payload().accounts[0], accountB],
    dailySettingsByAccount: {
      "local-a": { arenaFormation: 1, towerFormation: 2, claimBottle: false, payRecruit: false, buyGold: true },
      "local-b": { arenaFormation: 6, claimBottle: true, sendFriendGold: false },
    },
  }), "shared_account_plan");
  assert.equal(sharedCreated.status, 200);
  const shared = (await sharedCreated.json()).job;
  const ownerId = shared.ownerId;
  const idA = shared.accountIds[0];
  const idB = shared.accountIds[1];
  const bOnlyCreated = await putPlan(owner, payload({
    name: "仅乙计划",
    accountLocalIds: ["local-b"],
    accounts: [{ localId: "local-b" }],
    dailySettingsByAccount: { "local-b": { arenaFormation: 3 } },
  }), "b_only_plan");
  assert.equal(bOnlyCreated.status, 200);
  const bOnly = (await bOnlyCreated.json()).job;

  const original = ctx.store.getJob(ownerId, shared.id);
  const divergentConfig = structuredClone(original.config);
  divergentConfig.dailySettingsByAccount[idA] = {
    ...divergentConfig.dailySettingsByAccount[idA],
    arenaFormation: 2,
    bossFormation: 4,
    buyGold: true,
  };
  divergentConfig.dailySettingsByLocalId["local-a"] = {
    ...divergentConfig.dailySettingsByLocalId["local-a"],
    arenaFormation: 1,
    towerFormation: 5,
    claimEmail: false,
    sendFriendGold: false,
  };
  ctx.store.updateJob(ownerId, shared.id, { config: divergentConfig });

  const jobsBefore = ctx.store.db.prepare("SELECT COUNT(*) AS n FROM jobs").get().n;
  const oldShared = ctx.store.getJob(ownerId, shared.id);
  const queued = await owner(`/jobs/${shared.id}/run`, { method: "POST", body: {} });
  assert.equal(queued.status, 202);
  const { runIds } = await queued.json();
  await started;
  const runBeforeSync = ctx.store.getRun(ownerId, runIds[0]);
  const requested = { arenaFormation: 5, buyGold: false, sendFriendGold: true, claimBottle: true };
  const sync = await owner("/batch-plans/account-settings/local-a", {
    method: "PATCH",
    body: { dailySettings: requested },
  });
  assert.equal(sync.status, 200);
  assert.deepEqual(await sync.json(), { updatedCount: 1 });

  const expectedMerged = {
    ...oldShared.config.dailySettingsByLocalId["local-a"],
    ...oldShared.config.dailySettingsByAccount[idA],
    ...requested,
  };
  const updatedShared = ctx.store.getJob(ownerId, shared.id);
  assert.deepEqual(updatedShared.config.dailySettingsByAccount[idA], expectedMerged);
  assert.deepEqual(updatedShared.config.dailySettingsByLocalId["local-a"], expectedMerged);
  assert.deepEqual(updatedShared.config.dailySettingsByAccount[idB], oldShared.config.dailySettingsByAccount[idB]);
  assert.deepEqual(updatedShared.config.dailySettingsByLocalId["local-b"], oldShared.config.dailySettingsByLocalId["local-b"]);
  assert.deepEqual(ctx.store.getJob(ownerId, bOnly.id).config.dailySettingsByAccount[idB], bOnly.localPlan.dailySettingsByAccount["local-b"]);
  assert.deepEqual(updatedShared.config.localTaskIds, oldShared.config.localTaskIds);
  assert.deepEqual(updatedShared.config.taskOptions, oldShared.config.taskOptions);
  assert.deepEqual(updatedShared.account_ids, oldShared.account_ids);
  assert.equal(updatedShared.name, oldShared.name);
  assert.equal(ctx.store.db.prepare("SELECT COUNT(*) AS n FROM jobs").get().n, jobsBefore);
  assert.deepEqual(ctx.store.getRun(ownerId, runIds[0]).config, runBeforeSync.config);
  assert.deepEqual(dispatched[0].config.dailySettingsByAccount[idA], runBeforeSync.config.dailySettingsByAccount[idA]);

  const invalid = await owner("/batch-plans/account-settings/local-a", {
    method: "PATCH",
    body: { dailySettings: { unrecognizedSetting: true } },
  });
  assert.equal(invalid.status, 400);
  const extraBody = await owner("/batch-plans/account-settings/local-a", {
    method: "PATCH",
    body: { dailySettings: { claimBottle: false }, extra: true },
  });
  assert.equal(extraBody.status, 400);
  const crossOwner = await otherOwner("/batch-plans/account-settings/local-a", {
    method: "PATCH",
    body: { dailySettings: { claimBottle: false } },
  });
  assert.deepEqual(await crossOwner.json(), { updatedCount: 0 });

  release();
  await ctx.runner.pumpPromise;
});

test("run titles are snapshotted and legacy runs fall back to the current owned job", async (t) => {
  let markStarted;
  let release;
  const started = new Promise((resolve) => { markStarted = resolve; });
  const blocked = new Promise((resolve) => { release = resolve; });
  const ctx = await setup(t, async () => {
    markStarted();
    await blocked;
  });
  const owner = await ctx.register("run-title-user");
  const created = await putPlan(owner, payload({ name: "罐子计划" }), "run_title_plan");
  assert.equal(created.status, 200);
  const { job } = await created.json();
  const queued = await owner(`/jobs/${job.id}/run`, { method: "POST", body: {} });
  assert.equal(queued.status, 202);
  const { runIds } = await queued.json();
  await started;
  const runId = runIds[0];

  let run = (await (await owner(`/runs/${runId}`)).json()).run;
  assert.equal(run.jobName, "罐子计划");
  assert.deepEqual(run.taskIds, ["startBatch", "batchclubsign"]);
  const stored = ctx.store.getRun(job.ownerId, runId);
  const configWithUnknownTask = {
    ...stored.config,
    localTaskIds: [...stored.config.localTaskIds, "not-a-task"],
  };
  ctx.store.db.prepare("UPDATE runs SET job_name=NULL,config_json=? WHERE id=?")
    .run(JSON.stringify(configWithUnknownTask), runId);
  run = (await (await owner("/runs")).json()).runs[0];
  assert.equal(run.jobName, "罐子计划");
  assert.deepEqual(run.taskIds, ["startBatch", "batchclubsign"]);
  ctx.store.db.prepare("UPDATE runs SET job_name=? WHERE id=?").run("罐子计划", runId);

  const renamed = await owner(`/jobs/${job.id}`, {
    method: "PATCH",
    body: {
      name: "已经改名",
      accountIds: job.accountIds,
      actions: ["batchPlan"],
      enabled: false,
      schedule: { type: "daily", time: "09:00", timezone: "Asia/Shanghai" },
    },
  });
  assert.equal(renamed.status, 200);
  run = (await (await owner(`/runs/${runId}`)).json()).run;
  assert.equal(run.jobName, "罐子计划");

  const deleted = await owner(`/jobs/${job.id}`, { method: "DELETE" });
  assert.equal(deleted.status, 204);
  run = (await (await owner(`/runs/${runId}`)).json()).run;
  assert.equal(run.jobName, "罐子计划");

  release();
  await ctx.runner.pumpPromise;
});
