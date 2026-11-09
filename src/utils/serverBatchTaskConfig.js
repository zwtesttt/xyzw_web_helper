import { blackMarketItemCatalog, defaultBlackMarketPurchaseList } from "./batch/blackMarketConfig.js";
import { availableTasks } from "./batch/constants.js";
import { merchantConfig } from "./dreamConstants.js";

export const SERVER_BATCH_TASK_CATALOG = Object.freeze(
  Object.fromEntries(availableTasks.map(({ value, label }) => [value, label])),
);
export const SERVER_BATCH_TASK_IDS = Object.freeze(Object.keys(SERVER_BATCH_TASK_CATALOG));
export const SERVER_BATCH_TASK_LABELS = Object.freeze({ ...SERVER_BATCH_TASK_CATALOG });
export const TASK_SECRET_KEYS = Object.freeze(["password", "cdkCodes"]);

const int = (name, value, min, max) => {
  if (!Number.isInteger(value) || value < min || value > max)
    throw new Error(`计划参数 ${name} 必须是 ${min}–${max} 的整数`);
  return value;
};
const text = (name, value, max) => {
  if (typeof value !== "string" || value.length > max)
    throw new Error(`计划参数 ${name} 无效`);
  return value;
};
const own = (value, key) => Object.hasOwn(value, key);
const secretOr = (name, current, previous, max) => {
  const value = current === undefined ? previous : current;
  return text(name, value ?? "", max);
};

export const TASK_OPTION_DEFAULTS = Object.freeze({
  boxCount: 100, fishCount: 100, recruitCount: 100,
  defaultBoxType: 2001, defaultFishType: 1, targetBoxPoints: 1000,
  cdkPlatformType: "h5", dreamPurchaseList: [],
  blackMarketPurchaseList: defaultBlackMarketPurchaseList.map((entry) => ({ ...entry })),
  blackMarketPurchaseCount: null,
  starChallengeBossIds: [1, 2, 3, 4, 5, 6, 7, 8],
  starChallengeFormationSource: "saved",
  starChallengeMaxAttempts: 1,
  starChallengeTargetStars: 3,
  starChallengeClaimRewards: true,
  receiverId: "", giftQuantity: 10, giftAll: false,
  weirdTowerMaxClimb: 100, legionApplyTargetId: null,
  commandDelay: 500, taskDelay: 500, actionDelay: 300,
  battleDelay: 500, refreshDelay: 1000, longDelay: 3000,
});

const CDK_PLATFORMS = new Set(["h5", "wx", "qq"]);
const DREAM_ITEMS = new Set(Object.entries(merchantConfig).flatMap(([merchantId, value]) =>
  value.items.map((name, itemIndex) => `${merchantId}-${itemIndex}`),
));
const BLACK_MARKET_ITEMS = new Set(blackMarketItemCatalog.map((entry) => entry.itemId));

