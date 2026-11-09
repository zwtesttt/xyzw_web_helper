import assert from "node:assert/strict";
import test from "node:test";
import { availableTasks } from "../src/utils/batch/constants.js";
import {
  buildHostedBatchPlanPayload,
  canRunLocalBatchTask,
  hostedJobToLocalPlan,
  isOwnedBatchPlan,
  selectAllBatchTaskIds,
  SERVER_BATCH_TASKS,
  toHostedSchedule,
  toLocalBatchDraft,
} from "../src/utils/serverBatchPlans.js";
import { validateTaskOptions } from "../src/utils/serverBatchTaskConfig.js";

test("hosted batch schedule uses the supported plan execution set and Beijing time", () => {
  assert.deepEqual(
    Object.keys(SERVER_BATCH_TASKS).sort(),
    availableTasks.map((task) => task.value).sort(),
  );
  assert.deepEqual(
    toHostedSchedule({ runType: "daily", runTime: "08:15" }),
    { type: "daily", time: "08:15", timezone: "Asia/Shanghai" },
  );
  assert.deepEqual(
    toHostedSchedule({ runType: "cron", cronExpression: "15 8 * * 1-5" }),
    { type: "cron", expression: "15 8 * * 1-5", timezone: "Asia/Shanghai" },
  );
});

test("plan payload includes only selected account fields and saved daily configuration", async () => {
  const payload = await buildHostedBatchPlanPayload({
    task: {
      name: "周常",
      enabled: true,
      runType: "daily",
      runTime: "12:30",
      selectedTokens: ["local-a"],
      selectedTasks: ["startBatch"],
    },
    tokens: [{
      id: "local-a",
      name: "角色 A",
      server: "12服",
      roleId: "role-a",
      token: "serialized-token",
      wsUrl: null,
      sourceUrl: null,
    }],
    dailySettingsByAccount: { "local-a": { arenaFormation: 4, claimBottle: false, commandDelay: 700, taskDelay: 900, templateId: "legacy-template", templateName: "旧模板", unrelatedSetting: "remove" } },
    delaySettings: { commandDelay: 700, taskDelay: 900 },
    getBin: async () => new Uint8Array([1, 2, 3]).buffer,
  });
  assert.deepEqual(payload.accountLocalIds, ["local-a"]);
  assert.equal(payload.accounts[0].name, "角色 A");
  assert.equal(payload.accounts[0].binBase64, "AQID");
  assert.deepEqual(payload.dailySettingsByAccount, { "local-a": { arenaFormation: 4, claimBottle: false } });
  assert.deepEqual(payload.delaySettings, {
    commandDelay: 700,
    taskDelay: 900,
    actionDelay: 300,
    battleDelay: 500,
    refreshDelay: 1000,
    longDelay: 3000,
  });
  await assert.rejects(
    buildHostedBatchPlanPayload({
      task: { selectedTokens: ["local-a"], selectedTasks: ["unknown-task"] },
      tokens: [{ id: "local-a", token: "x" }],
    }),
    /暂不支持服务端执行/,
  );
  await assert.rejects(
    buildHostedBatchPlanPayload({
      task: { selectedTokens: ["local-a"], selectedTasks: ["startBatch"] },
      tokens: [{ id: "local-a", token: "x", wsUrl: "wss://custom.invalid" }],
    }),
    /自定义连接/,
  );
});

test("a hosted plan on another device can reuse an existing server role without resending secrets", async () => {
  const payload = await buildHostedBatchPlanPayload({
    task: {
      name: "服务器已有角色",
      enabled: false,
      runType: "cron",
      cronExpression: "0 9 * * *",
      selectedTokens: ["local-existing"],
      selectedTasks: ["batchclubsign"],
    },
    tokens: [],
    dailySettingsByAccount: {},
  });
  assert.deepEqual(payload.accounts, [{ localId: "local-existing" }]);
  assert.deepEqual(payload.dailySettingsByAccount, {});
});

test("server task shadows never run locally and export only as disabled local drafts", () => {
  const task = {
    id: "local-plan",
    enabled: true,
    execution: "server",
    serverPlanId: "server-plan",
    serverOwnerId: "owner-a",
    serverJobId: "job-id",
    syncStatus: "synced",
  };
  assert.equal(canRunLocalBatchTask(task), false);
  assert.equal(canRunLocalBatchTask({ execution: "server-pending" }), false);
  assert.equal(canRunLocalBatchTask({}), true);
  assert.equal(isOwnedBatchPlan(task, "owner-a"), true);
  assert.equal(isOwnedBatchPlan(task, "owner-b"), false);
  const allTaskIds = ["startBatch", "batchFish", "batchclubsign"].map((value) => ({ value }));
  assert.deepEqual(selectAllBatchTaskIds(allTaskIds, "server"), ["startBatch", "batchFish", "batchclubsign"]);
  assert.deepEqual(selectAllBatchTaskIds(allTaskIds, "local"), ["startBatch", "batchFish", "batchclubsign"]);
  assert.deepEqual(toLocalBatchDraft(task), {
    id: "local-plan",
    enabled: false,
    execution: "local",
  });
});

