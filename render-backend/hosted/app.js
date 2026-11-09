import express from "express";
import cron from "node-cron";
import { publicTaskOptions, splitTaskSecrets, validateTaskOptions } from "../../src/utils/serverBatchTaskConfig.js";
import { normalizeTenPalaceOptions } from "../../src/utils/tenPalace.js";
import { createAuth } from "./auth.js";
import { SERVER_BATCH_TASKS, validateBatchDelaySettings, validateDailySettings } from "./batch-plan-executor.js";
import { decodeBinBase64, parseRoleToken } from "./credentials.js";

export const ACTIONS = Object.freeze({
  batchPlan: { label: "批量日常计划", composite: true },
  nightmareTeam: { label: "十殿组队挑战", composite: true, team: true },
  signIn: { label: "每日签到", command: "system_signinreward" },
  claimHangup: { label: "领取挂机奖励", command: "system_claimhangupreward" },
  claimMail: {
    label: "领取邮件附件",
    command: "mail_claimallattachment",
    params: { category: 0 },
  },
  legionSignIn: { label: "俱乐部签到", command: "legion_signin" },
  legacyHangup: { label: "领取功法挂机奖励", command: "legacy_claimhangup" },
  claimTowerReward: { label: "领取咸将塔奖励", command: "tower_claimreward" },
  collectionFree: {
    label: "领取珍宝阁免费奖励",
    command: "collection_claimfreereward",
  },
});
const asyncRoute = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);
const text = (value) => (typeof value === "string" ? value.trim() : "");
const publicAccount = (row) => ({
  id: row.id,
  name: row.name,
  server: row.server,
  roleId: row.role_id,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  hasBin: !!(row.has_bin ?? row.bin_enc),
});
const publicJob = (row) => ({
  id: row.id,
  name: row.name,
  accountIds: row.account_ids,
  actions: row.actions,
  enabled: row.enabled,
  schedule: {
    type: row.schedule_type,
    value: row.schedule_value,
    timezone: row.timezone,
  },
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  sourcePlanId: row.source_plan_id || null,
  localPlan: row.source_plan_id ? {
    id: row.source_plan_id,
    taskIds: row.local_task_ids || [],
    accountLocalIds: row.config?.accountLocalIds || [],
    taskOptions: publicTaskOptions(row.config?.taskOptions, row.config?.taskSecretsPresent || {}),
    delaySettings: row.config?.delaySettings || {},
    dailySettingsByAccount: row.config?.dailySettingsByLocalId || {},
    hasPassword: Boolean(row.config?.taskSecretsPresent?.password),
    hasCdkCodes: Boolean(row.config?.taskSecretsPresent?.cdkCodes),
  } : null,
  teamPlan: row.actions?.includes("nightmareTeam") ? {
    leaderAccountId: row.config?.nightmareTeam?.leaderAccountId || row.account_ids[0],
    memberOrder: row.config?.nightmareTeam?.memberOrder || row.account_ids,
    settings: row.config?.nightmareTeam?.settings || {},
    challengeId: row.config?.nightmareTeam?.challengeId || 1,
  } : null,
});
const publicRun = (row) => ({
  id: row.id,
  jobId: row.job_id,
  groupId: row.group_id,
  accountId: row.account_id,
  accountIds: row.account_ids || [row.account_id],
  accountName: row.account_name,
  action: row.action,
  status: row.status,
  message: row.message,
  logs: row.logs_json
    ? (() => {
        try {
          return JSON.parse(row.logs_json);
        } catch {
          return [];
        }
      })()
    : [],
  queuedAt: row.queued_at,
  startedAt: row.started_at,
  finishedAt: row.finished_at,
  jobName: row.job_name || null,
  taskIds: Array.isArray(row.config?.localTaskIds)
    ? row.config.localTaskIds.filter((id) => Object.hasOwn(SERVER_BATCH_TASKS, id))
    : [],
  checkpoint: row.action === "nightmareTeam" ? row.checkpoint || null : undefined,
});

