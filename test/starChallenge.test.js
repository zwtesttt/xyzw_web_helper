import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  DEFAULT_STAR_CHALLENGE_OPTIONS,
  inspectStarChallengeState,
  loadStarChallengeConfig,
  normalizeStarChallengeOptions,
  parseStarChallengeTeam,
  runStarChallenge,
  validateStarChallengeConfig,
} from "../src/utils/starChallenge.js";

const officialConfig = JSON.parse(
  await readFile(new URL("./fixtures/star-challenge-official-config.json", import.meta.url), "utf8"),
);
const config = validateStarChallengeConfig(officialConfig);
const WEEK_START_MS = Date.UTC(2026, 10, 1, 16, 0, 0); // Monday 00:00 Asia/Shanghai.
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const SERVER_TIME = WEEK_START_MS + 60 * 60 * 1000;
const WEEK_PASS_KEY = "nm:w:m:boss";
const PET_UID = "900719925474099312345";

function makeRole(overrides = {}) {
  return {
    id: 12345,
    lordWeaponId: 88,
    petData: { petUId: "765432109876543210" },
    battleTeam: new Map([[0, { heroId: 101 }], [1, { heroId: 102 }]]),
    statistics: new Map([[WEEK_PASS_KEY, 8]]),
    statisticsTime: new Map([[WEEK_PASS_KEY, Math.floor(WEEK_START_MS / 1000)]]),
    privilege: new Map([[701, Math.floor((WEEK_START_MS + WEEK_MS) / 1000)]]),
    ...overrides,
  };
}

function makeExt(overrides = {}) {
  return {
    roleId: 12345,
    starResetTime: Math.floor(WEEK_START_MS / 1000),
    starBossCompleteMap: new Map(),
    starFightCntMap: new Map(),
    privilegeStarFightCntMap: new Map(),
    starRewardsClaimedMap: new Map(),
    ...overrides,
  };
}

function makePreset(bossId = 1) {
  return {
    teamInfo: new Map([
      [0, new Map([["heroId", 101]])],
      [1, { heroId: 102 }],
      [2, { heroId: 0 }],
    ]),
    weapon: new Map([["weaponId", 33]]),
    petUId: PET_UID,
    bossId,
  };
}

function makeTokenStore({ role = makeRole(), ext, presets, onStart, onClaim, extReads, bundle = "test-bundle" } = {}) {
  const calls = [];
  let lastExt = ext || makeExt();
  let readIndex = 0;
  const tokenStore = {
    wsConnections: { account: { client: { serverTime: SERVER_TIME } } },
    getWebSocketStatus: () => "connected",
    async sendMessageWithPromise(tokenId, cmd, params) {
      calls.push({ tokenId, cmd, params });
      if (cmd === "system_getdatabundlever") return { dataBundleVer: bundle };
      if (cmd === "role_getroleinfo") return { role };
      if (cmd === "nmext_getinfo") {
        if (extReads?.length) lastExt = extReads[Math.min(readIndex++, extReads.length - 1)];
        return { roleNMExt: lastExt };
      }
      if (cmd === "presetteam_typegetinfo") return { presetTeamMap: presets ?? new Map([[101, makePreset()]]) };
      if (cmd === "nmext_startboss") {
        const result = await onStart?.(params, calls.length);
        if (result?.nextExt) lastExt = result.nextExt;
        return result?.response || { isWin: true, nowStarIdxList: [0] };
      }
      if (cmd === "nmext_claimstarreward") return (await onClaim?.()) || {};
      throw new Error(`Unexpected command ${cmd}`);
    },
  };
  return { tokenStore, calls };
}

function inspect(ext = makeExt(), role = makeRole(), time = SERVER_TIME) {
  return inspectStarChallengeState({ role, roleNMExt: ext, config, serverTime: time });
}

test("validates the actual official config shape, thresholds and privilege entries", () => {
  assert.equal(config.unlockLevel, 8);
  assert.equal(config.bosses.size, 8);
  assert.equal(config.book.size, 10);
  assert.equal(config.book.get(2).start, 2);
  assert.equal(config.book.get(2).stage, 4);
  assert.equal(config.book.get(10).stage, 24);
  assert.equal(config.privileges.get(701).benefit[0].value, 1);
  assert.throws(() => validateStarChallengeConfig({ ...officialConfig, NightMareStarConf: {} }), /不完整/);
});

test("accepts omitted empty progress maps and computes current week qualification", () => {
  const ext = { roleId: 12345, starResetTime: Math.floor(WEEK_START_MS / 1000) };
  const state = inspect(ext);
  assert.equal(state.stale, false);
  assert.equal(state.weekPass.unlocked, true);
  assert.equal(state.bosses[0].remaining, 6); // 5 base + official privilege level 1.
  assert.equal(state.totalStars, 0);
});

