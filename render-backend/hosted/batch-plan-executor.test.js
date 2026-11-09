import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
/* eslint-disable test/no-import-node-test -- project acceptance runs these with node --test. */
import test from "node:test";
import { availableTasks } from "../../src/utils/batch/constants.js";
import { validateTaskOptions } from "../../src/utils/serverBatchTaskConfig.js";
import {
  createBatchPlanExecutor,
  SERVER_BATCH_TASKS,
  validateBatchDelaySettings,
  validateDailySettings,
} from "./batch-plan-executor.js";

const officialStarChallengeConfig = JSON.parse(
  await readFile(new URL("../../test/fixtures/star-challenge-official-config.json", import.meta.url), "utf8"),
);

class FakeGameClient {
  constructor(credential) {
    this.credential = credential;
    this.connected = false;
    this.serverTime = 1_700_000_000_000;
    this.commands = [];
    this.helpers = [];
    this.disconnectCount = 0;
    FakeGameClient.instances.push(this);
  }
  async connect() { this.connected = true; }
  async sendWithPromise(command, params = {}, timeout) {
    this.commands.push({ command, params, timeout });
    if (command === "role_getroleinfo") {
      return {
        role: {
          hangUp: {
            checkTime: Math.floor(this.serverTime / 1000),
            helpFriend: this.helpers,
          },
        },
      };
    }
    if (command === "system_mysharecallback") {
      this.helpers.push({ slot: this.helpers.length, helpTime: 3600 });
    }
    if (command === "legacy_claimhangup") {
      return { reward: [{ value: 1 }], role: { items: { 37007: { quantity: 1 } } } };
    }
    return {};
  }
  disconnect() { this.connected = false; this.disconnectCount++; }
}
FakeGameClient.instances = [];

class AllTasksGameClient {
  static instances = [];

  constructor(credential) {
    this.credential = credential;
    this.connected = false;
    this.seq = 0;
    this.serverTime = Date.parse("2026-10-25T10:00:00+08:00");
    this.connectCount = 0;
    this.battleVersion = null;
    this.calls = [];
    this.helpers = [];
    this.market = [];
    this.starExt = {
      roleId: 12345,
      starResetTime: Math.floor(Date.parse("2026-10-19T00:00:00+08:00") / 1000),
      starBossCompleteMap: new Map(),
      starFightCntMap: new Map(),
      privilegeStarFightCntMap: new Map(),
      starRewardsClaimedMap: new Map(),
    };
    AllTasksGameClient.instances.push(this);
  }
  async connect() {
    this.connected = true;
    this.connectCount++;
    this.battleVersion = 240520 + this.connectCount;
  }
  disconnect() { this.connected = false; }
  role() {
    return {
      id: 12345,
      lordWeaponId: 33,
      petData: { petUId: "987654321012345678" },
      battleTeam: new Map([[0, { heroId: 101 }]]),
      hangUp: { checkTime: Math.floor(this.serverTime / 1000), helpFriend: this.helpers },
      items: {
        1007: { quantity: 3 }, 1011: { quantity: 30 }, 1012: { quantity: 30 },
        1021: { quantity: 1 }, 2001: { quantity: 300 }, 2002: { quantity: 100 },
        2003: { quantity: 100 }, 2004: { quantity: 100 }, 37007: { quantity: 10 },
      },
      tower: { energy: 0 }, dungeon: { merchant: { 1: [5] } }, genie: { 1: 0 },
      levelId: 4000,
      statistics: new Map([["artifact:point", 0], ["nm:w:m:boss", 8]]),
      statisticsTime: new Map([
        ["artifact:point", Math.floor(this.serverTime / 1000)],
        ["nm:w:m:boss", Math.floor(Date.parse("2026-10-20T00:00:00+08:00") / 1000)],
      ]),
    };
  }
  async sendWithPromise(command, params = {}, timeout) {
    assert.equal(this.connected, true, `sent ${command} while disconnected`);
    this.seq++;
    this.calls.push({ command, params: structuredClone(params), timeout });
    let response = {};
    if (command === "fight_startlevel") response = { battleData: { version: this.battleVersion } };
    else if (command === "role_getroleinfo") response = { role: this.role() };
    else if (command === "system_getdatabundlever") response = { dataBundleVer: "test-bundle" };
    else if (command === "nmext_getinfo") response = { roleNMExt: structuredClone(this.starExt) };
    else if (command === "presetteam_typegetinfo") {
      response = {
        presetTeamMap: new Map((params.types || []).map((type) => [type, {
          teamInfo: new Map([[0, { heroId: 101 }]]),
          weapon: { weaponId: 33 },
          petUId: "987654321012345678",
        }])),
      };
    } else if (command === "nmext_startboss") response = { isWin: true, nowStarIdxList: [0] };
    else if (command === "nmext_claimstarreward") response = {};
    else if (command === "system_mysharecallback") {
      this.helpers.push({ slot: this.helpers.length, helpTime: 3600 });
      response = { role: { hangUp: this.role().hangUp } };
    } else if (command === "presetteam_getinfo") {
      response = { presetTeamInfo: { useTeamId: 1, 1: { teamInfo: { 1: { heroId: 101 } } } } };
    } else if (command === "bosstower_getinfo") response = { bossTower: { towerId: 1 } };
    else if (command === "evotower_getinfo") response = { evoTower: { towerId: 1, rewardTowerId: 1, energy: 0, lotteryLeftCnt: 0, taskClaimMap: {} } };
    else if (command === "mergebox_getinfo") response = { mergeBox: { costTotalCnt: 0, taskMap: {}, taskClaimMap: {}, gridMap: {} } };
    else if (command === "towers_getinfo") response = { actId: params.actId, levelRewardMap: { 3008: true } };
    else if (command === "activity_get") response = { activity: { myMonthInfo: { 2: { num: 1000 } }, myArenaInfo: { num: 1000 } } };
    else if (command === "arena_getareatarget") response = { rankList: [{ roleId: 2 }] };
    else if (command === "club_getinfo") response = { siege: { attackMap: {} }, club: { oppoMap: {} } };
    else if (command === "club_attackmonster") response = { battleData: { result: { accept: { ext: { curHP: 0 } } } }, reward: [{ id: 1 }] };
    else if (command === "legion_getinfobyid") response = { legionData: { id: params.legionId, name: "测试俱乐部" } };
    else if (command === "legacy_claimhangup") response = { reward: [{ value: 1 }], role: { items: { 37007: { quantity: 11 } } } };
    else if (command === "rank_getroleinfo") response = { roleInfo: { roleId: params.roleId, serverName: "1服", name: "接收者" } };
    else if (command === "role_commitpassword") response = { role: { statistics: { "que:wh:tm": 1 } } };
    else if (command === "store_getpurchase") response = { purchaseCnt: 1, purchaseItemList: this.market };
    else if (command === "store_setpurchase") this.market = structuredClone(params.purchaseItemList);
    else if (command === "genie_sweep") response = { role: { items: { 1021: { quantity: 0 } } } };
    else if (command === "study_startgame") response = { study: { id: 7 }, questionList: [{ id: 1, question: "测试题" }] };
    else if (command === "activity_warorderget") response = { activity: { warOrderActivityInfo: { [params.actId]: { complete: {}, taskClaimed: {} } } } };
    this.onPacket?.(structuredClone(response), { cmd: `${command}resp`, time: this.serverTime });
    return response;
  }
}

