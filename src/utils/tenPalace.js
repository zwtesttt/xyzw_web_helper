const configCache = new Map();
const DEFAULTS = Object.freeze({
  challengeId: 1,
  requireCharm: false,
  preferCharm: false,
  autoClaimCharms: true,
  claimKillRewards: true,
  claimWeekReward: true,
  autoBuyCharms: false,
  charmTargets: Object.freeze({}),
  maxBuyPerCharm: 5,
  runLimitMinutes: 120,
  kindnessBudget: 0,
  restoreLimit: 0,
  challengeOnce: true,
});
const CHARM_NAMES = Object.freeze({
  1: "玄灵咒·壹", 2: "落幡咒·贰", 3: "九星咒·叁",
  4: "祝香咒·肆", 5: "金光咒·伍", 6: "净身咒·陆",
});

export const TEN_PALACE_TEAM_TYPE = 3;
export const TEN_PALACE_DEFAULTS = DEFAULTS;

export function entriesOf(value, label = "数据") {
  if (value instanceof Map) return [...value.entries()];
  if (value && typeof value === "object" && !Array.isArray(value)) return Object.entries(value);
  throw new Error(`${label}格式不正确`);
}

export function field(value, key, fallback = undefined) {
  if (value instanceof Map) {
    if (value.has(key)) return value.get(key);
    if (value.has(String(key))) return value.get(String(key));
    const numberKey = Number(key);
    if (Number.isSafeInteger(numberKey) && value.has(numberKey)) return value.get(numberKey);
    return fallback;
  }
  if (value && typeof value === "object") {
    if (Object.hasOwn(value, key)) return value[key];
    if (Object.hasOwn(value, String(key))) return value[String(key)];
  }
  return fallback;
}

export function toGameRoleId(value) {
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return value;
  if (typeof value === "string" && /^\d{1,16}$/.test(value)) {
    const parsed = Number(value);
    if (Number.isSafeInteger(parsed) && parsed > 0) return parsed;
  }
  throw new Error("游戏角色 ID 必须是安全范围内的十进制正整数");
}

function rowsOf(value, label, { optional = false } = {}) {
  if (value === undefined && optional) return [];
  return entriesOf(value, label).map(([key, row]) => {
    if (!row || typeof row !== "object") throw new Error(`${label}条目格式不正确`);
    const id = Number(field(row, "id", key));
    if (!Number.isSafeInteger(id) || id <= 0) throw new Error(`${label}编号无效`);
    return { ...row, id };
  }).sort((a, b) => a.id - b.id);
}

/** Validate only the official tables needed by Ten Palace. */
export function validateTenPalaceConfig(raw) {
  if (!raw || typeof raw !== "object") throw new Error("十殿配置格式不正确");
  const challenges = rowsOf(raw.NightMare, "十殿挑战配置");
  const teams = rowsOf(raw.MatchTeam, "十殿队伍配置");
  const charms = rowsOf(raw.CharmConf, "符咒配置");
  const gifts = rowsOf(raw.CharmGift, "免费符咒配置", { optional: true });
  const monsters = raw.NightMareMonster ? rowsOf(raw.NightMareMonster, "十殿BOSS配置") : [];
  const legionSchedules = raw.LegionScheduleConf ? rowsOf(raw.LegionScheduleConf, "俱乐部赛季配置") : [];
  const itemConfigs = raw.ItemConf ? rowsOf(raw.ItemConf, "物品配置") : [];
  if (!challenges.length || !teams.some((item) => item.matchTeamType === 1))
    throw new Error("十殿挑战或队伍配置缺失");
  if (charms.some((item) => !Number.isInteger(item.NewConsumeNum) || item.NewConsumeNum < 0))
    throw new Error("符咒好心值价格配置无效");
  const team = teams.find((item) => item.matchTeamType === 1);
  if (!Number.isInteger(team.memberMin) || !Number.isInteger(team.memberMax) ||
      team.memberMin < 1 || team.memberMax < team.memberMin || team.memberMax > 5)
    throw new Error("十殿组队人数配置无效");
  for (const challenge of challenges) {
    if (!Number.isInteger(challenge.totalTime) || challenge.totalTime < 60 ||
        !Number.isInteger(challenge.extParam)) throw new Error(`十殿类型 ${challenge.id} 配置无效`);
  }
  return { challenges, teams, charms, gifts, monsters, legionSchedules, itemConfigs, team, constants: raw.ConstantConf || {} };
}

