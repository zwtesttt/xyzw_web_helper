import {
  SERVER_BATCH_TASK_CATALOG,
  TASK_OPTION_DEFAULTS,
} from "./serverBatchTaskConfig.js";

export const SERVER_BATCH_TASKS = SERVER_BATCH_TASK_CATALOG;

const DAILY_TASK_SETTING_KEYS = new Set([
  "arenaFormation",
  "towerFormation",
  "bossFormation",
  "bossTimes",
  "claimBottle",
  "payRecruit",
  "openBox",
  "arenaEnable",
  "claimHangUp",
  "claimEmail",
  "blackMarketPurchase",
  "freeGachaEnable",
  "buyGold",
  "sendFriendGold",
]);

export function pickDailyTaskSettings(settings) {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) return settings;
  return Object.fromEntries(
    Object.entries(settings).filter(([key]) => DAILY_TASK_SETTING_KEYS.has(key)),
  );
}

export const isServerBatchTaskSupported = (taskId) =>
  Object.hasOwn(SERVER_BATCH_TASKS, taskId);

export function toHostedSchedule(task) {
  if (task.runType === "daily") return { type: "daily", time: task.runTime, timezone: "Asia/Shanghai" };
  return { type: "cron", expression: task.cronExpression, timezone: "Asia/Shanghai" };
}

export function hostedJobToLocalPlan(job, ownerId, localId = job.sourcePlanId) {
  return {
    id: localId,
    serverPlanId: job.sourcePlanId,
    serverOwnerId: ownerId,
    serverJobId: job.id,
    execution: "server",
    syncStatus: "synced",
    name: job.name,
    runType: job.schedule.type,
    runTime: job.schedule.type === "daily" ? cronToTime(job.schedule.value) : null,
    cronExpression: job.schedule.type === "cron" ? job.schedule.value : "",
    selectedTokens: [...(job.localPlan?.accountLocalIds || [])],
    serverAccountNames: (job.localPlan?.accounts || []).map((account) => account.name),
    selectedTasks: [...(job.localPlan?.taskIds || [])],
    taskOptions: { ...TASK_OPTION_DEFAULTS, ...(job.localPlan?.taskOptions || {}) },
    delaySettings: { ...(job.localPlan?.delaySettings || {}) },
    dailySettingsByAccount: { ...(job.localPlan?.dailySettingsByAccount || {}) },
    hasPassword: Boolean(job.localPlan?.hasPassword),
    hasCdkCodes: Boolean(job.localPlan?.hasCdkCodes),
    enabled: job.enabled,
  };
}

export function cronToTime(expression) {
  const fields = String(expression).trim().split(/\s+/);
  if (fields.length !== 5 || !/^\d+$/.test(fields[0]) || !/^\d+$/.test(fields[1])) return "";
  return `${fields[1].padStart(2, "0")}:${fields[0].padStart(2, "0")}`;
}

export async function hostedRequest(path, { method = "GET", body } = {}) {
  const response = await fetch(`/api/server${path}`, {
    method,
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      "X-Requested-With": "XMLHttpRequest",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (response.status === 204) return null;
  const data = await response.json().catch(() => ({}));
  if (response.status === 401) {
    const error = new Error("请先登录「托管」账号");
    error.status = 401;
    throw error;
  }
  if (!response.ok) {
    const error = new Error(data.error || `托管服务器请求失败 (${response.status})`);
    error.status = response.status;
    throw error;
  }
  return data;
}

export async function buildHostedBatchPlanPayload({
  task,
  tokens,
  dailySettingsByAccount,
  delaySettings,
  taskOptions = {},
  getBin,
}) {
  const localIds = [...new Set(task.selectedTokens || [])];
  if (!localIds.length) throw new Error("请选择至少一个本地角色");
  if (!task.selectedTasks?.length) throw new Error("请选择至少一个任务");
  const unsupported = task.selectedTasks.filter((id) => !isServerBatchTaskSupported(id));
  if (unsupported.length) {
    throw new Error(`这些任务暂不支持服务端执行，请取消选择：${unsupported.join("、")}`);
  }
  const accounts = [];
  for (const localId of localIds) {
    const token = tokens.find((item) => item.id === localId);
    if (!token) {
      accounts.push({ localId });
      continue;
    }
    if (!token.token) throw new Error(`本地角色「${token.name || localId}」缺少 Token`);
    if (token.wsUrl || token.sourceUrl)
      throw new Error(`本地角色「${token.name || localId}」使用了自定义连接或 Token 来源，暂不能托管`);
    let binBase64;
    try {
      const data = await getBin?.(localId);
      if (data?.byteLength) binBase64 = arrayBufferToBase64(data);
    } catch {
      // A missing local BIN does not replace an already-stored hosted BIN.
    }
    accounts.push({
      localId,
      name: token.name || token.roleName || "角色",
      server: token.server || "",
      roleId: String(token.roleId || ""),
      roleToken: token.token,
      ...(binBase64 ? { binBase64 } : {}),
    });
  }
  return {
    name: task.name,
    enabled: Boolean(task.enabled),
    accountLocalIds: localIds,
    accounts,
    taskIds: [...task.selectedTasks],
    dailySettingsByAccount: Object.fromEntries(localIds.filter((id) => dailySettingsByAccount?.[id] !== undefined).map((id) => [id, pickDailyTaskSettings(dailySettingsByAccount[id])])),
    taskOptions: { ...TASK_OPTION_DEFAULTS, ...(taskOptions || {}) },
    delaySettings: {
      commandDelay: delaySettings?.commandDelay ?? taskOptions?.commandDelay ?? 500,
      taskDelay: delaySettings?.taskDelay ?? taskOptions?.taskDelay ?? 500,
      actionDelay: delaySettings?.actionDelay ?? taskOptions?.actionDelay ?? 300,
      battleDelay: delaySettings?.battleDelay ?? taskOptions?.battleDelay ?? 500,
      refreshDelay: delaySettings?.refreshDelay ?? taskOptions?.refreshDelay ?? 1000,
      longDelay: delaySettings?.longDelay ?? taskOptions?.longDelay ?? 3000,
    },
    schedule: toHostedSchedule(task),
  };
}

function arrayBufferToBase64(buffer) {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  const stride = 0x8000;
  for (let start = 0; start < bytes.length; start += stride)
    binary += String.fromCharCode(...bytes.subarray(start, start + stride));
  return btoa(binary);
}

export function canRunLocalBatchTask(task) {
  return !task?.execution || task.execution === "local";
}

export function isOwnedBatchPlan(task, ownerId) {
  return Boolean(ownerId && task?.serverOwnerId === ownerId);
}

export function toLocalBatchDraft(task) {
  const draft = { ...task };
  delete draft.serverJobId;
  delete draft.serverPlanId;
  delete draft.serverOwnerId;
  delete draft.syncStatus;
  const wasHosted = Boolean(task?.execution && task.execution !== "local");
  for (const key of ["taskSecretsEnc", "taskSecrets", "hasPassword", "hasCdkCodes", "password", "cdkCodes"])
    delete draft[key];
  if (draft.taskOptions && typeof draft.taskOptions === "object") {
    draft.taskOptions = { ...draft.taskOptions };
    for (const key of ["password", "cdkCodes", "taskSecretsEnc", "hasPassword", "hasCdkCodes"])
      delete draft.taskOptions[key];
  }
  draft.execution = "local";
  if (wasHosted) draft.enabled = false;
  return draft;
}

export function selectAllBatchTaskIds(tasks, execution) {
  return tasks
    .filter((task) => execution !== "server" || isServerBatchTaskSupported(task.value))
    .map((task) => task.value);
}
