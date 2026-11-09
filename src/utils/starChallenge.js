const configByVersion = new Map();
const activeStarChallengeRuns = new Set();
const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000;
const WEEK_PASS_KEY = "nm:w:m:boss";
const STAR_PRIVILEGE_TYPE = 14;
const TIMESTAMP_PRIVILEGE_EXPIRATION_TYPE = -9999;

export const STAR_CHALLENGE_BOSS_IDS = Object.freeze([1, 2, 3, 4, 5, 6, 7, 8]);
export const DEFAULT_STAR_CHALLENGE_OPTIONS = Object.freeze({
  starChallengeBossIds: STAR_CHALLENGE_BOSS_IDS,
  starChallengeFormationSource: "saved",
  starChallengeMaxAttempts: 1,
  starChallengeTargetStars: 3,
  starChallengeClaimRewards: true,
});

const mapLike = (value) => value instanceof Map || (
  value && typeof value === "object" && !Array.isArray(value)
);

function entriesOf(value, name, { omittedAsEmpty = false } = {}) {
  if (value === undefined && omittedAsEmpty) return [];
  if (!mapLike(value)) throw new Error(`${name} 数据格式不正确，停止星级挑战`);
  return value instanceof Map ? [...value.entries()] : Object.entries(value);
}

function getValue(value, key) {
  if (value instanceof Map) {
    if (value.has(key)) return value.get(key);
    const stringKey = String(key);
    if (value.has(stringKey)) return value.get(stringKey);
    const numberKey = Number(key);
    if (Number.isSafeInteger(numberKey) && value.has(numberKey))
      return value.get(numberKey);
    return undefined;
  }
  if (!value || typeof value !== "object") return undefined;
  if (Object.hasOwn(value, key)) return value[key];
  return Object.hasOwn(value, String(key)) ? value[String(key)] : undefined;
}

function positiveInt(value, name) {
  const number = typeof value === "string" && /^\d+$/.test(value)
    ? Number(value)
    : value;
  if (!Number.isSafeInteger(number) || number <= 0)
    throw new Error(`${name} 缺失或格式不正确`);
  return number;
}

function nonNegativeInt(value, name) {
  const number = typeof value === "string" && /^\d+$/.test(value)
    ? Number(value)
    : value;
  if (!Number.isSafeInteger(number) || number < 0)
    throw new Error(`${name} 格式不正确`);
  return number;
}

function mapEntriesByIntKey(value, name, { omittedAsEmpty = true, maxKey = 8 } = {}) {
  const entries = entriesOf(value, name, { omittedAsEmpty });
  const normalized = new Map();
  for (const [rawKey, rawValue] of entries) {
    const keyText = String(rawKey);
    if (!/^\d+$/.test(keyText)) throw new Error(`${name} 包含无效关卡`);
    const key = Number(keyText);
    if (!Number.isSafeInteger(key) || key < 1 || key > maxKey || normalized.has(key))
      throw new Error(`${name} 包含无效或重复关卡`);
    normalized.set(key, rawValue);
  }
  return normalized;
}

function normalizeCounterMap(value, name) {
  const entries = mapEntriesByIntKey(value, name);
  const result = new Map();
  for (const [bossId, rawCount] of entries)
    result.set(bossId, nonNegativeInt(rawCount, `${name}[${bossId}]`));
  return result;
}

function objectValues(value, name) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") return Object.values(value);
  throw new Error(`${name} 官方配置缺失`);
}

function configNumber(value, name, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum)
    throw new Error(`${name} 官方配置无效`);
  return value;
}