export async function loadTenPalaceConfig(tokenStore, tokenId, fetchConfig = globalThis.fetch, { check = () => {} } = {}) {
  check();
  const bundle = await tokenStore.sendMessageWithPromise(tokenId, "system_getdatabundlever", {}, 15000);
  check();
  const version = bundle?.dataBundleVer;
  if (typeof version !== "string" || !/^[\w.-]+$/.test(version)) throw new Error("服务器未提供有效的游戏配置版本");
  if (!configCache.has(version)) {
    const loading = (async () => {
      const response = await fetchConfig(`https://xxz-xyzw-res.hortorgames.com/data/${version}/config.json`, { signal: AbortSignal.timeout(30000) });
      if (!response?.ok) throw new Error("官方十殿配置读取失败");
      return validateTenPalaceConfig(await response.json());
    })();
    configCache.set(version, loading);
    loading.catch(() => { if (configCache.get(version) === loading) configCache.delete(version); });
    for (const key of configCache.keys()) if (key !== version) configCache.delete(key);
  }
  check();
  return configCache.get(version);
}

export function normalizeTenPalaceOptions(input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("十殿计划参数格式无效");
  const result = { ...DEFAULTS, ...input, charmTargets: { ...DEFAULTS.charmTargets, ...(input.charmTargets || {}) } };
  const allowed = new Set(Object.keys(DEFAULTS));
  for (const key of Object.keys(input)) if (!allowed.has(key)) throw new Error(`不支持的十殿参数: ${key}`);
  if (!Number.isSafeInteger(result.challengeId) || result.challengeId <= 0) throw new Error("挑战类型无效");
  for (const key of ["requireCharm", "preferCharm", "autoClaimCharms", "autoBuyCharms", "claimKillRewards", "claimWeekReward", "challengeOnce"])
    if (typeof result[key] !== "boolean") throw new Error(`十殿参数 ${key} 必须是布尔值`);
  if (!Number.isInteger(result.maxBuyPerCharm) || result.maxBuyPerCharm < 0 || result.maxBuyPerCharm > 50)
    throw new Error("单种符咒补充上限必须为 0–50");
  if (!Number.isSafeInteger(result.kindnessBudget) || result.kindnessBudget < 0 || result.kindnessBudget > 1000000)
    throw new Error("好心值预算必须为 0–1000000");
  if (!Number.isInteger(result.restoreLimit) || result.restoreLimit < 0 || result.restoreLimit > 5)
    throw new Error("恢复次数上限必须为 0–5");
  if (!Number.isInteger(result.runLimitMinutes) || result.runLimitMinutes < 1 || result.runLimitMinutes > 120)
    throw new Error("十殿运行上限必须为 1–120 分钟");
  for (const [id, count] of Object.entries(result.charmTargets))
    if (!/^[1-6]$/.test(id) || !Number.isInteger(count) || count < 0 || count > 50)
      throw new Error("符咒目标库存必须是 0–50 的整数");
  if (result.autoBuyCharms && (!result.kindnessBudget || !result.maxBuyPerCharm ||
      Object.values(result.charmTargets).every((count) => count === 0)))
    throw new Error("开启自动补符前，请设置好心值预算、单次上限和至少一种目标库存");
  return result;
}

export function mondayStartSeconds(now = Date.now()) {
  const beijing = new Date(now + 8 * 60 * 60 * 1000);
  const date = new Date(Date.UTC(beijing.getUTCFullYear(), beijing.getUTCMonth(), beijing.getUTCDate()));
  const day = (date.getUTCDay() + 6) % 7;
  return Math.floor((Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - day) - 8 * 60 * 60 * 1000) / 1000);
}

export function parseRolePayload(response) {
  const role = field(response, "role", field(field(response, "body"), "role", field(field(response, "data"), "role", field(field(response, "roleInfo"), "role", field(response, "roleInfo", response)))));
  if (!role || typeof role !== "object" || Array.isArray(role)) throw new Error("无法读取服务器角色对象");
  return role;
}

