import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createTasksArena } from "../../src/utils/batch/tasksArena.js";
import { createTasksBottle } from "../../src/utils/batch/tasksBottle.js";
import { createTasksCampChallenge } from "../../src/utils/batch/tasksCampChallenge.js";
import { createTasksDungeon } from "../../src/utils/batch/tasksDungeon.js";
import { createTasksHangUp } from "../../src/utils/batch/tasksHangUp.js";
import { createTasksItem } from "../../src/utils/batch/tasksItem.js";
import { createTasksLegacy } from "../../src/utils/batch/tasksLegacy.js";
import { createTasksStarChallenge } from "../../src/utils/batch/tasksStarChallenge.js";
import { createTasksStore } from "../../src/utils/batch/tasksStore.js";
import { createTasksTower } from "../../src/utils/batch/tasksTower.js";
import { createTasksXuanwuBlessing } from "../../src/utils/batch/tasksXuanwuBlessing.js";
import { DailyTaskRunner } from "../../src/utils/dailyTaskRunner.js";
import { fillHangUpTime } from "../../src/utils/dailyTaskState.js";
import { classifyGameError, extractGameCode, extractGameCommand } from "../../src/utils/gameErrorPolicy.js";
import { SERVER_BATCH_TASK_CATALOG, SERVER_BATCH_TASK_IDS, validateTaskOptions } from "../../src/utils/serverBatchTaskConfig.js";
import { findStudyAnswer } from "../../src/utils/serverStudyMatcher.js";
import { GameClient } from "../lib/gameClient.js";

export const SERVER_BATCH_TASKS = SERVER_BATCH_TASK_CATALOG;
export const SERVER_BATCH_TASK_SET = new Set(SERVER_BATCH_TASK_IDS);
const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000;
const DEFAULT_DAILY_SETTINGS = Object.freeze({
  arenaFormation: 1, towerFormation: 1, bossFormation: 1, bossTimes: 2,
  claimBottle: true, payRecruit: true, openBox: true, arenaEnable: true,
  claimHangUp: true, claimEmail: true, blackMarketPurchase: true, freeGachaEnable: true,
  buyGold: true, sendFriendGold: true,
});
const DAILY_BOOLEAN_SETTINGS = new Set([
  "claimBottle", "payRecruit", "openBox", "arenaEnable", "claimHangUp",
  "claimEmail", "blackMarketPurchase", "freeGachaEnable", "buyGold", "sendFriendGold",
]);
const DEFAULT_DELAYS = Object.freeze({
  commandDelay: 500, taskDelay: 500, actionDelay: 300,
  battleDelay: 500, refreshDelay: 1000, longDelay: 3000,
});
const READ_ONLY_COMMANDS = new Set([
  "role_getroleinfo", "system_getdatabundlever", "presetteam_getinfo",
  "presetteam_typegetinfo", "nmext_getinfo",
  "fight_startlevel",
  "tower_getinfo", "evotower_getinfo", "bosstower_getinfo", "legion_getinfo",
  "legion_getinfobyid", "rank_getroleinfo", "store_getpurchase",
  "activity_warorderget", "activity_warordergetinfo", "dungeon_getinfo",
  "towers_getinfo", "arena_getareatarget", "arena_getarearank",
  "mergebox_getinfo", "item_getinfo", "artifact_getinfo", "legacy_getinfo",
  "activity_get", "activity_getlotteryinfo", "club_getinfo", "club_gettargetteam",
  "warguess_getrank",
]);
const BATTLE_VERSION_COMMANDS = new Set([
  "fight_startareaarena", "fight_startpvp", "fight_starttower", "fight_startboss",
  "fight_startlegionboss", "fight_startdungeon", "fight_level",
]);
const answerPath = fileURLToPath(new URL("../../public/answer.json", import.meta.url));

export function validateDailySettings(input) {
  if (input == null) return { ...DEFAULT_DAILY_SETTINGS };
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error("Daily task settings must be an object");
  const result = { ...DEFAULT_DAILY_SETTINGS };
  for (const [key, value] of Object.entries(input)) {
    if (DAILY_BOOLEAN_SETTINGS.has(key)) {
      if (typeof value !== "boolean") throw new Error(`Invalid setting: ${key}`);
      result[key] = value;
    } else if (["arenaFormation", "towerFormation", "bossFormation"].includes(key)) {
      if (!Number.isInteger(value) || value < 1 || value > 6)
        throw new Error(`Invalid setting: ${key}`);
      result[key] = value;
    } else if (key === "bossTimes") {
      if (!Number.isInteger(value) || value < 0 || value > 4)
        throw new Error(`Invalid setting: ${key}`);
      result[key] = value;
    } else if (key !== "templateId" && key !== "templateName") {
      throw new Error(`Unsupported daily task setting: ${key}`);
    }
  }
  return result;
}