function createExecutor(overrides = {}) {
  FakeGameClient.instances = [];
  return createBatchPlanExecutor({
    GameClientClass: FakeGameClient,
    sleep: async () => {},
    ...overrides,
  });
}
const account = { id: "server-account-a", name: "测试角色", credential: { roleToken: "fake-token", roleId: "role-a" } };
const config = (taskId) => ({
  localTaskIds: [taskId],
  dailySettingsByAccount: { "server-account-a": { arenaFormation: 4 } },
});

const versionedBattleCommands = [
  "fight_startareaarena", "fight_startpvp", "fight_starttower", "fight_startboss",
  "fight_startlegionboss", "fight_startdungeon", "fight_level",
];

class BattleCheckingGameClient extends AllTasksGameClient {
  static versionResponse;
  static versionFailure;

  async sendWithPromise(command, params = {}, timeout) {
    if (command === "fight_startlevel") {
      assert.equal(this.connected, true, "sent fight_startlevel while disconnected");
      this.seq++;
      this.calls.push({ command, params: structuredClone(params), timeout });
      if (BattleCheckingGameClient.versionFailure) {
        const error = new Error(BattleCheckingGameClient.versionFailure.message);
        Object.assign(error, BattleCheckingGameClient.versionFailure.metadata || {});
        throw error;
      }
      return BattleCheckingGameClient.versionResponse !== undefined
        ? structuredClone(BattleCheckingGameClient.versionResponse)
        : { battleData: { version: this.battleVersion } };
    }
    if (versionedBattleCommands.includes(command)) {
      this.seq++;
      this.calls.push({ command, params: structuredClone(params), timeout });
      if (command === "fight_startareaarena" && !params.targetId) {
        const error = new Error("fight_startareaarena requires targetId");
        error.gameCode = 200750;
        error.command = command;
        throw error;
      }
      if (params.battleVersion !== this.battleVersion) {
        const error = new Error("[200750] missing or stale battleVersion");
        error.gameCode = 200750;
        error.command = command;
        throw error;
      }
      return { battleData: { version: this.battleVersion } };
    }
    return super.sendWithPromise(command, params, timeout);
  }
}

function makeBattleRunner(runTask) {
  return class {
    constructor(tokenStore) { this.tokenStore = tokenStore; }
    run(tokenId, callbacks, settings) {
      return runTask(this.tokenStore, tokenId, callbacks, settings);
    }
  };
}

function createBattleExecutor({ run = async () => ({ completed: 1 }), ...overrides } = {}) {
  AllTasksGameClient.instances = [];
  BattleCheckingGameClient.versionResponse = undefined;
  BattleCheckingGameClient.versionFailure = null;
  return createBatchPlanExecutor({
    GameClientClass: BattleCheckingGameClient,
    DailyTaskRunnerClass: makeBattleRunner(run),
    sleep: async () => {},
    clock: () => Date.parse("2026-10-25T10:00:00+08:00"),
    now: () => new Date("2026-10-25T10:00:00+08:00"),
    ...overrides,
  });
}

const battlePlanConfig = (localTaskIds = ["startBatch"], extra = {}) => ({
  localTaskIds,
  delaySettings: { commandDelay: 0, taskDelay: 0, actionDelay: 0, battleDelay: 0, refreshDelay: 0, longDelay: 0 },
  ...extra,
});

