<template>
  <section class="star-challenge-page" aria-labelledby="star-challenge-title">
    <header class="star-challenge-page__header">
      <div class="star-challenge-page__title-group">
        <h2 id="star-challenge-title">星级挑战</h2>
        <p>读取游戏内关卡阵容与每周进度；缺少保存阵容时会跳过该关。</p>
      </div>
      <div class="star-challenge-page__actions">
        <n-button
          :disabled="!tokenId || loading || running"
          :loading="loading"
          @click="refresh"
        >
          刷新进度
        </n-button>
        <n-button
          v-if="!running"
          type="primary"
          :disabled="!canRun || loading"
          @click="runSelected"
        >
          挑战所选关卡
        </n-button>
        <n-button v-if="!running" :disabled="!canClaimRewards || loading" @click="runClaimOnly">
          只领取星级奖励
        </n-button>
        <n-button v-if="running" type="error" @click="cancelRun">
          停止
        </n-button>
      </div>
    </header>

    <n-alert v-if="!tokenId" type="info" :show-icon="false">
      先选择一个游戏角色，再加载星级挑战进度。
    </n-alert>
    <n-alert v-else-if="!connected" type="warning" :show-icon="false">
      当前角色尚未连接。请先在工作台连接游戏，再刷新数据；本页不会自动连接账号。
    </n-alert>
    <n-alert v-if="errorMessage" type="error" :show-icon="false" class="star-challenge-page__alert">
      {{ errorMessage }}
    </n-alert>

    <details class="star-challenge-page__settings">
      <summary>
        <strong>阵容与挑战设置</strong>
        <span>
          {{ settings.starChallengeFormationSource === "saved" ? "游戏内保存阵容" : "当前出战阵容" }}
          · 每关最多 {{ settings.starChallengeMaxAttempts }} 次
          · 目标 {{ settings.starChallengeTargetStars }} 星
        </span>
      </summary>
      <StarChallengeOptions :model-value="settings" @update:model-value="updateSettings" />
    </details>

    <section v-if="snapshot" class="star-challenge-page__summary" aria-label="星级挑战进度">
      <n-alert v-if="snapshot.state.stale" type="warning" :show-icon="false">
        星级挑战进度属于上周数据。请先在游戏内打开星级挑战刷新本周状态，再回到这里读取。
      </n-alert>
      <n-alert v-else-if="!snapshot.state.weekPass.unlocked" type="warning" :show-icon="false">
        本周尚未解锁：需要通关等级 {{ snapshot.config.unlockLevel }}，当前有效进度 {{ snapshot.state.weekPass.level }}。
      </n-alert>
      <div class="star-challenge-page__summary-row">
        <span>本周累计星数 <strong>{{ snapshot.state.totalStars }}</strong></span>
        <span>可领取奖励 <strong>{{ snapshot.state.claimableRewards.length }} 档</strong></span>
        <span>星级特权加次 <strong>{{ snapshot.state.privilegeBonus }}</strong></span>
      </div>
    </section>

    <section v-if="progress.length" class="star-challenge-page__progress" aria-live="polite">
      <h2>本次执行</h2>
      <ul>
        <li v-for="(item, index) in progress" :key="`${index}-${item}`">{{ item }}</li>
      </ul>
    </section>

    <section v-if="loading && !snapshot" class="star-challenge-page__loading" aria-label="正在读取星级挑战数据">
      <n-skeleton text :repeat="2" />
      <n-skeleton height="160px" />
    </section>

    <section v-if="snapshot" class="star-challenge-page__bosses" aria-label="星级挑战关卡列表">
      <n-card
        v-for="boss in snapshot.previews"
        :key="boss.bossId"
        size="small"
        class="star-challenge-page__boss-card"
      >
        <template #header>
          <div class="star-challenge-page__boss-heading">
            <strong>第 {{ boss.bossId }} 关</strong>
            <n-tag size="small" :type="boss.remaining > 0 ? 'success' : 'default'">
              剩余 {{ boss.remaining }}/{{ boss.totalLimit }} 次
            </n-tag>
          </div>
        </template>

        <div class="star-challenge-page__stars" :aria-label="`已获得 ${boss.starCount} 星`">
          <span v-for="(earned, index) in boss.stars" :key="index" :class="{ earned }">
            {{ earned ? "★" : "☆" }}
          </span>
          <span class="star-challenge-page__star-count">{{ boss.starCount }}/3 星</span>
        </div>

        <p v-if="boss.unlockStar > snapshot.state.totalStars" class="star-challenge-page__muted">
          解锁需要累计 {{ boss.unlockStar }} 星
        </p>
        <template v-if="snapshot.formationSource === 'saved'">
          <p v-if="boss.formationError" class="star-challenge-page__formation-error">
            阵容数据异常：{{ boss.formationError }}
          </p>
          <p v-else-if="!boss.hasSavedFormation" class="star-challenge-page__muted">
            未保存本关阵容；执行时会跳过，不会回退到当前阵容。
          </p>
          <template v-else>
            <p class="star-challenge-page__formation-title">游戏内保存阵容</p>
            <div class="star-challenge-page__heroes">
              <div v-for="hero in formationHeroes(boss)" :key="hero.position" class="star-challenge-page__hero">
                <span>站位 {{ hero.position + 1 }}</span>
                <strong>{{ hero.name }}</strong>
              </div>
            </div>
            <p class="star-challenge-page__equipment">
              武器 ID {{ boss.formation.lordWeaponId }} · 宠物 UID {{ boss.formation.petUId || "未设置" }}
            </p>
          </template>
        </template>
        <template v-else>
          <p class="star-challenge-page__formation-title">当前出战阵容</p>
          <div class="star-challenge-page__heroes">
            <div v-for="hero in formationHeroes(boss)" :key="hero.position" class="star-challenge-page__hero">
              <span>站位 {{ hero.position + 1 }}</span>
              <strong>{{ hero.name }}</strong>
            </div>
          </div>
          <p class="star-challenge-page__equipment">
            武器 ID {{ boss.formation.lordWeaponId }} · 宠物 UID {{ boss.formation.petUId || "未设置" }}
          </p>
        </template>
      </n-card>
    </section>
  </section>