export function countRoleItem(roleResponse, itemId, now = Date.now()) {
  const role = parseRolePayload(roleResponse);
  const items = field(role, "items");
  if (!(items instanceof Map) && (!items || typeof items !== "object")) return null;
  const direct = field(items, itemId);
  let directCount = 0;
  if (direct !== undefined) {
    directCount = Number(field(direct, "quantity", Number.NaN));
    if (!Number.isSafeInteger(directCount) || directCount < 0) return null;
    const expiry = Number(field(direct, "expireTime", field(field(direct, "ext"), "expireTime", 0)));
    if (expiry > 0 && expiry <= Math.floor(now / 1000)) directCount = 0;
  }
  let total = directCount;
  const expiredItems = field(role, "expireItems", new Map());
  let rows;
  try { rows = entriesOf(expiredItems, "限时物品"); } catch { return null; }
  for (const [, item] of rows) {
    if (Number(field(item, "itemId", -1)) !== Number(itemId)) continue;
    const expiry = Number(field(item, "expire", field(field(item, "ext"), "expireTime", field(item, "expireTime", Number.NaN))));
    if (!Number.isFinite(expiry) || (expiry !== 0 && expiry <= Math.floor(now / 1000))) continue;
    const quantity = Number(field(item, "quantity", Number.NaN));
    if (!Number.isSafeInteger(quantity) || quantity < 0) return null;
    total += quantity;
  }
  return Number.isSafeInteger(total) ? total : null;
}

export function parseTenPalaceRoleState(roleInfo, now = Date.now()) {
  const data = field(roleInfo, "nightMareData", roleInfo);
  if (!data || typeof data !== "object") throw new Error("游戏没有返回十殿角色状态");
  const charmResetTime = Number(field(data, "charmResetTime", 0));
  const weekStart = mondayStartSeconds(now);
  const charmsCurrentWeek = Number.isFinite(charmResetTime) && charmResetTime >= weekStart && charmResetTime < weekStart + 7 * 86400;
  const charmData = field(data, "charmData", new Map());
  const charmGift = field(data, "charmGift", new Map());
  const charms = {};
  for (let id = 1; id <= 6; id++) {
    const amount = Number(field(charmData, id, 0));
    const claimTime = Number(field(charmGift, id, 0));
    charms[id] = {
      id,
      name: CHARM_NAMES[id],
      amount: charmsCurrentWeek && Number.isSafeInteger(amount) && amount >= 0 ? amount : 0,
      rawAmount: Number.isSafeInteger(amount) && amount >= 0 ? amount : 0,
      validThisWeek: charmsCurrentWeek,
      giftClaimedThisWeek: Number.isFinite(claimTime) && claimTime >= weekStart && claimTime < weekStart + 7 * 86400,
    };
  }
  const love = Number(field(data, "love", 0));
  return {
    roleId: String(field(data, "roleId", field(roleInfo, "roleId", ""))),
    roomId: String(field(data, "roomId", "")),
    kindness: Number.isSafeInteger(love) && love >= 0 ? love : 0,
    charms,
    charmResetTime,
    charmGift,
    itemCount: null,
    raw: data,
  };
}

export function parseTenPalaceFormation(response) {
  const teamInfo = field(response, "teamInfo");
  const info = teamInfo ?? response;
  if (!info || typeof info !== "object" || Array.isArray(info)) throw new Error("游戏返回的十殿阵容格式无效");
  const battleTeam = field(info, "team", field(info, "battleTeam"));
  if (battleTeam === undefined && teamInfo === info) throw tenPalaceFormationNotSavedError();
  const slots = entriesOf(battleTeam, "十殿阵容").map(([position, hero]) => {
    const pos = Number(position);
    const heroId = Number(field(hero, "heroId", field(hero, "id", hero)));
    if (!Number.isInteger(pos) || pos < 0 || pos > 4 || !Number.isSafeInteger(heroId) || heroId < 0)
      throw new Error("十殿阵容包含无效站位");
    return { position: pos, heroId };
  }).filter((slot) => slot.heroId > 0).sort((a, b) => a.position - b.position);
  if (!slots.length) throw tenPalaceFormationNotSavedError();
  const petUid = field(info, "petUId", "");
  if (typeof petUid === "number" && (!Number.isSafeInteger(petUid) || petUid < 0))
    throw new Error("十殿阵容宠物 UID 已超出安全数字范围，请重新读取原始字符串");
  if (typeof petUid !== "string" && typeof petUid !== "number")
    throw new Error("十殿阵容宠物 UID 格式无效");
  return {
    battleTeam: new Map(slots.map(({ position, heroId }) => [position, heroId])),
    lordWeaponId: Number(field(info, "weaponId", field(info, "lordWeaponId", 0))),
    petUId: String(petUid),
  };
}