test("hosted battle commands share one dynamic version read and preserve caller params", async () => {
  const params = versionedBattleCommands.map((_, index) => ({
    targetId: `target-${index}`, battleVersion: 1, marker: index,
  }));
  const originalParams = structuredClone(params);
  const execute = createBattleExecutor({
    run: async (tokenStore, tokenId) => {
      await Promise.all(versionedBattleCommands.map((command, index) =>
        tokenStore.sendMessageWithPromise(tokenId, command, params[index])));
      return { completed: 1 };
    },
  });

  await execute(account, battlePlanConfig());

  const client = AllTasksGameClient.instances[0];
  const versionReads = client.calls.filter((call) => call.command === "fight_startlevel");
  const battleCalls = client.calls.filter((call) => versionedBattleCommands.includes(call.command));
  assert.equal(versionReads.length, 1, "concurrent battle commands should share the read");
  assert.deepEqual(versionReads[0].params, {}, "fight_startlevel must not recursively receive a version");
  assert.deepEqual(battleCalls.map((call) => call.command), versionedBattleCommands);
  for (const [index, call] of battleCalls.entries()) {
    assert.deepEqual(call.params, { ...originalParams[index], battleVersion: client.battleVersion });
  }
  assert.deepEqual(params, originalParams, "the caller's parameter objects must remain unchanged");
});

test("noncombat hosted tasks do not request a battle version", async () => {
  const execute = createBattleExecutor();
  await execute(account, battlePlanConfig(["collection_claimfreereward"]));
  assert.equal(
    AllTasksGameClient.instances[0].calls.some((call) => call.command === "fight_startlevel"),
    false,
  );
});

test("battle version cache resets for a new account execution and a reconnected transport", async () => {
  const freshAccountExecutor = createBattleExecutor({
    run: async (tokenStore, tokenId) => {
      await tokenStore.sendMessageWithPromise(tokenId, "fight_startpvp", { targetId: "first" });
      return { completed: 1 };
    },
  });
  await freshAccountExecutor(account, battlePlanConfig());
  await freshAccountExecutor({
    ...account,
    id: "server-account-b",
    credential: { roleToken: "other-token", roleId: "role-b" },
  }, battlePlanConfig());
  assert.equal(AllTasksGameClient.instances.length, 2);
  for (const client of AllTasksGameClient.instances) {
    assert.equal(client.calls.filter((call) => call.command === "fight_startlevel").length, 1);
  }

  const reconnectingExecutor = createBattleExecutor({
    run: async (tokenStore, tokenId) => {
      await tokenStore.sendMessageWithPromise(tokenId, "fight_startpvp", { targetId: "before-close" });
      tokenStore.closeWebSocketConnection(tokenId);
      return { completed: 1 };
    },
  });
  await reconnectingExecutor(account, battlePlanConfig(["startBatch", "batcharenafight"]));
  const reconnectedClient = AllTasksGameClient.instances[0];
  const reconnectedBattles = reconnectedClient.calls.filter((call) =>
    ["fight_startpvp", "fight_startareaarena"].includes(call.command));
  assert.equal(reconnectedClient.connectCount, 2);
  assert.ok(reconnectedBattles.some((call) => call.command === "fight_startareaarena" && call.params.targetId === 2));
  assert.deepEqual(reconnectedBattles.map((call) => call.params.battleVersion), [
    240521, 240522, 240522, 240522,
  ]);
  assert.equal(reconnectedClient.calls.filter((call) => call.command === "fight_startlevel").length, 2);
});

test("missing or invalid battle versions stop combat and later mutations", async () => {
  const invalidResponses = [
    null,
    {},
    { battleData: {} },
    { battleData: { version: 0 } },
    { battleData: { version: -1 } },
    { battleData: { version: 1.5 } },
    { battleData: { version: Number.MAX_SAFE_INTEGER + 1 } },
  ];
  for (const versionResponse of invalidResponses) {
    const execute = createBattleExecutor({
      run: async (tokenStore, tokenId) => {
        try {
          await tokenStore.sendMessageWithPromise(tokenId, "fight_startpvp", { targetId: "target" });
        } catch {}
        await tokenStore.sendMessageWithPromise(tokenId, "collection_claimfreereward", {});
        return { completed: 1 };
      },
    });
    BattleCheckingGameClient.versionResponse = versionResponse;
    await assert.rejects(execute(account, battlePlanConfig()), (error) =>
      error.code === "BATTLE_VERSION_UNAVAILABLE" &&
      error.command === "fight_startlevel" &&
      error.serverStateUnavailable === true &&
      /战斗版本无法确认/.test(error.message));
    const commands = AllTasksGameClient.instances[0].calls.map((call) => call.command);
    assert.equal(commands.includes("fight_startpvp"), false);
    assert.equal(commands.includes("collection_claimfreereward"), false);
  }
});

test("a rejected version read is terminal and keeps redacted source metadata", async () => {
  const execute = createBattleExecutor({
    run: async (tokenStore, tokenId) => {
      await tokenStore.sendMessageWithPromise(tokenId, "fight_startpvp", { targetId: "target" });
      await tokenStore.sendMessageWithPromise(tokenId, "collection_claimfreereward", {});
      return { completed: 1 };
    },
  });
  BattleCheckingGameClient.versionFailure = {
    message: "[990001] private-secret version rejected",
    metadata: { gameCode: 990001, command: "fight_startlevel" },
  };
  await assert.rejects(execute(account, battlePlanConfig(["startBatch"], {
    taskSecrets: { password: "private-secret" },
  })), (error) =>
    error.code === "BATTLE_VERSION_UNAVAILABLE" &&
    error.gameCode === 990001 &&
    error.command === "fight_startlevel" &&
    error.serverStateUnavailable === true &&
    error.cause?.gameCode === 990001 &&
    error.cause?.command === "fight_startlevel" &&
    error.cause?.message.includes("[已隐藏]") &&
    !error.cause?.message.includes("private-secret"));
  const commands = AllTasksGameClient.instances[0].calls.map((call) => call.command);
  assert.equal(commands.includes("fight_startpvp"), false);
  assert.equal(commands.includes("collection_claimfreereward"), false);
});