function sameOrigin(req) {
  const origin = req.get("origin");
  if (!origin) return req.get("x-requested-with") === "XMLHttpRequest";
  const proto =
    req.get("x-forwarded-proto")?.split(",")[0]?.trim() || req.protocol;
  const host =
    req.get("x-forwarded-host")?.split(",")[0]?.trim() || req.get("host");
  try {
    const a = new URL(origin);
    return a.host === host && a.protocol === `${proto}:`;
  } catch {
    return false;
  }
}
function validateSchedule(schedule = {}) {
  const type = schedule.type;
  const timezone = schedule.timezone || "Asia/Shanghai";
  if (timezone !== "Asia/Shanghai")
    throw new Error("Only Asia/Shanghai is supported");
  if (type === "daily") {
    if (
      typeof schedule.time !== "string" ||
      !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(schedule.time)
    )
      throw new Error("Daily schedule time must be HH:mm");
    const [h, m] = schedule.time.split(":").map(Number);
    return { type, value: `${m} ${h} * * *`, timezone };
  }
  if (type === "cron") {
    if (
      typeof schedule.expression !== "string" ||
      schedule.expression.length > 100 ||
      schedule.expression.trim().split(/\s+/).length !== 5 ||
      !cron.validate(schedule.expression)
    )
      throw new Error(
        "Use a valid five-field cron expression (minute precision)",
      );
    return { type, value: schedule.expression, timezone };
  }
  throw new Error("Schedule type must be daily or cron");
}