function tenPalaceFormationNotSavedError() {
  const error = new Error("游戏内尚未保存十殿挑战阵容");
  error.code = "TEN_PALACE_FORMATION_NOT_SAVED";
  return error;
}

export function parseTenPalaceRoom(roomInfo) {
  const room = field(roomInfo, "roomInfo", roomInfo);
  if (!room || typeof room !== "object") throw new Error("游戏没有返回十殿房间状态");
  const state = Number(field(room, "state", -1));
  if (![0, 1, 2, 3].includes(state)) throw new Error("十殿房间状态无效");
  return {
    roomId: String(field(room, "roomId", "")),
    state,
    stateEndTime: Number(field(room, "stateEndTime", 0)),
    leaderId: String(field(room, "leaderId", "")),
    fighterId: String(field(room, "fighterId", "")),
    curMonsterCfgId: Number(field(room, "curMonsterCfgId", 0)),
    restoreCnt: Number(field(room, "restoreCnt", 0)),
    matchTeamId: String(field(room, "matchTeamId", "")),
    fightLimitTime: Number(field(room, "fightLimitTime", 0)),
    lastMonsterId: Number(field(room, "lastMonsterId", 0)),
    lastFightFrame: Number(field(room, "lastFightFrame", 0)),
    lastBattleData: field(room, "lastBattleData", null),
    monsterTeamInfo: field(room, "monsterTeamInfo", new Map()),
    playerTeamInfo: field(room, "playerTeamInfo", new Map()),
    raw: room,
  };
}

export function tenPalaceServerId(roleInfo) {
  const role = (() => { try { return parseRolePayload(roleInfo); } catch { return roleInfo; } })();
  const oldServerId = Number(field(field(role, "statistics", new Map()), "or:ser:id", 0));
  const serverId = Number(field(role, "serverId", field(roleInfo, "serverId", 0)));
  const result = Number.isSafeInteger(oldServerId) && oldServerId > 0 ? oldServerId : serverId;
  return Number.isSafeInteger(result) && result > 0 ? result : null;
}

export function charmPurchasePreview({ config, roleState, market, charmId, quantity, remainingBudget }) {
  const row = config.charms.find((item) => item.id === charmId);
  if (!row) throw new Error("未知符咒");
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 50) throw new Error("购买数量必须为 1–50");
  const stock = Number(field(field(market, "charmLeftNumMap", market), charmId, -1));
  if (!Number.isSafeInteger(stock) || stock < quantity) throw new Error("区域商店余量不足或读取失败");
  const cost = row.NewConsumeNum * quantity;
  if (!Number.isSafeInteger(cost) || roleState.kindness < cost) throw new Error("好心值不足");
  if (remainingBudget !== undefined && cost > remainingBudget) throw new Error("超过本次好心值预算");
  const festival = Boolean(market?.festival);
  const cap = festival ? row.festivalLimit : row.dayLimitNum;
  if (!Number.isInteger(cap) || cap < quantity) throw new Error("当前符咒限购配置无效");
  return { charmId, quantity, cost, stock, cap };
}

export function charmFestivalActive(config, nowSeconds = Date.now() / 1000) {
  const start = Number(config?.constants?.charmFestStartTime || 0);
  const end = Number(config?.constants?.charmFestEndTime || 0);
  return Number.isFinite(start) && Number.isFinite(end) && start > 0 && nowSeconds >= start && nowSeconds <= end;
}

