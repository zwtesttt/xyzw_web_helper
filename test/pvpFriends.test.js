import assert from "node:assert/strict";
import test from "node:test";
import { bon, ProtoMsg } from "../src/utils/bonProtocol.js";
import {
  fetchGameFollowedFriends,
  formatFollowLoadError,
  normalizeGameFollowedFriends,
} from "../src/utils/pvpFriends.js";

function captureError(callback) {
  try {
    callback();
  } catch (error) {
    return error;
  }
  assert.fail("Expected callback to throw");
}

test("normalizes object, Map, and array follow collections", () => {
  const objectResult = normalizeGameFollowedFriends({
    follows: {
      42: { roleId: 42, name: "  小鱼  ", power: 1234, serverViewId: 17001 },
    },
  });
  assert.deepEqual(objectResult, [
    { id: "42", name: "小鱼", serverName: "17001服", power: 1234, headImg: "" },
  ]);
  assert.deepEqual(
    normalizeGameFollowedFriends({
      follows: new Map([["43", { roleId: "43", name: "好友" }]]),
    }).map(({ id }) => id),
    ["43"],
  );
  assert.deepEqual(
    normalizeGameFollowedFriends({ follows: [{ roleId: 44, name: "列表好友" }] }).map(
      ({ id }) => id,
    ),
    ["44"],
  );
});

test("accepts an explicitly empty collection and rejects missing or malformed data", () => {
  assert.deepEqual(normalizeGameFollowedFriends({ follows: {} }), []);
  assert.deepEqual(normalizeGameFollowedFriends({ follows: new Map() }), []);
  assert.deepEqual(normalizeGameFollowedFriends({ follows: [] }), []);
  assert.deepEqual(normalizeGameFollowedFriends({ follows: Object.create(null) }), []);
  assert.throws(() => normalizeGameFollowedFriends({}), /格式不受支持/);
  assert.throws(() => normalizeGameFollowedFriends({ follows: null }), /格式不受支持/);
  assert.throws(() => normalizeGameFollowedFriends({ follows: new Set() }), /格式不受支持/);
  assert.throws(() => normalizeGameFollowedFriends({ follows: new Date() }), /格式不受支持/);
});

test("accepts decoded packet and real ProtoMsg response envelopes", () => {
  const payload = { follows: { 9: { roleId: 9, name: "好友" } } };
  const packet = { cmd: "Friend_GetFollowInfoResp", code: 0, body: payload };
  assert.deepEqual(normalizeGameFollowedFriends(packet).map(({ id }) => id), ["9"]);
  const proto = new ProtoMsg({ cmd: "friend_getfollowinforesp", code: 0, body: bon.encode(payload) });
  assert.deepEqual(normalizeGameFollowedFriends(proto.rawData).map(({ id }) => id), ["9"]);
  assert.deepEqual(normalizeGameFollowedFriends(proto).map(({ id }) => id), ["9"]);
  assert.deepEqual(normalizeGameFollowedFriends({ _raw: packet }).map(({ id }) => id), ["9"]);
});

test("uses payload precedence without reading lower-priority fields", () => {
  const response = {
    cmd: "friend_getfollowinforesp", code: 0, rawData: { follows: {} },
    get body() { throw new Error("must not read lower-priority body"); },
    toLogString() { throw new Error("must not invoke arbitrary log methods"); },
  };
  assert.deepEqual(normalizeGameFollowedFriends(response), []);
});

test("keeps transport decoding outside the follow-list normalizer", () => {
  assert.throws(() => normalizeGameFollowedFriends(JSON.stringify({ follows: {} })), /格式不受支持/);
  assert.throws(() => normalizeGameFollowedFriends({ cmd: "friend_getfollowinforesp", body: bon.encode({ follows: {} }) }), /格式不受支持/);
  const rejected = new ProtoMsg({ cmd: "friend_getfollowinforesp", code: 7, body: bon.encode({ follows: {} }) });
  assert.throws(() => normalizeGameFollowedFriends(rejected), /错误码 7/);
});

