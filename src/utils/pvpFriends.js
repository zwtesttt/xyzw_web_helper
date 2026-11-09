const GAME_ROLE_ID = /^\d+$/;
const FOLLOW_RESPONSE_CMD = "friend_getfollowinforesp";
const FOLLOW_REQUEST_CMD = "friend_getfollowinfo";
const MAX_RESPONSE_LAYERS = 4;

function normalizeRoleId(value) {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value > 0 ? String(value) : null;
  }
  if (typeof value !== "string") return null;
  const digits = value.trim();
  if (!GAME_ROLE_ID.test(digits)) return null;
  const id = digits.replace(/^0+/, "") || "0";
  return id === "0" ? null : id;
}

function toFollowEntries(follows) {
  if (follows instanceof Map) return [...follows.entries()];
  if (Array.isArray(follows)) {
    return follows.map((item) => [undefined, item]);
  }
  if (follows && typeof follows === "object") {
    const prototype = Object.getPrototypeOf(follows);
    if (prototype === Object.prototype || prototype === null) {
      return Object.entries(follows);
    }
  }
  return null;
}

function normalizeServerName(serverViewId) {
  const value = normalizeRoleId(serverViewId);
  return value ? `${value}服` : "";
}

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function safeValueType(value) {
  if (value === null) return "null";
  if (value instanceof Uint8Array) return `Uint8Array(${value.byteLength} bytes)`;
  if (value instanceof ArrayBuffer) return `ArrayBuffer(${value.byteLength} bytes)`;
  if (Array.isArray(value)) return `array(${value.length})`;
  if (value instanceof Map) return `Map(${value.size})`;
  if (value instanceof Set) return `Set(${value.size})`;
  if (isPlainObject(value)) return "object";
  return typeof value;
}

function safeFieldNames(value) {
  if (!isPlainObject(value)) return "";
  let keys;
  try {
    keys = Object.keys(value);
  } catch {
    return "";
  }
  const named = keys
    .filter((key) => /^[a-z_$][\w$]{0,31}$/i.test(key))
    .sort();
  const shown = named.slice(0, 10);
  const omitted = keys.length - shown.length;
  return `;fields=${shown.join(",") || "none"}${omitted > 0 ? `,+${omitted}` : ""}`;
}

/** Describe only bounded structure; never include response values. */
export function describeFollowResponseShape(value) {
  const details = [`type=${safeValueType(value)}${safeFieldNames(value)}`];
  const command = getSafeCommand(value?.cmd);
  if (command) {
    details.push(
      `cmd=${command === FOLLOW_RESPONSE_CMD ? FOLLOW_RESPONSE_CMD : "unrecognized"}`,
    );
  }
  if (Number.isSafeInteger(value?.code)) details.push(`code=${value.code}`);
  if (isPlainObject(value) && Object.hasOwn(value, "body")) {
    details.push(`body=${safeValueType(value.body)}${safeFieldNames(value.body)}`);
  }
  return details.join("; ").slice(0, 220);
}

function getSafeCommand(value) {
  return typeof value === "string" && /^[a-z]\w{0,63}$/i.test(value)
    ? value.toLowerCase()
    : "";
}

function shapeError(value, message = "游戏返回的好友列表格式不受支持") {
  const error = new Error(`${message}（${describeFollowResponseShape(value)}）`);
  error.responseShape = describeFollowResponseShape(value);
  return error;
}

function isSafeSparsePayload(value) {
  if (!isPlainObject(value) || Object.hasOwn(value, "follows")) return false;
  const allowedKeys = new Set(["followCnt", "lastFollowCnt", "_originalCmd"]);
  const keys = Object.keys(value);
  if (keys.some((key) => !allowedKeys.has(key))) return false;
  if (
    Object.hasOwn(value, "_originalCmd") &&
    value._originalCmd !== FOLLOW_REQUEST_CMD
  ) {
    return false;
  }
  for (const key of ["followCnt", "lastFollowCnt"]) {
    if (
      Object.hasOwn(value, key) &&
      !(Number.isSafeInteger(value[key]) && value[key] >= 0)
    ) {
      return false;
    }
  }
  return true;
}

function isSuccessfulEmptyEnvelope(value) {
  if (!isPlainObject(value)) return false;
  if (getSafeCommand(value.cmd) !== FOLLOW_RESPONSE_CMD) return false;
  if (!(value.code === undefined || value.code === 0 || value.code === "0")) return false;
  const allowedKeys = new Set([
    "cmd",
    "code",
    "seq",
    "resp",
    "ack",
    "time",
    "_originalCmd",
  ]);
  if (Object.keys(value).some((key) => !allowedKeys.has(key))) return false;
  return (
    !Object.hasOwn(value, "_originalCmd") ||
    value._originalCmd === FOLLOW_REQUEST_CMD
  );
}

