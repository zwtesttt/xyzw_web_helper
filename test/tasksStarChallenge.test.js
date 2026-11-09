import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createTasksStarChallenge } from "../src/utils/batch/tasksStarChallenge.js";
import { DEFAULT_STAR_CHALLENGE_OPTIONS } from "../src/utils/starChallenge.js";

const officialConfig = JSON.parse(
  await readFile(new URL("./fixtures/star-challenge-official-config.json", import.meta.url), "utf8"),
);
const weekStart = Date.UTC(2026, 10, 1, 16, 0, 0);
const serverTime = weekStart + 60 * 60 * 1000;
const weekKey = "nm:w:m:boss";
const emptyExt = () => ({
  roleId: 12345,
  starResetTime: Math.floor(weekStart / 1000),
  starBossCompleteMap: new Map(),
  starFightCntMap: new Map(),
  privilegeStarFightCntMap: new Map(),
  starRewardsClaimedMap: new Map(),
});
const role = () => ({
  id: 12345,
  lordWeaponId: 88,
  petData: { petUId: "765432109876543210" },
  battleTeam: new Map([[0, { heroId: 101 }]]),
  statistics: new Map([[weekKey, 8]]),
  statisticsTime: new Map([[weekKey, Math.floor(weekStart / 1000)]]),
  privilege: new Map([[701, Math.floor((weekStart + 7 * 24 * 60 * 60 * 1000) / 1000)]]),
});

function createDeps({ onStart, batchSettings } = {}) {
  const calls = [];
  const shouldStop = { value: false };
  const isRunning = { value: false };
  const tokenStatus = { value: {} };
  const tokenStore = {
    wsConnections: { account: { client: { serverTime } } },
    getWebSocketStatus: () => "connected",
    closeWebSocketConnection() {},
    async sendMessageWithPromise(tokenId, command, params) {
      calls.push({ tokenId, command, params, afterStop: shouldStop.value });
      if (command === "system_getdatabundlever") return { dataBundleVer: "test-bundle" };
      if (command === "role_getroleinfo") return { role: role() };
      if (command === "nmext_getinfo") return { roleNMExt: emptyExt() };
      if (command === "presetteam_typegetinfo") {
        return {
          presetTeamMap: new Map([[101, {
            teamInfo: new Map([[0, { heroId: 101 }]]),
            weapon: { weaponId: 33 },
            petUId: "900719925474099312345",
          }]]),
        };
      }
      if (command === "nmext_startboss") {
        await onStart?.(params, shouldStop);
        return { isWin: true, nowStarIdxList: [0] };
      }
      if (command === "nmext_claimstarreward") return {};
      throw new Error(`Unexpected command ${command}`);
    },
  };
  const deps = {
    selectedTokens: { value: ["account"] },
    tokens: { value: [{ id: "account", roleId: 12345, name: "测试角色" }] },
    tokenStatus,
    isRunning,
    shouldStop,
    ensureConnection: async (_tokenId, _retries, onSlot) => { onSlot?.(true); },
    releaseConnectionSlot() {},
    connectionQueue: { active: 0 },
    batchSettings: {
      ...DEFAULT_STAR_CHALLENGE_OPTIONS,
      starChallengeBossIds: [2],
      starChallengeClaimRewards: false,
      battleDelay: 0,
      maxActive: 1,
      ...batchSettings,
    },
    tokenStore,
    addLog() {},
    message: { success() {}, error() {} },
    currentRunningTokenId: { value: null },
    delayConfig: { battle: 0 },
    sleep: async () => {},
    fetchStarChallengeConfig: async () => ({ ok: true, json: async () => officialConfig }),
  };
  return { deps, calls, shouldStop, isRunning, tokenStatus };
}

test("scheduled Star Challenge uses its saved task options rather than global batch settings", async () => {
  const { deps, calls } = createDeps();
  const { batchStarChallenge } = createTasksStarChallenge(deps);
  await batchStarChallenge({
    starChallengeBossIds: [1],
    starChallengeFormationSource: "current",
    starChallengeMaxAttempts: 2,
    starChallengeTargetStars: 2,
    starChallengeClaimRewards: false,
  });
  const start = calls.find((call) => call.command === "nmext_startboss");
  assert.equal(start.params.bossId, 1);
  assert.equal(start.params.presetTeamType, 0);
  assert.equal(start.params.battleTeam.get(0), 101);
  assert.equal(calls.some((call) => call.command === "presetteam_typegetinfo"), false);
});

test("a click event is not mistaken for plan options and keeps the global settings", async () => {
  const { deps, calls } = createDeps({ batchSettings: { starChallengeFormationSource: "current" } });
  const { batchStarChallenge } = createTasksStarChallenge(deps);
  const clickEvent = Object.create({ type: "click" });
  await batchStarChallenge(clickEvent);
  assert.equal(calls.find((call) => call.command === "nmext_startboss").params.bossId, 2);
});

test("cancelled Star Challenge preserves the local plan stop flag and prevents the next task", async () => {
  const { deps, calls, shouldStop, tokenStatus } = createDeps({
    onStart: async (_params, stop) => { stop.value = true; },
  });
  const { batchStarChallenge } = createTasksStarChallenge(deps);
  const selectedTasks = ["batchStarChallenge", "batchStudy"];
  let nextTaskRan = false;

  for (const taskName of selectedTasks) {
    if (shouldStop.value) break;
    if (taskName === "batchStarChallenge") {
      await batchStarChallenge({
        starChallengeBossIds: [1],
        starChallengeFormationSource: "current",
        starChallengeClaimRewards: false,
      });
    } else {
      nextTaskRan = true;
    }
  }

  assert.equal(shouldStop.value, true);
  assert.equal(nextTaskRan, false);
  assert.equal(tokenStatus.value.account, "stopped");
  assert.equal(calls.filter((call) => call.command === "nmext_startboss").length, 1);
  assert.equal(calls.some((call) => call.afterStop), false);
});
