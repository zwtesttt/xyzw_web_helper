import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { buildHostedBatchPlanPayload } from "../src/utils/serverBatchPlans.js";

const component = await readFile(
  new URL("../src/views/BatchDailyTasks.vue", import.meta.url),
  "utf8",
);
const script = component.match(/<script setup[^>]*>([\s\S]*?)<\/script>/)?.[1];
assert.ok(script, "BatchDailyTasks must contain a setup script");
const source = ts.createSourceFile(
  "BatchDailyTasks.js",
  script,
  ts.ScriptTarget.Latest,
  true,
);
const wantedDeclarations = new Set(["saveScheduledTasks", "saveTaskInternal"]);
const declarations = source.statements
  .filter(
    (statement) =>
      ts.isVariableStatement(statement) &&
      statement.declarationList.declarations.some((declaration) =>
        wantedDeclarations.has(declaration.name.getText(source)),
      ),
  )
  .map((statement) => statement.getText(source))
  .join("\n");
assert.match(declarations, /saveTaskInternal/);

function fixture({ failStorage = false } = {}) {
  const storage = new Map();
  const putCalls = [];
  const remotePlans = new Map();
  const scheduledTasks = { value: [] };
  const editingTask = { value: null };
  const context = {
    scheduledTasks,
    editingTask,
    taskForm: {
      name: "重试计划",
      runType: "daily",
      runTime: "2026-10-30T09:00:00",
      cronExpression: "",
      selectedTokens: ["local-a"],
      selectedTasks: ["startBatch"],
      legionApplyTargetId: null,
      enabled: true,
      execution: "server",
      // Mirror the fields initialized by the real plan modal. The save path
      // snapshots these per-plan values rather than ambient batch settings.
      taskOptions: {
        commandDelay: 700,
        taskDelay: 900,
        actionDelay: 300,
        battleDelay: 500,
        refreshDelay: 1000,
        longDelay: 3000,
        legionApplyTargetId: null,
        password: "",
        cdkCodes: "",
      },
      dailySettingsByAccount: {
        "local-a": {
          arenaFormation: 4,
          towerFormation: 1,
          bossFormation: 1,
          bossTimes: 2,
        },
      },
    },
    taskScheduleSelectedGroupIds: { value: [] },
    tokens: {
      value: [{
        id: "local-a",
        name: "测试角色",
        roleId: "role-a",
        token: JSON.stringify({ roleToken: "fake-token", roleId: "role-a" }),
      }],
    },
    batchSettings: { commandDelay: 700, taskDelay: 900 },
    serverDelayFields: [
      { key: "commandDelay" },
      { key: "taskDelay" },
      { key: "actionDelay" },
      { key: "battleDelay" },
      { key: "refreshDelay" },
      { key: "longDelay" },
    ],
    showTaskModal: { value: true },
    message: { warning() {}, error() {}, success() {} },
    localStorage: {
      setItem(key, value) {
        if (failStorage) throw new Error("storage full");
        storage.set(key, value);
      },
      getItem(key) {
        return storage.get(key) ?? null;
      },
    },
    console: { error() {} },
    loadSettings: () => ({
      arenaFormation: 4,
      commandDelay: 700,
      templateName: "old template",
    }),
    getArrayBuffer: async () => undefined,
    buildHostedBatchPlanPayload,
    hostedRequest: async (path, options = {}) => {
      if (path === "/batch-plans") return { userId: "owner-a" };
      assert.equal(options.method, "PUT");
      putCalls.push({ path, body: options.body });
      const clientPlanId = decodeURIComponent(path.split("/").at(-1));
      remotePlans.set(clientPlanId, structuredClone(options.body));
      if (putCalls.length === 1) throw new Error("response lost after commit");
      return {
        job: {
          sourcePlanId: clientPlanId,
          ownerId: "owner-a",
          id: "hosted-job-a",
        },
      };
    },
    workspaceNavigation: { push() {} },
    saveScheduledTasks: undefined,
    addTaskSaveLog() {},
    addLog() {},
    reconcileHostedBatchPlans: async () => {},
  };
  vm.createContext(context);
  vm.runInContext(
    `${declarations  }\nglobalThis.api = { saveScheduledTasks, saveTaskInternal };`,
    context,
  );
  return { context, putCalls, remotePlans, scheduledTasks, editingTask, storage };
}

test("unknown first PUT response retries the same durable plan ID without a duplicate shadow", async () => {
  const f = fixture();
  await f.context.api.saveTaskInternal();
  assert.equal(f.putCalls.length, 1);
  assert.equal(f.remotePlans.size, 1);
  assert.equal(f.scheduledTasks.value.length, 1);
  assert.equal(f.scheduledTasks.value[0].execution, "server-pending");
  assert.equal(f.editingTask.value.id, f.scheduledTasks.value[0].id);
  assert.equal(
    JSON.parse(f.storage.get("scheduledTasks"))[0].execution,
    "server-pending",
  );

  await f.context.api.saveTaskInternal();
  assert.equal(f.putCalls.length, 2);
  assert.equal(f.putCalls[0].path, f.putCalls[1].path);
  assert.equal(f.remotePlans.size, 1);
  assert.equal(f.scheduledTasks.value.length, 1);
  assert.equal(f.scheduledTasks.value[0].execution, "server");
});

test("hosted PUT is skipped when the pending local plan cannot be persisted", async () => {
  const f = fixture({ failStorage: true });
  await f.context.api.saveTaskInternal();
  assert.equal(f.putCalls.length, 0);
  assert.equal(f.remotePlans.size, 0);
  assert.equal(f.scheduledTasks.value.length, 0);
  assert.equal(f.editingTask.value, null);
});