export function createHostedApp({
  store,
  secretBox,
  runner,
  allowRegistration = true,
  cookieSecure = false,
} = {}) {
  if (!store || !secretBox || !runner)
    throw new TypeError("store, secretBox and runner are required");
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);
  app.use(express.json({ limit: "13mb", strict: true }));
  app.use("/api/server", (req, res, next) => {
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      const hasBody =
        Number(req.get("content-length") || 0) > 0 ||
        Boolean(req.get("transfer-encoding"));
      if (hasBody && !req.is("application/json"))
        return res.status(415).json({ error: "JSON request required" });
      if (!sameOrigin(req))
        return res.status(403).json({ error: "Cross-origin request rejected" });
    }
    next();
  });
  const auth = createAuth({ store, allowRegistration, cookieSecure });
  const root = "/api/server";
  app.post(`${root}/auth/register`, auth.rateLimit, asyncRoute(auth.register));
  app.post(`${root}/auth/login`, auth.rateLimit, asyncRoute(auth.login));
  app.post(`${root}/auth/logout`, asyncRoute(auth.logout));
  app.get(
    `${root}/auth/me`,
    asyncRoute(async (req, res) => {
      const user = await auth.identify(req);
      return user
        ? res.json({ user: { id: user.id, username: user.username } })
        : res.status(401).json({ error: "Sign in required" });
    }),
  );
  app.get(`${root}/task-definitions`, (req, res) =>
    res.json({
      actions: Object.entries(ACTIONS).filter(([, v]) => !v.composite).map(([id, v]) => ({
        id,
        label: v.label,
      })),
    }),
  );

  app.get(`${root}/accounts`, auth.requireUser, (req, res) =>
    res.json({ accounts: store.listAccounts(req.user.id).map(publicAccount) }),
  );
  app.post(
    `${root}/accounts`,
    auth.requireUser,
    asyncRoute(async (req, res) => {
      if (req.body?.wsUrl !== undefined || req.body?.sourceUrl !== undefined)
        return res
          .status(400)
          .json({
            error: "Custom WebSocket and token source URLs are not supported",
          });
      const name = text(req.body?.name);
      const server = text(req.body?.server, 80);
      const roleId = text(req.body?.roleId, 128);
      if (name.length < 1 || name.length > 80)
        return res.status(400).json({ error: "Name must be 1–80 characters" });
      let credential;
      try {
        const token = req.body?.roleToken;
        credential = parseRoleToken(token);
        if (roleId) credential.roleId = roleId;
      } catch (error) {
        return res.status(400).json({ error: error.message });
      }
      let bin;
      try {
        bin = decodeBinBase64(req.body?.binBase64);
      } catch (error) {
        return res.status(400).json({ error: error.message });
      }
      const row = store.insertAccount({
        userId: req.user.id,
        name,
        server,
        roleId: credential.roleId,
        credentialEnc: secretBox.encrypt(credential),
        binEnc: bin ? secretBox.encrypt(bin.toString("base64")) : null,
      });
      return res.status(201).json({ account: publicAccount(row) });
    }),
  );
  app.get(`${root}/accounts/:id`, auth.requireUser, (req, res) => {
    const row = store.getAccount(req.user.id, req.params.id);
    return row
      ? res.json({ account: publicAccount(row) })
      : res.status(404).json({ error: "Account not found" });
  });
  app.patch(
    `${root}/accounts/:id`,
    auth.requireUser,
    asyncRoute(async (req, res) => {
      if (req.body?.wsUrl !== undefined || req.body?.sourceUrl !== undefined)
        return res
          .status(400)
          .json({
            error: "Custom WebSocket and token source URLs are not supported",
          });
      const existing = store.getAccount(req.user.id, req.params.id);
      if (!existing)
        return res.status(404).json({ error: "Account not found" });
      const input = {
        name: req.body?.name === undefined ? undefined : text(req.body.name),
        server:
          req.body?.server === undefined
            ? undefined
            : text(req.body.server, 80),
      };
      if (
        input.name !== undefined &&
        (input.name.length < 1 || input.name.length > 80)
      )
        return res.status(400).json({ error: "Name must be 1–80 characters" });
      let credentialEnc, roleId;
      if (
        (typeof req.body?.roleToken === "string" &&
          req.body.roleToken.trim()) ||
        req.body?.roleId !== undefined
      ) {
        try {
          const old = secretBox.decrypt(existing.credential_enc);
          const next =
            typeof req.body?.roleToken === "string" && req.body.roleToken.trim()
              ? parseRoleToken(req.body.roleToken)
              : old;
          if (text(req.body?.roleId, 128))
            next.roleId = text(req.body.roleId, 128);
          credentialEnc = secretBox.encrypt(next);
          roleId = next.roleId;
        } catch (error) {
          return res.status(400).json({ error: error.message });
        }
      }
      let binEnc;
      if (req.body?.binBase64 !== undefined) {
        try {
          const bin = decodeBinBase64(req.body.binBase64);
          binEnc = bin ? secretBox.encrypt(bin.toString("base64")) : null;
        } catch (error) {
          return res.status(400).json({ error: error.message });
        }
      }
      const row = store.updateAccount(req.user.id, req.params.id, {
        ...input,
        roleId,
        credentialEnc,
        binEnc,
      });
      return res.json({ account: publicAccount(row) });
    }),
  );
  app.delete(`${root}/accounts/:id`, auth.requireUser, (req, res) => {
    const removed = store.deleteAccount(req.user.id, req.params.id);
    if (!removed) return res.status(404).json({ error: "Account not found" });
    runner.refreshSchedules();
    return res.status(204).end();
  });
  app.post(
    `${root}/accounts/import`,
    auth.requireUser,
    asyncRoute(async (req, res) => {
      if (
        !Array.isArray(req.body?.accounts) ||
        req.body.accounts.length < 1 ||
        req.body.accounts.length > 50
      )
        return res.status(400).json({ error: "Provide 1–50 accounts" });
      const results = [];
      try {
        store.transaction(() => {
          for (const item of req.body.accounts) {
            if (item.wsUrl !== undefined || item.sourceUrl !== undefined)
              throw new Error(
                "Custom WebSocket and token source URLs are not supported",
              );
            const name = text(item.name);
            if (!name || name.length > 80)
              throw new Error("Each account needs a name up to 80 characters");
            const credential = parseRoleToken(item.roleToken);
            const bin = decodeBinBase64(item.binBase64);
            const roleId = text(item.roleId, 128) || credential.roleId;
            const sourceLocalId = text(item.sourceLocalId, 128) || null;
            const existing =
              (sourceLocalId
                ? store.getAccountBySourceLocalId(req.user.id, sourceLocalId)
                : null) || store.getAccountByRoleId(req.user.id, roleId);
            let row;
            if (existing) {
              row = store.updateAccount(req.user.id, existing.id, {
                name,
                server: text(item.server, 80),
                roleId,
                credentialEnc: secretBox.encrypt({
                  ...credential,
                  roleId,
                }),
                binEnc: bin
                  ? secretBox.encrypt(bin.toString("base64"))
                  : existing.bin_enc,
              });
            } else {
              row = store.insertAccount({
                userId: req.user.id,
                name,
                server: text(item.server, 80),
                roleId,
                credentialEnc: secretBox.encrypt({
                  ...credential,
                  roleId,
                }),
                binEnc: bin ? secretBox.encrypt(bin.toString("base64")) : null,
                sourceLocalId,
              });
            }
            results.push(publicAccount(row));
          }
        });
      } catch (error) {
        return res.status(400).json({ error: error.message });
      }
      return res.status(201).json({ accounts: results });
    }),
  );

  const parseJob = (body, userId, allowBatchPlan = false) => {
    const name = text(body?.name);
    const accountIds = body?.accountIds;
    const actions = body?.actions;
    if (!name || name.length > 100)
      throw new Error("Job name must be 1–100 characters");
    if (
      !Array.isArray(accountIds) ||
      accountIds.length < 1 ||
      accountIds.length > 50 ||
      new Set(accountIds).size !== accountIds.length
    )
      throw new Error("Select 1–50 unique accounts");
    if (!store.hasAccountIds(userId, accountIds))
      throw new Error("One or more selected accounts were not found");
    if (
      !Array.isArray(actions) ||
      actions.length < 1 ||
      actions.length > Object.keys(ACTIONS).length ||
      new Set(actions).size !== actions.length ||
      actions.some((a) => typeof a !== "string" || !Object.hasOwn(ACTIONS, a) || (a === "batchPlan" && !allowBatchPlan) || ACTIONS[a]?.team)
    )
      throw new Error("Select one or more supported actions");
    const schedule = validateSchedule(body.schedule || {});
    if (body.enabled !== undefined && typeof body.enabled !== "boolean")
      throw new Error("enabled must be a boolean");
    return {
      name,
      accountIds,
      actions,
      enabled: body.enabled ?? true,
      scheduleType: schedule.type,
      scheduleValue: schedule.value,
      timezone: schedule.timezone,
    };
  };
  const localBatchIds = new Set(Object.keys(SERVER_BATCH_TASKS));
  const parseTeamPlan = (body, userId) => {
    const name = text(body?.name);
    const accountIds = body?.accountIds;
    if (!name || name.length > 100) throw new Error("计划名称必须为 1–100 个字符");
    if (!Array.isArray(accountIds) || accountIds.length < 2 || accountIds.length > 5 ||
        accountIds.some((id) => typeof id !== "string" || !id) || new Set(accountIds).size !== accountIds.length)
      throw new Error("十殿固定队伍需选择 2–5 个不同服务器账号");
    if (!store.hasAccountIds(userId, accountIds)) throw new Error("所选服务器账号不可用");
    const selected = accountIds.map((id) => store.getAccount(userId, id));
    const roles = selected.map((item) => item?.role_id);
    if (selected.some((item) => !item) || new Set(roles).size !== roles.length)
      throw new Error("队伍内不能重复选择同一个游戏角色");
    const leaderAccountId = body.leaderAccountId || accountIds[0];
    if (!accountIds.includes(leaderAccountId)) throw new Error("队长必须是已选择的账号");
    const memberOrder = body.memberOrder || accountIds;
    if (!Array.isArray(memberOrder) || memberOrder.length !== accountIds.length ||
        new Set(memberOrder).size !== accountIds.length || memberOrder.some((id) => !accountIds.includes(id)))
      throw new Error("队伍出战顺序无效");
    const challengeId = Number(body.challengeId ?? 1);
    if (![1, 9].includes(challengeId)) throw new Error("当前支持十殿试炼或平等王挑战");
    const settings = normalizeTenPalaceOptions({ ...(body.settings || {}), challengeId });
    if (settings.challengeId !== challengeId) throw new Error("挑战类型与计划参数不一致");
    const schedule = validateSchedule(body.schedule || {});
    if (body.enabled !== undefined && typeof body.enabled !== "boolean") throw new Error("enabled 必须为布尔值");
    return { name, accountIds, leaderAccountId, memberOrder, challengeId, settings,
      enabled: body.enabled ?? true, scheduleType: schedule.type,
      scheduleValue: schedule.value, timezone: schedule.timezone };
  };
  app.get(`${root}/nightmare-plans`, auth.requireUser, (req, res) => {
    const plans = store.listJobs(req.user.id).filter((job) => job.actions.includes("nightmareTeam"));
    res.json({ plans: plans.map(publicJob) });
  });
  app.post(`${root}/nightmare-plans`, auth.requireUser, (req, res) => {
    try {
      const input = parseTeamPlan(req.body, req.user.id);
      const plan = store.insertJob({
        userId: req.user.id, name: input.name, accountIds: input.accountIds,
        actions: ["nightmareTeam"], enabled: input.enabled,
        scheduleType: input.scheduleType, scheduleValue: input.scheduleValue,
        timezone: input.timezone,
        config: { nightmareTeam: {
          leaderAccountId: input.leaderAccountId, memberOrder: input.memberOrder,
          challengeId: input.challengeId, settings: input.settings,
        } },
      });
      runner.refreshSchedules();
      return res.status(201).json({ plan: publicJob(plan) });
    } catch (error) { return res.status(400).json({ error: error.message }); }
  });
  app.patch(`${root}/nightmare-plans/:id`, auth.requireUser, (req, res) => {
    const old = store.getJob(req.user.id, req.params.id);
    if (!old || !old.actions.includes("nightmareTeam")) return res.status(404).json({ error: "Ten Palace plan not found" });
    try {
      const input = parseTeamPlan({
        ...req.body,
        name: req.body.name ?? old.name,
        accountIds: req.body.accountIds ?? old.account_ids,
        leaderAccountId: req.body.leaderAccountId ?? old.config?.nightmareTeam?.leaderAccountId,
        memberOrder: req.body.memberOrder ?? old.config?.nightmareTeam?.memberOrder,
        challengeId: req.body.challengeId ?? old.config?.nightmareTeam?.challengeId,
        settings: req.body.settings ?? old.config?.nightmareTeam?.settings,
        enabled: req.body.enabled ?? old.enabled,
        schedule: req.body.schedule || (() => {
          if (old.schedule_type === "daily") {
            const [minute, hour] = old.schedule_value.split(" ").map(Number);
            return { type: "daily", time: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}` };
          }
          return { type: "cron", expression: old.schedule_value };
        })(),
      }, req.user.id);
      const plan = store.updateJob(req.user.id, old.id, {
        name: input.name, accountIds: input.accountIds, actions: ["nightmareTeam"],
        enabled: input.enabled, scheduleType: input.scheduleType,
        scheduleValue: input.scheduleValue, timezone: input.timezone,
        config: { nightmareTeam: {
          leaderAccountId: input.leaderAccountId, memberOrder: input.memberOrder,
          challengeId: input.challengeId, settings: input.settings,
        } },
      });
      runner.refreshSchedules();
      return res.json({ plan: publicJob(plan) });
    } catch (error) { return res.status(400).json({ error: error.message }); }
  });
  app.delete(`${root}/nightmare-plans/:id`, auth.requireUser, (req, res) => {
    const plan = store.getJob(req.user.id, req.params.id);
    if (!plan || !plan.actions.includes("nightmareTeam")) return res.status(404).json({ error: "Ten Palace plan not found" });
    store.deleteJob(req.user.id, plan.id);
    runner.refreshSchedules();
    return res.status(204).end();
  });
  app.post(`${root}/nightmare-plans/:id/run`, auth.requireUser, (req, res) => {
    const plan = store.getJob(req.user.id, req.params.id);
    if (!plan || !plan.actions.includes("nightmareTeam")) return res.status(404).json({ error: "Ten Palace plan not found" });
    try { return res.status(202).json(runner.enqueue(plan, req.user.id)); }
    catch (error) { return res.status(400).json({ error: error.message }); }
  });
  const parseLocalId = (value, label) => {
    if (typeof value !== "string" || !/^[\w-]{1,128}$/.test(value))
      throw new Error(`${label} is invalid`);
    return value;
  };
  const localDailyDefaults = {
    arenaFormation: 1, towerFormation: 1, bossFormation: 1, bossTimes: 2,
    claimBottle: true, payRecruit: true, openBox: true, arenaEnable: true,
    claimHangUp: true, claimEmail: true, blackMarketPurchase: true,
    freeGachaEnable: true, buyGold: true, sendFriendGold: true,
  };
  const sanitizeBatchConfig = (body, accountIdByLocalId, previousConfig = null) => {
    const taskIds = body?.taskIds;
    if (!Array.isArray(taskIds) || !taskIds.length || taskIds.length > localBatchIds.size ||
        new Set(taskIds).size !== taskIds.length || taskIds.some((id) => !localBatchIds.has(id)))
      throw new Error("计划任务列表无效");
    const sourceSettings = body?.dailySettingsByAccount || {};
    if (!sourceSettings || typeof sourceSettings !== "object" || Array.isArray(sourceSettings))
      throw new Error("每日任务配置格式错误");
    const dailySettingsByAccount = {};
    const dailySettingsByLocalId = {};
    for (const [localId, accountId] of accountIdByLocalId) {
      const supplied = sourceSettings[localId];
      const previous = previousConfig?.dailySettingsByAccount?.[accountId];
      const settings = supplied !== undefined
        ? validateDailySettings(supplied)
        : previous
          ? validateDailySettings(previous)
          : { ...localDailyDefaults };
      dailySettingsByAccount[accountId] = settings;
      dailySettingsByLocalId[localId] = settings;
    }
    const previousSecrets = previousConfig?.taskSecretsEnc
      ? secretBox.decrypt(previousConfig.taskSecretsEnc)
      : {};
    const suppliedOptions = body?.taskOptions ?? {};
    if (!suppliedOptions || typeof suppliedOptions !== "object" || Array.isArray(suppliedOptions))
      throw new Error("托管任务参数格式错误");
    const split = splitTaskSecrets(suppliedOptions, previousSecrets);
    const { taskOptions, taskSecrets } = validateTaskOptions(split.taskOptions, {
      taskIds,
      previous: previousConfig?.taskOptions || {},
      secrets: split.taskSecrets,
      previousSecrets,
    });
    const requestedDelays = body?.delaySettings ?? previousConfig?.delaySettings ?? {
      commandDelay: taskOptions.commandDelay,
      taskDelay: taskOptions.taskDelay,
      actionDelay: taskOptions.actionDelay,
      battleDelay: taskOptions.battleDelay,
      refreshDelay: taskOptions.refreshDelay,
      longDelay: taskOptions.longDelay,
    };
    const delaySettings = validateBatchDelaySettings(requestedDelays);
    return {
      version: 2,
      localTaskIds: [...taskIds],
      accountLocalIds: [...accountIdByLocalId.keys()],
      dailySettingsByAccount,
      dailySettingsByLocalId,
      delaySettings,
      taskOptions,
      taskSecretsEnc: secretBox.encrypt(taskSecrets),
      taskSecretsPresent: {
        password: Boolean(taskSecrets.password),
        cdkCodes: Boolean(taskSecrets.cdkCodes),
      },
    };
  };
  const publicBatchPlan = (job) => {
    const result = publicJob(job);
    if (result.localPlan) {
      result.localPlan.accounts = job.account_ids
        .map((id) => store.getAccountById(id))
        .filter(Boolean)
        .map((account) => ({ localId: account.source_local_id, name: account.name, server: account.server }));
    }
    result.ownerId = job.user_id;
    return result;
  };
  app.get(`${root}/batch-plans`, auth.requireUser, (req, res) => {
    const plans = store.listJobs(req.user.id)
      .filter((job) => job.source_plan_id)
      .map((job) => ({ job: publicBatchPlan(job) }));
    return res.json({ userId: req.user.id, plans });
  });
  app.patch(`${root}/batch-plans/account-settings/:localId`, auth.requireUser, (req, res) => {
    try {
      const localId = parseLocalId(req.params.localId, "Local account ID");
      const body = req.body;
      if (!body || typeof body !== "object" || Array.isArray(body) ||
          Object.keys(body).length !== 1 || !Object.hasOwn(body, "dailySettings"))
        throw new Error("账号每日设置请求格式错误");
      const partial = body.dailySettings;
      if (!partial || typeof partial !== "object" || Array.isArray(partial))
        throw new Error("账号每日设置格式错误");
      const validated = validateDailySettings(partial);
      if (Object.keys(partial).some((key) => !Object.hasOwn(validated, key)))
        throw new Error("账号每日设置包含不支持的字段");
      const dailySettings = Object.fromEntries(
        Object.keys(partial).map((key) => [key, validated[key]]),
      );
      if (!Object.keys(dailySettings).length) return res.json({ updatedCount: 0 });

      const updatedCount = store.transaction(() => {
        const account = store.getAccountBySourceLocalId(req.user.id, localId);
        if (!account) return 0;
        const plans = store.listJobs(req.user.id).filter((job) =>
          job.source_plan_id && job.actions.includes("batchPlan") && job.account_ids.includes(account.id),
        );
        for (const job of plans) {
          const config = job.config && typeof job.config === "object" && !Array.isArray(job.config)
            ? { ...job.config }
            : {};
          const existingByAccount = config.dailySettingsByAccount &&
            typeof config.dailySettingsByAccount === "object" && !Array.isArray(config.dailySettingsByAccount)
            ? config.dailySettingsByAccount
            : {};
          const existingByLocalId = config.dailySettingsByLocalId &&
            typeof config.dailySettingsByLocalId === "object" && !Array.isArray(config.dailySettingsByLocalId)
            ? config.dailySettingsByLocalId
            : {};
          const accountSettings = existingByAccount[account.id] &&
            typeof existingByAccount[account.id] === "object" && !Array.isArray(existingByAccount[account.id])
            ? existingByAccount[account.id]
            : {};
          const localSettings = existingByLocalId[localId] &&
            typeof existingByLocalId[localId] === "object" && !Array.isArray(existingByLocalId[localId])
            ? existingByLocalId[localId]
            : {};
          const mergedSettings = { ...localSettings, ...accountSettings, ...dailySettings };
          const dailySettingsByAccount = {
            ...existingByAccount,
            [account.id]: mergedSettings,
          };
          const dailySettingsByLocalId = {
            ...existingByLocalId,
            [localId]: mergedSettings,
          };
          store.updateJob(req.user.id, job.id, {
            config: { ...config, dailySettingsByAccount, dailySettingsByLocalId },
          });
        }
        return plans.length;
      });
      return res.json({ updatedCount });
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
  });
  app.put(`${root}/batch-plans/:clientPlanId`, auth.requireUser, (req, res) => {
    try {
      const clientPlanId = parseLocalId(req.params.clientPlanId, "Plan ID");
      const body = req.body || {};
      const name = text(body.name);
      if (!name || name.length > 100) throw new Error("计划名称长度必须为 1–100 个字符");
      if (typeof body.enabled !== "boolean") throw new Error("计划启用状态无效");
      const accountLocalIds = body.accountLocalIds;
      const accounts = body.accounts;
      if (!Array.isArray(accountLocalIds) || accountLocalIds.length < 1 || accountLocalIds.length > 50 ||
          new Set(accountLocalIds).size !== accountLocalIds.length || !Array.isArray(accounts) || accounts.length !== accountLocalIds.length)
        throw new Error("请提供与所选计划账号一一对应的账号凭据");
      const accountInputs = new Map();
      for (const item of accounts) {
        const localId = parseLocalId(item?.localId, "Local account ID");
        if (accountInputs.has(localId) || !accountLocalIds.includes(localId))
          throw new Error("计划账号列表不匹配");
        if (item.wsUrl || item.sourceUrl)
          throw new Error("自定义 WebSocket 或 Token 来源不支持服务器托管");
        const existingAccount = store.getAccountBySourceLocalId(req.user.id, localId);
        if (!Object.hasOwn(item, "roleToken")) {
          if (!existingAccount) throw new Error(`本地角色 ${  localId  } 尚未导入托管服务器`);
          accountInputs.set(localId, { localId, existingAccount });
          continue;
        }
        if (typeof item.roleToken !== "string" &&
            (!item.roleToken || typeof item.roleToken !== "object" || Array.isArray(item.roleToken)))
          throw new Error("roleToken must be serialized credentials or an object");
        const name = text(item.name);
        if (!name || name.length > 80) throw new Error("每个账号必须有 1–80 个字符的名称");
        const credential = parseRoleToken(item.roleToken);
        const roleId = text(item.roleId, 128) || credential.roleId;
        credential.roleId = roleId;
        const bin = Object.hasOwn(item, "binBase64") ? decodeBinBase64(item.binBase64) : undefined;
        accountInputs.set(localId, { localId, name, server: text(item.server, 80), roleId, credential, bin });
      }
      if (accountInputs.size !== accountLocalIds.length) throw new Error("缺少计划账号凭据");
      const schedule = validateSchedule(body.schedule || {});
      const existing = store.getBatchPlan(req.user.id, clientPlanId);
      if (!existing && store.listJobs(req.user.id).length >= 100) throw new Error("Job limit reached (100 per user)");
      const result = store.transaction(() => {
        const mapped = new Map();
        for (const localId of accountLocalIds) {
          const item = accountInputs.get(localId);
          const row = item.existingAccount || store.upsertSourceAccount({
            userId: req.user.id,
            sourceLocalId: localId,
            name: item.name,
            server: item.server,
            roleId: item.roleId,
            credentialEnc: secretBox.encrypt(item.credential),
            binEnc: item.bin === undefined ? undefined : item.bin ? secretBox.encrypt(item.bin.toString("base64")) : null,
          });
          mapped.set(localId, row.id);
        }
        const config = sanitizeBatchConfig(body, mapped, existing?.config);
        const accountIds = [...mapped.values()];
        const input = {
          name,
          accountIds,
          actions: ["batchPlan"],
          enabled: body.enabled,
          scheduleType: schedule.type,
          scheduleValue: schedule.value,
          timezone: schedule.timezone,
          sourcePlanId: clientPlanId,
          localTaskIds: config.localTaskIds,
          config,
        };
        const job = existing
          ? store.updateJob(req.user.id, existing.id, input)
          : store.insertJob({ userId: req.user.id, ...input });
        return publicJob(job);
      });
      runner.refreshSchedules();
      return res.json({ job: publicBatchPlan(store.getJob(req.user.id, result.id)) });
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
  });
  app.patch(`${root}/batch-plans/:clientPlanId`, auth.requireUser, (req, res) => {
    const job = store.getBatchPlan(req.user.id, text(req.params.clientPlanId));
    if (!job) return res.status(404).json({ error: "托管计划不存在" });
    if (typeof req.body?.enabled !== "boolean")
      return res.status(400).json({ error: "enabled must be a boolean" });
    const updated = store.updateJob(req.user.id, job.id, { enabled: req.body.enabled });
    runner.refreshSchedules();
    return res.json({ job: publicBatchPlan(updated) });
  });
  app.delete(`${root}/batch-plans/:clientPlanId`, auth.requireUser, (req, res) => {
    const clientPlanId = text(req.params.clientPlanId);
    const job = store.getBatchPlan(req.user.id, clientPlanId);
    if (job) store.deleteJob(req.user.id, job.id);
    runner.refreshSchedules();
    return res.status(204).end();
  });
  app.get(`${root}/jobs`, auth.requireUser, (req, res) =>
    res.json({ jobs: store.listJobs(req.user.id).map(publicJob) }),
  );
  app.post(`${root}/jobs`, auth.requireUser, (req, res) => {
    try {
      const input = parseJob(req.body, req.user.id);
      const job = store.insertJob({ userId: req.user.id, ...input });
      runner.refreshSchedules();
      return res.status(201).json({ job: publicJob(job) });
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
  });
  app.get(`${root}/jobs/:id`, auth.requireUser, (req, res) => {
    const job = store.getJob(req.user.id, req.params.id);
    return job
      ? res.json({ job: publicJob(job) })
      : res.status(404).json({ error: "Job not found" });
  });
  app.patch(`${root}/jobs/:id`, auth.requireUser, (req, res) => {
    const existingJob = store.getJob(req.user.id, req.params.id);
    if (!existingJob)
      return res.status(404).json({ error: "Job not found" });
    try {
      if (existingJob.actions.includes("nightmareTeam"))
        throw new Error("请在十殿计划中修改队伍成员与计划设置");
      const input = parseJob(req.body, req.user.id, !!existingJob.source_plan_id);
      if (existingJob.source_plan_id &&
          (input.actions.length !== 1 || input.actions[0] !== "batchPlan" ||
           JSON.stringify([...input.accountIds].sort()) !== JSON.stringify([...existingJob.account_ids].sort())))
        throw new Error("请在批量日常计划中修改任务与账号");
      const job = store.updateJob(req.user.id, req.params.id, {
        name: input.name,
        accountIds: input.accountIds,
        actions: input.actions,
        enabled: input.enabled,
        scheduleType: input.scheduleType,
        scheduleValue: input.scheduleValue,
        timezone: input.timezone,
      });
      runner.refreshSchedules();
      return res.json({ job: publicJob(job) });
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
  });
  app.delete(`${root}/jobs/:id`, auth.requireUser, (req, res) => {
    const result = store.deleteJob(req.user.id, req.params.id);
    runner.refreshSchedules();
    return result
      ? res.status(204).end()
      : res.status(404).json({ error: "Job not found" });
  });
  app.post(`${root}/jobs/:id/run`, auth.requireUser, (req, res) => {
    const job = store.getJob(req.user.id, req.params.id);
    if (!job) return res.status(404).json({ error: "Job not found" });
    try {
      return res.status(202).json(runner.enqueue(job, req.user.id));
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
  });
  app.post(`${root}/runs/:id/cancel`, auth.requireUser, (req, res) => {
    const row = store.getRun(req.user.id, req.params.id);
    if (!row) return res.status(404).json({ error: "Run not found" });
    const result = runner.cancelGroup(req.user.id, row.group_id);
    if (!result) return res.status(404).json({ error: "Run group not found" });
    return res.json({ ...result, stopped: true });
  });
  app.post(`${root}/runs/groups/:groupId/cancel`, auth.requireUser, (req, res) => {
    const result = runner.cancelGroup(req.user.id, req.params.groupId);
    return result
      ? res.json({ ...result, stopped: true })
      : res.status(404).json({ error: "Run group not found" });
  });
  app.get(`${root}/runs`, auth.requireUser, (req, res) => {
    const limit = Math.min(
      200,
      Math.max(1, Number.parseInt(req.query.limit, 10) || 100),
    );
    return res.json({
      runs: store.listRuns(req.user.id, limit).map(publicRun),
    });
  });
  app.get(`${root}/runs/:id`, auth.requireUser, (req, res) => {
    const row = store.getRun(req.user.id, req.params.id);
    return row
      ? res.json({ run: publicRun(row) })
      : res.status(404).json({ error: "Run not found" });
  });
  app.get("/health", (req, res) => res.json({ ok: true }));
  app.use((req, res) => res.status(404).json({ error: "Not found" }));
  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    if (err instanceof SyntaxError && "body" in err)
      return res.status(400).json({ error: "Invalid JSON" });
    return res.status(500).json({ error: "Server error" });
  });
  return app;
}
