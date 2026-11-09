import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import test from "node:test";
import { loadModule } from "./helpers/loadModule.js";

test("backend connection logs omit credential queries and early close clears the timeout", async () => {
  const timers = new Map();
  let timerId = 0;
  class Socket {
    constructor() {
      this.handlers = {};
    }
    on(event, handler) {
      this.handlers[event] = handler;
    }
    close() {}
  }
  const { GameClient } = await loadModule(
    new URL("../render-backend/lib/gameClient.js", import.meta.url),
    {
      "./bonProtocol.js": {},
      ws: { default: Socket },
    },
    {
      setTimeout(callback) {
        const id = ++timerId;
        timers.set(id, callback);
        return id;
      },
      clearTimeout(id) {
        timers.delete(id);
      },
    },
  );
  const client = new GameClient({ roleToken: "secret-test-token", roleId: 1 });
  const logs = [];
  client.log = (...args) => logs.push(args);
  const connection = client.connect();
  const rejected = assert.rejects(connection, /连接在建立前已关闭/);
  client.ws.handlers.close(1006, "closed");
  await rejected;
  assert.equal(timers.size, 0);
  assert.equal(JSON.stringify(logs).includes("secret-test-token"), false);
  assert.equal(logs[0][1], "wss://xxz-xyzw.hortorgames.com/agent");
});

test("backend packet correlation prefers exact sequence IDs and only infers matching natural responses", async () => {
  let packet;
  class Socket {
    on() {}
  }
  const { GameClient } = await loadModule(
    new URL("../render-backend/lib/gameClient.js", import.meta.url),
    {
      "./bonProtocol.js": {
        bon: {},
        encode: () => Buffer.from([]),
        getEnc: () => ({}),
        parse: () => packet,
      },
      ws: { default: Socket },
    },
  );
  const client = new GameClient({ roleToken: "packet-test-token", roleId: 1 });
  client._log = () => {};
  const decoded = [];
  client.onPacket = (...args) => decoded.push(args);
  const pending = (id, command) => new Promise((resolve, reject) => {
    client.promises[id] = { resolve, reject, timer: null, originalCmd: command };
  });
  const frame = (raw, rawData = { ok: true }) => {
    packet = { _raw: raw, rawData };
    client._handleMessage(Buffer.from([]));
  };

  const exact = pending(7, "role_getroleinfo");
  frame({ resp: 7, cmd: "UNRELATEDRESP", code: 0, time: 123 }, { role: { id: 1 } });
  assert.deepEqual(await exact, { role: { id: 1 } });
  assert.equal(client.serverTime, 123);
  assert.equal(decoded.length, 1);
  assert.deepEqual(decoded[0][0], { role: { id: 1 } });

  const fromUppercaseCommand = pending(8, "new_action");
  frame({ cmd: "NEW_ACTIONRESP", code: 0 });
  assert.deepEqual(await fromUppercaseCommand, { ok: true });

  const fromStringResp = pending(9, "another_action");
  frame({ resp: "ANOTHER_ACTIONRESP", cmd: "push", code: 0 });
  assert.deepEqual(await fromStringResp, { ok: true });

  const aliased = pending(10, "system_buygold");
  frame({ cmd: "SYNCREWARDRESP", code: 0 });
  assert.deepEqual(await aliased, { ok: true });

  let unrelatedSettled = false;
  const unrelated = pending(11, "wanted_action").then(
    () => { unrelatedSettled = true; },
    () => { unrelatedSettled = true; },
  );
  frame({ cmd: "OTHER_ACTIONRESP", code: 0 });
  await Promise.resolve();
  assert.equal(unrelatedSettled, false);
  delete client.promises[11];
  void unrelated;

  const rejected = pending(12, "item_openbox");
  frame({ resp: 12, code: 400010 });
  await assert.rejects(rejected, (error) =>
    /\[400010\].*物品不足/.test(error.message) && error.gameCode === 400010 && error.command === "item_openbox",
  );

  const hintedRejection = pending(13, "fight_startlevel");
  frame({ resp: 13, code: 200750, hint: "服务端返回的拒绝原因" });
  await assert.rejects(hintedRejection, (error) =>
    error.message.includes("服务端返回的拒绝原因") &&
    error.gameCode === 200750 &&
    error.command === "fight_startlevel");

  const rejectionWithoutHint = pending(14, "fight_startlevel");
  frame({ resp: 14, code: 200750, hint: "  " });
  await assert.rejects(rejectionWithoutHint, (error) =>
    error.message.includes("游戏服务器拒绝了请求，具体原因未确认") &&
    !/被顶号|扫码/.test(error.message) &&
    error.gameCode === 200750 &&
    error.command === "fight_startlevel");
});

test("backend Star Challenge commands preserve BON parameters and map responses", async () => {
  let encodedPacket;
  let packet;
  class Socket {
    static OPEN = 1;
    on() {}
  }
  const { GameClient } = await loadModule(
    new URL("../render-backend/lib/gameClient.js", import.meta.url),
    {
      "./bonProtocol.js": {
        bon: { encode: (value) => value },
        encode: (value) => { encodedPacket = value; return Buffer.from([]); },
        getEnc: () => ({}),
        parse: () => packet,
      },
      ws: { default: Socket },
    },
  );
  const client = new GameClient({ roleToken: "star-test-token", roleId: 12345 });
  client.connected = true;
  client.ws = { readyState: 1, send() {} };
  client._log = () => {};

  const petUId = "900719925474099312345";
  const battleTeam = new Map([[0, 101], [2, 303]]);
  const calls = [
    ["presetteam_typegetinfo", { types: [101, 102] }, { presetTeamMap: new Map([[101, { petUId }]]) }],
    ["nmext_getinfo", {}, { roleNMExt: { roleId: 12345 } }],
    ["nmext_startboss", {
      bossId: 1,
      battleTeam,
      lordWeaponId: 33,
      presetTeamType: 101,
      petUId,
    }, { isWin: true, nowStarIdxList: [0] }],
    ["nmext_claimstarreward", {}, { roleNMExt: { starRewardsClaimedMap: new Map([[1, true]]) } }],
  ];

  for (const [command, params, response] of calls) {
    const pending = client.sendWithPromise(command, params, 1000);
    assert.equal(encodedPacket.cmd, command);
    if (command === "nmext_startboss") {
      assert.deepEqual([...encodedPacket.body.battleTeam], [[0, 101], [2, 303]]);
      assert.equal(encodedPacket.body.petUId, petUId);
      assert.equal(Object.hasOwn(encodedPacket.body, "battleVersion"), false);
    }
    packet = {
      _raw: {
        cmd: `${command}resp`,
        code: 0,
        seq: encodedPacket.seq,
        time: 1_800_000_000_000,
      },
      rawData: response,
    };
    client._handleMessage(Buffer.from([]));
    const actual = await pending;
    if (command === "nmext_startboss") assert.equal(actual.isWin, true);
    else if (command === "presetteam_typegetinfo") assert.equal(actual.presetTeamMap.get(101).petUId, petUId);
    else if (command === "nmext_getinfo") assert.equal(actual.roleNMExt.roleId, 12345);
    else assert.equal(actual.roleNMExt.starRewardsClaimedMap.get(1), true);
  }
  assert.equal(Object.keys(client.promises).length, 0);
});