/** Validate the current official bundle and retain only the star-feature tables. */
export function validateStarChallengeConfig(config) {
  const constant = config?.NightMareStarConstant?.config ?? config?.NightMareStarConstant;
  const unlockLevel = configNumber(
    constant?.nightMareStarUnlockLevel,
    "星级挑战解锁等级",
    1,
  );
  const bossRows = objectValues(config?.NightMareStarConf, "NightMareStarConf");
  const bookRows = objectValues(config?.NightMareStarBookConf, "NightMareStarBookConf");
  const privilegeRows = objectValues(config?.PrivilegeConf, "PrivilegeConf");
  const privilegeSortRows = objectValues(config?.PrivilegeSortConf, "PrivilegeSortConf");
  const bosses = new Map();
  for (const row of bossRows) {
    if (!row || !Number.isInteger(row.bossId) || row.bossId < 1 || row.bossId > 8 || bosses.has(row.bossId))
      throw new Error("星级挑战关卡配置无效");
    const challengeTime = configNumber(row.challengeTime, `第${row.bossId}关挑战次数`, 1);
    const unlockStar = configNumber(row.unlockStar, `第${row.bossId}关解锁星数`, 0);
    if (unlockStar > 24) throw new Error(`第${row.bossId}关解锁星数超出配置范围`);
    const conditionTypes = row.nightMareStarConditionType;
    const conditionValues = row.nightMareStarConditionValue;
    if (!Array.isArray(conditionTypes) || conditionTypes.length !== 3 ||
        !Array.isArray(conditionValues) || conditionValues.length !== 3 ||
        conditionValues.some((value) => !Array.isArray(value)))
      throw new Error(`第${row.bossId}关星级条件配置无效`);
    bosses.set(row.bossId, { ...row, challengeTime, unlockStar });
  }
  if (bosses.size !== STAR_CHALLENGE_BOSS_IDS.length)
    throw new Error("星级挑战关卡配置不完整");

  const book = new Map();
  for (const row of bookRows) {
    if (!row || !Number.isInteger(row.id) || row.id <= 0 || book.has(row.id))
      throw new Error("星级奖励配置无效");
    const start = configNumber(row.start, `星级奖励${row.id}起始星数`, 0);
    const stage = configNumber(row.stage, `星级奖励${row.id}阶段星数`, 1);
    if (!Array.isArray(row.itemBonus)) throw new Error(`星级奖励${row.id}内容配置无效`);
    book.set(row.id, { ...row, start, stage });
  }
  if (!book.size) throw new Error("星级奖励配置为空");

  const privileges = new Map();
  for (const row of privilegeRows) {
    if (!row || !Number.isInteger(row.id) || row.id <= 0 || !Array.isArray(row.benefit))
      continue;
    for (const benefit of row.benefit) {
      if (benefit?.type !== STAR_PRIVILEGE_TYPE) continue;
      configNumber(benefit.value, `星级挑战特权${row.id}次数`, 0);
      if (![0, 1].includes(row.canMulti)) throw new Error(`星级挑战特权${row.id}叠加规则无效`);
      privileges.set(row.id, {
        ...row,
        benefit: row.benefit.filter((item) => item?.type === STAR_PRIVILEGE_TYPE),
      });
    }
  }
  if (!privileges.size) throw new Error("星级挑战特权配置无效");
  const privilegeSort = new Map();
  for (const row of privilegeSortRows) {
    if (row?.type === STAR_PRIVILEGE_TYPE) {
      if (![1, 2].includes(row.sort)) throw new Error("星级挑战特权合并规则无效");
      privilegeSort.set(row.type, row.sort);
    }
  }
  if (!privilegeSort.has(STAR_PRIVILEGE_TYPE))
    throw new Error("星级挑战特权合并规则缺失");

  return {
    unlockLevel,
    bosses,
    book,
    privileges,
    privilegeSort,
  };
}

/** Read and cache validated immutable star tables by the server's current bundle. */
export async function loadStarChallengeConfig(
  tokenStore,
  tokenId,
  fetchConfig = globalThis.fetch,
  { check = () => {} } = {},
) {
  check();
  const response = await tokenStore.sendMessageWithPromise(
    tokenId,
    "system_getdatabundlever",
    {},
    15000,
  );
  check();
  const version = response?.dataBundleVer;
  if (typeof version !== "string" || !/^[\w.-]+$/.test(version))
    throw new Error("服务器未提供有效的游戏配置版本");
  if (!configByVersion.has(version)) {
    const loading = (async () => {
      const result = await fetchConfig(
        `https://xxz-xyzw-res.hortorgames.com/data/${version}/config.json`,
        { signal: AbortSignal.timeout(30000) },
      );
      if (!result?.ok) throw new Error("官方星级挑战配置读取失败");
      return validateStarChallengeConfig(await result.json());
    })();
    configByVersion.set(version, loading);
    loading.catch(() => {
      if (configByVersion.get(version) === loading) configByVersion.delete(version);
    });
    for (const key of configByVersion.keys()) {
      if (key !== version) configByVersion.delete(key);
    }
  }
  check();
  return configByVersion.get(version);
}