export function validateBatchDelaySettings(input) {
  if (input == null) return { ...DEFAULT_DELAYS };
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error("Batch delay settings must be an object");
  const result = { ...DEFAULT_DELAYS };
  for (const [key, value] of Object.entries(input)) {
    if (!Object.hasOwn(result, key)) throw new Error(`Unsupported delay setting: ${key}`);
    if (!Number.isInteger(value) || value < 0 || value > 60000)
      throw new Error(`Invalid delay setting: ${key}`);
    result[key] = value;
  }
  return result;
}

export function getServerBatchTaskAvailability(taskId, date) {
  const instant = date instanceof Date ? date.getTime() : new Date(date ?? Date.now()).getTime();
  const now = new Date(instant + BEIJING_OFFSET_MS);
  const day = now.getUTCDay();
  const hour = now.getUTCHours();
  if (["batchbaoku13", "batchbaoku45"].includes(taskId) && (day === 1 || day === 2))
    return "宝库活动周一和周二未开放";
  if (["batchmengjing", "batchBuyDreamItems"].includes(taskId) && ![0, 1, 3, 4].includes(day))
    return "梦境活动仅周日、周一、周三、周四开放";
  if (["batcharenafight", "batchTopUpArena"].includes(taskId) && (hour < 6 || hour >= 22))
    return "竞技场仅北京时间 06:00–22:00 开放";
  if (["climbWeirdTower", "batchUseItems", "batchMergeItems", "batchClaimFreeEnergy"].includes(taskId)) {
    const epoch = instant;
    const cycleStart = Date.parse("2025-12-12T12:00:00+08:00");
    const week = 7 * 24 * 60 * 60 * 1000;
    const cycle = 3 * week;
    if (epoch < cycleStart || ((epoch - cycleStart) % cycle) >= week)
      return "怪异塔仅在黑市周开放";
    if (day === 5 && hour < 12) return "怪异塔周五 12:00 后开放";
  }
  return null;
}

function mergeRoleSnapshot(roleInfo, response) {
  const role = response?.role || response?.body?.role || response?.data?.role;
  if (!role || typeof role !== "object") return roleInfo;
  const merge = (left, right) => {
    if (!right || typeof right !== "object" || Array.isArray(right)) return right;
    const out = { ...(left && typeof left === "object" && !Array.isArray(left) ? left : {}) };
    for (const [key, value] of Object.entries(right))
      out[key] = value && typeof value === "object" && !Array.isArray(value)
        ? merge(out[key], value)
        : value;
    return out;
  };
  return { ...(roleInfo || {}), role: merge(roleInfo?.role, role) };
}

function collectSecrets(secrets = {}) {
  const list = [];
  for (const raw of Object.values(secrets)) {
    if (typeof raw !== "string" || !raw) continue;
    list.push(raw);
    for (const part of raw.split(/[\s,;，；]+/).filter(Boolean)) list.push(part);
  }
  return [...new Set(list)].sort((a, b) => b.length - a.length);
}

function createRedactor(secrets) {
  const values = collectSecrets(secrets);
  return (value) => {
    let result = String(value ?? "");
    for (const secret of values) result = result.split(secret).join("[已隐藏]");
    return result.slice(0, 500);
  };
}

function makeAbortError(signal) {
  const error = new Error(signal?.reason?.message || "托管任务已停止");
  error.code = "TASK_CANCELLED";
  return error;
}