function extractFollowPayload(response, { allowSparse = false } = {}) {
  const visited = new Set();
  let current = response;
  for (let depth = 0; depth < MAX_RESPONSE_LAYERS; depth += 1) {
    if (!current || typeof current !== "object" || visited.has(current)) break;
    visited.add(current);

    if (current.cmd !== undefined && getSafeCommand(current.cmd) !== FOLLOW_RESPONSE_CMD) {
      throw shapeError(response, "收到了其他游戏命令的响应");
    }
    if (current._originalCmd !== undefined && current._originalCmd !== FOLLOW_REQUEST_CMD) {
      throw shapeError(response, "响应与好友列表请求不匹配");
    }
    const code = current.code;
    if (code !== undefined && code !== 0 && code !== "0") {
      const safeCode = Number.isSafeInteger(code) ? `（错误码 ${code}）` : "";
      throw shapeError(response, `游戏未成功返回好友列表${safeCode}`);
    }
    if (Object.hasOwn(current, "follows")) return current;

    // The WebSocket client already decodes BON. Follow its documented payload
    // precedence, without reading lower-priority fields or invoking log helpers.
    let next;
    try {
      for (const key of ["rawData", "decodedBody", "body", "_raw"]) {
        const candidate = current[key];
        if (candidate !== undefined) {
          next = candidate;
          break;
        }
      }
    } catch {
      throw shapeError(response);
    }
    if (next !== undefined) {
      current = next;
      continue;
    }
    if (allowSparse && (isSafeSparsePayload(current) || isSuccessfulEmptyEnvelope(current))) {
      return { follows: {} };
    }
    break;
  }
  throw shapeError(response);
}

/** Convert Friend_GetFollowInfoResp.follows into safe PvP picker records. */
export function normalizeGameFollowedFriends(
  response,
  { selfRoleId, allowSparse = false } = {},
) {
  const payload = extractFollowPayload(response, { allowSparse });
  const entries = toFollowEntries(payload.follows);
  if (!entries) {
    throw shapeError(response);
  }

  const selfId = normalizeRoleId(selfRoleId);
  const seen = new Set();
  const friends = [];
  const hasArrayValues = Array.isArray(payload.follows);
  for (const [key, value] of entries) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const id = normalizeRoleId(value.roleId ?? (hasArrayValues ? undefined : key));
    if (!id || id === selfId || seen.has(id)) continue;
    seen.add(id);
    friends.push({
      id,
      name: typeof value.name === "string" && value.name.trim()
        ? value.name.trim()
        : `好友 ${id}`,
      serverName: normalizeServerName(value.serverViewId),
      power: value.power ?? "",
      headImg: typeof value.headImg === "string" ? value.headImg : "",
    });
  }
  return friends;
}

/** Read the current role first, then use its id for the game's follow-list query. */
export async function fetchGameFollowedFriends({
  tokenId,
  sendMessageWithPromise,
  isCurrent = () => true,
}) {
  if (!tokenId || typeof sendMessageWithPromise !== "function") {
    throw new TypeError("当前角色或游戏连接不可用");
  }
  if (!isCurrent()) return null;

  const roleResponse = await sendMessageWithPromise(
    tokenId,
    "role_getroleinfo",
    {},
    8000,
  );
  if (!isCurrent()) return null;

  const selfRoleId = normalizeRoleId(roleResponse?.role?.roleId);
  if (!selfRoleId) throw new Error("未能确认当前游戏角色，请重新连接后重试");
  const friendId = Number(selfRoleId);
  if (!Number.isSafeInteger(friendId)) {
    throw new RangeError("当前游戏角色 ID 超出协议支持范围");
  }

  const response = await sendMessageWithPromise(
    tokenId,
    "friend_getfollowinfo",
    { friendId },
    8000,
  );
  if (!isCurrent()) return null;

  return normalizeGameFollowedFriends(response, { selfRoleId, allowSparse: true });
}

/** Return a safe user-facing failure message without exposing request details. */
export function formatFollowLoadError(error) {
  if (typeof error?.responseShape === "string") {
    return `读取游戏关注列表失败：${error.message}`;
  }
  const safeMessage = new Set([
    "未能确认当前游戏角色，请重新连接后重试",
    "当前游戏角色 ID 超出协议支持范围",
    "当前角色或游戏连接不可用",
  ]);
  if (safeMessage.has(error?.message)) {
    return `读取游戏关注列表失败：${error.message}`;
  }
  return "读取游戏关注列表失败：游戏连接中断或请求超时，请检查游戏连接并确认角色仍在线后重试";
}
