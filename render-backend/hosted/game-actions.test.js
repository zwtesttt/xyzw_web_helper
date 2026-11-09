/* eslint-disable test/no-import-node-test -- project acceptance runs these with node --test. */
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { randomBytes } from "node:crypto";
import test from "node:test";
import { createSecretBox } from "./crypto.js";
import { createAuthUserLimiter, createGameExecutor } from "./game-actions.js";

const account = (box, { bin = true } = {}) => ({
  credential_enc: box.encrypt({
    roleToken: "dummy-role-token",
    roleId: "dummy-role-id",
  }),
  bin_enc: bin
    ? box.encrypt(Buffer.from("dummy-bin").toString("base64"))
    : null,
});

class FakeClient {
  static commands = [];
  static failValidation = false;
  constructor(token) {
    this.token = token;
    FakeClient.commands = [];
    FakeClient.instances = [this];
  }
  async connect() {
    this.connected = true;
    FakeClient.commands.push(["connect"]);
  }
  async sendWithPromise(cmd, params) {
    if (!this.connected) throw new Error("not connected");
    FakeClient.commands.push([cmd, params]);
    if (cmd === "role_getroleinfo" && FakeClient.failValidation)
      throw new Error("rejected");
    if (cmd === "role_getroleinfo") return { role: { id: "fixture-role" } };
    return { ok: true };
  }
  disconnect() {
    this.connected = false;
    FakeClient.commands.push(["disconnect"]);
  }
}

test("BIN refresh uses the fixed auth endpoint, parsed credentials, and validates role before action", async () => {
  const box = createSecretBox(randomBytes(32));
  let request;
  const execute = createGameExecutor({
    secretBox: box,
    GameClientClass: FakeClient,
    httpClient: {
      post: async (...args) => {
        request = args;
        return { data: Buffer.from("fixture") };
      },
    },
    parse: () => ({
      getData: () => ({
        roleToken: "fresh-role-token",
        roleId: "fresh-role-id",
      }),
    }),
    clock: () => 1_700_000_000_000,
    authUserLimiter: (fn) => fn(),
  });
  const result = await execute(account(box), "claimTowerReward");
  assert.deepEqual(result, { ok: true });
  assert.equal(
    request[0],
    "https://xxz-xyzw.hortorgames.com/login/authuser?_seq=1",
  );
  assert.equal(request[1].toString(), "dummy-bin");
  assert.equal(FakeClient.commands[0][0], "connect");
  assert.equal(FakeClient.commands[1][0], "role_getroleinfo");
  assert.equal(FakeClient.commands[2][0], "tower_claimreward");
  assert.equal(
    FakeClient.commands[2][1] && Object.keys(FakeClient.commands[2][1]).length,
    0,
  );
});

test("failed account validation prevents mutation and action failures are recorded as failures", async () => {
  const box = createSecretBox(randomBytes(32));
  FakeClient.failValidation = true;
  const execute = createGameExecutor({
    secretBox: box,
    GameClientClass: FakeClient,
    authUserLimiter: (fn) => fn(),
  });
  await assert.rejects(
    execute(account(box, { bin: false }), "signIn"),
    /Game request failed/,
  );
  assert.deepEqual(
    FakeClient.commands.map((x) => x[0]),
    ["connect", "role_getroleinfo", "disconnect"],
  );
  FakeClient.failValidation = false;
  const failing = class extends FakeClient {
    async sendWithPromise(cmd) {
      FakeClient.commands.push([cmd, {}]);
      if (cmd === "system_signinreward")
        throw new Error("[2300190] today already signed");
      return {};
    }
  };
  const failedAction = createGameExecutor({
    secretBox: box,
    GameClientClass: failing,
    authUserLimiter: (fn) => fn(),
  });
  await assert.rejects(
    failedAction(account(box, { bin: false }), "signIn"),
    /\[2300190\]/,
  );
});

test("batchPlan dispatch uses the decrypted credential through the real plan executor", async () => {
  const box = createSecretBox(randomBytes(32));
  const execute = createGameExecutor({
    secretBox: box,
    GameClientClass: FakeClient,
    authUserLimiter: (fn) => fn(),
  });
  const result = await execute(account(box, { bin: false }), "batchPlan", {
    localTaskIds: ["batchclubsign"],
    delaySettings: {
      commandDelay: 0,
      taskDelay: 0,
      actionDelay: 0,
      battleDelay: 0,
      refreshDelay: 0,
      longDelay: 0,
    },
  });
  assert.equal(result.completed, 1);
  assert.deepEqual(FakeClient.commands.map(([command]) => command), [
    "connect", "role_getroleinfo", "role_getroleinfo", "role_getroleinfo", "legion_signin", "disconnect", "disconnect",
  ]);
  assert.deepEqual(FakeClient.instances[0]?.token, {
    roleToken: "dummy-role-token",
    roleId: "dummy-role-id",
  });
});

test("BIN auth-user limiter allows 25 calls per rolling minute then waits", async () => {
  let now = 0;
  let sleeps = 0;
  let calls = 0;
  const limiter = createAuthUserLimiter({
    clock: () => now,
    sleep: async (ms) => {
      sleeps++;
      now += ms;
    },
  });
  for (let i = 0; i < 26; i++)
    await limiter(async () => {
      calls++;
    });
  assert.equal(calls, 26);
  assert.equal(sleeps, 1);
  assert.equal(now, 60_000);
});