/** Parse and validate the per-level hero map, filtering only known empty slots. */
export function parseStarChallengeTeam(teamInfo, name = "星级挑战阵容") {
  const entries = entriesOf(teamInfo, name);
  const battleTeam = new Map();
  for (const [slot, hero] of entries) {
    const slotText = String(slot);
    if (!/^\d+$/.test(slotText)) throw new Error(`${name}站位格式无效`);
    const position = Number(slotText);
    if (!Number.isSafeInteger(position) || position < 0 || position > 4 || battleTeam.has(position))
      throw new Error(`${name}包含重复或无效站位`);
    const rawHeroId = mapLike(hero)
      ? (getValue(hero, "heroId") ?? getValue(hero, "id"))
      : hero;
    if (rawHeroId === 0 || rawHeroId === "0" || rawHeroId === null || rawHeroId === undefined)
      continue;
    const heroId = typeof rawHeroId === "string" && /^\d+$/.test(rawHeroId)
      ? Number(rawHeroId)
      : rawHeroId;
    if (!Number.isSafeInteger(heroId) || heroId <= 0)
      throw new Error(`${name}英雄数据格式无效`);
    battleTeam.set(position, heroId);
  }
  if (!battleTeam.size) throw new Error(`${name}没有可用英雄`);
  return battleTeam;
}

function parseBossCompletionMap(value) {
  const bosses = mapEntriesByIntKey(value, "星级完成状态");
  const normalized = new Map();
  for (const [bossId, rawStars] of bosses) {
    const stars = new Map();
    for (const [rawIndex, complete] of entriesOf(rawStars, `第${bossId}关星级状态`)) {
      const text = String(rawIndex);
      if (!/^\d+$/.test(text)) throw new Error(`第${bossId}关星级状态无效`);
      const index = Number(text);
      if (!Number.isSafeInteger(index) || index < 0 || index > 2 || typeof complete !== "boolean")
        throw new Error(`第${bossId}关星级状态无效`);
      stars.set(index, complete);
    }
    normalized.set(bossId, stars);
  }
  return normalized;
}

function parseClaimedMap(value, book) {
  const entries = entriesOf(value, "星级奖励领取状态", { omittedAsEmpty: true });
  const claimed = new Map();
  for (const [rawId, rawClaimed] of entries) {
    const text = String(rawId);
    const id = /^\d+$/.test(text) ? Number(text) : Number.NaN;
    if (!Number.isSafeInteger(id) || !book.has(id) || typeof rawClaimed !== "boolean")
      throw new Error("星级奖励领取状态格式无效");
    claimed.set(id, rawClaimed);
  }
  return claimed;
}

function parseRolePrivilege(role, config, serverTime) {
  const entries = entriesOf(role?.privilege, "角色特权", { omittedAsEmpty: true });
  let value = 0;
  let found = false;
  for (const [rawId, rawCount] of entries) {
    const text = String(rawId);
    const id = /^\d+$/.test(text) ? Number(text) : Number.NaN;
    if (!Number.isSafeInteger(id) || id <= 0) throw new Error("角色特权数据格式无效");
    if (!Number.isSafeInteger(rawCount) || rawCount < 0)
      throw new Error(`角色特权${id}数量格式无效`);
    const privilege = config.privileges.get(id);
    if (!privilege || rawCount === 0 || isPrivilegeExpired(rawCount, privilege, serverTime)) continue;
    for (const benefit of privilege.benefit) {
      if (benefit.type !== STAR_PRIVILEGE_TYPE) continue;
      const current = benefit.value * (privilege.canMulti === 1 ? rawCount : 1);
      if (found && privilege.canMulti === 1) value += current;
      else if (found) value = config.privilegeSort.get(STAR_PRIVILEGE_TYPE) === 1
        ? Math.max(value, current)
        : Math.min(value, current);
      else value = current;
      found = true;
    }
  }
  return found ? value : 0;
}

function isPrivilegeExpired(count, privilege, serverTime) {
  const expiration = privilege.expirationType;
  const expiryMs = count * 1000;
  return (count > 0 && expiryMs < serverTime && expiration === 0) ||
    (expiration === 1 && serverTime > privilege.expirationTime * 1000) ||
    (expiration === 3 && expiryMs < serverTime) ||
    (privilege.privilegeExpirationType === TIMESTAMP_PRIVILEGE_EXPIRATION_TYPE && expiryMs < serverTime);
}