test("rejects null or malformed progress maps and stale weekly state", () => {
  assert.throws(() => inspect(makeExt({ starFightCntMap: null })), /星级挑战次数/);
  assert.throws(() => inspect(makeExt({ starFightCntMap: new Map([[1, -1]]) })), /格式不正确/);
  assert.throws(() => inspect(makeExt({ starBossCompleteMap: new Map([[1, { 0: 1 }]]) })), /星级状态无效/);
  const lastWeek = makeExt({ starResetTime: Math.floor((WEEK_START_MS - WEEK_MS) / 1000) });
  assert.equal(inspect(lastWeek).stale, true);
});

test("checks the Beijing Monday boundary and weekly pass timestamp", () => {
  const beforeBoundary = WEEK_START_MS - 1000;
  const afterBoundary = WEEK_START_MS + 1000;
  const current = makeExt({ starResetTime: Math.floor(afterBoundary / 1000) });
  const old = makeExt({ starResetTime: Math.floor(beforeBoundary / 1000) });
  assert.equal(inspect(current, makeRole({ statisticsTime: new Map([[WEEK_PASS_KEY, Math.floor(afterBoundary / 1000)]]) }), afterBoundary).stale, false);
  assert.equal(inspect(old, makeRole({ statisticsTime: new Map([[WEEK_PASS_KEY, Math.floor(beforeBoundary / 1000)]]) }), afterBoundary).weekPass.unlocked, false);
});

test("uses cumulative official book stage thresholds (4 stars and 24 stars)", () => {
  const fourStars = makeExt({
    starBossCompleteMap: new Map([
      [1, new Map([[0, true], [1, true], [2, true]])],
      [2, new Map([[0, true]])],
    ]),
  });
  const fourState = inspect(fourStars);
  assert.equal(fourState.totalStars, 4);
  assert.deepEqual(fourState.claimableRewards.map((reward) => reward.id), [1, 2]);

  const twentyFourStars = makeExt({
    starBossCompleteMap: new Map(Array.from({ length: 8 }, (_, index) => [
      index + 1,
      new Map([[0, true], [1, true], [2, true]]),
    ])),
  });
  const twentyFourState = inspect(twentyFourStars);
  assert.equal(twentyFourState.totalStars, 24);
  assert.equal(twentyFourState.highestEligibleRewardId, 10);
});

test("preserves Map teams, filters empty heroes and enforces five slots", () => {
  const team = parseStarChallengeTeam(new Map([
    [0, new Map([["heroId", 101]])],
    [1, { heroId: 102 }],
    [2, { heroId: 0 }],
  ]));
  assert.deepEqual([...team], [[0, 101], [1, 102]]);
  assert.throws(() => parseStarChallengeTeam({ 5: { heroId: 101 } }), /站位/);
  assert.throws(() => parseStarChallengeTeam({ 0: { heroId: 0 } }), /没有可用英雄/);
});

test("normalizes and strictly validates hosted/local task options", () => {
  assert.deepEqual(normalizeStarChallengeOptions({}), {
    ...DEFAULT_STAR_CHALLENGE_OPTIONS,
    starChallengeBossIds: [1, 2, 3, 4, 5, 6, 7, 8],
  });
  assert.throws(() => normalizeStarChallengeOptions({ starChallengeBossIds: [1, 1] }), /不重复/);
  assert.throws(() => normalizeStarChallengeOptions({ starChallengeFormationSource: "fallback" }), /来源/);
  assert.throws(() => normalizeStarChallengeOptions({ starChallengeMaxAttempts: 21 }), /1–20/);
  assert.throws(() => normalizeStarChallengeOptions({ starChallengeTargetStars: 0 }), /1–3/);
});

test("challenges from the fresh saved preset and keeps large pet UID exact", async () => {
  const { tokenStore, calls } = makeTokenStore();
  await runStarChallenge({
    tokenStore,
    tokenId: "account",
    serverTime: () => SERVER_TIME,
    settings: { starChallengeBossIds: [1], starChallengeClaimRewards: false },
    fetchConfig: async () => ({ ok: true, json: async () => officialConfig }),
    sleep: async () => {},
  });
  const start = calls.find((call) => call.cmd === "nmext_startboss");
  assert.ok(start);
  assert.deepEqual(start.params, {
    bossId: 1,
    battleTeam: new Map([[0, 101], [1, 102]]),
    lordWeaponId: 33,
    presetTeamType: 101,
    petUId: PET_UID,
  });
  assert.ok(start.params.battleTeam instanceof Map);
  assert.equal(start.params.petUId, PET_UID);
  assert.equal(calls.filter((call) => call.cmd === "nmext_getinfo").length, 2);
});