export function charmMarketStock(market, charmId) {
  const map = field(market, "charmLeftNumMap", market);
  const value = Number(field(map, charmId, -1));
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

export function canUseCharm(roleState, charmId) {
  const charm = roleState?.charms?.[charmId];
  return Boolean(charm && charm.validThisWeek && charm.amount > 0);
}

export function parseRoomFighterResult(room, roleId) {
  const boss = field(room?.monsterTeamInfo, room?.curMonsterCfgId);
  const snap = field(boss, "fightSnapData", new Map());
  return field(snap, roleId) !== undefined;
}

export function roomHasSurvivingHero(room, roleId) {
  const player = field(room?.playerTeamInfo, roleId);
  if (!player) return false;
  const heroes = field(player, "curHeroData");
  let rows;
  try { rows = entriesOf(heroes, `角色 ${roleId} 当前阵容`); } catch { return false; }
  return rows.length > 0 && rows.some(([, hero]) => {
    const hp = Number(field(hero, "curHp", Number.NaN));
    return Number.isFinite(hp) && hp > 0;
  });
}

export function isBoss12RoleBlocked(room, roleId) {
  if (Number(room?.curMonsterCfgId) !== 12) return false;
  const previousBoss = field(room?.monsterTeamInfo, 11);
  return field(field(previousBoss, "fightSnapData", new Map()), roleId) !== undefined;
}

export function tenPalaceRoomTeamMatches(room, roleIds, leaderRoleId) {
  if (!room || !Array.isArray(roleIds) || String(room.leaderId) !== String(leaderRoleId)) return false;
  const members = field(room.raw, "fightRoleBase");
  if (!Array.isArray(members)) return false;
  const actual = members.map((item) => String(field(item, "roleId", "")));
  return actual.length === roleIds.length && new Set(actual).size === actual.length &&
    actual.every((id) => roleIds.map(String).includes(id));
}

export async function claimTenPalaceCharms({ send, refresh, giftId = -1 }) {
  if (typeof send !== "function" || typeof refresh !== "function") throw new TypeError("send and refresh are required");
  const before = await refresh();
  const response = await send("nightmare_claimcharm", { giftId }, 12000);
  const after = await refresh();
  return { before, after, response };
}

export async function buyTenPalaceCharm({ send, refresh, loadMarket, config, charmId, quantity, remainingBudget }) {
  const [roleState, market] = await Promise.all([refresh(), loadMarket()]);
  const preview = charmPurchasePreview({ config, roleState, market, charmId, quantity, remainingBudget });
  const response = await send("nightmare_buycharm", { charmId, buyNum: quantity }, 12000);
  if (field(response, "success") !== true) throw new Error("服务器未确认符咒兑换成功；未自动重试");
  const after = await refresh();
  if (after.kindness > roleState.kindness || after.kindness !== roleState.kindness - preview.cost ||
      after.charms[charmId].amount < roleState.charms[charmId].amount + quantity)
    throw new Error("符咒兑换返回成功，但库存/好心值复核不一致；请检查游戏状态，未自动重试");
  return { preview, response, after };
}

export function teamJoinParams(teamId) {
  const value = String(teamId || "").trim();
  if (!value || value.length > 80) throw new Error("请输入有效的十殿队伍编号");
  return { teamId: value };
}

export function teamCreateParams({ challenge, teamConfig, name, notice = "", secret = 0 }) {
  if (!challenge || !Number.isInteger(challenge.id) || !Number.isInteger(challenge.extParam) ||
      !teamConfig || !Number.isInteger(teamConfig.id))
    throw new Error("十殿挑战类型无效");
  const safeName = String(name || "十殿挑战").trim();
  if (!safeName || safeName.length > 24) throw new Error("队伍名称必须为 1–24 个字符");
  return {
    teamCfgId: teamConfig.id,
    setting: { name: safeName, notice: String(notice).slice(0, 80), secret: secret ? 1 : 0, apply: 0, applyList: [], star: 0 },
    param: 0, custom: new Map(), extParam: challenge.extParam,
  };
}

export function parseRoleTenPalaceTeamId(response, teamConfigId) {
  const values = field(field(response, "roleMTData"), "gDMTData");
  const rows = values instanceof Map ? [...values.values()] : Array.isArray(values) ? values :
    values && typeof values === "object" ? Object.values(values) : [];
  const match = rows.find((item) => Number(field(item, "teamCfgId", -1)) === teamConfigId);
  return match ? String(field(match, "teamId", "")) : "";
}

export function challengeEligibility(teamRole, challenge, now = Date.now()) {
  if (!challenge || !teamRole) return { allowed: false, reason: "角色或挑战配置缺失" };
  if (challenge.extParam !== 2) return { allowed: true, reason: "" };
  const extParam = field(teamRole, "extParam", new Map());
  const privilege = Number(field(extParam, "privilege5", 0));
  if (privilege <= 0) return { allowed: false, reason: "缺少平等王挑战资格" };
  const pass8 = Number(field(extParam, "pass8", 0));
  const start = mondayStartSeconds(now);
  if (pass8 * 1000 < start * 1000 || pass8 * 1000 >= (start + 7 * 86400) * 1000)
    return { allowed: false, reason: "本周尚未通过第八殿" };
  if (Number(field(extParam, "itemCnt", 0)) <= 0)
    return { allowed: false, reason: "平等王挑战次数不足" };
  return { allowed: true, reason: "" };
}

export function currentLegionSeason(config, firstMonthDate, now = Date.now()) {
  if (typeof firstMonthDate !== "string" || !/^\d{4}[/-]\d{1,2}[/-]\d{1,2}$/.test(firstMonthDate) || !config?.legionSchedules?.length)
    return null;
  const toBeijingDay = (value) => {
    const match = String(value).match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/);
    if (!match) return null;
    return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / 1000 - 8 * 3600;
  };
  const firstMonthTime = toBeijingDay(firstMonthDate);
  if (firstMonthTime === null) return null;
  const rows = [...config.legionSchedules].sort((a, b) => a.id - b.id);
  const maxSeason = Math.max(...rows.map((row) => Number(row.season) || 0));
  let firstMonthSeason = 0;
  for (let season = 1; season <= maxSeason && !firstMonthSeason; season++) {
    if (rows.some((row) => Number(row.season) === season && Number(row.legionWarType) === 2 &&
      toBeijingDay(row.serverDate) >= firstMonthTime)) firstMonthSeason = season;
  }
  if (!firstMonthSeason) return null;
  const serverNow = Math.floor(now / 1000);
  for (let season = 1; season <= maxSeason; season++) {
    const seasonRows = rows.filter((row) => Number(row.season) === season);
    if (!seasonRows.length) continue;
    const lastTime = toBeijingDay(seasonRows[seasonRows.length - 1].serverDate);
    if (lastTime !== null && serverNow < lastTime + 86400)
      return Math.max(1, season - firstMonthSeason + 1);
  }
  return 1;
}

