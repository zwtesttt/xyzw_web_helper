import {
  DEFAULT_STAR_CHALLENGE_OPTIONS,
  normalizeStarChallengeOptions,
  runStarChallenge,
} from "../starChallenge.js";

/** Create the same star challenge job for browser batches and hosted plans. */
export function createTasksStarChallenge(deps) {
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
    message,
    currentRunningTokenId,
    delayConfig,
    sleep,
    fetchStarChallengeConfig,
    expectedRoleId,
  } = deps;

  const log = (name, text, type = "info") => addLog({
    time: new Date().toLocaleTimeString(),
    message: `${name}: ${text}`,
    type,
  });

  const batchStarChallenge = async (planOptions) => {
    const tokenIds = [...(selectedTokens?.value || [])];
    if (!tokenIds.length || isRunning?.value || shouldStop?.value) return;
    // A stored plan always owns its task settings; global batch settings only
    // apply to an interactive invocation without a plan snapshot.
    const isPlanOptions = planOptions && typeof planOptions === "object" &&
      !Array.isArray(planOptions) && Object.getPrototypeOf(planOptions) === Object.prototype;
    const settingSource = isPlanOptions
      ? { ...DEFAULT_STAR_CHALLENGE_OPTIONS, ...planOptions }
      : { ...DEFAULT_STAR_CHALLENGE_OPTIONS, ...(batchSettings || {}) };
    let settings;
    try {
      settings = normalizeStarChallengeOptions(settingSource);
    } catch (error) {
      message?.error?.(error.message);
      log("星级挑战", error.message, "error");
      return;
    }

    if (isRunning) isRunning.value = true;
    tokenIds.forEach((id) => { tokenStatus.value[id] = "waiting"; });
    const tasks = tokenIds.map(async (tokenId) => {
      if (shouldStop?.value) return;
      const token = tokens?.value?.find((item) => item.id === tokenId);
      const tokenName = token?.name || token?.roleName || tokenId;
      if (!token) {
        tokenStatus.value[tokenId] = "failed";
        log(tokenName, "角色记录不存在", "error");
        return;
      }
      tokenStatus.value[tokenId] = "running";
      let ownsSlot = false;
      currentRunningTokenId && (currentRunningTokenId.value = tokenId);
      try {
        await ensureConnection(tokenId, 2, (owned) => { ownsSlot = owned; });
        const check = () => {
          if (shouldStop?.value) {
            const error = new Error("星级挑战已停止");
            error.code = "TASK_CANCELLED";
            throw error;
          }
          const status = tokenStore.getWebSocketStatus?.(tokenId);
          if (status && status !== "connected") {
            const error = new Error("游戏连接已断开，停止星级挑战");
            error.code = "TRANSPORT_NOT_READY";
            throw error;
          }
        };
        const roleId = expectedRoleId ?? token.roleId;
        log(tokenName, `开始挑战，关卡 ${settings.starChallengeBossIds.join("、")}`, "info");
        const result = await runStarChallenge({
          tokenStore,
          tokenId,
          expectedRoleId: roleId,
          settings,
          fetchConfig: fetchStarChallengeConfig,
          check,
          sleep,
          delay: delayConfig?.battle ?? batchSettings?.battleDelay ?? 500,
          onProgress: (event) => {
            if (event.bossId) {
              const detail = event.status === "running"
                ? `第${event.bossId}关，第${event.attempt}/${event.maxAttempts}次挑战`
                : event.status === "won" || event.status === "lost"
                  ? `第${event.bossId}关${event.status === "won" ? "胜利" : "失败"}，当前 ${event.starCount} 星，剩余 ${event.remaining} 次`
                  : event.status === "skipped"
                    ? `跳过第${event.bossId}关：${event.reason}`
                    : `第${event.bossId}关进度已更新`;
              const type = event.status === "lost" ? "warning" : event.status === "skipped" ? "warning" : "info";
              log(tokenName, detail, type);
            } else if (event.status === "rewards-claimed") {
              log(tokenName, `已确认领取星级奖励 ${event.rewardClaim.claimed.join("、") || ""}`, "success");
            } else if (event.reason) {
              log(tokenName, event.reason, "info");
            }
          },
        });
        const attempted = result.results.filter((item) => item.attempted > 0).length;
        tokenStatus.value[tokenId] = "completed";
        log(tokenName, `星级挑战处理完成，实际挑战 ${attempted} 关`, "success");
      } catch (error) {
        const stopped = error?.code === "TASK_CANCELLED" || error?.interrupted;
        tokenStatus.value[tokenId] = stopped ? "stopped" : "failed";
        log(tokenName, `星级挑战${stopped ? "已停止" : "失败"}：${error?.message || "未知错误"}`, stopped ? "warning" : "error");
      } finally {
        if (ownsSlot) {
          try {
            tokenStore.closeWebSocketConnection?.(tokenId);
          } finally {
            releaseConnectionSlot?.();
          }
        }
        if (currentRunningTokenId?.value === tokenId) currentRunningTokenId.value = null;
        if (connectionQueue && batchSettings)
          log(tokenName, `连接清理结束（队列 ${connectionQueue.active}/${batchSettings.maxActive}）`);
      }
    });

    try {
      await Promise.all(tasks);
    } finally {
      if (isRunning) isRunning.value = false;
    }
    message?.success?.("星级挑战任务结束");
  };

  return { batchStarChallenge };
}
