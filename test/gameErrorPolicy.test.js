import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyGameError,
  extractGameCode,
  isDailyBusinessRejection,
} from "../src/utils/gameErrorPolicy.js";

test("game error policy reads structured and both compatible message code forms", () => {
  assert.equal(extractGameCode(Object.assign(new Error("rejected"), { gameCode: 990001 })), 990001);
  assert.equal(extractGameCode(new Error("[990001] unknown")), 990001);
  assert.equal(extractGameCode(new Error("服务器错误: 400010 - 物品不足")), 400010);
});

test("only known benign codes skip; auth and uncertain writes stay terminal", () => {
  assert.equal(classifyGameError(Object.assign(new Error("rejected"), { gameCode: 2300190 })).kind, "skipped");
  assert.equal(classifyGameError(new Error("[200020] 出了点小问题 (task_claimdailyreward)")).kind, "skipped");
  assert.equal(classifyGameError(new Error("[990001] unknown" )).kind, "failed");
  assert.equal(classifyGameError(new Error("[200750] expired" )).kind, "terminal");
  assert.equal(classifyGameError(Object.assign(new Error("timeout"), { code: "UNCERTAIN_WRITE" })).kind, "terminal");
});

test("daily task continues ordinary Node game rejections and propagates auth and known rate limits", () => {
  assert.equal(isDailyBusinessRejection(new Error("[990001] unknown")), true);
  assert.equal(isDailyBusinessRejection(Object.assign(new Error("rejected"), { gameCode: 400010 })), true);
  assert.equal(isDailyBusinessRejection(new Error("[200750] expired")), false);
  assert.equal(isDailyBusinessRejection(new Error("服务器错误: 200400 - 操作太快")), false);
  assert.equal(isDailyBusinessRejection(new Error("服务器错误: 12400000 - 挂机领取过于频繁")), false);
});
