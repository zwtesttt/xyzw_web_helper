/* eslint-disable test/no-import-node-test -- project acceptance runs these with node --test. */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createHostedApp } from "./app.js";
import { createSecretBox } from "./crypto.js";
import { TaskRunner } from "./runner.js";
import { HostedStore } from "./store.js";

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function startServer(store, box, executeAction = async () => {}) {
  const runner = new TaskRunner({ store, executeAction });
  const app = createHostedApp({ store, secretBox: box, runner });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  return { server, runner, url: `http://127.0.0.1:${server.address().port}` };
}
function client(url, cookie = "") {
  const requestOrigin = new URL(url).origin;
  return async (route, { method = "GET", body, headers = {} } = {}) =>
    fetch(`${url}/api/server${route}`, {
      method,
      headers: {
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
        origin: requestOrigin,
        ...(method !== "GET" ? { "x-requested-with": "XMLHttpRequest" } : {}),
        ...(cookie ? { cookie } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
}
const cookieOf = (r) => r.headers.get("set-cookie").split(";")[0];
async function register(api, username) {
  const response = await api("/auth/register", {
    method: "POST",
    body: { username, password: "long-password-123" },
  });
  assert.equal(response.status, 201);
  assert.match(response.headers.get("set-cookie"), /HttpOnly/);
  return cookieOf(response);
}

test("hosted API enforces authentication, same-origin writes and per-user account/job/run isolation", async (t) => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "xyzw-hosted-api-"));
  const store = new HostedStore({ dbPath: path.join(dataDir, "db.sqlite") });
  const box = createSecretBox(randomBytes(32));
  const { server, runner, url } = await startServer(store, box, async () => {});
  t.after(async () => {
    runner.stop();
    await new Promise((r) => server.close(r));
    store.close();
    await rm(dataDir, { recursive: true, force: true });
  });
  const anonymous = client(url);
  assert.equal((await anonymous("/accounts")).status, 401);
  assert.equal(
    (
      await anonymous("/auth/login", {
        method: "POST",
        body: { username: "nobody", password: "bad" },
      })
    ).status,
    401,
  );
  const aCookie = await register(anonymous, "user-a");
  const a = client(url, aCookie);
  assert.equal(
    (
      await anonymous("/auth/register", {
        method: "POST",
        body: { username: "user-a", password: "long-password-123" },
      })
    ).status,
    409,
  );
  const bCookie = await register(anonymous, "user-b");
  const b = client(url, bCookie);
  assert.equal((await a("/auth/me")).status, 200);
  const badOrigin = client(url, aCookie);
  assert.equal(
    (
      await badOrigin("/auth/logout", {
        method: "POST",
        body: {},
        headers: { origin: "https://evil.example" },
      })
    ).status,
    403,
  );
  const badUrl = await a("/accounts", {
    method: "POST",
    body: {
      name: "role-a",
      roleToken: { roleToken: "secret-role-token", roleId: "role-a" },
      wsUrl: "https://evil.example",
    },
  });
  assert.equal(badUrl.status, 400);
  const added = await a("/accounts", {
    method: "POST",
    body: {
      name: "role-a",
      server: "10服",
      roleToken: { roleToken: "secret-role-token", roleId: "role-a" },
    },
  });
  assert.equal(added.status, 201);
  const account = (await added.json()).account;
  assert.equal(account.roleId, "role-a");
  assert.equal(JSON.stringify(account).includes("secret-role-token"), false);
  const edited = await a(`/accounts/${account.id}`, {
    method: "PATCH",
    body: { name: "renamed-role", server: "11服", roleToken: "" },
  });
  assert.equal(edited.status, 200);
  assert.equal((await edited.json()).account.name, "renamed-role");
  assert.equal(
    box.decrypt(
      store.getAccount(store.getUserByUsername("user-a").id, account.id)
        .credential_enc,
    ).roleToken,
    "secret-role-token",
  );
  const stored = store.getAccount("user-a-does-not-exist", account.id);
  assert.equal(stored == null, true);
  const encrypted = store.db
    .prepare("SELECT credential_enc FROM accounts WHERE id=?")
    .get(account.id).credential_enc;
  assert.equal(encrypted.includes("secret-role-token"), false);
  assert.equal(box.decrypt(encrypted).roleToken, "secret-role-token");
  assert.equal((await b(`/accounts/${account.id}`)).status, 404);
  assert.equal(
    (
      await b(`/accounts/${account.id}`, {
        method: "PATCH",
        body: { name: "hijack" },
      })
    ).status,
    404,
  );
  assert.equal(
    (await b(`/accounts/${account.id}`, { method: "DELETE" })).status,
    404,
  );
  const invalidJob = await a("/jobs", {
    method: "POST",
    body: {
      name: "bad",
      accountIds: [account.id, "foreign"],
      actions: ["signIn"],
      schedule: { type: "daily", time: "08:00" },
    },
  });
  assert.equal(invalidJob.status, 400);
  const jobResponse = await a("/jobs", {
    method: "POST",
    body: {
      name: "daily",
      accountIds: [account.id],
      actions: ["signIn"],
      enabled: false,
      schedule: { type: "daily", time: "08:00", timezone: "Asia/Shanghai" },
    },
  });
  assert.equal(jobResponse.status, 201);
  const job = (await jobResponse.json()).job;
  assert.equal(
    (
      await a("/jobs", {
        method: "POST",
        body: {
          name: "bad-action",
          accountIds: [account.id],
          actions: ["constructor"],
          schedule: { type: "daily", time: "08:00" },
        },
      })
    ).status,
    400,
  );
  assert.equal((await b(`/jobs/${job.id}`)).status, 404);
  assert.equal(
    (await b(`/jobs/${job.id}`, { method: "PATCH", body: { name: "x" } }))
      .status,
    404,
  );
  assert.equal((await b(`/jobs/${job.id}`, { method: "DELETE" })).status, 404);
  assert.equal(
    (await b(`/jobs/${job.id}/run`, { method: "POST", body: {} })).status,
    404,
  );
  const runResponse = await a(`/jobs/${job.id}/run`, {
    method: "POST",
    body: {},
  });
  assert.equal(runResponse.status, 202);
  const { runIds } = await runResponse.json();
  for (let i = 0; i < 30; i++) {
    const rows = (await (await a("/runs")).json()).runs;
    if (rows[0]?.status === "succeeded") break;
    await wait(10);
  }
  const run = await a(`/runs/${runIds[0]}`);
  assert.equal((await run.json()).run.status, "succeeded");
  assert.equal((await b("/runs")).status, 200);
  assert.deepEqual((await (await b("/runs")).json()).runs, []);
  assert.equal(
    (await a("/auth/logout", { method: "POST", body: {} })).status,
    200,
  );
  assert.equal((await client(url, aCookie)("/accounts")).status, 401);
});