test("canonical hosted jobs rebuild editable local plan state without leaking configuration", () => {
  const plan = hostedJobToLocalPlan({
    id: "job-id",
    sourcePlanId: "local-plan",
    name: "晚间日常",
    enabled: true,
    schedule: { type: "daily", value: "5 21 * * *" },
    localPlan: {
      taskIds: ["startBatch"],
      accountLocalIds: ["role-local-a"],
      accounts: [{ name: "甲" }],
    },
  }, "owner-a");
  assert.equal(plan.serverPlanId, "local-plan");
  assert.equal(plan.serverOwnerId, "owner-a");
  assert.equal(plan.runTime, "21:05");
  assert.deepEqual(plan.selectedTokens, ["role-local-a"]);
  assert.deepEqual(plan.serverAccountNames, ["甲"]);
  assert.equal(Object.hasOwn(plan, "dailySettingsByAccount"), true);
  assert.deepEqual(plan.dailySettingsByAccount, {});
});

test("Star Challenge settings validate strictly and survive hosted plan roundtrips", async () => {
  const options = {
    starChallengeBossIds: [2, 5],
    starChallengeFormationSource: "current",
    starChallengeMaxAttempts: 4,
    starChallengeTargetStars: 2,
    starChallengeClaimRewards: false,
  };
  const validated = validateTaskOptions(options, { taskIds: ["batchStarChallenge"] });
  assert.deepEqual(Object.fromEntries(Object.keys(options).map((key) => [key, validated.taskOptions[key]])), options);
  for (const invalid of [
    { starChallengeBossIds: [] },
    { starChallengeBossIds: [1, 1] },
    { starChallengeBossIds: [9] },
    { starChallengeFormationSource: "fallback" },
    { starChallengeMaxAttempts: 21 },
    { starChallengeTargetStars: 0 },
    { starChallengeClaimRewards: 1 },
  ]) {
    assert.throws(() => validateTaskOptions(invalid), /starChallenge|星级挑战|每关最大|目标星数/);
  }

  const payload = await buildHostedBatchPlanPayload({
    task: {
      name: "星级挑战",
      enabled: true,
      runType: "daily",
      runTime: "09:30",
      selectedTokens: ["local-a"],
      selectedTasks: ["batchStarChallenge"],
    },
    tokens: [{ id: "local-a", token: "serialized-token", roleId: "12345" }],
    taskOptions: options,
    getBin: async () => undefined,
  });
  assert.deepEqual(
    Object.fromEntries(Object.keys(options).map((key) => [key, payload.taskOptions[key]])),
    options,
  );
  const localPlan = hostedJobToLocalPlan({
    id: "job-star",
    sourcePlanId: "plan-star",
    name: "星级挑战",
    enabled: true,
    schedule: { type: "daily", value: "30 9 * * *" },
    localPlan: {
      taskIds: ["batchStarChallenge"],
      accountLocalIds: ["local-a"],
      taskOptions: payload.taskOptions,
    },
  }, "owner-a");
  assert.deepEqual(
    Object.fromEntries(Object.keys(options).map((key) => [key, localPlan.taskOptions[key]])),
    options,
  );
});


test("black market count survives independent-plan payloads and old plans default to follow-game", async () => {
  const payload = await buildHostedBatchPlanPayload({
    task: { selectedTokens: ["local-a"], selectedTasks: ["store_purchase"] },
    tokens: [{ id: "local-a", token: "fake-token", roleId: "role-a" }],
    taskOptions: { blackMarketPurchaseCount: 8 },
  });
  assert.equal(payload.taskOptions.blackMarketPurchaseCount, 8);
  const current = hostedJobToLocalPlan({
    id: "job-a", sourcePlanId: "plan-a", name: "market", enabled: false,
    schedule: { type: "daily", value: "0 8 * * *" },
    localPlan: { taskOptions: { blackMarketPurchaseCount: 8 } },
  }, "owner-a");
  assert.equal(current.taskOptions.blackMarketPurchaseCount, 8);
  const legacy = hostedJobToLocalPlan({
    id: "job-old", sourcePlanId: "plan-old", name: "legacy", enabled: false,
    schedule: { type: "daily", value: "0 8 * * *" },
    localPlan: { taskOptions: {} },
  }, "owner-a");
  assert.equal(legacy.taskOptions.blackMarketPurchaseCount, null);
});