export function currentWeekCharge(roleInfo, now = Date.now()) {
  const statistics = field(roleInfo, "statistics", new Map());
  const statisticsTime = field(roleInfo, "statisticsTime", new Map());
  const amount = Number(field(statistics, "to:w:ch", 0));
  const timestamp = Number(field(statisticsTime, "to:w:ch", 0));
  const start = mondayStartSeconds(now);
  return Number.isSafeInteger(amount) && amount >= 0 && timestamp >= start && timestamp < start + 7 * 86400 ? amount : 0;
}

export function charmGiftEligibility({ config, roleInfo, roleState, season, now = Date.now() } = {}) {
  return (config?.gifts || []).map((gift) => {
    const charmId = Number(gift.charmId);
    const status = roleState?.charms?.[charmId];
    if (!Number.isInteger(charmId) || !status) return { giftId: gift.id, charmId, eligible: false, reason: "缺少符咒状态" };
    if (status.giftClaimedThisWeek) return { giftId: gift.id, charmId, eligible: false, reason: "本周已领取" };
    const vip = Number(field(roleInfo, "vip", Number.NaN));
    const weekCharge = currentWeekCharge(roleInfo, now);
    const freeWeekEnd = Number(config?.constants?.FreeWeekEndTime || 0);
    for (const condition of gift.condition || []) {
      const required = Number(condition.value);
      if (Number(condition.type) === 26) {
        if (!Number.isFinite(vip)) return { giftId: gift.id, charmId, eligible: false, reason: "无法确认VIP等级" };
        if (vip < required) return { giftId: gift.id, charmId, eligible: false, reason: `需要VIP ${required}` };
      } else if (Number(condition.type) === 11) {
        if (!Number.isSafeInteger(season)) return { giftId: gift.id, charmId, eligible: false, reason: "无法确认俱乐部赛季" };
        if (season < required) return { giftId: gift.id, charmId, eligible: false, reason: `需达到俱乐部赛季 ${required}` };
      } else if (Number(condition.type) === 28 && now / 1000 >= freeWeekEnd && weekCharge < required) {
        return { giftId: gift.id, charmId, eligible: false, reason: `本周充值进度不足 ${required}` };
      } else if (![26, 11, 28].includes(Number(condition.type))) {
        return { giftId: gift.id, charmId, eligible: false, reason: "包含未支持的领取条件" };
      }
    }
    return { giftId: gift.id, charmId, eligible: true, reason: "" };
  });
}

export function hasClaimableTenPalaceWeekReward(weekAward) {
  if (!weekAward || typeof weekAward !== "object") return false;
  const maxLevel = Number(field(weekAward, "maxLevel", Number.NaN));
  const levelReward = field(weekAward, "levelReward");
  if (!Number.isSafeInteger(maxLevel) || maxLevel < 0 || levelReward === undefined) return false;
  try { return maxLevel > entriesOf(levelReward, "周奖励领取记录").length; }
  catch { return false; }
}

