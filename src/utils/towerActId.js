const FRIDAY_DAY = 5;
const DAYS_PER_WEEK = 7;
const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000;

// The returned Date is intentionally used with UTC getters. This keeps game
// activity dates stable even when the browser/server host uses another zone.
export const toBeijingDate = (date = new Date()) =>
  new Date(new Date(date).getTime() + BEIJING_OFFSET_MS);

const getCycleFriday = (date) => {
  const cycleDate = toBeijingDate(date);
  const diff = (cycleDate.getUTCDay() - FRIDAY_DAY + DAYS_PER_WEEK) % DAYS_PER_WEEK;
  cycleDate.setUTCHours(0, 0, 0, 0);
  cycleDate.setUTCDate(cycleDate.getUTCDate() - diff);
  return cycleDate;
};

// 玄武赐福活动ID前缀（北京时间当天日期 YYMMDD，如 "260919"）
export const getXuanwuActBase = (date = new Date()) => {
  const beijing = toBeijingDate(date);
  const year = String(beijing.getUTCFullYear()).slice(-2);
  const month = String(beijing.getUTCMonth() + 1).padStart(2, "0");
  const day = String(beijing.getUTCDate()).padStart(2, "0");
  return `${year}${month}${day}`;
};

export const getTowerActId = (date = new Date()) => {
  const cycleFriday = getCycleFriday(date);
  const year = String(cycleFriday.getUTCFullYear()).slice(-2);
  const month = String(cycleFriday.getUTCMonth() + 1).padStart(2, "0");
  const day = String(cycleFriday.getUTCDate()).padStart(2, "0");
  return Number(`${year}${month}${day}1`);
};
