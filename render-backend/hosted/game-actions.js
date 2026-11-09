import { Buffer } from "node:buffer";
import axios from "axios";
import { g_utils } from "../lib/bonProtocol.js";
import { GameClient } from "../lib/gameClient.js";
import { ACTIONS } from "./app.js";
import { createBatchPlanExecutor } from "./batch-plan-executor.js";
import { createTenPalaceGameExecutor } from "./ten-palace-executor.js";

export function createAuthUserLimiter({
  clock = () => Date.now(),
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
  let queue = Promise.resolve();
  let started = [];
  return (fn) => {
    const operation = queue.then(async () => {
      started = started.filter((time) => clock() - time < 60_000);
      if (started.length >= 25)
        await sleep(Math.max(1, started[0] + 60_000 - clock()));
      started = started.filter((time) => clock() - time < 60_000);
      started.push(clock());
      return fn();
    });
    queue = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  };
}
const sharedAuthUserLimiter = createAuthUserLimiter();

export function createGameExecutor({
  secretBox,
  GameClientClass = GameClient,
  httpClient = axios,
  parse = g_utils.parse,
  clock = () => Date.now(),
  authUserLimiter = sharedAuthUserLimiter,
  batchPlanExecutor = createBatchPlanExecutor({ GameClientClass }),
} = {}) {
  const resolveCredential = async (account) => {
    let credential;
    try {
      credential = secretBox.decrypt(account.credential_enc);
    } catch {
      throw new Error("Stored game credential could not be decrypted");
    }
    if (account.bin_enc) {
      let bin;
      try {
        bin = Buffer.from(secretBox.decrypt(account.bin_enc), "base64");
      } catch {
        throw new Error("Stored BIN credential could not be decrypted");
      }
      try {
        const response = await authUserLimiter(() =>
          httpClient.post(
            "https://xxz-xyzw.hortorgames.com/login/authuser?_seq=1",
            bin,
            {
              headers: { "Content-Type": "application/octet-stream" },
              responseType: "arraybuffer",
              timeout: 15000,
              maxRedirects: 0,
            },
          ),
        );
        const message = parse(response.data);
        const data = message.getData();
        if (!data || typeof data !== "object" || !data.roleToken || !data.roleId)
          throw new Error("Game auth response missing role fields");
        const current = clock();
        credential = {
          ...data,
          roleId: credential.roleId || data.roleId,
          sessId: current * 100 + Math.floor(Math.random() * 100),
          connId: current + Math.floor(Math.random() * 10),
          isRestore: 0,
        };
      } catch {
        throw new Error("Game credential refresh failed; check or replace the BIN file");
      }
    }
    if (!credential.roleToken || !credential.roleId)
      throw new Error("Game credential is invalid; re-import the account token");
    return credential;
  };
  const tenPalaceExecutor = createTenPalaceGameExecutor({ GameClientClass, resolveCredential, fetchConfig: globalThis.fetch, clock });
  return async function execute(account, actionId, config, context = {}) {
    const action = ACTIONS[actionId];
    if (!action) throw new Error("Unsupported action");
    if (actionId === "nightmareTeam") return tenPalaceExecutor(account, config, context);
    const credential = await resolveCredential(account);
    if (actionId === "batchPlan") {
      let taskSecrets = {};
      if (config?.taskSecretsEnc) {
        try {
          taskSecrets = secretBox.decrypt(config.taskSecretsEnc);
        } catch {
          throw new Error("Stored hosted task secret could not be decrypted");
        }
      }
      const safeConfig = { ...config, taskSecrets };
      delete safeConfig.taskSecretsEnc;
      return batchPlanExecutor({ ...account, credential }, safeConfig, context);
    }
    const client = new GameClientClass(credential);
    client._log = () => {};
    let validated = false;
    try {
      await client.connect();
      const role = await client.sendWithPromise("role_getroleinfo", {}, 10000);
      if (!role || typeof role !== "object")
        throw new Error("Game account validation failed");
      validated = true;
      return await client.sendWithPromise(
        action.command,
        action.params || {},
        12000,
      );
    } catch (error) {
      const msg = String(error?.message || "").slice(0, 240);
      if (validated && /^\[\d+\]/.test(msg)) throw new Error(msg);
      throw new Error(
        /token|expire|credential/i.test(msg)
          ? "Game credential expired or was rejected; re-import the account"
          : "Game request failed; no success was recorded",
      );
    } finally {
      try {
        client.disconnect();
      } catch {}
    }
  };
}