function getBeijingWeekStart(timestamp) {
  const date = new Date(timestamp + BEIJING_OFFSET_MS);
  const weekdayFromMonday = (date.getUTCDay() + 6) % 7;
  date.setUTCHours(0, 0, 0, 0);
  return date.getTime() - weekdayFromMonday * 24 * 60 * 60 * 1000 - BEIJING_OFFSET_MS;
}

function roleIdentity(role, roleNMExt, expectedRoleId) {
  const roleId = role?.roleId ?? role?.id;
  const extRoleId = roleNMExt?.roleId;
  const normalize = (value, label) => {
    const valid = typeof value === "number"
      ? Number.isSafeInteger(value) && value > 0
      : typeof value === "string" && /^\d+$/.test(value) &&
        Number.isSafeInteger(Number(value)) && Number(value) > 0;
    if (!valid)
      throw new Error(`${label}缺失或格式不正确，停止星级挑战`);
    return String(value);
  };
  const freshRoleId = normalize(roleId, "游戏角色 ID");
  if (normalize(extRoleId, "星级挑战角色 ID") !== freshRoleId)
    throw new Error("星级挑战状态与当前角色不匹配，停止操作");
  if (expectedRoleId !== undefined && expectedRoleId !== null && String(expectedRoleId) !== freshRoleId)
    throw new Error("服务器角色 ID 与当前角色数据不匹配，停止操作");
  return freshRoleId;
}

function readWeekPass(role, requiredLevel, serverTime) {
  const statistics = entriesOf(role?.statistics, "角色周通关数据", { omittedAsEmpty: true });
  const statisticsTime = entriesOf(role?.statisticsTime, "角色周通关时间", { omittedAsEmpty: true });
  const values = new Map(statistics.map(([key, value]) => [String(key), value]));
  const times = new Map(statisticsTime.map(([key, value]) => [String(key), value]));
  const levelValue = values.get(WEEK_PASS_KEY) ?? 0;
  const level = nonNegativeInt(levelValue, "本周星级挑战解锁进度");
  const timeValue = times.get(WEEK_PASS_KEY);
  let currentWeek = false;
  if (timeValue !== undefined) {
    const timestamp = nonNegativeInt(timeValue, "本周星级挑战解锁时间") * 1000;
    currentWeek = timestamp > 0 && timestamp <= serverTime &&
      timestamp >= getBeijingWeekStart(serverTime);
  }
  return { level, currentWeek, unlocked: currentWeek && level >= requiredLevel };
}