</template>

<script setup>
import { useMessage } from "naive-ui";
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import { useTokenStore } from "@/stores/tokenStore";
import { HERO_DICT } from "@/utils/HeroList.js";
import {
  DEFAULT_STAR_CHALLENGE_OPTIONS,
  loadStarChallengeSnapshot,
  runStarChallenge,
} from "@/utils/starChallenge.js";
import StarChallengeOptions from "./StarChallengeOptions.vue";

const tokenStore = useTokenStore();
const message = useMessage();
const settings = reactive({
  ...DEFAULT_STAR_CHALLENGE_OPTIONS,
  starChallengeBossIds: [...DEFAULT_STAR_CHALLENGE_OPTIONS.starChallengeBossIds],
});
const snapshot = ref(null);
const loading = ref(false);
const running = ref(false);
const errorMessage = ref("");
const progress = ref([]);
const tokenId = computed(() => tokenStore.selectedToken?.id || "");
const token = computed(() => tokenStore.selectedToken || null);
const connected = computed(() => tokenId.value && tokenStore.getWebSocketStatus(tokenId.value) === "connected");
const canRun = computed(() => Boolean(
  connected.value && snapshot.value && !snapshot.value.state.stale &&
  snapshot.value.state.weekPass.unlocked && settings.starChallengeBossIds.length,
));
const canClaimRewards = computed(() => Boolean(
  connected.value && snapshot.value && !snapshot.value.state.stale &&
  snapshot.value.state.claimableRewards.length,
));
let generation = 0;
let activeController = null;

const updateSettings = (value) => {
  Object.assign(settings, value);
};

const heroName = (heroId) => HERO_DICT[heroId]?.name || `未知武将 #${heroId}`;
const formationHeroes = (boss) => [...(boss.formation?.battleTeam || [])]
  .map(([position, heroId]) => ({ position, name: heroName(heroId) }));
const appendProgress = (text) => {
  progress.value = [...progress.value, text].slice(-80);
};

const makeCheck = (id, requestGeneration, signal) => () => {
  if (signal?.aborted || requestGeneration !== generation || tokenId.value !== id) {
    const error = new Error("角色已切换或操作已取消");
    error.code = "TASK_CANCELLED";
    throw error;
  }
  if (tokenStore.getWebSocketStatus(id) !== "connected") {
    const error = new Error("游戏连接已断开，请重新连接并读取状态");
    error.code = "TRANSPORT_NOT_READY";
    throw error;
  }
};

const refresh = async () => {
  const id = tokenId.value;
  const selected = token.value;
  if (!id) return;
  if (!connected.value) {
    errorMessage.value = "当前角色尚未连接游戏，未发送读取请求。";
    return;
  }
  activeController?.abort(new Error("刷新数据"));
  const requestGeneration = ++generation;
  const controller = new AbortController();
  activeController = controller;
  loading.value = true;
  errorMessage.value = "";
  // A failed refresh must not leave a previously valid snapshot available for writes.
  snapshot.value = null;
  try {
    const result = await loadStarChallengeSnapshot({
      tokenStore,
      tokenId: id,
      expectedRoleId: selected?.roleId,
      settings,
      check: makeCheck(id, requestGeneration, controller.signal),
    });
    makeCheck(id, requestGeneration, controller.signal)();
    snapshot.value = result;
  } catch (error) {
    if (requestGeneration === generation && tokenId.value === id) {
      errorMessage.value = error?.message || "读取星级挑战状态失败";
    }
  } finally {
    if (requestGeneration === generation) loading.value = false;
  }
};