test("a 200750 version-read rejection keeps the server rejection and blocks mutations", async () => {
  const execute = createBattleExecutor({
    run: async (tokenStore, tokenId) => {
      await tokenStore.sendMessageWithPromise(tokenId, "fight_startpvp", { targetId: "target" });
      await tokenStore.sendMessageWithPromise(tokenId, "collection_claimfreereward", {});
      return { completed: 1 };
    },
  });
  BattleCheckingGameClient.versionFailure = {
    message: "[200750] login state expired",
    metadata: { gameCode: 200750, command: "fight_startlevel" },
  };
  await assert.rejects(execute(account, battlePlanConfig()), (error) =>
    error.gameCode === 200750 &&
    error.command === "fight_startlevel" &&
    error.code === "GAME_REQUEST_REJECTED" &&
    /\[200750\]/.test(error.message));
  const commands = AllTasksGameClient.instances[0].calls.map((call) => call.command);
  assert.equal(commands.includes("fight_startpvp"), false);
  assert.equal(commands.includes("collection_claimfreereward"), false);
});

test("the battle-version preflight consumes command capacity before combat", async () => {
  const execute = createBattleExecutor({
    maxCommands: 3,
    run: async (tokenStore, tokenId) => {
      await tokenStore.sendMessageWithPromise(tokenId, "fight_startpvp", { targetId: "target" });
      await tokenStore.sendMessageWithPromise(tokenId, "collection_claimfreereward", {});
      return { completed: 1 };
    },
  });
  await assert.rejects(execute(account, battlePlanConfig()), (error) => error.code === "TASK_COMMAND_LIMIT");
  const commands = AllTasksGameClient.instances[0].calls.map((call) => call.command);
  assert.equal(commands.filter((command) => command === "fight_startlevel").length, 1);
  assert.equal(commands.includes("fight_startpvp"), false);
  assert.equal(commands.includes("collection_claimfreereward"), false);
});

test("cancellation during the version preflight prevents combat and later mutations", async () => {
  let signalVersionRead;
  let finishVersionRead;
  const versionReadStarted = new Promise((resolve) => { signalVersionRead = resolve; });
  class DeferredVersionGameClient extends BattleCheckingGameClient {
    async sendWithPromise(command, params = {}, timeout) {
      if (command !== "fight_startlevel") return super.sendWithPromise(command, params, timeout);
      assert.equal(this.connected, true);
      this.seq++;
      this.calls.push({ command, params: structuredClone(params), timeout });
      return new Promise((resolve) => {
        finishVersionRead = resolve;
        signalVersionRead();
      });
    }
  }
  const controller = new AbortController();
  const execute = createBattleExecutor({
    GameClientClass: DeferredVersionGameClient,
    run: async (tokenStore, tokenId) => {
      await tokenStore.sendMessageWithPromise(tokenId, "fight_startpvp", { targetId: "target" });
      await tokenStore.sendMessageWithPromise(tokenId, "collection_claimfreereward", {});
      return { completed: 1 };
    },
  });
  const execution = execute(account, battlePlanConfig(), { signal: controller.signal });
  await versionReadStarted;
  controller.abort();
  finishVersionRead({ battleData: { version: 240521 } });
  await assert.rejects(execution, (error) => error.code === "TASK_CANCELLED");
  const commands = AllTasksGameClient.instances[0].calls.map((call) => call.command);
  assert.equal(commands.includes("fight_startpvp"), false);
  assert.equal(commands.includes("collection_claimfreereward"), false);
});

for (const [taskId, command] of [
  ["batchclubsign", "legion_signin"],
  ["collection_claimfreereward", "collection_claimfreereward"],
  ["batchLegacyClaim", "legacy_claimhangup"],
]) {
  test(`${taskId} dispatches its matching game command and closes the connection`, async () => {
    const execute = createExecutor();
    await execute(account, config(taskId));
    const client = FakeGameClient.instances[0];
    assert.equal(client.commands[0].command, "role_getroleinfo");
    assert.equal(client.commands.at(-1).command, command);
    assert.equal(client.connected, false);
    assert.ok(client.disconnectCount >= 1);
  });
}

test("batchAddHangUpTime uses the server response clock and confirms all four slots", async () => {
  const execute = createExecutor();
  await execute(account, config("batchAddHangUpTime"));
  const client = FakeGameClient.instances[0];
  assert.equal(client.commands.filter((entry) => entry.command === "system_mysharecallback").length, 4);
  assert.equal(client.commands.some((entry) => entry.command === "system_claimhangupreward"), false);
  assert.equal(client.commands.at(-1).command, "role_getroleinfo");
  assert.equal(client.connected, false);
});

test("claimHangUpRewards claims the reward before filling slots", async () => {
  const execute = createExecutor();
  await execute(account, config("claimHangUpRewards"));
  const commands = FakeGameClient.instances[0].commands.map((entry) => entry.command);
  assert.ok(commands.indexOf("system_claimhangupreward") > 0);
  assert.ok(commands.indexOf("system_claimhangupreward") < commands.indexOf("system_mysharecallback"));
});

