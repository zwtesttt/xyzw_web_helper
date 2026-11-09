import assert from "node:assert/strict";
import test from "node:test";
import { loadModule } from "./helpers/loadModule.js";

/** Load either real client with deterministic timers and no network access. */
async function createClient(file, exportName) {
  let nextId = 0;
  const timers = new Map();
  const intervals = new Map();
  const errors = [];
  const logger = {
    info() {},
    verbose() {},
    wsMessage() {},
    warn() {},
    error(...args) {
      errors.push(args);
    },
  };
  const utils = {
    bon: {
      encode(value) {
        return value;
      },
    },
  };
  const dependencies = {
    "@/stores/cache": {
      $CacheManager: {
        getCache() {
          return {};
        },
      },
    },
    "./bonProtocol.js": { g_utils: utils },
    "./logger.js": { gameLogger: logger, wsLogger: logger },
    "./helperTaskRunner.js": { sleep: async () => {} },
  };
  const globals = {
    WebSocket: { OPEN: 1 },
    setTimeout(callback) {
      const id = ++nextId;
      timers.set(id, callback);
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    setInterval(callback) {
      const id = ++nextId;
      intervals.set(id, callback);
      return id;
    },
    clearInterval(id) {
      intervals.delete(id);
    },
  };
  const exports = await loadModule(
    new URL(`../src/utils/${file}`, import.meta.url),
    dependencies,
    globals,
  );
  const client = new exports[exportName]({
    url: "ws://example.invalid",
    utils,
  });
  client.connected = true;
  client.socket = { readyState: 1, send() {} };
  return { client, timers, intervals, errors };
}

for (const [file, name] of [
  ["xyzwWebSocket.js", "XyzwWebSocketClient"],
  ["xyzwLegionWarWebSocket.js", "XyzwLegionWarWebSocketClient"],
]) {
  test(`${name} clears request timers for sequence and legacy command responses`, async () => {
    const { client, timers } = await createClient(file, name);
    const first = client.sendWithPromise("role_getroleinfo");
    assert.equal(timers.size, 1);
    client._handlePromiseResponse({ resp: client.seq, code: 0, body: "first" });
    assert.equal(await first, "first");
    assert.equal(timers.size, 0);
    const second = client.sendWithPromise("role_getroleinfo");
    client._handlePromiseResponse({
      cmd: "role_getroleinforesp",
      code: 0,
      body: "second",
    });
    assert.equal(await second, "second");
    assert.equal(timers.size, 0);
  });

  test(`${name} rejects outstanding requests and clears timers on connection cleanup`, async () => {
    const { client, timers } = await createClient(file, name);
    const pending = client.sendWithPromise("role_getroleinfo");
    const rejected = assert.rejects(pending, /连接已关闭/);
    client._clearTimers();
    await rejected;
    assert.equal(timers.size, 0);
    assert.equal(Object.keys(client.promises).length, 0);
  });

  test(`${name} processes a delayed queue entry without an undefined sleep`, async () => {
    const { client, intervals, errors } = await createClient(file, name);
    client.send("heart_beat", {}, { sleep: 1 });
    client._processQueueLoop();
    await intervals.get(client.sendQueueTimer)();
    assert.equal(client.sendQueue.length, 0);
    assert.deepEqual(errors, []);
  });

  if (file === "xyzwWebSocket.js") {
    test("registers friend_getfollowinfo with BON body and legacy response mapping", async () => {
      const { client, timers } = await createClient(file, name);
      const raw = client.registry.build("friend_getfollowinfo", 2, 7, {
        friendId: 12345,
      });
      assert.equal(raw.cmd, "friend_getfollowinfo");
      assert.deepEqual({ ...raw.body }, { friendId: 12345 });

      const sequencePending = client.sendWithPromise("friend_getfollowinfo", {
        friendId: 12345,
      });
      const sequence = client.seq;
      const sequenceResult = { follows: {} };
      client._handlePromiseResponse({
        resp: sequence,
        code: 0,
        body: sequenceResult,
      });
      assert.equal(await sequencePending, sequenceResult);

      const pending = client.sendWithPromise("friend_getfollowinfo", {
        friendId: 12345,
      });
      const requestSeq = client.seq;
      client._handlePromiseResponse({
        cmd: "friend_getfollowinforesp",
        code: 0,
        body: { follows: { 67890: { roleId: 67890, name: "好友" } } },
      });
      const response = await pending;
      assert.equal(response._originalCmd, "friend_getfollowinfo");
      assert.equal(
        JSON.stringify(response.follows),
        JSON.stringify({ 67890: { roleId: 67890, name: "好友" } }),
      );
      assert.equal(client.promises[requestSeq], undefined);
      assert.equal(timers.size, 0);
    });

    test("registers Star Challenge commands with exact body parameters and mapped responses", async () => {
      const { client, timers } = await createClient(file, name);
      const petUId = "900719925474099312345";
      const battleTeam = new Map([[0, 101], [2, 303]]);
      const params = { bossId: 1, battleTeam, lordWeaponId: 33, presetTeamType: 101, petUId };
      const raw = client.registry.build("nmext_startboss", 2, 7, params);
      assert.equal(raw.cmd, "nmext_startboss");
      assert.equal(raw.body.petUId, petUId);
      assert.deepEqual([...raw.body.battleTeam], [[0, 101], [2, 303]]);

      const pending = client.sendWithPromise("nmext_startboss", params);
      const response = { isWin: true, nowStarIdxList: [0], roleNMExt: { roleId: 12345 } };
      client._handlePromiseResponse({
        cmd: "nmext_startbossresp",
        code: 0,
        body: response,
      });
      assert.equal(await pending, response);
      assert.equal(timers.size, 0);

      for (const command of ["presetteam_typegetinfo", "nmext_getinfo", "nmext_claimstarreward"]) {
        const request = client.registry.build(command, 0, 1, {});
        assert.equal(request.cmd, command);
      }
    });

    test("maps Ten Palace room and team detail responses to their own pending commands", async () => {
      const { client, timers } = await createClient(file, name);
      const roomParams = { roomId: "room-123" };
      const teamParams = { teamId: "team-456" };

      assert.deepEqual({ ...client.registry.build("nightmare_getroominfo", 0, 1, roomParams).body }, roomParams);
      assert.deepEqual({ ...client.registry.build("matchteam_getteaminfo", 0, 2, teamParams).body }, teamParams);

      const roomPending = client.sendWithPromise("nightmare_getroominfo", roomParams);
      const roomSequence = client.seq;
      const teamPending = client.sendWithPromise("matchteam_getteaminfo", teamParams);
      const teamSequence = client.seq;

      client._handlePromiseResponse({ cmd: "matchteam_getteaminforesp", code: 0, body: { teamInfo: { teamId: "team-456" } } });
      assert.equal((await teamPending).teamInfo.teamId, "team-456");
      assert.equal(client.promises[roomSequence]?.originalCmd, "nightmare_getroominfo");

      client._handlePromiseResponse({ cmd: "nightmare_getroominforesp", code: 0, body: { roomInfo: { roomId: "room-123" } } });
      assert.equal((await roomPending).roomInfo.roomId, "room-123");
      assert.equal(client.promises[teamSequence], undefined);
      assert.equal(timers.size, 0);
    });

    test("maps Ten Palace join, prepare, confirm, and open legacy responses", async () => {
      const { client, timers } = await createClient(file, name);
      const cases = [
        ["matchteam_join", "matchteam_joinresp"],
        ["matchteam_memberprepare", "matchteam_memberprepareresp"],
        ["matchteam_memberconfirm", "matchteam_memberconfirmresp"],
        ["matchteam_openteam", "matchteam_openteamresp"],
      ];

      for (const [command, responseCommand] of cases) {
        const params = { teamId: "team-123" };
        const raw = client.registry.build(command, 0, 1, params);
        assert.equal(raw.cmd, command);
        assert.deepEqual({ ...raw.body }, params);

        const pending = client.sendWithPromise(command, params);
        const requestSeq = client.seq;
        const responseBody = { accepted: true };
        client._handlePromiseResponse({
          cmd: responseCommand,
          code: 0,
          body: responseBody,
        });
        const response = await pending;
        assert.equal(response._originalCmd, command);
        assert.equal(response.accepted, true);
        assert.equal(client.promises[requestSeq], undefined);
      }
      assert.equal(timers.size, 0);
    });

    test("200750 rejections preserve server hints or use a neutral fallback on both response paths", async () => {
      const { client, timers } = await createClient(file, name);
      for (const responsePath of ["sequence", "legacy"]) {
        for (const hint of ["服务端返回的拒绝原因", "  "]) {
          const pending = client.sendWithPromise("friend_getfollowinfo", { friendId: 12345 });
          const requestSeq = client.seq;
          const packet = responsePath === "sequence"
            ? { resp: requestSeq, code: 200750, hint }
            : { cmd: "friend_getfollowinforesp", code: 200750, hint };
          client._handlePromiseResponse(packet);
          const expectedText = hint.trim() || "游戏服务器拒绝了请求，具体原因未确认";
          await assert.rejects(pending, (error) =>
            error.message.includes(expectedText) &&
            !/被顶号|扫码/.test(error.message) &&
            error.gameCode === 200750 &&
            error.command === "friend_getfollowinfo");
          assert.equal(timers.size, 0);
        }
      }
    });
  }
}