/** Validate one fresh progress snapshot before allowing any state-based write. */
export function inspectStarChallengeState({
  role,
  roleNMExt,
  config,
  serverTime,
  expectedRoleId,
}) {
  if (!role || typeof role !== "object" || Array.isArray(role) || !roleNMExt ||
      typeof roleNMExt !== "object" || Array.isArray(roleNMExt))
    throw new Error("未取得完整的角色或星级挑战状态，停止写入操作");
  if (!Number.isFinite(serverTime) || serverTime <= 0)
    throw new Error("服务器时间未同步，无法确认星级挑战周状态");
  const roleId = roleIdentity(role, roleNMExt, expectedRoleId);
  const starResetTime = positiveInt(roleNMExt.starResetTime, "星级挑战周重置时间");
  const resetMs = starResetTime * 1000;
  if (resetMs > serverTime + 5 * 60 * 1000)
    throw new Error("星级挑战重置时间晚于服务器时间，停止写入操作");
  const stale = getBeijingWeekStart(resetMs) < getBeijingWeekStart(serverTime);
  const starFightCntMap = normalizeCounterMap(roleNMExt.starFightCntMap, "星级挑战次数");
  const privilegeStarFightCntMap = normalizeCounterMap(
    roleNMExt.privilegeStarFightCntMap,
    "星级挑战特权次数",
  );
  const starBossCompleteMap = parseBossCompletionMap(roleNMExt.starBossCompleteMap);
  const starRewardsClaimedMap = parseClaimedMap(roleNMExt.starRewardsClaimedMap, config.book);
  const privilegeBonus = parseRolePrivilege(role, config, serverTime);
  const totalStars = [...starBossCompleteMap.values()].reduce(
    (total, stars) => total + [...stars.values()].filter(Boolean).length,
    0,
  );
  const highestEligibleRewardId = [...config.book.values()].reduce((highest, reward) => {
    return totalStars >= reward.stage ? Math.max(highest, reward.id) : highest;
  }, 0);
  const highestClaimedRewardId = [...starRewardsClaimedMap.entries()].reduce(
    (highest, [id, claimed]) => claimed ? Math.max(highest, id) : highest,
    0,
  );
  // The live NightmareStarPanel uses totalStars >= NightMareStarBookConf.stage.
  // `start` is a display range boundary; adding it to `stage` double-counts it.
  const claimableRewards = [...config.book.values()]
    .filter((reward) => totalStars >= reward.stage &&
      reward.id <= highestEligibleRewardId && !starRewardsClaimedMap.get(reward.id))
    .sort((a, b) => a.id - b.id);
  const weekPass = readWeekPass(role, config.unlockLevel, serverTime);
  const bosses = STAR_CHALLENGE_BOSS_IDS.map((bossId) => {
    const row = config.bosses.get(bossId);
    const stars = starBossCompleteMap.get(bossId) || new Map();
    const starCount = [...stars.values()].filter(Boolean).length;
    const baseUsed = starFightCntMap.get(bossId) || 0;
    const privilegeUsed = privilegeStarFightCntMap.get(bossId) || 0;
    const totalLimit = row.challengeTime + privilegeBonus;
    const used = baseUsed + privilegeUsed;
    return {
      bossId,
      config: row,
      starCount,
      stars: [0, 1, 2].map((index) => stars.get(index) === true),
      baseUsed,
      privilegeUsed,
      baseLimit: row.challengeTime,
      privilegeBonus,
      remaining: Math.max(0, totalLimit - used),
      totalLimit,
      unlockStar: row.unlockStar,
      unlockedByStars: totalStars >= row.unlockStar,
    };
  });
  return {
    roleId,
    stale,
    starResetTime,
    totalStars,
    bosses,
    weekPass,
    privilegeBonus,
    claimableRewards,
    highestEligibleRewardId,
    highestClaimedRewardId,
    starFightCntMap,
    privilegeStarFightCntMap,
    starBossCompleteMap,
    starRewardsClaimedMap,
  };
}

function readRoleFromResponse(response) {
  return response?.role || response?.body?.role || response?.data?.role ||
    response?.roleInfo?.role || response?.roleInfo || null;
}

function readRoleNMExt(response) {
  return response?.roleNMExt || response?.body?.roleNMExt ||
    response?.data?.roleNMExt || null;
}

function safePetUid(value, name) {
  if (value === undefined || value === null || value === "") return "";
  if (typeof value === "bigint") return value;
  if (typeof value === "string" && /^\d+$/.test(value)) return value;
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0)
    return value;
  throw new Error(`${name}宠物 UID 格式无效`);
}

function safeWeaponId(value, fallback) {
  if (value === undefined || value === null) value = fallback ?? 0;
  const number = typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value;
  if (!Number.isSafeInteger(number) || number < 0)
    throw new Error("星级挑战主公武器 ID 格式无效");
  return number;
}

function getCurrentFormation(role) {
  const team = parseStarChallengeTeam(role?.battleTeam, "当前出战阵容");
  const petUid = safePetUid(role?.petData?.petUId, "当前阵容");
  return {
    battleTeam: team,
    lordWeaponId: safeWeaponId(role?.lordWeaponId, 0),
    petUId: petUid,
    presetTeamType: 0,
  };
}

function getSavedFormation(presetTeamMap, bossId, role) {
  if (!mapLike(presetTeamMap)) throw new Error("游戏返回的星级预设阵容数据格式不正确");
  const preset = getValue(presetTeamMap, 100 + bossId);
  if (preset === undefined) return null;
  if (preset === null) throw new Error(`第${bossId}关预设阵容数据格式不正确`);
  if (!mapLike(preset)) throw new Error(`第${bossId}关预设阵容数据格式不正确`);
  const teamInfo = getValue(preset, "teamInfo");
  if (teamInfo === undefined || teamInfo === null)
    throw new Error(`第${bossId}关预设阵容缺少队伍信息`);
  const weapon = getValue(preset, "weapon");
  if (!mapLike(weapon)) throw new Error(`第${bossId}关预设阵容缺少武器信息`);
  const battleTeam = parseStarChallengeTeam(teamInfo, `第${bossId}关预设阵容`);
  const weaponId = getValue(weapon, "weaponId");
  const petUid = getValue(preset, "petUId");
  return {
    battleTeam,
    lordWeaponId: safeWeaponId(weaponId, role?.lordWeaponId ?? 0),
    petUId: safePetUid(petUid ?? role?.petData?.petUId, `第${bossId}关预设阵容`),
    presetTeamType: 100 + bossId,
  };
}