test("startBatch passes the full saved settings snapshot into the shared daily runner", async () => {
  let received;
  class FakeDailyRunner {
    constructor(tokenStore, delays, options) {
      this.tokenStore = tokenStore;
      this.delays = delays;
      this.options = options;
      this.delays = delays;
    }
    async run(tokenId, callbacks, settings) {
      received = { tokenId, callbacks, settings, connected: this.tokenStore.getWebSocketStatus(tokenId), options: this.options, delays: this.delays };
      return { incomplete: 0 };
    }
  }
  const execute = createExecutor({ DailyTaskRunnerClass: FakeDailyRunner });
  await execute(account, {
    ...config("startBatch"),
    delaySettings: { commandDelay: 700, taskDelay: 900 },
    dailySettingsByAccount: {
      "server-account-a": {
        arenaFormation: 4,
        towerFormation: 2,
        bossFormation: 6,
        bossTimes: 0,
        claimBottle: false,
        payRecruit: true,
        openBox: false,
        arenaEnable: true,
        claimHangUp: false,
        claimEmail: true,
        blackMarketPurchase: false,
        freeGachaEnable: true,
      },
    },
  });
  assert.equal(received.connected, "connected");
  assert.deepEqual(received.delays, { commandDelay: 700, taskDelay: 900 });
  assert.equal(received.settings.towerFormation, 2);
  assert.equal(received.settings.claimBottle, false);
  assert.equal(received.settings.freeGachaEnable, true);
  assert.equal(typeof received.options.sleep, "function");
});

test("unknown server tasks fail before a game connection starts", async () => {
  const execute = createExecutor();
  await assert.rejects(
    execute(account, { ...config("unknown"), localTaskIds: ["unknown"] }),
    /任务列表无效/,
  );
  assert.equal(FakeGameClient.instances.length, 0);
});

test("daily settings allow only known fields and validated ranges", () => {
  assert.equal(validateDailySettings().freeGachaEnable, true);
  assert.equal(validateDailySettings({ arenaFormation: 6 }).arenaFormation, 6);
  assert.throws(() => validateDailySettings({ arenaFormation: 0 }), /Invalid setting/);
  assert.throws(() => validateDailySettings({ serverUrl: "https://example.invalid" }), /Unsupported/);
  assert.equal(Object.keys(SERVER_BATCH_TASKS).length, 40);
  assert.deepEqual(validateBatchDelaySettings({ commandDelay: 2000 }), {
    commandDelay: 2000,
    taskDelay: 500,
    actionDelay: 300,
    battleDelay: 500,
    refreshDelay: 1000,
    longDelay: 3000,
  });
  assert.throws(() => validateBatchDelaySettings({ taskDelay: -1 }), /Invalid delay/);
  assert.throws(() => validateBatchDelaySettings({ fetchUrl: "https://example.invalid" }), /Unsupported delay/);
});

test("all 40 selectable tasks execute a real factory path or an explicit read-only skip", async () => {
  const expected = {
    startBatch: "role_getroleinfo", claimHangUpRewards: "system_claimhangupreward", batchAddHangUpTime: "system_mysharecallback",
    resetBottles: "bottlehelper_stop", batchlingguanzi: "bottlehelper_claim", climbTower: "tower_getinfo",
    climbWeirdTower: "evotower_getinfo", batchStudy: "study_answer", batchOpenBox: "item_openbox",
    batchOpenBoxByPoints: "item_openbox", batchClaimBoxPointReward: "item_batchclaimboxpointreward",
    batchFish: "artifact_lottery", batchRecruit: "hero_recruit", batchRedeemCodes: "system_claimcdkreward",
    batchbaoku13: "bosstower_startboss", batchbaoku45: "bosstower_getinfo", batchmengjing: "dungeon_selecthero",
    batchclubsign: "legion_signin", batchCampChallenge: "club_taskclaim", batchCampChallengePet: "club_attackmonster",
    batchCampClaimTasks: "club_taskclaim", batchStarChallenge: "nmext_startboss", batchApplyLegion: "legion_applyjoin", batcharenafight: "fight_startareaarena",
    batchTopUpFish: "activity_get", batchTopUpArena: "activity_get", batchClaimFreeEnergy: "mergebox_getinfo",
    skinChallenge: "towers_getinfo", legion_storebuygoods: "legion_storebuygoods", store_syncpurchaseconfig: "store_setpurchase",
    store_purchase: "store_purchase", collection_claimfreereward: "collection_claimfreereward", batchLegacyClaim: "legacy_claimhangup",
    batchLegacyGiftSendEnhanced: "legacy_sendgift", batchUseItems: "mergebox_getinfo", batchMergeItems: "mergebox_getinfo",
    batchClaimPeachTasks: "legion_getpayloadtask", batchGenieSweep: "genie_sweep", batchBuyDreamItems: "dungeon_buymerchant",
    batchXuanwuBlessing: "activity_lottery",
  };
  assert.equal(availableTasks.length, 40);
  assert.deepEqual(Object.keys(SERVER_BATCH_TASKS).sort(), availableTasks.map((task) => task.value).sort());
  const options = {
    boxCount: 21, fishCount: 3, recruitCount: 11, defaultBoxType: 2002, defaultFishType: 2,
    targetBoxPoints: 100, dreamPurchaseList: ["1-5"], blackMarketPurchaseList: [{ itemId: 2002, discount: 8 }],
    receiverId: "2", giftQuantity: 2, giftAll: false, weirdTowerMaxClimb: 1, legionApplyTargetId: "3", cdkPlatformType: "h5",
  };
  const delays = { commandDelay: 0, taskDelay: 0, actionDelay: 0, battleDelay: 0, refreshDelay: 0, longDelay: 0 };
  for (const task of availableTasks) {
    AllTasksGameClient.instances = [];
    const execute = createBatchPlanExecutor({
      GameClientClass: AllTasksGameClient,
      DailyTaskRunnerClass: class { async run() { return { incomplete: 0 }; } },
      sleep: async () => {},
      clock: () => Date.parse("2026-10-25T10:00:00+08:00"),
      now: () => new Date("2026-10-25T10:00:00+08:00"),
      loadStudyAnswers: async () => [{ name: "测试题", value: 2 }],
      fetchStarChallengeConfig: async () => ({ ok: true, json: async () => officialStarChallengeConfig }),
    });
    const taskAccount = task.value === "batchStarChallenge"
      ? { ...account, credential: { ...account.credential, roleId: 12345 } }
      : account;
    const result = await execute(taskAccount, {
      version: 2,
      localTaskIds: [task.value],
      taskOptions: options,
      taskSecrets: { password: "test-password", cdkCodes: "TEST-CODE-A\nTEST-CODE-B" },
      delaySettings: delays,
      dailySettingsByAccount: { [account.id]: { arenaFormation: 1, towerFormation: 1, bossFormation: 1, bossTimes: 0 } },
    });
    assert.ok(["completed", "skipped"].includes(result.results[0]?.status), `${task.value} did not report a usable outcome`);
    assert.ok(AllTasksGameClient.instances[0].calls.some((call) => call.command === expected[task.value]), `${task.value} did not call ${expected[task.value]}`);
  }
});