const runOperation = async (claimOnly) => {
  if ((!claimOnly && !canRun.value) || (claimOnly && !canClaimRewards.value) || running.value) return;
  const id = tokenId.value;
  const selected = token.value;
  const requestGeneration = ++generation;
  const controller = new AbortController();
  activeController = controller;
  running.value = true;
  errorMessage.value = "";
  progress.value = [];
  try {
    const result = await runStarChallenge({
      tokenStore,
      tokenId: id,
      expectedRoleId: selected?.roleId,
      settings,
      claimOnly,
      signal: controller.signal,
      check: makeCheck(id, requestGeneration, controller.signal),
      onProgress: (event) => {
        if (event.bossId && event.status === "running") {
          appendProgress(`第 ${event.bossId} 关：挑战 ${event.attempt}/${event.maxAttempts} 次`);
        } else if (event.bossId && ["won", "lost"].includes(event.status)) {
          appendProgress(`第 ${event.bossId} 关：${event.status === "won" ? "胜利" : "失败"}，${event.starCount} 星，剩余 ${event.remaining} 次`);
        } else if (event.status === "skipped" && event.bossId) {
          appendProgress(`第 ${event.bossId} 关：已跳过，${event.reason}`);
        } else if (event.reason) {
          appendProgress(event.reason);
        }
      },
    });
    makeCheck(id, requestGeneration, controller.signal)();
    if (snapshot.value) snapshot.value.state = result.state;
    appendProgress(claimOnly ? "领取结束；本次没有发起星级挑战。" : "执行结束，服务器进度已刷新。");
    message.success(claimOnly ? "星级奖励领取结束" : "星级挑战执行结束");
  } catch (error) {
    if (tokenId.value === id && requestGeneration === generation) {
      errorMessage.value = error?.message || "星级挑战执行失败";
      if (error?.code === "TASK_CANCELLED") appendProgress("已停止，未继续发送后续操作。");
    }
  } finally {
    if (requestGeneration === generation) {
      running.value = false;
      activeController = null;
      if (tokenId.value === id && connected.value && !controller.signal.aborted) {
        await refresh();
      }
    }
  }
};

const runSelected = () => runOperation(false);
const runClaimOnly = () => runOperation(true);

const cancelRun = () => {
  if (!activeController || !running.value) return;
  activeController.abort(new Error("用户停止星级挑战"));
  appendProgress("正在停止；当前网络请求结束后不会继续发起挑战。");
};

watch(tokenId, (nextId, previousId) => {
  if (nextId === previousId) return;
  generation++;
  activeController?.abort(new Error("切换角色"));
  activeController = null;
  snapshot.value = null;
  progress.value = [];
  errorMessage.value = "";
  loading.value = false;
  running.value = false;
  if (nextId && tokenStore.getWebSocketStatus(nextId) === "connected") void refresh();
}, { flush: "sync" });

watch(() => settings.starChallengeFormationSource, () => {
  if (snapshot.value && connected.value && !loading.value && !running.value)
    void refresh();
});

onMounted(() => {
  if (tokenId.value && connected.value) void refresh();
});

onBeforeUnmount(() => {
  generation++;
  activeController?.abort(new Error("离开星级挑战页面"));
  activeController = null;
});
</script>