test("accepts sparse empty data only when the successful follow read opts in", async () => {
  assert.throws(() => normalizeGameFollowedFriends({}), /格式不受支持/);
  assert.throws(
    () => normalizeGameFollowedFriends({ followCnt: 0, lastFollowCnt: 0 }),
    /格式不受支持/,
  );
  assert.deepEqual(normalizeGameFollowedFriends({}, { allowSparse: true }), []);
  assert.deepEqual(
    normalizeGameFollowedFriends(
      { followCnt: 0, lastFollowCnt: 12, _originalCmd: "friend_getfollowinfo" },
      { allowSparse: true },
    ),
    [],
  );
  assert.deepEqual(
    normalizeGameFollowedFriends(
      { followCnt: 3, lastFollowCnt: 2 },
      { allowSparse: true },
    ),
    [],
  );
  for (const count of [-1, 1.5, "invalid"]) {
    assert.throws(
      () =>
        normalizeGameFollowedFriends(
          { followCnt: count },
          { allowSparse: true },
        ),
      /格式不受支持/,
    );
  }
  assert.deepEqual(
    normalizeGameFollowedFriends(
      new ProtoMsg({ cmd: "friend_getfollowinforesp", code: 0 }),
      { allowSparse: true },
    ),
    [],
  );
  assert.throws(
    () => normalizeGameFollowedFriends({ follows: null }, { allowSparse: true }),
    /格式不受支持/,
  );
  assert.throws(
    () => normalizeGameFollowedFriends({ role: {}, battleData: {} }, { allowSparse: true }),
    /格式不受支持/,
  );
  assert.throws(
    () =>
      normalizeGameFollowedFriends(
        { _originalCmd: "some_other_request", followCnt: 0 },
        { allowSparse: true },
      ),
    /不匹配/,
  );

  const calls = [];
  const result = await fetchGameFollowedFriends({
    tokenId: "token-a",
    async sendMessageWithPromise(...args) {
      calls.push(args);
      return args[1] === "role_getroleinfo"
        ? { role: { roleId: 77 } }
        : { cmd: "friend_getfollowinforesp", code: 0, rawData: { followCnt: 0 } };
    },
  });
  assert.deepEqual(result, []);

  const rawEmptyResult = await fetchGameFollowedFriends({
    tokenId: "token-a",
    async sendMessageWithPromise(_tokenId, command) {
      return command === "role_getroleinfo" ? { role: { roleId: 77 } } : {};
    },
  });
  assert.deepEqual(rawEmptyResult, []);
});

test("rejects wrong commands and nonzero response codes even if body has follows", () => {
  const follows = { follows: { 2: { roleId: 2 } } };
  assert.throws(
    () =>
      normalizeGameFollowedFriends({
        cmd: "friend_batchresp",
        code: 0,
        body: follows,
      }),
    /其他游戏命令/,
  );
  assert.throws(
    () =>
      normalizeGameFollowedFriends({
        cmd: "friend_getfollowinforesp",
        code: 7,
        body: follows,
      }, { allowSparse: true }),
    /错误码 7/,
  );
});

test("response-shape diagnostics are bounded and never include field values", () => {
  const secret = "SECRET_ACCOUNT_TOKEN_123";
  const error = captureError(() =>
    normalizeGameFollowedFriends({
      cmd: "friend_unknown_response",
      code: 1,
      body: { token: secret, roleId: 123456789, name: "Private Name" },
    }),
  );
  assert.match(error.message, /fields=body,cmd,code/);
  assert.ok(error.message.length < 260);
  assert.ok(!error.message.includes(secret));
  assert.ok(!error.message.includes("123456789"));
  assert.ok(!error.message.includes("Private Name"));
  const transportError = new Error(`WebSocket未连接 [${secret}]`);
  const safeTransportError = formatFollowLoadError(transportError);
  assert.ok(!safeTransportError.includes(secret));
  assert.match(safeTransportError, /检查游戏连接/);
});