test("hosted Star Challenge consumes the plan's selected level and formation source", async () => {
  AllTasksGameClient.instances = [];
  const execute = createBatchPlanExecutor({
    GameClientClass: AllTasksGameClient,
    sleep: async () => {},
    clock: () => Date.parse("2026-10-25T10:00:00+08:00"),
    now: () => new Date("2026-10-25T10:00:00+08:00"),
    fetchStarChallengeConfig: async () => ({ ok: true, json: async () => officialStarChallengeConfig }),
  });
  const result = await execute({
    ...account,
    credential: { ...account.credential, roleId: 12345 },
  }, {
    localTaskIds: ["batchStarChallenge"],
    taskOptions: {
      starChallengeBossIds: [1],
      starChallengeFormationSource: "current",
      starChallengeMaxAttempts: 1,
      starChallengeTargetStars: 2,
      starChallengeClaimRewards: false,
      commandDelay: 0, taskDelay: 0, actionDelay: 0, battleDelay: 0, refreshDelay: 0, longDelay: 0,
    },
    delaySettings: { commandDelay: 0, taskDelay: 0, actionDelay: 0, battleDelay: 0, refreshDelay: 0, longDelay: 0 },
  });
  const calls = AllTasksGameClient.instances[0].calls;
  const start = calls.find((call) => call.command === "nmext_startboss");
  assert.equal(result.completed, 1);
  assert.equal(start.params.bossId, 1);
  assert.equal(start.params.presetTeamType, 0);
  assert.equal(start.params.battleTeam.get(0), 101);
  assert.equal(calls.some((call) => call.command === "presetteam_typegetinfo"), false);
});

test("hosted Star Challenge cancellation never reaches the next selected task", async () => {
  AllTasksGameClient.instances = [];
  const controller = new AbortController();
  class CancellingGameClient extends AllTasksGameClient {
    async sendWithPromise(command, params = {}, timeout) {
      const response = await super.sendWithPromise(command, params, timeout);
      if (command === "nmext_startboss") controller.abort(new Error("test cancellation"));
      return response;
    }
  }
  const execute = createBatchPlanExecutor({
    GameClientClass: CancellingGameClient,
    sleep: async () => {},
    clock: () => Date.parse("2026-10-25T10:00:00+08:00"),
    now: () => new Date("2026-10-25T10:00:00+08:00"),
    fetchStarChallengeConfig: async () => ({ ok: true, json: async () => officialStarChallengeConfig }),
  });
  await assert.rejects(execute({
    ...account,
    credential: { ...account.credential, roleId: 12345 },
  }, {
    localTaskIds: ["batchStarChallenge", "collection_claimfreereward"],
    taskOptions: {
      starChallengeBossIds: [1],
      starChallengeFormationSource: "current",
      starChallengeClaimRewards: false,
      commandDelay: 0, taskDelay: 0, actionDelay: 0, battleDelay: 0, refreshDelay: 0, longDelay: 0,
    },
    delaySettings: { commandDelay: 0, taskDelay: 0, actionDelay: 0, battleDelay: 0, refreshDelay: 0, longDelay: 0 },
  }, { signal: controller.signal }), (error) => error.code === "TASK_CANCELLED");
  const calls = AllTasksGameClient.instances[0].calls.map((call) => call.command);
  assert.equal(calls.filter((command) => command === "nmext_startboss").length, 1);
  assert.equal(calls.includes("collection_claimfreereward"), false);
});

test("configured counts, secrets, dream and market inputs reach their shared commands", async () => {
  AllTasksGameClient.instances = [];
  const execute = createBatchPlanExecutor({
    GameClientClass: AllTasksGameClient,
    sleep: async () => {},
    clock: () => Date.parse("2026-10-25T10:00:00+08:00"),
    now: () => new Date("2026-10-25T10:00:00+08:00"),
  });
  await execute(account, {
    localTaskIds: ["batchOpenBox", "batchFish", "batchRecruit", "batchLegacyGiftSendEnhanced", "batchRedeemCodes", "batchBuyDreamItems", "store_syncpurchaseconfig"],
    taskOptions: { boxCount: 21, fishCount: 3, recruitCount: 11, defaultBoxType: 2002, defaultFishType: 2, targetBoxPoints: 100, dreamPurchaseList: ["1-5"], blackMarketPurchaseList: [{ itemId: 2002, discount: 8 }], receiverId: "2", giftQuantity: 2, giftAll: false, weirdTowerMaxClimb: 1, legionApplyTargetId: "3", cdkPlatformType: "h5" },
    taskSecrets: { password: "test-password", cdkCodes: "TEST-CODE-A\nTEST-CODE-B" },
    delaySettings: { commandDelay: 0, taskDelay: 0, actionDelay: 0, battleDelay: 0, refreshDelay: 0, longDelay: 0 },
    dailySettingsByAccount: { [account.id]: { arenaFormation: 1, towerFormation: 1, bossFormation: 1, bossTimes: 0 } },
  });
  const calls = AllTasksGameClient.instances[0].calls;
  assert.deepEqual(calls.filter((call) => call.command === "item_openbox").map((call) => call.params.number), [10, 10, 1]);
  assert.deepEqual(calls.filter((call) => call.command === "artifact_lottery").map((call) => call.params.lotteryNumber), [3]);
  assert.deepEqual(calls.filter((call) => call.command === "hero_recruit").map((call) => call.params.recruitNumber), [10, 1]);
  assert.equal(calls.find((call) => call.command === "legacy_sendgift").params.itemCnt, 2);
  assert.deepEqual(calls.filter((call) => call.command === "system_claimcdkreward").map((call) => call.params.key), ["TEST-CODE-A", "TEST-CODE-B"]);
  assert.equal(calls.find((call) => call.command === "dungeon_buymerchant").params.id, 1);
  assert.deepEqual(calls.find((call) => call.command === "store_setpurchase").params.purchaseItemList, [{ itemId: 2002, discount: 8 }]);
});