test("refreshes full weekly state after a challenge with a partial response patch", async () => {
  const freshState = makeExt({ starFightCntMap: new Map([[1, 1]]) });
  const { tokenStore, calls } = makeTokenStore({
    extReads: [makeExt(), freshState],
    onStart: async () => ({
      response: {
        isWin: true,
        nowStarIdxList: [0],
        roleNMExt: { starFightCntMap: new Map([[1, 1]]) },
      },
    }),
  });
  const result = await runStarChallenge({
    tokenStore,
    tokenId: "account",
    serverTime: () => SERVER_TIME,
    settings: { starChallengeBossIds: [1], starChallengeClaimRewards: false },
    fetchConfig: async () => ({ ok: true, json: async () => officialConfig }),
    sleep: async () => {},
  });
  assert.equal(result.results[0].attempted, 1);
  assert.equal(result.state.bosses[0].baseUsed, 1);
  assert.equal(result.state.bosses[0].remaining, 5);
  assert.equal(calls.filter((call) => call.cmd === "nmext_startboss").length, 1);
  assert.equal(calls.filter((call) => call.cmd === "nmext_getinfo").length, 2);
});

test("missing or malformed saved preset skips without falling back to current lineup", async () => {
  for (const presets of [
    new Map(),
    new Map([[101, { teamInfo: new Map([[0, { heroId: 0 }]]), weapon: { weaponId: 1 }, petUId: "" }]]),
  ]) {
    const { tokenStore, calls } = makeTokenStore({ presets });
    const result = await runStarChallenge({
      tokenStore,
      tokenId: "account",
      serverTime: () => SERVER_TIME,
      settings: { starChallengeBossIds: [1], starChallengeClaimRewards: false },
      fetchConfig: async () => ({ ok: true, json: async () => officialConfig }),
      sleep: async () => {},
    });
    assert.equal(result.results[0].status, "skipped");
    assert.equal(calls.some((call) => call.cmd === "nmext_startboss"), false);
  }
});

test("current lineup is sent only when explicitly selected", async () => {
  const { tokenStore, calls } = makeTokenStore({ presets: new Map() });
  await runStarChallenge({
    tokenStore,
    tokenId: "account",
    serverTime: () => SERVER_TIME,
    settings: {
      starChallengeBossIds: [1],
      starChallengeFormationSource: "current",
      starChallengeClaimRewards: false,
    },
    fetchConfig: async () => ({ ok: true, json: async () => officialConfig }),
    sleep: async () => {},
  });
  const start = calls.find((call) => call.cmd === "nmext_startboss");
  assert.deepEqual([...start.params.battleTeam], [[0, 101], [1, 102]]);
  assert.equal(start.params.presetTeamType, 0);
  assert.equal(start.params.lordWeaponId, 88);
  assert.equal(start.params.petUId, "765432109876543210");
  assert.equal(calls.some((call) => call.cmd === "presetteam_typegetinfo"), false);
});

test("one loss stops that level but continues later selected levels", async () => {
  const { tokenStore, calls } = makeTokenStore({
    presets: new Map([[101, makePreset()], [102, makePreset(2)]]),
    extReads: [makeExt(), makeExt({ starFightCntMap: new Map([[1, 1]]) }), makeExt({
      starFightCntMap: new Map([[1, 1], [2, 1]]),
    })],
    onStart: async (params) => ({ response: { isWin: params.bossId !== 1, nowStarIdxList: [] } }),
  });
  const result = await runStarChallenge({
    tokenStore,
    tokenId: "account",
    serverTime: () => SERVER_TIME,
    settings: { starChallengeBossIds: [1, 2], starChallengeClaimRewards: false },
    fetchConfig: async () => ({ ok: true, json: async () => officialConfig }),
    sleep: async () => {},
  });
  assert.deepEqual(calls.filter((call) => call.cmd === "nmext_startboss").map((call) => call.params.bossId), [1, 2]);
  assert.equal(result.results[0].status, "lost");
  assert.equal(result.results[0].attempted, 1);
  assert.equal(result.results[1].attempted, 1);
});

test("a challenge transport failure is never retried", async () => {
  const { tokenStore, calls } = makeTokenStore({
    onStart: async () => { throw new Error("timeout"); },
  });
  await assert.rejects(runStarChallenge({
    tokenStore,
    tokenId: "account",
    serverTime: () => SERVER_TIME,
    settings: { starChallengeBossIds: [1], starChallengeClaimRewards: false },
    fetchConfig: async () => ({ ok: true, json: async () => officialConfig }),
    sleep: async () => {},
  }), /timeout/);
  assert.equal(calls.filter((call) => call.cmd === "nmext_startboss").length, 1);
});

