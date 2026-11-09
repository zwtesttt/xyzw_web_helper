import { createHash } from "node:crypto";
import {
  field,
  isMatchingTenPalaceFightNotification,
  runTenPalaceTeam,
  validateTenPalaceConfig,
} from "../../src/utils/tenPalace.js";

const configCache = new Map();
function canonical(value) {
  if (value instanceof Map) return [...value.entries()].map(([key, item]) => [String(key), canonical(item)]).sort(([a], [b]) => a.localeCompare(b));
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  return value;
}
function fingerprint(body) {
  return createHash("sha256").update(JSON.stringify(canonical(field(body, "battleData", {})))).digest("hex").slice(0, 24);
}
function getRoleId(account, credential) { return String(account.role_id || account.roleId || credential.roleId || ""); }

export function createTenPalaceGameExecutor({
  GameClientClass,
  resolveCredential,
  fetchConfig = globalThis.fetch,
  clock = () => Date.now(),
  connectTimeout = 15000,
} = {}) {
  if (typeof GameClientClass !== "function" || typeof resolveCredential !== "function") throw new TypeError("GameClientClass and resolveCredential are required");
  return async function executeTenPalaceTeam(account, config = {}, context = {}) {
    const teamPlan = config.nightmareTeam || config;
    const accountRows = Array.isArray(context.teamAccounts) ? context.teamAccounts : [];
    const requestedIds = teamPlan.memberOrder || accountRows.map((item) => item.id);
    if (accountRows.length < 2 || accountRows.length > 5) throw new Error("十殿队伍需要 2–5 个服务器账号");
    if (!Array.isArray(requestedIds) || requestedIds.length !== accountRows.length || new Set(requestedIds).size !== requestedIds.length) throw new Error("十殿计划角色顺序无效");
    const byId = new Map(accountRows.map((item) => [String(item.id), item]));
    if (requestedIds.some((id) => !byId.has(String(id)))) throw new Error("十殿计划包含已删除或无权使用的账号");
    const orderedAccounts = requestedIds.map((id) => byId.get(String(id)));
    const leaderAccountId = String(teamPlan.leaderAccountId || orderedAccounts[0].id);
    if (!byId.has(leaderAccountId)) throw new Error("十殿计划队长账号不可用");
    const clients = [];
    const receivedHashes = new Set();
    const waiters = new Set();
    const roleIds = new Set();
    let lastRoomHintAt = 0;
    const publish = (event) => {
      if (event.cmd === "nightmare_roominfo_notify") lastRoomHintAt = Math.max(lastRoomHintAt, event.receivedAt);
      if (event.cmd !== "nightmare_fightnotify" || !isMatchingTenPalaceFightNotification(event, { roleId: field(event.body, "roleId", ""), bossId: field(event.body, "bossCfgId", -1) })) return;
      const key = `${field(event.body, "roleId", "")}|${field(event.body, "bossCfgId", "")}|${fingerprint(event.body)}`;
      if (receivedHashes.has(key)) return;
      receivedHashes.add(key);
      if (receivedHashes.size > 200) receivedHashes.delete(receivedHashes.values().next().value);
      for (const waiter of [...waiters]) waiter(event);
    };
    const normalizePacket = (body, envelope = {}) => {
      const raw = body && typeof body === "object" ? body : {};
      const command = String(envelope.cmd || envelope.resp || "").toLowerCase();
      if (!command.endsWith("nightmare_fightnotify") && !command.endsWith("nightmare_roominfo_notify")) return;
      if (Number(envelope.code ?? raw.code ?? 0) !== 0) return;
      publish({ body: raw, envelope, cmd: command, code: Number(envelope.code ?? raw.code ?? 0), seq: envelope.seq, receivedAt: clock() });
    };
    const cleanup = () => {
      for (const client of clients) {
        try { client.disconnect(); } catch {}
      }
      clients.length = 0;
      for (const waiter of [...waiters]) waiter.cancel?.();
      waiters.clear();
    };
    try {
      const credentials = await Promise.all(orderedAccounts.map((row) => resolveCredential(row)));
      const members = orderedAccounts.map((row, index) => {
        const credential = credentials[index];
        const roleId = getRoleId(row, credential);
        if (!roleId || roleIds.has(roleId)) throw new Error("十殿队伍必须使用不同且有效的游戏角色");
        roleIds.add(roleId);
        const client = new GameClientClass(credential, undefined, { onPacket: normalizePacket });
        client._log = () => {};
        clients.push(client);
        return {
          accountId: String(row.id),
          roleId,
          send: (cmd, params, timeout) => client.sendWithPromise(cmd, params, timeout),
          connected: () => Boolean(client.connected),
          serverTime: () => Number(client.serverTime || 0) || undefined,
        };
      });
      await Promise.all(clients.map((client) => client.connect(connectTimeout)));
      if (context.signal?.aborted) throw context.signal.reason || new Error("十殿队伍任务已停止");
      const leader = members.find((item) => item.accountId === leaderAccountId);
      if (!leader) throw new Error("十殿队长角色不可用");
      const versionResponse = await leader.send("system_getdatabundlever", {}, 15000);
      const version = field(versionResponse, "dataBundleVer", "");
      if (typeof version !== "string" || !/^[\w.-]+$/.test(version)) throw new Error("游戏未返回有效配置版本，停止十殿任务");
      if (!configCache.has(version)) {
        const loading = (async () => {
          const response = await fetchConfig(`https://xxz-xyzw-res.hortorgames.com/data/${version}/config.json`, { signal: AbortSignal.timeout(30000) });
          if (!response?.ok) throw new Error("官方十殿配置读取失败");
          return validateTenPalaceConfig(await response.json());
        })();
        configCache.set(version, loading);
        loading.catch(() => { if (configCache.get(version) === loading) configCache.delete(version); });
      }
      const gameConfig = await configCache.get(version);
      const waitForBattle = (roleId, timeout, { signal, bossId, afterTime = 0 } = {}) => {
        let timer;
        let abortHandler;
        let waiter;
        const promise = new Promise((resolve) => {
          const finish = (event = null) => {
            clearTimeout(timer);
            if (signal && abortHandler) signal.removeEventListener("abort", abortHandler);
            waiters.delete(waiter);
            resolve(event);
          };
          waiter = (event) => {
            if (event.receivedAt < afterTime) return;
            if (!isMatchingTenPalaceFightNotification(event, { roleId, bossId, afterTime })) return;
            finish(event);
          };
          waiter.cancel = () => finish(null);
          waiters.add(waiter);
          timer = setTimeout(() => finish(null), Math.max(1, timeout));
          abortHandler = () => finish(null);
          signal?.addEventListener("abort", abortHandler, { once: true });
        });
        promise.cancel = () => waiter?.cancel?.();
        return promise;
      };
      context.onProgress?.(`已连接 ${members.length} 个十殿账号并读取当前游戏配置`);
      const result = await runTenPalaceTeam({
        members,
        config: gameConfig,
        settings: teamPlan.settings || { challengeId: teamPlan.challengeId },
        leaderRoleId: leader.roleId,
        memberOrder: requestedIds.map((id) => members[orderedAccounts.findIndex((row) => String(row.id) === String(id))].roleId),
        checkpoint: context.checkpoint || null,
        signal: context.signal,
        onCheckpoint: context.onCheckpoint,
        onProgress: (event) => context.onProgress?.(event.text),
        waitForBattle,
        clock,
      });
      return result;
    } finally {
      cleanup();
      void lastRoomHintAt;
    }
  };
}