test("black market purchase count defaults to null and accepts only protocol-range integers", () => {
  assert.equal(validateTaskOptions({}).taskOptions.blackMarketPurchaseCount, null);
  assert.equal(validateTaskOptions({ blackMarketPurchaseCount: 1 }).taskOptions.blackMarketPurchaseCount, 1);
  assert.equal(validateTaskOptions({ blackMarketPurchaseCount: 2147483647 }).taskOptions.blackMarketPurchaseCount, 2147483647);
  for (const invalid of ["5", 0, -1, 1.5, 2147483648]) {
    assert.throws(
      () => validateTaskOptions({ blackMarketPurchaseCount: invalid }),
      /blackMarketPurchaseCount/,
    );
  }
});

class ErroringGameClient extends AllTasksGameClient {
  static failure = null;

  async connect() {
    if (ErroringGameClient.failure?.connect) throw new Error("connection timed out");
    return super.connect();
  }

  async sendWithPromise(command, params = {}, timeout) {
    const failure = ErroringGameClient.failure;
    if (failure?.command === command) {
      if (!failure.noSend) this.seq++;
      this.calls.push({ command, params: structuredClone(params), timeout });
      const error = new Error(failure.message || `[${failure.gameCode}] simulated rejection`);
      if (failure.gameCode !== undefined) error.gameCode = failure.gameCode;
      error.command = command;
      throw error;
    }
    return super.sendWithPromise(command, params, timeout);
  }
}

function createErroringExecutor(overrides = {}) {
  AllTasksGameClient.instances = [];
  ErroringGameClient.instances = AllTasksGameClient.instances;
  ErroringGameClient.failure = null;
  return createBatchPlanExecutor({
    GameClientClass: ErroringGameClient,
    sleep: async () => {},
    clock: () => Date.parse("2026-10-25T10:00:00+08:00"),
    now: () => new Date("2026-10-25T10:00:00+08:00"),
    ...overrides,
  });
}

const erroringPlanConfig = (localTaskIds, extra = {}) => ({
  localTaskIds,
  taskOptions: { cdkPlatformType: "h5" },
  taskSecrets: { cdkCodes: "CODE-A\nCODE-B" },
  delaySettings: { commandDelay: 0, taskDelay: 0, actionDelay: 0, battleDelay: 0, refreshDelay: 0, longDelay: 0 },
  ...extra,
});

test("ordinary task rejection is recorded failed and a later task really executes", async () => {
  const execute = createErroringExecutor();
  ErroringGameClient.failure = { command: "system_claimcdkreward", gameCode: 990001 };
  const result = await execute(account, erroringPlanConfig(["batchRedeemCodes", "collection_claimfreereward"]));
  assert.equal(result.completed, 1);
  assert.equal(result.failed, 1);
  assert.equal(result.results[0].status, "failed");
  assert.equal(result.results[0].gameCode, 990001);
  assert.equal(result.results[0].command, "system_claimcdkreward");
  const calls = ErroringGameClient.instances[0].calls.map((call) => call.command);
  assert.ok(calls.includes("collection_claimfreereward"));
});

test("known already-claimed rejection is skipped and later tasks execute", async () => {
  const execute = createErroringExecutor();
  ErroringGameClient.failure = { command: "collection_claimfreereward", gameCode: 2300190 };
  const result = await execute(account, erroringPlanConfig(["collection_claimfreereward", "batchclubsign"]));
  assert.equal(result.skipped, 1);
  assert.equal(result.failed, 0);
  assert.equal(result.results[0].status, "skipped");
  assert.ok(ErroringGameClient.instances[0].calls.some((call) => call.command === "legion_signin"));
});

test("swallowed auth rejection stops before any following mutation", async () => {
  const execute = createErroringExecutor();
  ErroringGameClient.failure = { command: "system_claimcdkreward", gameCode: 200750 };
  await assert.rejects(
    execute(account, erroringPlanConfig(["batchRedeemCodes", "collection_claimfreereward"])),
    (error) => error.gameCode === 200750 || error.code === "GAME_AUTH_INVALID",
  );
  const calls = ErroringGameClient.instances[0].calls.map((call) => call.command);
  assert.equal(calls.filter((command) => command === "system_claimcdkreward").length, 1);
  assert.equal(calls.includes("collection_claimfreereward"), false);
});