export function createBatchPlanExecutor({
  GameClientClass = GameClient,
  DailyTaskRunnerClass = DailyTaskRunner,
  loadConfig,
  fetchStarChallengeConfig,
  sleep: sleepImpl = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  clock = () => Date.now(),
  now = () => new Date(clock()),
  loadStudyAnswers = () => readFile(answerPath, "utf8").then(JSON.parse),
  maxDurationMs = 60 * 60 * 1000,
  maxCommands = 10000,
} = {}) {
  return async function executeBatchPlan(account, config = {}, context = {}) {
    const taskIds = config?.localTaskIds;
    if (!Array.isArray(taskIds) || !taskIds.length || taskIds.length > SERVER_BATCH_TASK_IDS.length ||
        new Set(taskIds).size !== taskIds.length || taskIds.some((id) => !SERVER_BATCH_TASK_SET.has(id)))
      throw new Error("托管计划任务列表无效，请重新保存计划");
    const credential = account.credential;
    if (!credential?.roleToken || !credential?.roleId) throw new Error("游戏账号凭据缺失");
    const tokenId = account.id;
    const taskSecrets = config.taskSecrets && typeof config.taskSecrets === "object" ? config.taskSecrets : {};
    const redactor = createRedactor(taskSecrets);
    const validated = validateTaskOptions(config.taskOptions || {}, {
      taskIds,
      secrets: taskSecrets,
    });
    const options = validated.taskOptions;
    const effectiveSecrets = validated.taskSecrets;
    const delays = validateBatchDelaySettings(config.delaySettings || {
      commandDelay: options.commandDelay, taskDelay: options.taskDelay,
      actionDelay: options.actionDelay, battleDelay: options.battleDelay,
      refreshDelay: options.refreshDelay, longDelay: options.longDelay,
    });
    const settings = validateDailySettings(config.dailySettingsByAccount?.[tokenId]);
    const start = clock();
    const deadline = start + Math.min(maxDurationMs, 60 * 60 * 1000);
    const controller = new AbortController();
    const externalSignal = context.signal;
    const relayAbort = () => controller.abort(externalSignal?.reason);
    if (externalSignal?.aborted) relayAbort();
    else externalSignal?.addEventListener("abort", relayAbort, { once: true });
    const signal = controller.signal;
    let durationExpired = false;
    const durationTimer = setTimeout(() => {
      durationExpired = true;
      controller.abort(new Error("任务运行超过 60 分钟限制"));
    }, Math.min(maxDurationMs, 60 * 60 * 1000));
    durationTimer.unref?.();
    const client = new GameClientClass(credential);
    client._log = () => {};
    let commands = 0;
    let mutationCommands = 0;
    let uncertainWrite = false;
    let readUnavailable = false;
    let commandLimitReached = false;
    let terminalFailure = null;
    let cachedBattleVersion = null;
    let battleVersionPromise = null;
    let battleVersionGeneration = 0;
    let latestTaskError = "";
    let loggedGameFailure = null;
    const taskFailures = new Map();
    const pendingMessages = new Set();
    const records = [];
    const status = { value: {} };
    const running = { value: false };
    const stop = { value: Boolean(signal?.aborted) };
    const currentRunningTokenId = { value: tokenId };
    const gameData = { roleInfo: { role: null }, studyStatus: null };
    const tokenInfo = { id: tokenId, name: account.name || tokenId, roleId: credential.roleId };
    const emitProgress = (value) => {
      const text = redactor(typeof value === "object" ? value.message : value);
      records.push(text);
      if (records.length > 500) records.shift();
      try { context.onProgress?.(text); } catch {}
    };
    const fail = (message, code = "TASK_FAILED", details = {}) => {
      const error = new Error(redactor(message));
      error.code = code;
      if (Number.isInteger(details.gameCode)) error.gameCode = details.gameCode;
      if (typeof details.command === "string" && details.command) error.command = details.command;
      if (details.uncertain) error.uncertain = true;
      if (details.serverStateUnavailable) error.serverStateUnavailable = true;
      if (details.cause) {
        const cause = details.cause;
        const safeCause = new Error(redactor(cause?.message || cause));
        for (const key of ["code", "gameCode", "command"]) {
          if (cause?.[key] !== undefined) safeCause[key] = cause[key];
        }
        error.cause = safeCause;
      }
      return error;
    };
    const rememberTerminal = (error) => {
      terminalFailure ||= error;
      stop.value = true;
      return terminalFailure;
    };
    const resetBattleVersionCache = () => {
      battleVersionGeneration++;
      cachedBattleVersion = null;
      battleVersionPromise = null;
    };
    const check = () => {
      if (terminalFailure) throw terminalFailure;
      if (uncertainWrite) throw fail("上一条写入的响应丢失，结果不确定；为避免重复操作，已停止本计划", "UNCERTAIN_WRITE", { uncertain: true });
      if (durationExpired) throw fail("任务运行超过 60 分钟限制", "TASK_DEADLINE");
      if (readUnavailable)
        throw fail("服务器状态读取未确认，不能基于过期状态继续执行写入操作", "READ_UNAVAILABLE", { serverStateUnavailable: true });
      if (commandLimitReached) throw fail("任务达到 10000 条指令上限", "TASK_COMMAND_LIMIT");
      if (clock() > deadline) {
        stop.value = true;
        throw fail("任务运行超过 60 分钟限制", "TASK_DEADLINE");
      }
      if (signal.aborted || stop.value) throw makeAbortError(signal);
    };
    const cancellableSleep = async (ms) => {
      check();
      const duration = Math.max(0, Math.min(60000, Number(ms) || 0));
      if (duration === 0) return;
      if (clock() + duration > deadline) throw fail("任务运行超过 60 分钟限制", "TASK_DEADLINE");
      await new Promise((resolve, reject) => {
        let settled = false;
        const finish = (error) => {
          if (settled) return;
          settled = true;
          signal.removeEventListener("abort", onAbort);
          if (error) reject(error);
          else resolve();
        };
        const onAbort = () => finish(durationExpired
          ? fail("任务运行超过 60 分钟限制", "TASK_DEADLINE")
          : makeAbortError(signal));
        signal.addEventListener("abort", onAbort, { once: true });
        Promise.resolve().then(() => sleepImpl(duration)).then(
          () => finish(),
          (error) => finish(error),
        );
      });
      check();
    };
    // Keep abort listeners detachable and ensure cancellation closes transport promptly.
    const onAbort = () => {
      stop.value = true;
      resetBattleVersionCache();
      try { client.disconnect(); } catch {}
    };
    signal?.addEventListener("abort", onAbort, { once: true });

    const updateSnapshot = (response) => {
      const next = mergeRoleSnapshot(gameData.roleInfo, response);
      if (next !== gameData.roleInfo) gameData.roleInfo = next;
    };
    const drainPendingMessages = async () => {
      let firstError = null;
      while (pendingMessages.size) {
        const pending = [...pendingMessages];
        const settled = await Promise.allSettled(pending);
        pending.forEach((promise) => pendingMessages.delete(promise));
        if (!firstError) {
          firstError = settled.find((entry) => entry.status === "rejected")?.reason || null;
        }
      }
      return firstError;
    };
    let getBattleVersion;
    const assertCommandCanSend = (cmd) => {
      check();
      if (!client.connected) {
        const terminal = fail("游戏连接未就绪", "TRANSPORT_NOT_READY", { command: cmd });
        throw rememberTerminal(terminal);
      }
      if (commands >= maxCommands) {
        commandLimitReached = true;
        stop.value = true;
        throw fail("任务达到 10000 条指令上限", "TASK_COMMAND_LIMIT", { command: cmd });
      }
    };
    const send = async (cmd, params = {}, timeout = 8000) => {
      assertCommandCanSend(cmd);
      let requestParams = params;
      if (BATTLE_VERSION_COMMANDS.has(cmd)) {
        const battleVersion = await getBattleVersion();
        // The preflight read consumes the same command budget and can take long
        // enough for cancellation or the plan deadline to arrive.
        assertCommandCanSend(cmd);
        requestParams = {
          ...(params && typeof params === "object" && !Array.isArray(params) ? params : {}),
          battleVersion,
        };
      }
      commands++;
      const mutation = !READ_ONLY_COMMANDS.has(cmd);
      let sent = false;
      try {
        const requestSeqBefore = client.seq;
        const promise = client.sendWithPromise(cmd, requestParams, timeout);
        sent = true;
        // Preserve sequence-based adapters that expose seq only after send.
        if (client.seq !== undefined && client.seq === requestSeqBefore) sent = false;
        const response = await promise;
        if (mutation) mutationCommands++;
        const previousFailure = taskFailures.get(cmd);
        taskFailures.delete(cmd);
        if (previousFailure && loggedGameFailure?.gameCode === previousFailure.gameCode)
          loggedGameFailure = null;
        updateSnapshot(response);
        check();
        return response;
      } catch (error) {
        const original = String(error?.message || "游戏请求失败");
        const gameCode = extractGameCode(error);
        const command = extractGameCommand(error) || cmd;
        const wrappedDetails = { gameCode: gameCode ?? undefined, command };
        const isServerReject = gameCode !== null;
        const isTransportError = /timeout|超时|连接已关闭|connection|socket|network|网络|closed|ECONN|未连接/i.test(original);
        if (mutation && sent && !isServerReject && isTransportError) {
          uncertainWrite = true;
          stop.value = true;
          const terminal = fail(`写入命令 ${cmd} 未收到确认，结果不确定；已停止后续操作`, "UNCERTAIN_WRITE", { command, uncertain: true, cause: error });
          throw rememberTerminal(terminal);
        }
        if (mutation && !sent && isTransportError) {
          stop.value = true;
          const terminal = fail(`写入命令 ${cmd} 尚未发送：${original}；已停止后续操作`, "TRANSPORT_NOT_READY", { command, cause: error });
          throw rememberTerminal(terminal);
        }
        if (!mutation && isTransportError) {
          readUnavailable = true;
          stop.value = true;
          const terminal = fail(`读取命令 ${cmd} 未收到确认，服务器状态不可用；已停止后续操作`, "READ_UNAVAILABLE", { command, serverStateUnavailable: true, cause: error });
          throw rememberTerminal(terminal);
        }
        const policy = classifyGameError({ ...error, gameCode, command });
        if (policy.kind === "terminal") {
          const terminalCode = gameCode === 200750
            ? "GAME_REQUEST_REJECTED"
            : error?.code || "GAME_AUTH_INVALID";
          const terminal = fail(original, terminalCode, { ...wrappedDetails, cause: error });
          throw rememberTerminal(terminal);
        }
        taskFailures.set(cmd, { message: redactor(original), gameCode, command });
        if (cmd === "role_getroleinfo") {
          readUnavailable = true;
          const terminal = fail(`游戏角色状态读取命令 ${cmd} 失败：${original}；已停止后续操作`, "READ_UNAVAILABLE", { ...wrappedDetails, serverStateUnavailable: true, cause: error });
          throw rememberTerminal(terminal);
        }
        throw fail(original, error?.code || "TASK_COMMAND_FAILED", wrappedDetails);
      }
    };
    getBattleVersion = async () => {
      check();
      if (Number.isSafeInteger(cachedBattleVersion) && cachedBattleVersion > 0)
        return cachedBattleVersion;
      if (battleVersionPromise) return battleVersionPromise;

      const generation = battleVersionGeneration;
      const pending = Promise.resolve().then(async () => {
        try {
          const response = await send("fight_startlevel", {}, 8000);
          check();
          if (generation !== battleVersionGeneration) {
            const stale = fail("游戏连接已更换，战斗版本无法确认，已停止本账号后续操作", "TRANSPORT_NOT_READY", { command: "fight_startlevel" });
            throw rememberTerminal(stale);
          }
          const version = response?.battleData?.version;
          if (!Number.isSafeInteger(version) || version <= 0) {
            const unavailable = fail("战斗版本无法确认，已停止本账号后续操作", "BATTLE_VERSION_UNAVAILABLE", {
              command: "fight_startlevel", serverStateUnavailable: true,
            });
            throw rememberTerminal(unavailable);
          }
          cachedBattleVersion = version;
          emitProgress(`已确认战斗版本 ${version}`);
          return version;
        } catch (error) {
          if (terminalFailure) throw terminalFailure;
          const controlCodes = new Set([
            "TASK_CANCELLED", "TASK_COMMAND_LIMIT", "TASK_DEADLINE", "TRANSPORT_NOT_READY",
            "READ_UNAVAILABLE", "UNCERTAIN_WRITE", "GAME_AUTH_INVALID",
          ]);
          if (controlCodes.has(error?.code)) throw rememberTerminal(error);
          const unavailable = fail("战斗版本无法确认，已停止本账号后续操作", "BATTLE_VERSION_UNAVAILABLE", {
            gameCode: extractGameCode(error) ?? undefined,
            command: "fight_startlevel", serverStateUnavailable: true, cause: error,
          });
          throw rememberTerminal(unavailable);
        }
      }).finally(() => {
        if (battleVersionPromise === pending) battleVersionPromise = null;
      });
      battleVersionPromise = pending;
      return pending;
    };
    const tokenStore = {
      gameTokens: [tokenInfo],
      wsConnections: { [tokenId]: { client } },
      gameData,
      getWebSocketStatus: () => client.connected ? "connected" : "disconnected",
      sendMessageWithPromise: (_id, cmd, params, timeout) => send(cmd, params, timeout),
      sendMessage: (_id, cmd, params) => {
        const promise = send(cmd, params || {}, 12000);
        promise.catch(() => {});
        pendingMessages.add(promise);
        return promise;
      },
      sendGetRoleInfo: (_id, params = {}) => send("role_getroleinfo", params, 15000),
      closeWebSocketConnection: (_id) => {
        resetBattleVersionCache();
        try { client.disconnect(); } catch {}
      },
    };
    const ensureConnection = async (_id, _retries, onSlot) => {
      check();
      if (typeof onSlot === "function") onSlot(true);
      if (!client.connected) {
        resetBattleVersionCache();
        try {
          await client.connect();
        } catch (error) {
          const terminal = fail(redactor(error?.message || "游戏连接失败"), "TRANSPORT_NOT_READY", { command: "connect" });
          throw rememberTerminal(terminal);
        }
        check();
      }
      // Every task starts from a fresh server snapshot. A transport failure here
      // becomes READ_UNAVAILABLE, so swallowed source-factory errors cannot make
      // a later mutation act on stale role data.
      const response = await send("role_getroleinfo", {}, 15000);
      const role = response?.role || response?.body?.role || response?.data?.role || response?.roleInfo?.role;
      if (!role || typeof role !== "object" || Array.isArray(role) || !Object.keys(role).length) {
        readUnavailable = true;
        const terminal = fail("无法读取游戏角色状态，已停止后续操作", "READ_UNAVAILABLE", { command: "role_getroleinfo", serverStateUnavailable: true });
        throw rememberTerminal(terminal);
      }
      updateSnapshot(response);
      return true;
    };
    const refs = {
      selectedTokens: { value: [tokenId] },
      tokens: { value: [tokenInfo] },
      tokenStatus: status,
      isRunning: running,
      shouldStop: stop,
      currentRunningTokenId,
      batchSettings: {
        ...options,
        password: effectiveSecrets.password,
        cdkCodes: effectiveSecrets.cdkCodes,
        maxActive: 1,
      },
      helperSettings: {
        boxType: options.defaultBoxType,
        fishType: options.defaultFishType,
        count: options.boxCount,
        targetPoints: options.targetBoxPoints,
      },
      currentSettings: settings,
      loadSettings: () => settings,
      weirdTowerMaxClimb: { value: options.weirdTowerMaxClimb },
      expectedRoleId: credential.roleId,
      fetchStarChallengeConfig,
      recipientIdInput: { value: options.receiverId },
      recipientInfo: { value: {} },
      securityPassword: { value: effectiveSecrets.password },
      giftQuantity: { value: options.giftAll ? 9999 : options.giftQuantity },
      delayConfig: {
        command: delays.commandDelay, task: delays.taskDelay, action: delays.actionDelay,
        battle: delays.battleDelay, refresh: delays.refreshDelay, long: delays.longDelay,
      },
      tokenStore,
      ensureConnection,
      releaseConnectionSlot: () => {},
      connectionQueue: { active: 0 },
      addLog: ({ message = "", type = "info" } = {}) => emitProgress(`${type === "error" ? "失败" : type === "warning" ? "提示" : "进度"}：${message}`),
      message: Object.fromEntries(["success", "warning", "error", "info"].map((type) => [type, (message) => emitProgress(`${type === "error" ? "失败" : type === "warning" ? "提示" : "进度"}：${message}`)])),
      pickArenaTargetId: (targets) => {
        const candidate = Array.isArray(targets) ? targets[0] : targets?.rankList?.[0] || targets?.roleList?.[0] || targets?.targets?.[0] || targets?.targetList?.[0] || targets?.list?.[0] || targets;
        return candidate?.roleId || candidate?.id || candidate?.targetId || null;
      },
      isTodayAvailable: (stamp) => !Number.isFinite(Number(stamp)) || Number(stamp) < (() => {
        const date = new Date(new Date(now()).getTime() + BEIJING_OFFSET_MS);
        const midnight = Date.UTC(
          date.getUTCFullYear(),
          date.getUTCMonth(),
          date.getUTCDate(),
        ) - BEIJING_OFFSET_MS;
        return Math.floor(midnight / 1000);
      })(),
      calculateMonthProgress: () => {
        const date = new Date(new Date(now()).getTime() + BEIJING_OFFSET_MS);
        const days = new Date(Date.UTC(
          date.getUTCFullYear(),
          date.getUTCMonth() + 1,
          0,
        )).getUTCDate();
        return Math.min(1, Math.max(0, date.getUTCDate() / days));
      },
      now: () => new Date(now()),
      sleep: cancellableSleep,
      onError: (...args) => {
        const detail = args.map((arg) => redactor(arg?.message || arg)).join(" ").trim();
        if (detail) {
          const gameCode = extractGameCode(detail);
          if (gameCode !== null) loggedGameFailure = { message: detail, gameCode, command: "" };
          else latestTaskError = detail;
        }
        emitProgress(`任务内部错误：${detail || "未知错误"}`);
      },
    };
    const recordTaskLog = ({ message = "", type = "info" } = {}) => {
      const detail = redactor(message);
      if (type === "error" && detail) {
        const gameCode = extractGameCode(detail);
        if (gameCode !== null) loggedGameFailure = { message: detail, gameCode, command: "" };
        else latestTaskError = detail;
      }
      emitProgress(`${type === "error" ? "失败" : type === "warning" ? "提示" : "进度"}：${detail}`);
    };
    refs.addLog = recordTaskLog;
    refs.message = Object.fromEntries(["success", "warning", "error", "info"].map((type) => [type, (message) => recordTaskLog({ message, type })]));
    const addLog = refs.addLog;
    const messages = refs.message;
    const createDeps = () => ({ ...refs, currentRunningTokenId, addLog, message: messages });
    const factories = {
      ...createTasksHangUp(createDeps()),
      ...createTasksBottle(createDeps()),
      ...createTasksTower(createDeps()),
      ...createTasksItem(createDeps()),
      ...createTasksDungeon(createDeps()),
      ...createTasksArena(createDeps()),
      ...createTasksStore(createDeps()),
      ...createTasksLegacy(createDeps()),
      ...createTasksCampChallenge(createDeps()),
      ...createTasksStarChallenge(createDeps()),
      ...createTasksXuanwuBlessing(createDeps()),
    };
    async function executeStudy() {
      await ensureConnection(tokenId);
      const questions = await loadStudyAnswers();
      if (!Array.isArray(questions) || questions.length === 0) throw fail("服务器题库为空或无法读取");
      let workPromise = null;
      let workError = null;
      let answerCount = 0;
      const handlePacket = (packet) => {
        const body = packet?.body || packet?.data || packet;
        const questionList = body?.questionList;
        const studyId = body?.role?.study?.id || body?.study?.id || body?.studyId;
        if (!Array.isArray(questionList) || !studyId || workPromise) return;
        workPromise = (async () => {
          emitProgress(`收到答题题目 ${questionList.length} 道`);
          for (let index = 0; index < questionList.length; index++) {
            check();
            const question = questionList[index];
            if (!question?.id || typeof question.question !== "string") throw fail("答题题目信息不完整");
            const answer = findStudyAnswer(questions, question.question) ?? 1;
            await tokenStore.sendMessageWithPromise(tokenId, "study_answer", {
              id: studyId, option: [answer], questionId: [question.id],
            }, 8000);
            answerCount++;
            emitProgress(`已回答 ${answerCount}/${questionList.length} 道题`);
            if (index < questionList.length - 1) await cancellableSleep(300);
          }
          await cancellableSleep(1500);
          for (let rewardId = 1; rewardId <= 10; rewardId++) {
            check();
            try {
              await tokenStore.sendMessageWithPromise(tokenId, "study_claimreward", { rewardId }, 8000);
              emitProgress(`已确认领取答题奖励 ${rewardId}/10`);
            } catch (error) {
              if (/^\[\d+\]/.test(String(error?.message || ""))) {
                emitProgress(`答题奖励 ${rewardId} 当前不可领取，继续检查后续奖励`);
              } else throw error;
            }
            if (rewardId < 10) await cancellableSleep(200);
          }
          tokenStore.gameData.studyStatus = { status: "completed", answeredCount: answerCount, questionCount: questionList.length };
        })().catch((error) => { workError = error; throw error; });
        workPromise.catch(() => {});
      };
      client.onPacket = handlePacket;
      tokenStore.gameData.studyStatus = { status: "starting", answeredCount: 0, questionCount: 0 };
      const startResponse = await tokenStore.sendMessageWithPromise(tokenId, "study_startgame", {}, 8000);
      handlePacket(startResponse);
      const startedAt = clock();
      // A fake/injected clock may remain fixed while an asynchronous game packet
      // arrives. Bound polling by attempts as well as elapsed time so test and
      // server execution cannot spin forever in that case.
      for (let poll = 0; poll < 90 && clock() - startedAt < 90000; poll++) {
        if (workPromise) break;
        await cancellableSleep(1000);
      }
      if (!workPromise) throw fail("答题题目响应超时");
      await workPromise;
      if (workError) throw workError;
      client.onPacket = null;
      emitProgress(`答题完成，共回答 ${answerCount} 道题`);
    }

    const taskResults = [];
    let resultError = null;
    let currentStep = "连接角色与验证Token";
    try {
      emitProgress(`托管计划开始，本次共 ${taskIds.length} 项任务`);
      await ensureConnection(tokenId);
      for (let taskIndex = 0; taskIndex < taskIds.length; taskIndex++) {
        if (taskIndex > 0) await cancellableSleep(delays.taskDelay);
        const taskId = taskIds[taskIndex];
        check();
        const taskName = SERVER_BATCH_TASKS[taskId] || taskId;
        currentStep = taskName;
        const unavailable = getServerBatchTaskAvailability(taskId, new Date(now()));
        if (unavailable) {
          const detail = `跳过「${taskName}」：${unavailable}`;
          emitProgress(detail);
          taskResults.push({ taskId, status: "skipped", reason: unavailable });
          continue;
        }
        status.value[tokenId] = "waiting";
        await ensureConnection(tokenId);
        const before = commands;
        const mutationsBefore = mutationCommands;
        let taskFinalizationError = null;
        latestTaskError = "";
        loggedGameFailure = null;
        taskFailures.clear();
        emitProgress(`开始「${taskName}」`);
        try {
          if (taskId === "batchStudy") {
            await executeStudy();
            status.value[tokenId] = "completed";
          } else if (taskId === "startBatch") {
            const runner = new DailyTaskRunnerClass(tokenStore, {
              commandDelay: delays.commandDelay,
              taskDelay: delays.taskDelay,
            }, { loadConfig, sleep: cancellableSleep });
            const result = await runner.run(tokenId, {
              onLog: addLog,
              onProgress: (value) => emitProgress(`每日任务完成 ${value}%`),
              shouldStop: () => signal?.aborted || uncertainWrite || Boolean(terminalFailure),
            }, settings);
            if (result && typeof result === "object") {
              const { completed = 0, skipped = 0, failed: stepFailed = 0, incomplete = 0 } = result;
              if (incomplete > 0) {
                emitProgress(`每日任务本轮执行结束，仍有 ${incomplete} 项留待全天后续确认（日常正常推进）`);
              }
              if (completed === 0 && skipped === 0 && stepFailed > 0) {
                throw fail(`日常任务全部步骤均失败（失败 ${stepFailed} 项）`);
              }
            }
            taskFailures.clear();
            loggedGameFailure = null;
            latestTaskError = "";
            status.value[tokenId] = "completed";
          } else if (taskId === "claimHangUpRewards" || taskId === "batchAddHangUpTime") {
            if (taskId === "claimHangUpRewards") await send("system_claimhangupreward", {}, 12000);
            const filled = await fillHangUpTime({ tokenStore, tokenId, sleep: cancellableSleep, onLog: (text) => emitProgress(text), check });
            if (filled.remaining) throw fail(`加钟后仍有 ${filled.remaining} 个挂机槽位未确认`);
            status.value[tokenId] = "completed";
          } else {
            const fn = factories[taskId];
            if (typeof fn !== "function") throw fail(`托管任务 ${taskId} 缺少已注册的执行函数`);
            const args = [];
            if (["batchOpenBox", "batchOpenBoxByPoints", "batchFish", "batchRecruit"].includes(taskId)) args.push(true);
            if (taskId === "batchLegacyGiftSendEnhanced") args.push(options.giftAll);
            if (taskId === "batchApplyLegion") args.push(options.legionApplyTargetId);
            if (taskId === "batchStarChallenge") args.push(options);
            await fn(...args);
          }
          const pendingError = await drainPendingMessages();
          if (pendingError) throw pendingError;
          check();
          const state = status.value[tokenId];
          const operationCount = commands - before;
          const mutationCount = mutationCommands - mutationsBefore;
          let swallowedFailure = null;
          if (["failed", "pending", "stopped"].includes(state)) {
            const detail = latestTaskError || loggedGameFailure?.message || [...taskFailures.values()].at(-1)?.message || records.slice(-40).reverse().find((line) => /失败|错误|异常|不足|不完整/.test(line));
            swallowedFailure = fail(`任务「${taskName}」未完成，状态：${state}${detail ? `：${detail}` : ""}`, "TASK_FAILED", {
              gameCode: loggedGameFailure?.gameCode || [...taskFailures.values()].at(-1)?.gameCode,
              command: loggedGameFailure?.command || [...taskFailures.values()].at(-1)?.command,
            });
          } else if (latestTaskError) {
            swallowedFailure = fail(`任务「${taskName}」存在未恢复的错误：${latestTaskError}`);
          } else if (loggedGameFailure) {
            const matchingFailure = [...taskFailures.values()].reverse().find((item) => item.gameCode === loggedGameFailure.gameCode);
            swallowedFailure = fail(`任务「${taskName}」存在未恢复的游戏错误：${loggedGameFailure.message}`, "TASK_COMMAND_FAILED", {
              gameCode: loggedGameFailure.gameCode,
              command: loggedGameFailure.command || matchingFailure?.command,
            });
          } else if (taskFailures.size) {
            const failure = [...taskFailures.values()].at(-1);
            swallowedFailure = fail(`任务「${taskName}」命令 ${failure.command} 未完成：${failure.message}`, "TASK_COMMAND_FAILED", failure);
          }
          if (swallowedFailure) throw swallowedFailure;

          if (mutationCount === 0 && taskId !== "startBatch") {
            const reason = records.slice(-40).reverse().find((line) => /跳过|无需|没有|不足|已完成|已领取|未开放|当前无|不需要|未配置/.test(line));
            taskResults.push({ taskId, status: "skipped", reason: reason || "仅完成状态读取，未执行可确认的游戏操作", commands: operationCount });
          } else taskResults.push({ taskId, status: "completed", commands: operationCount, mutations: mutationCount });
          emitProgress(`「${taskName}」${taskResults.at(-1).status === "skipped" ? "已跳过" : "完成"}`);
        } catch (error) {
          const pendingError = await drainPendingMessages();
          if (terminalFailure) throw terminalFailure;
          check();
          const taskError = pendingError || error;
          const errorPolicy = classifyGameError(taskError);
          if (errorPolicy.kind === "terminal") throw rememberTerminal(taskError);
          const recordedFailure = [...taskFailures.values()].at(-1) || loggedGameFailure;
          const policy = errorPolicy.gameCode !== null || !recordedFailure
            ? errorPolicy
            : classifyGameError(recordedFailure);
          if (policy.kind === "terminal") throw rememberTerminal(taskError);
          const operationCount = commands - before;
          const details = {
            gameCode: policy.gameCode ?? recordedFailure?.gameCode ?? undefined,
            command: policy.command || recordedFailure?.command || "",
          };
          const reason = redactor(errorPolicy.gameCode === null && recordedFailure
            ? recordedFailure.message || taskError?.message || "任务失败"
            : taskError?.message || "任务失败");
          const result = { taskId, status: policy.kind === "skipped" ? "skipped" : "failed", reason, commands: operationCount };
          if (details.gameCode !== undefined) result.gameCode = details.gameCode;
          if (details.command) result.command = details.command;
          taskResults.push(result);
          emitProgress(`「${taskName}」${result.status === "skipped" ? "已跳过" : "失败并继续后续任务"}：${reason}${details.command ? `（${details.command}）` : ""}`);
        } finally {
          taskFinalizationError = await drainPendingMessages();
          client.onPacket = null;
        }
        if (terminalFailure) throw terminalFailure;
        if (taskFinalizationError) throw taskFinalizationError;
      }
      const completed = taskResults.filter((item) => item.status === "completed").length;
      const skipped = taskResults.filter((item) => item.status === "skipped").length;
      const failed = taskResults.filter((item) => item.status === "failed").length;
      emitProgress(`托管计划结束：完成 ${completed} 项，跳过 ${skipped} 项，失败 ${failed} 项，共发送 ${commands} 条游戏指令`);
      return { completed, skipped, failed, commandCount: commands, results: taskResults };
    } catch (error) {
      resultError = error;
      const code = error?.code || (signal?.aborted ? "TASK_CANCELLED" : "TASK_FAILED");
      const rawMessage = redactor(error?.message || "任务失败");
      const message = rawMessage.includes(currentStep) ? rawMessage : `[${currentStep}] ${rawMessage}`;
      emitProgress(code === "TASK_CANCELLED" ? `任务已停止：${message}` : `任务失败：${message}`);
      const failure = new Error(message);
      failure.code = code;
      if (Number.isInteger(error?.gameCode)) failure.gameCode = error.gameCode;
      if (typeof error?.command === "string" && error.command) failure.command = error.command;
      if (error?.serverStateUnavailable) failure.serverStateUnavailable = true;
      if (error?.cause) failure.cause = error.cause;
      failure.uncertain = code === "UNCERTAIN_WRITE" || uncertainWrite;
      failure.records = [...records];
      throw failure;
    } finally {
      client.onPacket = null;
      signal.removeEventListener("abort", onAbort);
      externalSignal?.removeEventListener("abort", relayAbort);
      clearTimeout(durationTimer);
      resetBattleVersionCache();
      try { client.disconnect(); } catch {}
      if (resultError?.code === "UNCERTAIN_WRITE") uncertainWrite = true;
    }
  };
}
