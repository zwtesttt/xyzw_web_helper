const TERMINAL_CODES = new Set([200750, 200760]);
const SKIPPED_CODES = new Set([
  -10006, 1000020, 12000116, 200160, 2300070, 2300190, 2300370,
  3300060, 3500020, 400010, 400190, 700020, 1500020,
]);
const DAILY_STOP_CODES = new Set([200400, 12400000]);

export function extractGameCode(error) {
  const structured = Number(error?.gameCode);
  if (Number.isInteger(structured) && structured !== 0) return structured;
  const message = String(error?.message || error || "");
  const match = message.match(/\[(-?\d+)\]|服务器错误\s*[:：]\s*(-?\d+)/);
  return match ? Number(match[1] || match[2]) : null;
}

export function extractGameCommand(error) {
  if (typeof error?.command === "string" && error.command) return error.command;
  const message = String(error?.message || error || "");
  const parenMatch = message.match(/[（(]([a-z]\w*)[)）]/i);
  if (parenMatch) return parenMatch[1];
  const markers = ["请求超时", "读取命令", "写入命令"];
  let markerIndex = -1;
  let markerLength = 0;
  for (const marker of markers) {
    const index = message.indexOf(marker);
    if (index >= 0 && (markerIndex < 0 || index < markerIndex)) {
      markerIndex = index;
      markerLength = marker.length;
    }
  }
  if (markerIndex < 0) return "";
  const command = message.slice(markerIndex + markerLength).replace(/^[\s:：]+/, "");
  return command.match(/^[a-z]\w*/i)?.[0] || "";
}

export function classifyGameError(error) {
  const gameCode = extractGameCode(error);
  const command = extractGameCommand(error);
  if (
    error?.uncertain || error?.serverStateUnavailable ||
    ["UNCERTAIN_WRITE", "READ_UNAVAILABLE", "TASK_CANCELLED", "TASK_DEADLINE", "TASK_COMMAND_LIMIT", "TRANSPORT_NOT_READY"].includes(error?.code) ||
    TERMINAL_CODES.has(gameCode)
  ) return { kind: "terminal", gameCode, command };
  if (SKIPPED_CODES.has(gameCode)) return { kind: "skipped", gameCode, command };
  if (gameCode === 200020 && /claim|reward|point|award|signin/i.test(command)) {
    return { kind: "skipped", gameCode, command };
  }
  return { kind: "failed", gameCode, command };
}

export function isDailyBusinessRejection(error) {
  const { kind, gameCode } = classifyGameError(error);
  return kind !== "terminal" && gameCode !== null && !DAILY_STOP_CODES.has(gameCode);
}