test("uncertain mutation acknowledgement is terminal and does not run later tasks", async () => {
  const execute = createErroringExecutor();
  ErroringGameClient.failure = { command: "collection_claimfreereward", message: "请求超时: collection_claimfreereward (10ms)" };
  await assert.rejects(
    execute(account, config("collection_claimfreereward")),
    (error) => error.code === "UNCERTAIN_WRITE" && error.uncertain === true,
  );
  const calls = ErroringGameClient.instances[0].calls.map((call) => call.command);
  assert.equal(calls.includes("legion_signin"), false);
});

test("unsent mutation transport failure is terminal and keeps its command", async () => {
  const execute = createErroringExecutor();
  ErroringGameClient.failure = { command: "item_openbox", message: "未连接", noSend: true };
  await assert.rejects(
    execute(account, erroringPlanConfig(["batchOpenBox", "batchclubsign"])),
    (error) => error.code === "TRANSPORT_NOT_READY" && error.command === "item_openbox",
  );
  const calls = ErroringGameClient.instances[0].calls.map((call) => call.command);
  assert.equal(calls.includes("legion_signin"), false);
});

test("delayed fire-and-forget write is drained before advancing to the next task", async () => {
  class DelayedTowerGameClient extends AllTasksGameClient {
    static instances = [];
    roleReads = 0;

    async sendWithPromise(command, params = {}, timeout) {
      if (command === "role_getroleinfo") {
        this.seq++;
        this.calls.push({ command, params: structuredClone(params), timeout });
        this.roleReads++;
        const role = this.role();
        role.tower = { energy: 1, id: 10 };
        const response = { role };
        this.onPacket?.(structuredClone(response), { cmd: "role_getroleinforesp", time: this.serverTime });
        return response;
      }
      if (command === "fight_starttower") {
        this.seq++;
        this.calls.push({ command, params: structuredClone(params), timeout });
        const error = new Error("[1500040] previous tower reward is unclaimed");
        error.gameCode = 1500040;
        error.command = command;
        throw error;
      }
      if (command === "tower_claimreward") {
        this.seq++;
        this.calls.push({ command, params: structuredClone(params), timeout });
        return new Promise((_, reject) => setTimeout(() => reject(new Error("请求超时: tower_claimreward")), 20));
      }
      return super.sendWithPromise(command, params, timeout);
    }
  }

  AllTasksGameClient.instances = [];
  DelayedTowerGameClient.instances = AllTasksGameClient.instances;
  const execute = createBatchPlanExecutor({
    GameClientClass: DelayedTowerGameClient,
    sleep: async (ms) => {
      if (ms === 3000) {
        await new Promise((resolve) => setTimeout(resolve, 1));
        throw new Error("injected tower wait failure");
      }
    },
    clock: () => Date.parse("2026-10-25T10:00:00+08:00"),
    now: () => new Date("2026-10-25T10:00:00+08:00"),
  });

  await assert.rejects(
    execute(account, erroringPlanConfig(["climbTower", "batchclubsign"])),
    (error) => error.code === "UNCERTAIN_WRITE" && error.command === "tower_claimreward",
  );
  const calls = DelayedTowerGameClient.instances[0].calls.map((call) => call.command);
  assert.ok(calls.includes("tower_claimreward"));
  assert.equal(calls.includes("legion_signin"), false);
});

test("task delay runs once between subtasks and not after the last task", async () => {
  const waits = [];
  const execute = createErroringExecutor({ sleep: async (ms) => waits.push(ms) });
  await execute(account, erroringPlanConfig(
    ["collection_claimfreereward", "batchclubsign"],
    { delaySettings: { commandDelay: 0, taskDelay: 37, actionDelay: 0, battleDelay: 0, refreshDelay: 0, longDelay: 0 } },
  ));
  assert.deepEqual(waits.filter((duration) => duration === 37), [37]);
});

test("failed role-state reads are terminal before any mutation", async () => {
  const execute = createErroringExecutor();
  ErroringGameClient.failure = { command: "role_getroleinfo", message: "请求超时: role_getroleinfo (10ms)" };
  await assert.rejects(execute(account, config("batchclubsign")), (error) => error.code === "READ_UNAVAILABLE");
  assert.equal(ErroringGameClient.instances[0].calls.some((call) => !["role_getroleinfo"].includes(call.command)), false);
});

test("command cap stops remaining task mutations", async () => {
  const execute = createErroringExecutor({ maxCommands: 2 });
  await assert.rejects(execute(account, config("batchclubsign")), (error) => error.code === "TASK_COMMAND_LIMIT");
  assert.equal(ErroringGameClient.instances[0].calls.some((call) => call.command === "legion_signin"), false);
});

test("startBatch succeeds and records completed when daily tasks have partial incomplete count at rollover", async () => {
  class RolloverDailyRunner {
    async run(_tokenId, callbacks) {
      callbacks.onLog?.({ message: "本轮结束，6 个步骤未确认完成" });
      return { completed: 33, skipped: 0, failed: 4, incomplete: 6 };
    }
  }
  const execute = createExecutor({ DailyTaskRunnerClass: RolloverDailyRunner });
  const result = await execute(account, config("startBatch"));
  assert.equal(result.completed, 1);
  assert.equal(result.failed, 0);
  assert.equal(result.results[0].status, "completed");
});

test("startBatch fails when all attempted daily steps fail", async () => {
  class AllFailedDailyRunner {
    async run() {
      return { completed: 0, skipped: 0, failed: 5, incomplete: 5 };
    }
  }
  const execute = createExecutor({ DailyTaskRunnerClass: AllFailedDailyRunner });
  const result = await execute(account, config("startBatch"));
  assert.equal(result.completed, 0);
  assert.equal(result.failed, 1);
  assert.equal(result.results[0].status, "failed");
});