export function normalizeStarChallengeOptions(input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error("星级挑战参数格式无效");
  const bossIds = input.starChallengeBossIds ?? DEFAULT_STAR_CHALLENGE_OPTIONS.starChallengeBossIds;
  if (!Array.isArray(bossIds) || !bossIds.length || bossIds.length > STAR_CHALLENGE_BOSS_IDS.length ||
      bossIds.some((id) => !Number.isInteger(id) || id < 1 || id > 8) || new Set(bossIds).size !== bossIds.length)
    throw new Error("星级挑战关卡必须为不重复的 1–8 关");
  const formationSource = input.starChallengeFormationSource ?? "saved";
  if (!new Set(["saved", "current"]).has(formationSource))
    throw new Error("星级挑战阵容来源无效");
  const maxAttempts = input.starChallengeMaxAttempts ?? 1;
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 20)
    throw new Error("每关最大挑战次数必须为 1–20 的整数");
  const targetStars = input.starChallengeTargetStars ?? 3;
  if (!Number.isInteger(targetStars) || targetStars < 1 || targetStars > 3)
    throw new Error("目标星数必须为 1–3 的整数");
  const claimRewards = input.starChallengeClaimRewards ?? true;
  if (typeof claimRewards !== "boolean") throw new Error("自动领取星级奖励开关无效");
  return {
    starChallengeBossIds: [...bossIds],
    starChallengeFormationSource: formationSource,
    starChallengeMaxAttempts: maxAttempts,
    starChallengeTargetStars: targetStars,
    starChallengeClaimRewards: claimRewards,
  };
}

/** Read a complete snapshot for previews; this function never writes game state. */
export async function loadStarChallengeSnapshot({
  tokenStore,
  tokenId,
  expectedRoleId,
  settings = DEFAULT_STAR_CHALLENGE_OPTIONS,
  fetchConfig = globalThis.fetch,
  check = () => {},
  serverTime = () => tokenStore.wsConnections?.[tokenId]?.client?.serverTime,
}) {
  settings = normalizeStarChallengeOptions(settings);
  const config = await loadStarChallengeConfig(tokenStore, tokenId, fetchConfig, { check });
  check();
  const roleResponse = await tokenStore.sendMessageWithPromise(tokenId, "role_getroleinfo", {}, 15000);
  check();
  const role = readRoleFromResponse(roleResponse);
  const extResponse = await tokenStore.sendMessageWithPromise(tokenId, "nmext_getinfo", {}, 15000);
  check();
  const roleNMExt = readRoleNMExt(extResponse);
  const state = inspectStarChallengeState({
    role,
    roleNMExt,
    config,
    serverTime: serverTime(),
    expectedRoleId,
  });
  const presetsResponse = await tokenStore.sendMessageWithPromise(
    tokenId,
    "presetteam_typegetinfo",
    { types: STAR_CHALLENGE_BOSS_IDS.map((bossId) => 100 + bossId) },
    15000,
  );
  check();
  const presetTeamMap = presetsResponse?.presetTeamMap ?? presetsResponse?.body?.presetTeamMap ??
    presetsResponse?.data?.presetTeamMap;
  if (settings.starChallengeFormationSource === "saved" && !mapLike(presetTeamMap))
    throw new Error("游戏返回的星级预设阵容数据格式不正确");
  const previews = state.bosses.map((boss) => {
    if (settings.starChallengeFormationSource === "current")
      return { ...boss, formation: getCurrentFormation(role), hasSavedFormation: false };
    try {
      const formation = getSavedFormation(presetTeamMap, boss.bossId, role);
      return { ...boss, formation, hasSavedFormation: Boolean(formation) };
    } catch (error) {
      return { ...boss, formation: null, hasSavedFormation: false, formationError: error.message };
    }
  });
  return {
    config,
    role,
    roleNMExt,
    state,
    previews,
    presetTeamMap,
    formationSource: settings.starChallengeFormationSource,
  };
}

