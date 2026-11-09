/**
 * 商店类任务
 * 包含: legion_storebuygoods, legionStoreBuySkinCoins, store_purchase,
 * store_syncpurchaseconfig, collection_claimfreereward
 */

import {
  compareBlackMarketPurchaseLists,
  normalizeBlackMarketPurchaseList,
  toStorePurchaseItemList,
} from "./blackMarketConfig.js";

/**
 * 创建商店类任务执行器
 * @param {object} deps - 依赖项
 * @returns {object} 任务函数集合
 */
export function createTasksStore(deps) {
  const sleep = deps.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const {
    selectedTokens,
    tokens,
    tokenStatus,
    isRunning,
    shouldStop,
    ensureConnection,
    releaseConnectionSlot,
    connectionQueue,
    batchSettings,
    tokenStore,
    addLog,
    currentRunningTokenId,
    delayConfig,
  } = deps;


  const getBlackMarketPurchaseConfig = () =>
    normalizeBlackMarketPurchaseList(batchSettings.blackMarketPurchaseList);

  const getBlackMarketPurchaseCount = () => {
    const count = batchSettings.blackMarketPurchaseCount;
    if (count == null) return null;
    if (typeof count !== "number" || !Number.isInteger(count) || count < 1 || count > 2147483647)
      throw new Error("黑市采购次数必须留空或为 1–2147483647 的整数");
    return count;
  };

  const readBlackMarketPurchaseConfig = async (tokenId) => {
    const result = await tokenStore.sendMessageWithPromise(
      tokenId,
      "store_getpurchase",
      {},
      5000,
    );

    const rawPurchaseItemList = Array.isArray(result?.purchaseItemList)
      ? result.purchaseItemList.map((item) => ({ ...item }))
      : [];
    return {
      purchaseCnt: Number(result?.purchaseCnt || 0),
      purchaseItemList: normalizeBlackMarketPurchaseList(rawPurchaseItemList),
      rawPurchaseItemList,
    };
  };

  const updateBlackMarketPurchaseConfig = async (tokenId, tokenName) => {
    const configuredPurchaseList = getBlackMarketPurchaseConfig();
    const configuredPurchaseCount = getBlackMarketPurchaseCount();

    if (configuredPurchaseList.length === 0) {
      throw new Error("未配置黑市采购清单");
    }

    addLog({
      time: new Date().toLocaleTimeString(),
      message: `${tokenName} 正在读取当前黑市采购清单...`,
      type: "info",
    });

    const currentPurchaseConfig = await readBlackMarketPurchaseConfig(tokenId);
    const currentPurchaseCount = Math.max(1, currentPurchaseConfig.purchaseCnt || 1);
    const targetPurchaseCount = configuredPurchaseCount ?? currentPurchaseCount;
    const purchaseItemList = toStorePurchaseItemList(configuredPurchaseList);
    const listMatches = compareBlackMarketPurchaseLists(
      currentPurchaseConfig.purchaseItemList,
      configuredPurchaseList,
    );
    const countMatches = configuredPurchaseCount === null
      ? currentPurchaseCount === targetPurchaseCount
      : currentPurchaseConfig.purchaseCnt === targetPurchaseCount;

    addLog({
      time: new Date().toLocaleTimeString(),
      message: `${tokenName} 当前黑市清单: ${currentPurchaseConfig.purchaseItemList.length} 项，共 ${currentPurchaseConfig.purchaseCnt} 次`,
      type: "info",
    });

    if (listMatches && countMatches) {
      addLog({
        time: new Date().toLocaleTimeString(),
        message: `${tokenName} 黑市采购配置已是目标设置，跳过下发`,
        type: "info",
      });
      return;
    }

    addLog({
      time: new Date().toLocaleTimeString(),
      message: `${tokenName} 正在下发黑市采购配置...`,
      type: "info",
    });

    await tokenStore.sendMessageWithPromise(
      tokenId,
      "store_setpurchase",
      { purchaseCnt: targetPurchaseCount, purchaseItemList },
      5000,
    );

    await sleep(delayConfig.action);

    const verifiedPurchaseConfig = await readBlackMarketPurchaseConfig(tokenId);
    if (
      verifiedPurchaseConfig.purchaseCnt !== targetPurchaseCount ||
      !compareBlackMarketPurchaseLists(
        verifiedPurchaseConfig.purchaseItemList,
        configuredPurchaseList,
      )
    ) {
      throw new Error("黑市采购配置写回后校验失败");
    }

    addLog({
      time: new Date().toLocaleTimeString(),
      message: `${tokenName} 黑市采购配置已更新 ${purchaseItemList.length} 项，共 ${targetPurchaseCount} 次`,
      type: "success",
    });
  };

  const syncBlackMarketPurchaseCount = async (tokenId, tokenName) => {
    const configuredCount = getBlackMarketPurchaseCount();
    if (configuredCount === null) return;

    const currentConfig = await readBlackMarketPurchaseConfig(tokenId);
    if (currentConfig.purchaseCnt === configuredCount) return;

    const currentItems = currentConfig.rawPurchaseItemList;
    addLog({
      time: new Date().toLocaleTimeString(),
      message: `${tokenName} 正在同步黑市采购次数；保留服务器现有商品清单`,
      type: "info",
    });
    await tokenStore.sendMessageWithPromise(
      tokenId,
      "store_setpurchase",
      { purchaseCnt: configuredCount, purchaseItemList: currentItems },
      5000,
    );
    await sleep(delayConfig.action);

    const verifiedConfig = await readBlackMarketPurchaseConfig(tokenId);
    if (
      verifiedConfig.purchaseCnt !== configuredCount ||
      !compareBlackMarketPurchaseLists(verifiedConfig.purchaseItemList, currentItems)
    ) {
      throw new Error("黑市采购次数写回后校验失败");
    }
  };

  /**
   * 一键购买四圣碎片
   */
  const legion_storebuygoods = async () => {
    if (selectedTokens.value.length === 0) return;

    isRunning.value = true;
    shouldStop.value = false;

    selectedTokens.value.forEach((id) => {
      tokenStatus.value[id] = "waiting";
    });

    const taskPromises = selectedTokens.value.map(async (tokenId) => {
      if (shouldStop.value) return;

      tokenStatus.value[tokenId] = "running";
      const token = tokens.value.find((t) => t.id === tokenId);

      try {
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `=== 开始购买四圣碎片: ${token.name} ===`,
          type: "info",
        });

        await ensureConnection(tokenId);

        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 发送购买请求...`,
          type: "info",
        });

        const result = await tokenStore.sendMessageWithPromise(
          tokenId,
          "legion_storebuygoods",
          { id: 6 },
          5000,
        );

        await sleep(delayConfig.action);

        if (result.error) {
          if (result.error.includes("俱乐部商品购买数量超出上限")) {
            addLog({
              time: new Date().toLocaleTimeString(),
              message: `${token.name} 本周已购买过四圣碎片，跳过`,
              type: "info",
            });
          } else if (result.error.includes("物品不存在")) {
            addLog({
              time: new Date().toLocaleTimeString(),
              message: `${token.name} 盐锭不足或未加入军团，购买失败`,
              type: "error",
            });
            tokenStatus.value[tokenId] = "failed";
          } else {
            addLog({
              time: new Date().toLocaleTimeString(),
              message: `${token.name} 购买失败: ${result.error}`,
              type: "error",
            });
            tokenStatus.value[tokenId] = "failed";
          }
        } else {
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `${token.name} 购买成功，获得四圣碎片`,
            type: "success",
          });
          tokenStatus.value[tokenId] = "completed";
        }
      } catch (error) {
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 购买过程出错: ${error.message}`,
          type: "error",
        });
        tokenStatus.value[tokenId] = "failed";
      } finally {
        tokenStore.closeWebSocketConnection(tokenId);
        releaseConnectionSlot();
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 连接已关闭 (队列: ${connectionQueue.active}/${batchSettings.maxActive})`,
          type: "info",
        });
      }
    });

    await Promise.all(taskPromises);

    currentRunningTokenId.value = null;
    isRunning.value = false;
    shouldStop.value = false;
  };

  /**
   * 一键购买俱乐部5皮肤币
   */
  const legionStoreBuySkinCoins = async () => {
    if (selectedTokens.value.length === 0) return;

    isRunning.value = true;
    shouldStop.value = false;

    selectedTokens.value.forEach((id) => {
      tokenStatus.value[id] = "waiting";
    });

    const taskPromises = selectedTokens.value.map(async (tokenId) => {
      if (shouldStop.value) return;

      tokenStatus.value[tokenId] = "running";
      const token = tokens.value.find((t) => t.id === tokenId);

      try {
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `=== 开始购买俱乐部5皮肤币: ${token.name} ===`,
          type: "info",
        });

        await ensureConnection(tokenId);

        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 发送购买请求...`,
          type: "info",
        });

        let result = null;
        for (let i = 0; i < 5; i++) {
          if (shouldStop.value) break;

          result = await tokenStore.sendMessageWithPromise(
            tokenId,
            "legion_storebuygoods",
            { id: 1 },
            5000,
          );

          await sleep(delayConfig.action);
        }

        if (result && result.error) {
          if (result.error.includes("俱乐部商品购买数量超出上限")) {
            addLog({
              time: new Date().toLocaleTimeString(),
              message: `${token.name} 本周已购买过皮肤币，跳过`,
              type: "info",
            });
          } else if (result.error.includes("物品不存在")) {
            addLog({
              time: new Date().toLocaleTimeString(),
              message: `${token.name} 盐锭不足或未加入军团，购买失败`,
              type: "error",
            });
            tokenStatus.value[tokenId] = "failed";
          } else {
            addLog({
              time: new Date().toLocaleTimeString(),
              message: `${token.name} 购买失败: ${result.error}`,
              type: "error",
            });
            tokenStatus.value[tokenId] = "failed";
          }
        } else {
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `${token.name} 购买成功，获得皮肤币`,
            type: "success",
          });
          tokenStatus.value[tokenId] = "completed";
        }
      } catch (error) {
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 购买过程出错: ${error.message}`,
          type: "error",
        });
        tokenStatus.value[tokenId] = "failed";
      } finally {
        tokenStore.closeWebSocketConnection(tokenId);
        releaseConnectionSlot();
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 连接已关闭 (队列: ${connectionQueue.active}/${batchSettings.maxActive})`,
          type: "info",
        });
      }
    });

    await Promise.all(taskPromises);

    currentRunningTokenId.value = null;
    isRunning.value = false;
    shouldStop.value = false;
  };

  /**
   * 免费领取珍宝阁每日奖励
   */
  const collection_claimfreereward = async () => {
    if (selectedTokens.value.length === 0) return;

    isRunning.value = true;
    shouldStop.value = false;

    selectedTokens.value.forEach((id) => {
      tokenStatus.value[id] = "waiting";
    });

    const taskPromises = selectedTokens.value.map(async (tokenId) => {
      if (shouldStop.value) return;

      tokenStatus.value[tokenId] = "running";
      const token = tokens.value.find((t) => t.id === tokenId);

      try {
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `=== 开始免费领取珍宝阁: ${token.name} ===`,
          type: "info",
        });

        await ensureConnection(tokenId);

        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 发送珍宝阁免费领取请求...`,
          type: "info",
        });

        const result = await tokenStore.sendMessageWithPromise(
          tokenId,
          "collection_claimfreereward",
          {},
          5000,
        );

        await sleep(delayConfig.action);

        if (result.error) {
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `${token.name} 珍宝阁领取失败: ${result.error}`,
            type: "error",
          });
          tokenStatus.value[tokenId] = "failed";
        } else {
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `${token.name} 珍宝阁领取成功`,
            type: "success",
          });
          tokenStatus.value[tokenId] = "completed";
        }
      } catch (error) {
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 珍宝阁领取过程出错: ${error.message}`,
          type: "error",
        });
        tokenStatus.value[tokenId] = "failed";
      } finally {
        tokenStore.closeWebSocketConnection(tokenId);
        releaseConnectionSlot();
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 连接已关闭 (队列: ${connectionQueue.active}/${batchSettings.maxActive})`,
          type: "info",
        });
      }
    });

    await Promise.all(taskPromises);

    currentRunningTokenId.value = null;
    isRunning.value = false;
    shouldStop.value = false;
  };

  /**
   * 一键配置黑市采购清单
   */
  const store_syncpurchaseconfig = async () => {
    if (selectedTokens.value.length === 0) return;

    isRunning.value = true;
    shouldStop.value = false;

    selectedTokens.value.forEach((id) => {
      tokenStatus.value[id] = "waiting";
    });

    const taskPromises = selectedTokens.value.map(async (tokenId) => {
      if (shouldStop.value) return;

      tokenStatus.value[tokenId] = "running";
      const token = tokens.value.find((t) => t.id === tokenId);

      try {
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `=== 开始配置黑市采购清单: ${token.name} ===`,
          type: "info",
        });

        await ensureConnection(tokenId);
        await updateBlackMarketPurchaseConfig(tokenId, token.name);
        tokenStatus.value[tokenId] = "completed";
      } catch (error) {
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 配置黑市采购清单失败: ${error.message}`,
          type: "error",
        });
        tokenStatus.value[tokenId] = "failed";
      } finally {
        tokenStore.closeWebSocketConnection(tokenId);
        releaseConnectionSlot();
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 连接已关闭 (队列: ${connectionQueue.active}/${batchSettings.maxActive})`,
          type: "info",
        });
      }
    });

    await Promise.all(taskPromises);

    currentRunningTokenId.value = null;
    isRunning.value = false;
    shouldStop.value = false;
  };

  /**
   * 黑市一键采购
   */
  const store_purchase = async () => {
    if (selectedTokens.value.length === 0) return;

    isRunning.value = true;
    shouldStop.value = false;

    selectedTokens.value.forEach((id) => {
      tokenStatus.value[id] = "waiting";
    });

    const taskPromises = selectedTokens.value.map(async (tokenId) => {
      if (shouldStop.value) return;

      tokenStatus.value[tokenId] = "running";
      const token = tokens.value.find((t) => t.id === tokenId);

      try {
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `=== 开始黑市一键采购: ${token.name} ===`,
          type: "info",
        });

        await ensureConnection(tokenId);

        await syncBlackMarketPurchaseCount(tokenId, token.name);

        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 发送黑市采购请求...`,
          type: "info",
        });

        const result = await tokenStore.sendMessageWithPromise(
          tokenId,
          "store_purchase",
          {},
          5000,
        );

        await sleep(delayConfig.action);

        if (result.error) {
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `${token.name} 黑市采购失败: ${result.error}`,
            type: "error",
          });
          tokenStatus.value[tokenId] = "failed";
        } else {
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `${token.name} 黑市采购成功`,
            type: "success",
          });
          tokenStatus.value[tokenId] = "completed";
        }
      } catch (error) {
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 黑市采购过程出错: ${error.message}`,
          type: "error",
        });
        tokenStatus.value[tokenId] = "failed";
      } finally {
        tokenStore.closeWebSocketConnection(tokenId);
        releaseConnectionSlot();
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 连接已关闭 (队列: ${connectionQueue.active}/${batchSettings.maxActive})`,
          type: "info",
        });
      }
    });

    await Promise.all(taskPromises);

    currentRunningTokenId.value = null;
    isRunning.value = false;
    shouldStop.value = false;
  };

  return {
    legion_storebuygoods,
    legionStoreBuySkinCoins,
    store_purchase,
    store_syncpurchaseconfig,
    collection_claimfreereward,
  };
}
