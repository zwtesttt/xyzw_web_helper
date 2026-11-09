import assert from "node:assert/strict";
import test from "node:test";
import { defaultBlackMarketPurchaseList } from "../src/utils/batch/blackMarketConfig.js";
import { createTasksStore } from "../src/utils/batch/tasksStore.js";

function setup({ count = null, market, verifyWrite = true } = {}) {
  let currentMarket = structuredClone(market || {
    purchaseCnt: 3,
    purchaseItemList: defaultBlackMarketPurchaseList.map(({ itemId, discount }) => ({ itemId, discount })),
  });
  const calls = [];
  const selectedTokens = { value: ["account-a"] };
  const tokenStatus = { value: {} };
  const batchSettings = {
    blackMarketPurchaseCount: count,
    blackMarketPurchaseList: defaultBlackMarketPurchaseList.map((item) => ({ ...item })),
    maxActive: 1,
  };
  const tokenStore = {
    async sendMessageWithPromise(_id, command, params) {
      calls.push({ command, params: structuredClone(params) });
      if (command === "store_getpurchase") return structuredClone(currentMarket);
      if (command === "store_setpurchase" && verifyWrite) {
        currentMarket = {
          purchaseCnt: params.purchaseCnt,
          purchaseItemList: structuredClone(params.purchaseItemList),
        };
      }
      return {};
    },
    closeWebSocketConnection() {},
  };
  const tasks = createTasksStore({
    selectedTokens,
    tokens: { value: [{ id: "account-a", name: "测试角色" }] },
    tokenStatus,
    isRunning: { value: false },
    shouldStop: { value: false },
    ensureConnection: async () => {},
    releaseConnectionSlot() {},
    connectionQueue: { active: 0 },
    batchSettings,
    tokenStore,
    addLog() {},
    currentRunningTokenId: { value: null },
    delayConfig: { action: 0 },
    sleep: async () => {},
  });
  return { tasks, calls, tokenStatus, batchSettings, getMarket: () => currentMarket };
}

test("market config sync writes a changed count even when selected goods already match", async () => {
  const fixture = setup({ count: 7 });
  await fixture.tasks.store_syncpurchaseconfig();
  const writes = fixture.calls.filter((call) => call.command === "store_setpurchase");
  assert.equal(writes.length, 1);
  assert.equal(writes[0].params.purchaseCnt, 7);
  assert.deepEqual(writes[0].params.purchaseItemList, defaultBlackMarketPurchaseList.map(({ itemId, discount }) => ({ itemId, discount })).sort((a, b) => a.itemId - b.itemId));
  assert.equal(fixture.calls.at(-1).command, "store_getpurchase");
});

test("explicit configured count 1 replaces an actual server count of 0", async () => {
  const list = defaultBlackMarketPurchaseList.map(({ itemId, discount }) => ({ itemId, discount }));
  const fixture = setup({ count: 1, market: { purchaseCnt: 0, purchaseItemList: list } });
  await fixture.tasks.store_syncpurchaseconfig();
  const writes = fixture.calls.filter((call) => call.command === "store_setpurchase");
  assert.equal(writes.length, 1);
  assert.equal(writes[0].params.purchaseCnt, 1);
});

test("standalone count 1 syncs an actual server count of 0 before one purchase", async () => {
  const serverGoods = [{ itemId: 2004, discount: 4 }];
  const fixture = setup({ count: 1, market: { purchaseCnt: 0, purchaseItemList: serverGoods } });
  await fixture.tasks.store_purchase();
  assert.deepEqual(
    fixture.calls.find((call) => call.command === "store_setpurchase").params,
    { purchaseCnt: 1, purchaseItemList: serverGoods },
  );
  assert.equal(fixture.calls.filter((call) => call.command === "store_purchase").length, 1);
});

test("matching market count and goods avoid an unnecessary configuration write", async () => {
  const list = defaultBlackMarketPurchaseList.map(({ itemId, discount }) => ({ itemId, discount }));
  const fixture = setup({ count: 3, market: { purchaseCnt: 3, purchaseItemList: list } });
  await fixture.tasks.store_syncpurchaseconfig();
  assert.equal(fixture.calls.some((call) => call.command === "store_setpurchase"), false);
});

test("standalone market purchase sync preserves server goods and sends purchase once", async () => {
  const serverGoods = [
    { itemId: 2004, discount: 4 },
    { itemId: 2002, discount: 7 },
  ];
  const fixture = setup({ count: 5, market: { purchaseCnt: 3, purchaseItemList: serverGoods } });
  await fixture.tasks.store_purchase();
  const write = fixture.calls.find((call) => call.command === "store_setpurchase");
  assert.deepEqual(write.params, { purchaseCnt: 5, purchaseItemList: serverGoods });
  assert.equal(fixture.calls.filter((call) => call.command === "store_purchase").length, 1);
  assert.equal(fixture.tokenStatus.value["account-a"], "completed");
});

test("count verification mismatch prevents the standalone purchase command", async () => {
  const fixture = setup({ count: 5, verifyWrite: false });
  await fixture.tasks.store_purchase();
  assert.equal(fixture.calls.some((call) => call.command === "store_setpurchase"), true);
  assert.equal(fixture.calls.some((call) => call.command === "store_purchase"), false);
  assert.equal(fixture.tokenStatus.value["account-a"], "failed");
});

test("blank legacy count keeps the existing standalone purchase behavior", async () => {
  const fixture = setup({ count: null });
  await fixture.tasks.store_purchase();
  assert.deepEqual(fixture.calls.map((call) => call.command), ["store_purchase"]);
});

test("invalid configured count fails before reading or purchasing", async () => {
  const fixture = setup({ count: "5" });
  await fixture.tasks.store_purchase();
  assert.deepEqual(fixture.calls, []);
  assert.equal(fixture.tokenStatus.value["account-a"], "failed");
});