export function validateTaskOptions(input = {}, { taskIds = [], previous = {}, secrets = {}, previousSecrets = {} } = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error("任务参数必须是对象");
  const result = { ...TASK_OPTION_DEFAULTS, ...previous, ...input };
  delete result.password;
  delete result.cdkCodes;
  for (const key of Object.keys(input)) {
    if (!Object.hasOwn(TASK_OPTION_DEFAULTS, key) && !TASK_SECRET_KEYS.includes(key))
      throw new Error(`不支持的托管任务参数: ${key}`);
  }
  for (const key of ["boxCount", "fishCount", "recruitCount"])
    result[key] = int(key, result[key], 1, 100000);
  if (result.blackMarketPurchaseCount === undefined) result.blackMarketPurchaseCount = null;
  if (result.blackMarketPurchaseCount !== null &&
      (typeof result.blackMarketPurchaseCount !== "number" || !Number.isInteger(result.blackMarketPurchaseCount) ||
       result.blackMarketPurchaseCount < 1 || result.blackMarketPurchaseCount > 2147483647))
    throw new Error("计划参数 blackMarketPurchaseCount 必须留空或为 1–2147483647 的整数");
  result.defaultBoxType = int("defaultBoxType", result.defaultBoxType, 2001, 2004);
  if (![2001, 2002, 2003, 2004].includes(result.defaultBoxType)) throw new Error("宝箱类型无效");
  result.defaultFishType = int("defaultFishType", result.defaultFishType, 1, 2);
  result.targetBoxPoints = int("targetBoxPoints", result.targetBoxPoints, 1, 1000000);
  if (!Array.isArray(result.starChallengeBossIds) ||
      !result.starChallengeBossIds.length || result.starChallengeBossIds.length > 8 ||
      result.starChallengeBossIds.some((bossId) => !Number.isInteger(bossId) || bossId < 1 || bossId > 8) ||
      new Set(result.starChallengeBossIds).size !== result.starChallengeBossIds.length)
    throw new Error("计划参数 starChallengeBossIds 必须是 1–8 关内不重复的非空列表");
  result.starChallengeBossIds = [...result.starChallengeBossIds];
  if (!["saved", "current"].includes(result.starChallengeFormationSource))
    throw new Error("计划参数 starChallengeFormationSource 无效");
  result.starChallengeMaxAttempts = int("starChallengeMaxAttempts", result.starChallengeMaxAttempts, 1, 20);
  result.starChallengeTargetStars = int("starChallengeTargetStars", result.starChallengeTargetStars, 1, 3);
  if (typeof result.starChallengeClaimRewards !== "boolean")
    throw new Error("计划参数 starChallengeClaimRewards 必须是布尔值");
  result.giftQuantity = int("giftQuantity", result.giftQuantity, 1, 9999);
  result.weirdTowerMaxClimb = int("weirdTowerMaxClimb", result.weirdTowerMaxClimb, 1, 10000);
  for (const key of ["commandDelay", "taskDelay", "actionDelay", "battleDelay", "refreshDelay", "longDelay"])
    result[key] = int(key, result[key], 0, 60000);
  if (typeof result.giftAll !== "boolean") throw new Error("赠送全部残卷开关无效");
  if (!CDK_PLATFORMS.has(result.cdkPlatformType)) throw new Error("兑换码平台类型无效");
  result.receiverId = text("receiverId", result.receiverId ?? "", 128).trim();
  if (result.receiverId && (!/^[1-9]\d*$/.test(result.receiverId) || !Number.isSafeInteger(Number(result.receiverId))))
    throw new Error("接收角色 ID 必须是正整数");
  if (result.legionApplyTargetId !== null && result.legionApplyTargetId !== "")
    result.legionApplyTargetId = String(int("legionApplyTargetId", Number(result.legionApplyTargetId), 1, 2147483647));
  else result.legionApplyTargetId = null;

  if (!Array.isArray(result.dreamPurchaseList) || result.dreamPurchaseList.length > 64)
    throw new Error("梦境采购清单格式错误");
  const dreamSeen = new Set();
  result.dreamPurchaseList = result.dreamPurchaseList.map((entry) => {
    if (typeof entry !== "string" || !/^\d+-\d+$/.test(entry)) throw new Error("梦境采购清单项目无效");
    const [merchantId, itemIndex] = entry.split("-").map(Number);
    const key = `${merchantId}-${itemIndex}`;
    if (!DREAM_ITEMS.has(key)) throw new Error("梦境采购清单包含未知商品");
    if (dreamSeen.has(key)) throw new Error("梦境采购清单不能有重复商品");
    dreamSeen.add(key);
    return key;
  });

  if (!Array.isArray(result.blackMarketPurchaseList) || result.blackMarketPurchaseList.length > 64)
    throw new Error("黑市采购清单格式错误");
  const marketSeen = new Set();
  result.blackMarketPurchaseList = result.blackMarketPurchaseList.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error("黑市采购项目无效");
    const itemId = int("blackMarketPurchaseList.itemId", Number(entry.itemId), 1, 1000000);
    const discount = int("blackMarketPurchaseList.discount", Number(entry.discount), 1, 10);
    if (!BLACK_MARKET_ITEMS.has(itemId)) throw new Error("黑市采购清单包含未知商品");
    if (marketSeen.has(itemId)) throw new Error("黑市采购清单不能有重复商品");
    marketSeen.add(itemId);
    return { itemId, discount };
  });

  const effectiveSecrets = {
    password: secretOr("password", secrets.password, previousSecrets.password, 512),
    cdkCodes: secretOr("cdkCodes", secrets.cdkCodes, previousSecrets.cdkCodes, 20000),
  };
  const selected = new Set(taskIds);
  if (selected.has("batchOpenBox") || selected.has("batchOpenBoxByPoints")) {
    if (!result.defaultBoxType) throw new Error("开箱任务需要选择宝箱类型");
  }
  if (selected.has("batchFish") || selected.has("batchTopUpFish")) {
    if (!result.defaultFishType) throw new Error("钓鱼任务需要选择鱼竿类型");
  }
  if (selected.has("batchRedeemCodes") && !effectiveSecrets.cdkCodes.trim())
    throw new Error("兑换码任务需要填写兑换码");
  if (selected.has("batchLegacyGiftSendEnhanced")) {
    if (!result.receiverId) throw new Error("赠送功法残卷任务需要填写接收角色ID");
    if (!effectiveSecrets.password.trim()) throw new Error("赠送功法残卷任务需要填写安全密码");
  }
  if (selected.has("batchApplyLegion") && !result.legionApplyTargetId)
    throw new Error("申请俱乐部任务需要填写目标俱乐部ID");
  return { taskOptions: result, taskSecrets: effectiveSecrets };
}

export function publicTaskOptions(options = {}, secrets = {}) {
  const result = { ...TASK_OPTION_DEFAULTS, ...options };
  delete result.password;
  delete result.cdkCodes;
  return { ...result, hasPassword: Boolean(secrets.password), hasCdkCodes: Boolean(secrets.cdkCodes) };
}

export function splitTaskSecrets(input = {}, previous = {}) {
  const taskOptions = { ...(input || {}) };
  const secrets = { password: "", cdkCodes: "" };
  for (const key of TASK_SECRET_KEYS) {
    if (own(taskOptions, key)) secrets[key] = taskOptions[key];
    delete taskOptions[key];
  }
  return {
    taskOptions,
    taskSecrets: {
      password: secrets.password === "" ? (previous.password || "") : secrets.password,
      cdkCodes: secrets.cdkCodes === "" ? (previous.cdkCodes || "") : secrets.cdkCodes,
    },
  };
}