/** Execute a bounded sequence of star fights and verify optional star rewards. */
export async function runStarChallenge(options = {}) {
  const {
    tokenStore,
    tokenId,
    expectedRoleId,
    fetchConfig = globalThis.fetch,
    check = () => {},
    signal,
    claimOnly = false,
    onProgress = () => {},
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    delay = 500,
    serverTime = () => tokenStore.wsConnections?.[tokenId]?.client?.serverTime,
  } = options;
  if (!tokenStore || !tokenId) throw new Error("星级挑战缺少角色连接信息");
  const settings = normalizeStarChallengeOptions(options.settings || options);
  if (activeStarChallengeRuns.has(tokenId)) throw new Error("该角色的星级挑战正在执行");
  activeStarChallengeRuns.add(tokenId);
  let snapshotClient = null;
  const validateRun = () => {
    if (signal?.aborted) {
      const error = new Error("星级挑战已取消");
      error.code = "TASK_CANCELLED";
      throw error;
    }
    check();
    const status = tokenStore.getWebSocketStatus?.(tokenId);
    if (status && status !== "connected") {
      const error = new Error("游戏连接已断开，停止星级挑战");
      error.code = "TRANSPORT_NOT_READY";
      throw error;
    }
    const client = tokenStore.wsConnections?.[tokenId]?.client;
    if (snapshotClient && client !== snapshotClient) {
      const error = new Error("角色连接已切换，停止星级挑战");
      error.code = "TRANSPORT_NOT_READY";
      throw error;
    }
    return client;
  };
  const wait = async (ms) => {
    validateRun();
    await sleep(Math.max(0, Math.min(60000, Number(ms) || 0)));
    validateRun();
  };
  const read = async (cmd, params = {}, timeout = 15000) => {
    const client = validateRun();
    if (client && !snapshotClient) snapshotClient = client;
    const response = await tokenStore.sendMessageWithPromise(tokenId, cmd, params, timeout);
    validateRun();
    return response;
  };
  try {
    snapshotClient = validateRun();
    const config = await loadStarChallengeConfig(tokenStore, tokenId, fetchConfig, { check: validateRun });
    const roleResponse = await read("role_getroleinfo", {}, 15000);
    const role = readRoleFromResponse(roleResponse);
    const roleNMExtResponse = await read("nmext_getinfo", {}, 15000);
    let roleNMExt = readRoleNMExt(roleNMExtResponse);
    const requireValidState = () => inspectStarChallengeState({
      role,
      roleNMExt,
      config,
      serverTime: serverTime(),
      expectedRoleId,
    });
    let state = requireValidState();
    if (state.stale) throw new Error("星级挑战周数据已过期，请在游戏内刷新星级挑战后再执行");
    if (!claimOnly && !state.weekPass.unlocked) {
      throw new Error(`本周星级挑战未解锁：需要通关等级 ${config.unlockLevel}，当前有效进度 ${state.weekPass.level}`);
    }
    const presetsResponse = !claimOnly && settings.starChallengeFormationSource === "saved"
      ? await read("presetteam_typegetinfo", {
          types: settings.starChallengeBossIds.map((bossId) => 100 + bossId),
        }, 15000)
      : null;
    const presetTeamMap = presetsResponse
      ? (presetsResponse.presetTeamMap ?? presetsResponse.body?.presetTeamMap ?? presetsResponse.data?.presetTeamMap)
      : null;
    if (presetsResponse && !mapLike(presetTeamMap))
      throw new Error("游戏返回的星级预设阵容数据格式不正确");

    const results = [];
    for (const bossId of (claimOnly ? [] : settings.starChallengeBossIds)) {
      validateRun();
      state = requireValidState();
      if (state.stale) throw new Error("星级挑战周数据已过期，停止后续写入");
      const boss = state.bosses.find((item) => item.bossId === bossId);
      if (!boss.unlockedByStars) {
        const reason = `未达到第${bossId}关的星数解锁条件（需要累计 ${boss.unlockStar} 星）`;
        onProgress({ bossId, status: "skipped", reason });
        results.push({ bossId, status: "skipped", reason });
        continue;
      }
      if (boss.starCount >= settings.starChallengeTargetStars) {
        const reason = `已达到目标星数 ${settings.starChallengeTargetStars}`;
        onProgress({ bossId, status: "skipped", reason });
        results.push({ bossId, status: "skipped", reason });
        continue;
      }
      if (boss.remaining <= 0) {
        const reason = "本周剩余挑战次数不足";
        onProgress({ bossId, status: "skipped", reason });
        results.push({ bossId, status: "skipped", reason });
        continue;
      }
      let formation;
      if (settings.starChallengeFormationSource === "saved") {
        try {
          formation = getSavedFormation(presetTeamMap, bossId, role);
        } catch (error) {
          const reason = `预设阵容不可用：${error.message}`;
          onProgress({ bossId, status: "skipped", reason });
          results.push({ bossId, status: "skipped", reason });
          continue;
        }
        if (!formation) {
          const reason = "游戏内没有保存本关阵容，已跳过；不会改用当前出战阵容";
          onProgress({ bossId, status: "skipped", reason });
          results.push({ bossId, status: "skipped", reason });
          continue;
        }
      } else {
        formation = getCurrentFormation(role);
      }
      const maxAttempts = Math.min(settings.starChallengeMaxAttempts, boss.remaining);
      let attempted = 0;
      let status = "completed";
      while (attempted < maxAttempts) {
        validateRun();
        state = requireValidState();
        if (state.stale) throw new Error("星级挑战周数据已过期，停止后续写入");
        const currentBoss = state.bosses.find((item) => item.bossId === bossId);
        if (currentBoss.starCount >= settings.starChallengeTargetStars || currentBoss.remaining <= 0)
          break;
        onProgress({ bossId, status: "running", attempt: attempted + 1, maxAttempts, starCount: currentBoss.starCount });
        const response = await read("nmext_startboss", {
          bossId,
          battleTeam: formation.battleTeam,
          lordWeaponId: formation.lordWeaponId,
          presetTeamType: formation.presetTeamType,
          petUId: formation.petUId,
        }, 30000);
        if (typeof response?.isWin !== "boolean")
          throw new Error(`第${bossId}关战斗结果未确认；为避免重复挑战，停止写入`);
        attempted++;
        const refreshed = await read("nmext_getinfo", {}, 15000);
        roleNMExt = readRoleNMExt(refreshed);
        state = requireValidState();
        const resultBoss = state.bosses.find((item) => item.bossId === bossId);
        const newlyEarned = Array.isArray(response.nowStarIdxList)
          ? [...new Set(response.nowStarIdxList.filter((index) => Number.isInteger(index) && index >= 0 && index <= 2))]
          : [];
        onProgress({
          bossId,
          status: response.isWin ? "won" : "lost",
          attempt: attempted,
          starCount: resultBoss.starCount,
          newlyEarned,
          remaining: resultBoss.remaining,
        });
        if (!response.isWin) {
          status = "lost";
          break;
        }
        if (attempted < maxAttempts && resultBoss.starCount < settings.starChallengeTargetStars && resultBoss.remaining > 0)
          await wait(delay);
      }
      const finalBoss = state.bosses.find((item) => item.bossId === bossId);
      results.push({
        bossId,
        status,
        attempted,
        starCount: finalBoss.starCount,
        remaining: finalBoss.remaining,
      });
    }

    state = requireValidState();
    let rewardClaim = { status: "disabled", claimed: [] };
    if (claimOnly || settings.starChallengeClaimRewards) {
      if (state.stale) throw new Error("星级挑战周数据已过期，不能领取星级奖励");
      if (state.claimableRewards.length) {
        validateRun();
        const beforeClaimableIds = state.claimableRewards.map((reward) => reward.id);
        await read("nmext_claimstarreward", {}, 15000);
        const verifiedResponse = await read("nmext_getinfo", {}, 15000);
        roleNMExt = readRoleNMExt(verifiedResponse);
        state = requireValidState();
        const newlyClaimed = beforeClaimableIds.filter((id) => state.starRewardsClaimedMap.get(id) === true);
        if (!newlyClaimed.length)
          throw new Error("星级奖励领取后服务器状态未确认，请刷新状态后检查");
        rewardClaim = {
          status: "claimed",
          claimed: newlyClaimed,
        };
        onProgress({ status: "rewards-claimed", rewardClaim });
      } else {
        rewardClaim = { status: "skipped", reason: "当前没有可领取的星级奖励" };
        onProgress({ status: "rewards-skipped", reason: rewardClaim.reason });
      }
    }
    return { results, state, rewardClaim };
  } finally {
    activeStarChallengeRuns.delete(tokenId);
  }
}