<style scoped>
.star-challenge-page {
  display: flex;
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  flex-direction: column;
  gap: 12px;
  padding: 12px;
  color: var(--text-primary, var(--n-text-color, #15253f));
}

.star-challenge-page__header {
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 0 2px 10px;
  border-bottom: 1px solid var(--border-light, var(--n-border-color, #e4ebf4));
}

.star-challenge-page__title-group {
  min-width: 0;
}

.star-challenge-page__header h2 {
  margin: 0 0 2px;
  color: var(--text-primary, var(--n-text-color, #15253f));
  font-size: 18px;
  font-weight: 650;
  line-height: 1.35;
  overflow-wrap: anywhere;
}

.star-challenge-page__title-group p {
  margin: 0;
  color: var(--text-secondary, var(--n-text-color-2, #6e7c92));
  font-size: 13px;
  line-height: 1.4;
}

.star-challenge-page__actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
}

.star-challenge-page__alert,
.star-challenge-page__settings,
.star-challenge-page__summary,
.star-challenge-page__progress,
.star-challenge-page__loading {
  min-width: 0;
}

.star-challenge-page__settings {
  min-width: 0;
  padding: 10px 12px;
  border: 1px solid var(--border-light, var(--n-border-color, #e4ebf4));
  border-radius: var(--border-radius-medium, 8px);
  background: var(--bg-primary, var(--n-color, #fff));
}

.star-challenge-page__settings > summary {
  display: flex;
  min-height: 28px;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px 12px;
  color: var(--text-primary, var(--n-text-color, #15253f));
  cursor: pointer;
  list-style-position: inside;
}

.star-challenge-page__settings > summary strong {
  font-size: 14px;
  font-weight: 600;
}

.star-challenge-page__settings > summary span {
  color: var(--text-secondary, var(--n-text-color-2, #6e7c92));
  font-size: 12px;
  line-height: 1.4;
}

.star-challenge-page__settings[open] > summary {
  margin-bottom: 10px;
}

.star-challenge-page__settings :deep(.star-challenge-options) {
  padding: 12px;
  border-radius: var(--border-radius-medium, 8px);
}

.star-challenge-page__summary-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 20px;
  padding: 10px 12px;
  border: 1px solid var(--border-light, var(--n-border-color, #e4ebf4));
  border-radius: var(--border-radius-medium, 8px);
  background: var(--bg-primary, var(--n-color, #fff));
  color: var(--text-secondary, var(--n-text-color-2, #6e7c92));
}

.star-challenge-page__summary-row strong {
  color: var(--text-primary, var(--n-text-color, #15253f));
  font-variant-numeric: tabular-nums;
}

.star-challenge-page__progress {
  padding: 10px 12px;
  border: 1px solid var(--border-light, var(--n-border-color, #e4ebf4));
  border-radius: var(--border-radius-medium, 8px);
  background: var(--bg-primary, var(--n-color, #fff));
}

.star-challenge-page__progress h2 {
  margin: 0 0 8px;
  font-size: 16px;
}

.star-challenge-page__progress ul {
  display: grid;
  gap: 5px;
  margin: 0;
  padding-left: 20px;
  line-height: 1.45;
}

.star-challenge-page__bosses {
  display: grid;
  min-width: 0;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 320px), 1fr));
  gap: 10px;
}

.star-challenge-page__boss-card {
  min-width: 0;
  border-radius: var(--border-radius-medium, 8px);
}

.star-challenge-page__boss-card :deep(.n-card-header) {
  padding: 12px 14px 8px;
}

.star-challenge-page__boss-card :deep(.n-card__content) {
  padding: 0 14px 14px;
}

.star-challenge-page__boss-heading {
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
}

.star-challenge-page__stars {
  display: flex;
  align-items: center;
  gap: 5px;
  color: #9aa6b5;
  font-size: 22px;
}

.star-challenge-page__stars .earned {
  color: #d89c18;
}

.star-challenge-page__star-count {
  margin-left: 4px;
  color: var(--n-text-color-2, #516176);
  font-size: 13px;
  font-variant-numeric: tabular-nums;
}

.star-challenge-page__formation-title {
  margin: 14px 0 8px;
  color: var(--n-text-color-2, #516176);
  font-size: 13px;
  font-weight: 600;
}

.star-challenge-page__heroes {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 130px), 1fr));
  gap: 8px;
}

.star-challenge-page__hero {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 3px;
  padding: 8px 10px;
  border-radius: 8px;
  background: var(--bg-secondary, var(--n-color-embedded, #f3f6fb));
  border: 1px solid var(--border-light, #e4ebf4);
}

.star-challenge-page__hero span,
.star-challenge-page__muted,
.star-challenge-page__equipment {
  color: var(--n-text-color-3, #68768b);
  font-size: 12px;
}

.star-challenge-page__hero strong,
.star-challenge-page__equipment {
  overflow-wrap: anywhere;
}

.star-challenge-page__equipment {
  margin: 10px 0 0;
}

.star-challenge-page__muted {
  margin: 12px 0 0;
  line-height: 1.45;
}

.star-challenge-page__formation-error {
  margin: 10px 0 0;
  color: var(--n-error-color, #c43d43);
  font-size: 13px;
  overflow-wrap: anywhere;
}

@media (max-width: 600px) {
  .star-challenge-page {
    padding: 8px;
  }

  .star-challenge-page__actions {
    justify-content: flex-end;
    gap: 6px;
  }

  .star-challenge-page__actions :deep(.n-button) {
    flex: 0 1 auto;
    min-width: 0;
  }
}
</style>