test("cancellation after one write prevents any later challenge write", async () => {
  const controller = new AbortController();
  const { tokenStore, calls } = makeTokenStore({
    onStart: async () => {
      controller.abort();
      return { response: { isWin: true, nowStarIdxList: [0] } };
    },
  });
  await assert.rejects(runStarChallenge({
    tokenStore,
    tokenId: "account",
    signal: controller.signal,
    serverTime: () => SERVER_TIME,
    settings: { starChallengeBossIds: [1, 2], starChallengeClaimRewards: false },
    fetchConfig: async () => ({ ok: true, json: async () => officialConfig }),
    sleep: async () => {},
  }), /取消/);
  assert.equal(calls.filter((call) => call.cmd === "nmext_startboss").length, 1);
});

test("official config failure prevents all challenge writes and is retryable", async () => {
  const { tokenStore, calls } = makeTokenStore({ bundle: "failed-bundle" });
  await assert.rejects(runStarChallenge({
    tokenStore,
    tokenId: "account",
    serverTime: () => SERVER_TIME,
    settings: { starChallengeBossIds: [1] },
    fetchConfig: async () => ({ ok: false, json: async () => ({}) }),
  }), /官方星级挑战配置读取失败/);
  assert.equal(calls.some((call) => call.cmd === "nmext_startboss"), false);
  let fetched = false;
  await loadStarChallengeConfig(tokenStore, "account", async () => {
    fetched = true;
    return { ok: true, json: async () => officialConfig };
  });
  assert.equal(fetched, true);
});

test("claims eligible rewards once and verifies the fresh claimed map", async () => {
  const eligible = makeExt({
    starBossCompleteMap: new Map([
      [1, new Map([[0, true], [1, true], [2, true]])],
      [2, new Map([[0, true]])],
    ]),
  });
  const claimed = makeExt({
    starBossCompleteMap: eligible.starBossCompleteMap,
    starRewardsClaimedMap: new Map([[1, true], [2, true]]),
  });
  let claimCount = 0;
  const { tokenStore, calls } = makeTokenStore({
    extReads: [eligible, claimed],
    onClaim: async () => { claimCount++; return {}; },
  });
  const result = await runStarChallenge({
    tokenStore,
    tokenId: "account",
    serverTime: () => SERVER_TIME,
    settings: {
      starChallengeBossIds: [1],
      starChallengeTargetStars: 3,
      starChallengeClaimRewards: true,
    },
    fetchConfig: async () => ({ ok: true, json: async () => officialConfig }),
    sleep: async () => {},
  });
  assert.equal(result.results[0].status, "skipped");
  assert.equal(claimCount, 1);
  assert.equal(calls.filter((call) => call.cmd === "nmext_claimstarreward").length, 1);
  assert.equal(result.rewardClaim.status, "claimed");
});

test("does not repeat a reward claim when fresh server state is unchanged", async () => {
  const eligible = makeExt({
    starBossCompleteMap: new Map([
      [1, new Map([[0, true], [1, true], [2, true]])],
      [2, new Map([[0, true]])],
    ]),
  });
  const { tokenStore, calls } = makeTokenStore({ ext: eligible, onClaim: async () => ({}) });
  await assert.rejects(runStarChallenge({
    tokenStore,
    tokenId: "account",
    serverTime: () => SERVER_TIME,
    settings: { starChallengeBossIds: [1], starChallengeTargetStars: 3 },
    fetchConfig: async () => ({ ok: true, json: async () => officialConfig }),
    sleep: async () => {},
  }), /状态未确认/);
  assert.equal(calls.filter((call) => call.cmd === "nmext_claimstarreward").length, 1);
});

test("claim-only mode claims rewards without reading formations or starting a challenge", async () => {
  const eligible = makeExt({
    starBossCompleteMap: new Map([
      [1, new Map([[0, true], [1, true], [2, true]])],
      [2, new Map([[0, true]])],
    ]),
  });
  const claimed = makeExt({
    starBossCompleteMap: eligible.starBossCompleteMap,
    starRewardsClaimedMap: new Map([[1, true], [2, true]]),
  });
  const { tokenStore, calls } = makeTokenStore({
    extReads: [eligible, claimed],
    onClaim: async () => ({}),
  });
  const result = await runStarChallenge({
    tokenStore,
    tokenId: "account",
    claimOnly: true,
    serverTime: () => SERVER_TIME,
    fetchConfig: async () => ({ ok: true, json: async () => officialConfig }),
  });
  assert.equal(result.rewardClaim.status, "claimed");
  assert.equal(calls.filter((call) => call.cmd === "nmext_claimstarreward").length, 1);
  assert.equal(calls.some((call) => call.cmd === "nmext_startboss"), false);
  assert.equal(calls.some((call) => call.cmd === "presetteam_typegetinfo"), false);
});