test("rejects cyclic and over-nested response envelopes", () => {
  const cyclic = { cmd: "friend_getfollowinforesp", code: 0 };
  cyclic.body = cyclic;
  assert.throws(() => normalizeGameFollowedFriends(cyclic), /格式不受支持/);
  const tooDeep = {
    cmd: "friend_getfollowinforesp",
    code: 0,
    body: { body: { body: { body: { follows: {} } } } },
  };
  assert.throws(() => normalizeGameFollowedFriends(tooDeep), /格式不受支持/);
});

test("filters malformed rows, duplicates, self, and unsafe ids", () => {
  const friends = normalizeGameFollowedFriends(
    {
      follows: [
        { roleId: 50, name: "有效" },
        { roleId: "50", name: "重复" },
        { roleId: "51", name: "" },
        { roleId: 52.5, name: "非整数" },
        { roleId: Number.MAX_SAFE_INTEGER + 1, name: "不安全" },
        { roleId: 53, name: "自己" },
        null,
        { name: "数组项必须提供自己的角色 ID" },
      ],
    },
    { selfRoleId: 53 },
  );
  assert.deepEqual(friends.map(({ id, name }) => [id, name]), [
    ["50", "有效"],
    ["51", "好友 51"],
  ]);
});

test("canonicalizes decimal ids without number coercion for dedupe and self filtering", () => {
  const friends = normalizeGameFollowedFriends(
    {
      follows: new Map([
        ["00042", { roleId: "00042", name: "首项" }],
        ["42", { roleId: "42", name: "重复项" }],
        ["7", { roleId: 7, name: "自己" }],
      ]),
    },
    { selfRoleId: "0007" },
  );
  assert.deepEqual(friends.map(({ id, name }) => [id, name]), [["42", "首项"]]);

  assert.deepEqual(
    normalizeGameFollowedFriends({
      follows: new Map([["00042", { name: "Map key" }]]),
    }).map(({ id }) => id),
    ["42"],
  );
});

test("reads fresh role id then requests only that role's follow list", async () => {
  const calls = [];
  const friends = await fetchGameFollowedFriends({
    tokenId: "token-a",
    async sendMessageWithPromise(...args) {
      calls.push(args);
      return args[1] === "role_getroleinfo"
        ? { role: { roleId: 77 } }
        : { follows: { 78: { roleId: 78, name: "好友" } } };
    },
  });
  assert.equal(calls.length, 2);
  assert.deepEqual(calls.map(([, command]) => command), [
    "role_getroleinfo",
    "friend_getfollowinfo",
  ]);
  assert.deepEqual(calls[1][2], { friendId: 77 });
  assert.deepEqual(friends.map(({ id }) => id), ["78"]);
});

test("does not query follows when disconnected or the fresh role has no usable id", async () => {
  const calls = [];
  assert.equal(
    await fetchGameFollowedFriends({
      tokenId: "token-a",
      sendMessageWithPromise: async (...args) => calls.push(args),
      isCurrent: () => false,
    }),
    null,
  );
  assert.equal(calls.length, 0);

  await assert.rejects(
    fetchGameFollowedFriends({
      tokenId: "token-a",
      async sendMessageWithPromise(...args) {
        calls.push(args);
        return {};
      },
    }),
    /未能确认当前游戏角色/,
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0][1], "role_getroleinfo");
});

test("discards a role-switch race before querying follows", async () => {
  let current = true;
  const calls = [];
  const result = await fetchGameFollowedFriends({
    tokenId: "token-a",
    async sendMessageWithPromise(...args) {
      calls.push(args);
      current = false;
      return { role: { roleId: 77 } };
    },
    isCurrent: () => current,
  });
  assert.equal(result, null);
  assert.equal(calls.length, 1);
});

test("discards a follow-list response arriving after a role switch", async () => {
  let current = true;
  const calls = [];
  const result = await fetchGameFollowedFriends({
    tokenId: "token-a",
    async sendMessageWithPromise(...args) {
      calls.push(args);
      if (args[1] === "friend_getfollowinfo") current = false;
      return args[1] === "role_getroleinfo"
        ? { role: { roleId: 77 } }
        : { follows: { 78: { roleId: 78 } } };
    },
    isCurrent: () => current,
  });
  assert.equal(result, null);
  assert.equal(calls.length, 2);
});