export function isMatchingTenPalaceFightNotification(notification, { roleId, bossId, afterTime = 0 } = {}) {
  if (!notification || Number(notification.code || 0) !== 0 || Number(notification.receivedAt || 0) < afterTime) return false;
  const body = notification.body || notification;
  if (String(field(body, "roleId", "")) !== String(roleId) || Number(field(body, "bossCfgId", -1)) !== Number(bossId)) return false;
  const battle = field(body, "battleData");
  const leftTeam = field(battle, "leftTeam");
  return String(field(leftTeam, "roleId", "")) === String(roleId) && field(body, "result") !== undefined;
}

export function isMatchingTenPalaceRoomBattle(room, { roomId, roleId, bossId } = {}) {
  if (!room || String(room.roomId) !== String(roomId)) return false;
  const raw = room.raw || room;
  if (Number(field(raw, "lastMonsterId", -1)) !== Number(bossId)) return false;
  const lastBattle = field(raw, "lastBattleData");
  const leftTeam = field(lastBattle, "leftTeam");
  if (String(field(leftTeam, "roleId", "")) !== String(roleId)) return false;
  return String(room.fighterId || field(raw, "fighterId", "")) === String(roleId);
}

export function tenPalaceBattlePresentation(room, challenge, now = Date.now()) {
  const frame = Number(room?.lastFightFrame);
  const stateEndTime = Number(room?.stateEndTime);
  const speed = Number(challenge?.BattleSpeed || 1.4);
  if (!Number.isFinite(frame) || frame <= 0 || !Number.isFinite(stateEndTime) || stateEndTime <= 0 || !Number.isFinite(speed) || speed <= 0)
    return { ready: false, readyAt: null, waitMs: null };
  const playbackSeconds = frame * 0.03125 / speed;
  const endSeconds = stateEndTime > 1e12 ? stateEndTime / 1000 : stateEndTime;
  const startSeconds = endSeconds - 5 - playbackSeconds;
  const readyAt = startSeconds + playbackSeconds;
  const nowSeconds = now > 1e12 ? now / 1000 : now;
  return { ready: nowSeconds >= readyAt, readyAt, waitMs: Math.max(0, (readyAt - nowSeconds) * 1000) };
}

export function requiredEntryItems(roleState, challenge, now = Date.now()) {
  const resetAt = challenge?.id === 9 ? roleState?.raw?.tFResetTime : roleState?.raw?.tFResetTime2;
  const date = new Date(now + 8 * 60 * 60 * 1000);
  const reset = new Date(Number(resetAt || 0) * 1000 + 8 * 60 * 60 * 1000);
  const sameBeijingDay = resetAt > 0 && date.getUTCFullYear() === reset.getUTCFullYear() &&
    date.getUTCMonth() === reset.getUTCMonth() && date.getUTCDate() === reset.getUTCDate();
  if (!sameBeijingDay) return 1;
  const count = Number(roleState?.raw?.todayFightCnt || 0);
  const row = (challenge.useItemNum || []).find((item) => count >= item[0] && count <= item[1]);
  return Number(row?.[2] || 1);
}

export function nextBattleMember(room, orderedRoleIds, { bossId = room.curMonsterCfgId } = {}) {
  const fightSnap = field(field(room.monsterTeamInfo, bossId), "fightSnapData", new Map());
  const defeated = new Set(entriesOf(fightSnap, "十殿出战记录").map(([id]) => String(id)));
  const players = room.playerTeamInfo;
  for (const roleId of orderedRoleIds) {
    if (defeated.has(String(roleId))) continue;
    const player = field(players, roleId);
    if (!player) continue;
    const heroes = field(player, "curHeroData", new Map());
    const heroEntries = entriesOf(heroes, `角色 ${roleId} 当前阵容`);
    if (!heroEntries.length || heroEntries.every(([, hero]) => Number(field(hero, "curHp", 0)) <= 0)) continue;
    return String(roleId);
  }
  return null;
}

export function writeCheckpoint(context, checkpoint) {
  if (typeof context?.onCheckpoint === "function") return context.onCheckpoint(checkpoint);
  return Promise.resolve();
}

export async function runTenPalaceTeam(options) {
  const { runTenPalaceTeam: execute } = await import("./tenPalaceRunner.js");
  return execute(options);
}
