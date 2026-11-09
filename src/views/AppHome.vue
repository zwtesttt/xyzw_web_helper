<template>
  <n-config-provider :theme="null" :theme-overrides="themeOverrides">
    <div
      class="hosted-page workspace-shell"
      :class="{ 'workspace-shell--immersive': isImmersiveActive }"
    >
      <header v-show="!isImmersiveActive" class="workspace-header">
        <button class="workspace-brand" type="button" aria-label="返回工作台总览" @click="setTab('overview')">
          <span class="brand-mark" aria-hidden="true">
            <img src="/icons/xiaoyugan.png" alt="" />
          </span>
          <span class="brand-copy">
            <span class="brand-kicker">咸鱼助手</span>
            <strong>游戏工作台</strong>
          </span>
        </button>

        <label class="account-switcher">
          <span class="account-switcher__label">
            当前角色
            <i
              v-if="selectedToken"
              class="account-switcher__dot"
              :class="`account-switcher__dot--${connectionTone}`"
              aria-hidden="true"
            ></i>
          </span>
          <select
            :value="tokenStore.selectedTokenId"
            aria-label="选择本地游戏角色"
            @change="selectAccount"
          >
            <option value="">未选择角色</option>
            <option v-for="token in tokenStore.gameTokens" :key="token.id" :value="token.id">
              {{ token.name }}{{ token.server ? ` · ${token.server}` : "" }}
            </option>
          </select>
        </label>

        <nav class="desktop-tabs" aria-label="工作区导航">
          <button
            v-for="tab in tabs"
            :key="tab.id"
            type="button"
            :aria-current="activeTab === tab.id ? 'page' : undefined"
            @click="setTab(tab.id)"
          >
            {{ tab.label }}
          </button>
        </nav>
      </header>

      <main class="workspace-main">
        <section v-show="activeTab === 'overview'" class="workspace-overview" aria-labelledby="overview-title">
          <div class="overview-heading">
            <div>
              <p class="eyebrow">工作台</p>
              <h1 id="overview-title">你好，{{ selectedToken?.name || "先添加一个角色" }}</h1>
              <p>游戏、任务和账号管理集中在一个页面里。</p>
            </div>
            <button
              v-if="selectedToken"
              type="button"
              class="connection-pill"
              :class="`connection-pill--${connectionTone}`"
              :title="connectionStatus === 'connected' ? '点击跳转日常功能' : '点击立即连接角色'"
              @click="handleConnectionPillClick"
            >
              <span aria-hidden="true"></span>
              {{ connectionLabel }}
            </button>
          </div>

          <section v-if="!tokenStore.gameTokens.length" class="empty-account-card">
            <div class="empty-account-card__mark" aria-hidden="true">
              <svg viewBox="0 0 24 24"><path d="M4 7.5A2.5 2.5 0 0 1 6.5 5h11A2.5 2.5 0 0 1 20 7.5v9a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 16.5z"/><path d="M4 9h16M8 15h3"/></svg>
            </div>
            <div>
              <h2>还没有本地游戏账号</h2>
              <p>导入角色后，就可以使用游戏功能和任务工具。Token 只保存在本机浏览器。</p>
            </div>
            <button class="primary-button" type="button" @click="setTab('accounts')">添加游戏账号</button>
          </section>

          <section v-else-if="!selectedToken" class="empty-account-card">
            <div class="empty-account-card__mark" aria-hidden="true">
              <svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="3.5"/><path d="M4 20v-1a8 8 0 0 1 16 0v1"/></svg>
            </div>
            <div>
              <h2>选择一个本地角色</h2>
              <p>使用顶部的角色选择器，或打开账号页管理角色。</p>
            </div>
            <button class="secondary-button" type="button" @click="setTab('accounts')">打开账号管理</button>
          </section>

          <template v-else>
            <div class="overview-stats" aria-label="本机账号概况">
              <article class="overview-stat" role="button" tabindex="0" @click="setTab('accounts')">
                <span class="overview-stat__label">本地角色</span>
                <strong>{{ tokenStore.gameTokens.length }}</strong>
                <span class="overview-stat__detail">点击管理本机角色</span>
              </article>
              <article class="overview-stat" role="button" tabindex="0" @click="openGameFeature">
                <span class="overview-stat__label">当前区服</span>
                <strong class="overview-stat__server">{{ selectedToken.server || "未填写" }}</strong>
                <span class="overview-stat__detail">{{ selectedToken.name }}</span>
              </article>
              <article
                class="overview-stat overview-stat--connection"
                role="button"
                tabindex="0"
                @click="handleConnectionPillClick"
              >
                <span class="overview-stat__label">连接状态</span>
                <strong>{{ connectionLabel }}</strong>
                <span class="overview-stat__detail">
                  {{ connectionStatus === "connected" ? "已就绪，点击打开日常功能" : "点击立即建立角色连接" }}
                </span>
              </article>
            </div>

            <!-- 直达控制卡：当前角色今日日常 & 云端托管状态摘要 -->
            <div class="overview-direct-grid">
              <article class="direct-card">
                <div class="direct-card__head">
                  <div>
                    <span class="direct-card__kicker">当前角色日常</span>
                    <h3>今日活跃度 {{ overviewDailyPoint }}/100</h3>
                  </div>
                  <span
                    class="direct-pill"
                    :class="overviewDailyPoint >= 100 ? 'direct-pill--success' : 'direct-pill--blue'"
                  >
                    {{ overviewDailyPoint >= 100 ? "今日已满" : "待补差" }}
                  </span>
                </div>
                <div class="direct-progress-track" aria-hidden="true">
                  <div
                    class="direct-progress-fill"
                    :class="{ 'is-full': overviewDailyPoint >= 100 }"
                    :style="{ width: `${Math.min(100, overviewDailyPoint)}%` }"
                  ></div>
                </div>
                <p class="direct-card__Status">
                  {{
                    quickDailyRunning
                      ? quickDailyStep || "正在执行日常补差…"
                      : connectionStatus === "connected"
                        ? "连接正常，可直接执行单号一键补差或查看日常详情。"
                        : "点击下方按钮将自动连接角色并执行日常补差。"
                  }}
                </p>
                <div class="direct-card__actions">
                  <button
                    type="button"
                    class="primary-button"
                    :disabled="quickDailyRunning"
                    @click="runQuickDailyFromOverview"
                  >
                    {{ quickDailyRunning ? "执行中…" : "一键日常补差" }}
                  </button>
                  <button
                    type="button"
                    class="secondary-button"
                    @click="openGameFeature"
                  >
                    打开日常面板
                  </button>
                </div>
              </article>

              <article class="direct-card" @click="setTab('server')">
                <div class="direct-card__head">
                  <div>
                    <span class="direct-card__kicker">云端服务器托管</span>
                    <h3>
                      {{
                        hostedSummary.user
                          ? `已启用 ${hostedSummary.enabledJobs} 个计划`
                          : "未登录云端托管"
                      }}
                    </h3>
                  </div>
                  <span
                    class="direct-pill"
                    :class="
                      hostedSummary.user
                        ? hostedSummary.latestRun?.status === 'failed'
                          ? 'direct-pill--danger'
                          : 'direct-pill--success'
                        : 'direct-pill--muted'
                    "
                  >
                    {{
                      hostedSummary.user
                        ? hostedSummary.latestRun
                          ? hostedRunStatusLabel(hostedSummary.latestRun.status)
                          : "已就绪"
                        : "离线可跑"
                    }}
                  </span>
                </div>
                <p class="direct-card__Status">
                  <template v-if="hostedSummary.user">
                    托管账号：{{ hostedSummary.user.username }} · 已存 {{ hostedSummary.accountsCount }} 个角色
                    <template v-if="hostedSummary.latestRun">
                      · 最近：{{ hostedSummary.latestRun.accountName }}
                    </template>
                  </template>
                  <template v-else>
                    配置云端托管后，即使关闭手机或浏览器，服务器也会按北京时间自动执行定时任务。
                  </template>
                </p>
                <div class="direct-card__actions" @click.stop>
                  <button
                    type="button"
                    class="secondary-button"
                    @click="setTab('server')"
                  >
                    {{ hostedSummary.user ? "管理托管计划" : "去登录 / 配置托管" }}
                  </button>
                </div>
              </article>
            </div>

            <section class="quick-actions" aria-labelledby="quick-actions-title">
              <div class="section-heading">
                <div>
                  <p class="eyebrow">快捷操作</p>
                  <h2 id="quick-actions-title">接着做什么？</h2>
                </div>
              </div>
              <div class="quick-action-grid">
                <button type="button" class="quick-action" @click="openGameFeature">
                  <span class="quick-action__icon quick-action__icon--blue" aria-hidden="true">日</span>
                  <span><strong>单号日常</strong><small>打开角色日常与俱乐部工具</small></span>
                  <span class="quick-action__arrow" aria-hidden="true">↗</span>
                </button>
                <button type="button" class="quick-action" @click="openTask('batch')">
                  <span class="quick-action__icon quick-action__icon--green" aria-hidden="true">批</span>
                  <span><strong>批量日常</strong><small>选择多个角色并运行日常任务</small></span>
                  <span class="quick-action__arrow" aria-hidden="true">↗</span>
                </button>
                <button type="button" class="quick-action" @click="openTask('push')">
                  <span class="quick-action__icon quick-action__icon--purple" aria-hidden="true">推</span>
                  <span><strong>主线推关</strong><small>打开现有推关控制面板</small></span>
                  <span class="quick-action__arrow" aria-hidden="true">↗</span>
                </button>
                <button type="button" class="quick-action" @click="openGame('player')">
                  <span class="quick-action__icon quick-action__icon--amber" aria-hidden="true">
                    <svg viewBox="0 0 24 24"><path d="M7 8h10a4 4 0 0 1 3.8 5.2l-1 3.3a2 2 0 0 1-3.3.9L14 15h-4l-2.5 2.4a2 2 0 0 1-3.3-.9l-1-3.3A4 4 0 0 1 7 8Z"/><path d="M7 11v4m-2-2h4m7-1h.01M18 14h.01"/></svg>
                  </span>
                  <span><strong>进入游戏</strong><small>在当前工作区打开游戏页面</small></span>
                  <span class="quick-action__arrow" aria-hidden="true">↗</span>
                </button>
              </div>
            </section>
          </template>

          <aside class="runtime-note" aria-label="本机与服务器运行说明">
            <span class="runtime-note__mark" aria-hidden="true">i</span>
            <p>本机游戏工具需要先导入角色；服务器托管的凭据不会自动下载到本机。网页游戏操作和批量任务需保持 App 前台运行，只有服务端已启用的托管计划会在关闭应用后继续执行。</p>
          </aside>
        </section>

        <section
          v-show="activeTab !== 'overview'"
          class="workspace-panel"
          :class="{ 'workspace-panel--immersive': isImmersiveActive }"
          :aria-label="`${activeTabLabel}工作区`"
        >
          <header
            v-if="(activeTab === 'game' || activeTab === 'tasks') && !isImmersiveActive"
            class="panel-header"
          >
            <div class="panel-heading">
              <p class="eyebrow">{{ activeTab === 'game' ? '游戏工具' : '任务管理' }}</p>
              <h1>{{ activeTab === 'game' ? '游戏' : '任务' }}</h1>
            </div>
            <nav class="module-tabs" :aria-label="activeTab === 'game' ? '游戏页面' : '任务页面'">
              <template v-if="activeTab === 'game'">
                <button type="button" :aria-pressed="gameMode === 'features'" @click="setGameMode('features')">日常与功能</button>
                <button type="button" :aria-pressed="gameMode === 'player'" @click="setGameMode('player')">单角色游戏</button>
                <button type="button" :aria-pressed="gameMode === 'multi'" @click="setGameMode('multi')">批量游戏</button>
                <button v-if="legionWarAvailable" type="button" :aria-pressed="gameMode === 'legion'" @click="setGameMode('legion')">实时盐场</button>
              </template>
              <template v-else>
                <button type="button" :aria-pressed="taskMode === 'batch'" @click="setTaskMode('batch')">批量日常</button>
                <button type="button" :aria-pressed="taskMode === 'push'" @click="setTaskMode('push')">主线推关</button>
              </template>
            </nav>
          </header>

          <div
            class="workspace-module-host"
            :class="{
              'workspace-module-host--scroller': !isFullBleedGameView,
              'workspace-module-host--bleed': isFullBleedGameView,
              'workspace-module-host--immersive': isImmersiveActive,
            }"
          >
            <!-- 沉浸全屏悬浮切换按钮（仅在单号/批量游戏运行画布中展示） -->
            <button
              v-if="isFullBleedGameView && gameMode === 'player'"
              type="button"
              class="immersive-toggle-btn"
              :aria-pressed="immersiveGameMode"
              @click="immersiveGameMode = !immersiveGameMode"
            >
              {{ immersiveGameMode ? "退出全屏" : "沉浸全屏" }}
            </button>

            <div v-if="requiresLocalToken && !selectedToken" class="module-empty-state">
              <span class="module-empty-state__symbol" aria-hidden="true">＋</span>
              <h2>先选择本地游戏角色</h2>
              <p>添加或选择本机角色后，才能打开这项游戏功能。</p>
              <button class="primary-button" type="button" @click="setTab('accounts')">添加游戏账号</button>
            </div>

            <TokenImport
              v-else-if="activeTab === 'accounts'"
              :embedded="true"
              class="workspace-embedded-module"
            />
            <ServerConsole
              v-else-if="activeTab === 'server'"
              :embedded="true"
              class="workspace-embedded-module"
            />
            <section
              v-if="selectedToken && activeTab === 'game' && gameMode === 'player' && !singleGameReady"
              class="game-launch-state"
              aria-live="polite"
            >
              <span class="game-launch-state__mark" aria-hidden="true">🎮</span>
              <div>
                <h2>{{ isPreparingSingleGame ? "正在准备游戏" : "进入单角色游戏" }}</h2>
                <p v-if="isPreparingSingleGame">正在读取当前角色的本机 BIN 数据。</p>
                <p v-else-if="singleGamePreparationError === 'missing-bin'">本机没有这个角色的 BIN 数据，请先在账号页导入或下载 BIN。</p>
                <p v-else-if="singleGamePreparationError === 'storage-failed'">浏览器本地存储不可用，请检查本站点的存储权限后重试。</p>
                <p v-else-if="singleGamePreparationError">读取或转换 BIN 失败，请回到账号页检查角色数据。</p>
                <p v-else>准备本机角色数据后打开游戏窗口。</p>
              </div>
              <button type="button" :disabled="isPreparingSingleGame" @click="prepareCurrentSingleGame">
                {{ isPreparingSingleGame ? "正在准备…" : singleGamePreparationError ? "重试准备" : "进入游戏" }}
              </button>
            </section>

            <section
              v-if="selectedToken && activeTab === 'game' && gameMode === 'multi' && !multiGameLaunchId"
              class="multi-game-launch-setup"
            >
              <header class="multi-game-setup-header">
                <div>
                  <h2>批量进入游戏</h2>
                  <p>勾选需要同时打开的本机角色，每个窗口拥有独立的本地存储空间。</p>
                </div>
                <div class="multi-game-setup-actions">
                  <span class="multi-game-count">已选 {{ selectedMultiGameTokens.length }} / {{ tokenStore.gameTokens.length }}</span>
                  <button
                    type="button"
                    class="text-action-btn"
                    @click="multiGameSelectedIds = tokenStore.gameTokens.map((t) => t.id)"
                  >
                    全选
                  </button>
                  <button
                    type="button"
                    class="text-action-btn"
                    :disabled="!multiGameSelectedIds.length"
                    @click="multiGameSelectedIds = []"
                  >
                    清空
                  </button>
                </div>
              </header>
              <div class="multi-game-account-list">
                <label
                  v-for="token in tokenStore.gameTokens"
                  :key="token.id"
                  :class="{ 'is-checked': multiGameSelectedIds.includes(token.id) }"
                >
                  <input v-model="multiGameSelectedIds" type="checkbox" :value="token.id" />
                  <span class="multi-game-account-list__name">{{ token.name || "未命名角色" }}</span>
                  <small>{{ token.server || "未填写区服" }}</small>
                </label>
              </div>
              <p v-if="multiGamePreparationError" class="game-launch-error" role="alert">{{ multiGamePreparationError }}</p>
              <button
                type="button"
                class="primary-button"
                :disabled="isPreparingMultiGame || !multiGameSelectedIds.length"
                @click="prepareMultiGame"
              >
                {{ isPreparingMultiGame ? "正在准备…" : `启动所选游戏（${selectedMultiGameTokens.length}）` }}
              </button>
            </section>

            <GamePlayer
              v-if="singleGameReady && activeTab === 'game' && gameMode === 'player'"
              :key="`single-game:${selectedToken.id}`"
              :embedded="true"
              class="workspace-embedded-module"
            />
            <GameMultiPlayer
              v-if="multiGameLaunchId && activeTab === 'game' && gameMode === 'multi'"
              :key="`multi-game:${multiGameLaunchId}`"
              :embedded="true"
              :immersive="isImmersiveActive"
              @toggle-immersive="immersiveGameMode = !immersiveGameMode"
              class="workspace-embedded-module"
            />

            <KeepAlive v-if="!requiresLocalToken || selectedToken">
              <component
                :is="activeCachedModule"
                v-if="activeCachedModule"
                :key="activeCachedModuleKey"
                :embedded="true"
                class="workspace-embedded-module"
              />
            </KeepAlive>
          </div>
        </section>
      </main>

      <nav v-show="!isImmersiveActive" class="mobile-tabs" aria-label="工作区导航">
        <button
          v-for="tab in tabs"
          :key="tab.id"
          type="button"
          :aria-current="activeTab === tab.id ? 'page' : undefined"
          @click="setTab(tab.id)"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path v-if="tab.id === 'overview'" d="m3.5 10 8.5-7 8.5 7v10h-6v-6h-5v6h-6z" />
            <template v-else-if="tab.id === 'game'"><rect x="3" y="7" width="18" height="12" rx="4"/><path d="M8 10v6m-3-3h6m5-1h.01M18 14h.01"/></template>
            <template v-else-if="tab.id === 'tasks'"><rect x="4" y="5" width="16" height="16" rx="2"/><path d="M8 3v4m8-4v4M4 10h16m-9 4 2 2 4-4"/></template>
            <template v-else-if="tab.id === 'accounts'"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20v-1.5a6.5 6.5 0 0 1 13 0V20M17 5.5a3.5 3.5 0 0 1 0 6.8M18 14a5 5 0 0 1 3.5 4.5V20"/></template>
            <template v-else><rect x="3" y="4" width="18" height="6" rx="2"/><rect x="3" y="14" width="18" height="6" rx="2"/><circle cx="7" cy="7" r="1"/><circle cx="7" cy="17" r="1"/></template>
          </svg>
          <span>{{ tab.label }}</span>
        </button>
      </nav>
    </div>
  </n-config-provider>
</template>

<script setup>
import { useMessage } from "naive-ui";
import { computed, defineAsyncComponent, nextTick, onMounted, provide, reactive, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { WORKSPACE_NAVIGATION_KEY } from "@/composables/useWorkspaceNavigation";
import useIndexedDB from "@/hooks/useIndexedDB";
import { useTokenStore } from "@/stores/tokenStore";
import { isNowInLegionWarTime } from "@/utils/clubBattleUtils";
import { DailyTaskRunner } from "@/utils/dailyTaskRunner";
import {
  prepareMultiGameLaunch,
  prepareSingleGameLaunch,
  readActiveMultiGameLaunch,
} from "@/utils/gameLauncher";
import ServerConsole from "@/views/ServerConsole.vue";
import TokenImport from "@/views/TokenImport/TokenImport.vue";

const GameFeatures = defineAsyncComponent(() => import("@/views/GameFeatures.vue"));
const GamePlayer = defineAsyncComponent(() => import("@/views/GamePlayer.vue"));
const GameMultiPlayer = defineAsyncComponent(() => import("@/views/GameMultiPlayer.vue"));
const BatchDailyTasks = defineAsyncComponent(() => import("@/views/BatchDailyTasks.vue"));
const PushingLevels = defineAsyncComponent(() => import("@/views/PushingLevels.vue"));
const LegionWar = defineAsyncComponent(() => import("@/views/LegionWar.vue"));

const WORKSPACE_STATE_STORAGE_KEY = "xyzw_workspace_nav_state";
const VALID_TABS = new Set(["overview", "game", "tasks", "accounts", "server"]);
const VALID_GAME_MODES = new Set(["features", "player", "multi", "legion"]);
const VALID_TASK_MODES = new Set(["batch", "push"]);

const route = useRoute();
const router = useRouter();
const message = useMessage();
const tokenStore = useTokenStore();

const tabs = [
  { id: "overview", label: "总览" },
  { id: "game", label: "游戏" },
  { id: "tasks", label: "任务" },
  { id: "accounts", label: "账号" },
  { id: "server", label: "托管" },
];

function readInitialWorkspaceState() {
  let saved = {};
  try {
    saved = JSON.parse(sessionStorage.getItem(WORKSPACE_STATE_STORAGE_KEY) || "{}");
  } catch {}
  const qTab = typeof route.query.tab === "string" ? route.query.tab : saved.tab;
  const qGame = typeof route.query.game === "string" ? route.query.game : saved.gameMode;
  const qTask = typeof route.query.task === "string" ? route.query.task : saved.taskMode;
  return {
    tab: VALID_TABS.has(qTab) ? qTab : "overview",
    gameMode: VALID_GAME_MODES.has(qGame) ? qGame : "features",
    taskMode: VALID_TASK_MODES.has(qTask) ? qTask : "batch",
  };
}

const initialState = readInitialWorkspaceState();
const activeTab = ref(initialState.tab);
const gameMode = ref(initialState.gameMode);
const taskMode = ref(initialState.taskMode);
const immersiveGameMode = ref(false);

const { getArrayBuffer } = useIndexedDB();
const isPreparingSingleGame = ref(false);
const singleGamePreparedTokenId = ref("");
const singleGamePreparationError = ref("");
const multiGameSelectedIds = ref([]);
const multiGameLaunchId = ref("");
const isPreparingMultiGame = ref(false);
const multiGamePreparationError = ref("");
const gameLaunchEpoch = ref(0);

// 总览页快捷补差与云端托管摘要状态
const quickDailyRunning = ref(false);
const quickDailyStep = ref("");
const hostedSummary = reactive({
  user: null,
  accountsCount: 0,
  enabledJobs: 0,
  latestRun: null,
});

const selectedToken = computed(() => tokenStore.selectedToken);
const overviewDailyPoint = computed(() => {
  const pt = tokenStore.selectedTokenRoleInfo?.role?.dailyTask?.dailyPoint ?? 0;
  return Math.min(100, Math.max(0, Number(pt) || 0));
});
const connectionStatus = computed(() =>
  selectedToken.value
    ? tokenStore.getWebSocketStatus(selectedToken.value.id)
    : "disconnected",
);
const connectionLabel = computed(() => {
  const labels = {
    connected: "已连接",
    connecting: "连接中",
    disconnecting: "正在断开",
    error: "连接异常",
    disconnected: "点击连接",
  };
  return labels[connectionStatus.value] || "点击连接";
});
const connectionTone = computed(() =>
  connectionStatus.value === "connected"
    ? "connected"
    : connectionStatus.value === "error"
      ? "error"
      : "idle",
);
const activeTabLabel = computed(
  () => tabs.find((tab) => tab.id === activeTab.value)?.label || "工作区",
);
const requiresLocalToken = computed(
  () => activeTab.value === "game" || (activeTab.value === "tasks" && taskMode.value === "push"),
);
const legionWarAvailable = computed(() => isNowInLegionWarTime());
const activeCachedModule = computed(() => {
  if (activeTab.value === "game") {
    if (gameMode.value === "legion") return LegionWar;
    if (gameMode.value === "features") return GameFeatures;
  }
  if (activeTab.value === "tasks") {
    return taskMode.value === "push" ? PushingLevels : BatchDailyTasks;
  }
  return null;
});
const activeCachedModuleKey = computed(() =>
  activeTab.value === "game"
    ? `game:${gameMode.value}:${selectedToken.value?.id || "none"}`
    : `tasks:${taskMode.value}`,
);
const singleGameReady = computed(
  () => Boolean(selectedToken.value && singleGamePreparedTokenId.value === selectedToken.value.id),
);
const isFullBleedGameView = computed(
  () =>
    activeTab.value === "game" &&
    ((gameMode.value === "player" && singleGameReady.value) ||
      (gameMode.value === "multi" && Boolean(multiGameLaunchId.value))),
);
const isImmersiveActive = computed(
  () => isFullBleedGameView.value && immersiveGameMode.value,
);
const selectedMultiGameTokens = computed(() =>
  tokenStore.gameTokens.filter((token) => multiGameSelectedIds.value.includes(token.id)),
);

const themeOverrides = {
  common: {
    primaryColor: "#2563eb",
    primaryColorHover: "#1d4ed8",
    primaryColorPressed: "#1e40af",
    primaryColorSuppl: "#60a5fa",
    borderRadius: "10px",
    textColor1: "#15253f",
    textColor2: "#354761",
    textColor3: "#6e7c92",
    bodyColor: "#ffffff",
    cardColor: "#ffffff",
    modalColor: "#ffffff",
    popoverColor: "#ffffff",
    inputColor: "#ffffff",
  },
};

function persistWorkspaceState() {
  try {
    sessionStorage.setItem(
      WORKSPACE_STATE_STORAGE_KEY,
      JSON.stringify({
        tab: activeTab.value,
        gameMode: gameMode.value,
        taskMode: taskMode.value,
      }),
    );
  } catch {}
  const nextQuery = { ...route.query, tab: activeTab.value };
  if (activeTab.value === "game") {
    nextQuery.game = gameMode.value;
    delete nextQuery.task;
  } else if (activeTab.value === "tasks") {
    nextQuery.task = taskMode.value;
    delete nextQuery.game;
  } else {
    delete nextQuery.game;
    delete nextQuery.task;
  }
  router.replace({ query: nextQuery }).catch(() => {});
}

watch([activeTab, gameMode, taskMode], () => {
  if (!isFullBleedGameView.value) {
    immersiveGameMode.value = false;
  }
  persistWorkspaceState();
});

async function refreshHostedSummary() {
  try {
    const meRes = await fetch("/api/server/auth/me", {
      credentials: "same-origin",
      headers: { "X-Requested-With": "XMLHttpRequest" },
    });
    if (!meRes.ok) {
      hostedSummary.user = null;
      return;
    }
    const meData = await meRes.json();
    hostedSummary.user = meData.user || null;
    const [accRes, jobsRes, runsRes] = await Promise.all([
      fetch("/api/server/accounts", {
        credentials: "same-origin",
        headers: { "X-Requested-With": "XMLHttpRequest" },
      }),
      fetch("/api/server/jobs", {
        credentials: "same-origin",
        headers: { "X-Requested-With": "XMLHttpRequest" },
      }),
      fetch("/api/server/runs?limit=1", {
        credentials: "same-origin",
        headers: { "X-Requested-With": "XMLHttpRequest" },
      }),
    ]);
    if (accRes.ok) {
      const a = await accRes.json();
      hostedSummary.accountsCount = Array.isArray(a.accounts) ? a.accounts.length : 0;
    }
    if (jobsRes.ok) {
      const j = await jobsRes.json();
      hostedSummary.enabledJobs = Array.isArray(j.jobs)
        ? j.jobs.filter((job) => job.enabled).length
        : 0;
    }
    if (runsRes.ok) {
      const r = await runsRes.json();
      hostedSummary.latestRun = Array.isArray(r.runs) && r.runs.length ? r.runs[0] : null;
    }
  } catch {
    // Silent fallback when backend is offline in pure frontend preview
  }
}

function hostedRunStatusLabel(status) {
  return (
    { queued: "排队中", running: "执行中", succeeded: "最近成功", failed: "最近失败" }[
      status
    ] || status
  );
}

function ensureSelectedTokenConnected() {
  const token = selectedToken.value;
  if (!token) return;
  const status = tokenStore.getWebSocketStatus(token.id);
  if (status !== "connected" && status !== "connecting") {
    tokenStore.createWebSocketConnection(token.id, token.token, token.wsUrl);
  }
}

async function runQuickDailyFromOverview() {
  const token = selectedToken.value;
  if (!token || quickDailyRunning.value) return;
  quickDailyRunning.value = true;
  quickDailyStep.value = "正在检查连接状态…";
  try {
    if (tokenStore.getWebSocketStatus(token.id) !== "connected") {
      tokenStore.createWebSocketConnection(token.id, token.token, token.wsUrl);
      const started = Date.now();
      while (
        tokenStore.getWebSocketStatus(token.id) !== "connected" &&
        Date.now() - started < 5000
      ) {
        await new Promise((r) => setTimeout(r, 200));
      }
    }
    if (tokenStore.getWebSocketStatus(token.id) !== "connected") {
      throw new Error("角色连接超时，请检查 Token 后重试");
    }
    let savedSettings = {};
    try {
      savedSettings =
        JSON.parse(localStorage.getItem(`daily-settings:${token.id}`) || "null") || {};
    } catch {}
    const runnerSettings = {
      arenaFormation: 1,
      bossFormation: 1,
      bossTimes: 2,
      claimBottle: true,
      payRecruit: true,
      openBox: true,
      arenaEnable: true,
      claimHangUp: true,
      claimEmail: true,
      blackMarketPurchase: true,
      commandDelay: 500,
      taskDelay: 500,
      ...savedSettings,
    };
    const runner = new DailyTaskRunner(tokenStore, {
      commandDelay: runnerSettings.commandDelay,
      taskDelay: runnerSettings.taskDelay,
    });
    const result = await runner.run(
      token.id,
      {
        onLog: (item) => {
          quickDailyStep.value = item.message;
        },
        onProgress: (p) => {
          quickDailyStep.value = `日常进度已同步：${p}%`;
        },
      },
      runnerSettings,
    );
    if (result.incomplete) {
      message.warning(`本轮补差结束，仍有 ${result.incomplete} 项待继续`);
    } else {
      message.success("今日日常补差已完成！");
    }
  } catch (e) {
    message.error(e.message || "日常补差执行失败");
  } finally {
    quickDailyRunning.value = false;
    quickDailyStep.value = "";
  }
}

function handleConnectionPillClick() {
  if (!selectedToken.value) {
    setTab("accounts");
    return;
  }
  if (connectionStatus.value === "connected") {
    openGameFeature();
  } else {
    ensureSelectedTokenConnected();
  }
}

function setTab(tab) {
  if (!tabs.some((item) => item.id === tab)) return;
  if (activeTab.value !== tab && (activeTab.value === "game" || tab === "game")) {
    gameLaunchEpoch.value += 1;
  }
  activeTab.value = tab;
  if (tab === "game" && gameMode.value === "features") {
    ensureSelectedTokenConnected();
  } else if (tab === "overview") {
    void refreshHostedSummary();
  }
}

function setTaskMode(mode) {
  if (!VALID_TASK_MODES.has(mode)) return;
  taskMode.value = mode;
}

function setGameMode(mode) {
  if (!selectedToken.value) {
    setTab("accounts");
    return;
  }
  if (mode === "legion" && !legionWarAvailable.value) {
    message.info("实时盐场仅在活动开放时可用");
    return;
  }
  gameLaunchEpoch.value += 1;
  gameMode.value = mode;
  setTab("game");
  if (mode === "features") {
    ensureSelectedTokenConnected();
  } else if (mode === "player") {
    singleGamePreparationError.value = "";
    void prepareCurrentSingleGame();
  } else if (mode === "multi") {
    multiGameLaunchId.value = "";
    multiGamePreparationError.value = "";
    multiGameSelectedIds.value = selectedToken.value ? [selectedToken.value.id] : [];
  }
}

async function prepareCurrentSingleGame() {
  const token = selectedToken.value;
  if (!token || isPreparingSingleGame.value) return;
  if (singleGamePreparedTokenId.value === token.id) return;
  const tokenId = token.id;
  const launchEpoch = gameLaunchEpoch.value;
  isPreparingSingleGame.value = true;
  singleGamePreparationError.value = "";
  try {
    const result = await prepareSingleGameLaunch({
      token,
      getArrayBuffer,
      localStorage: window.localStorage,
    });
    if (
      gameLaunchEpoch.value !== launchEpoch ||
      tokenStore.selectedTokenId !== tokenId ||
      gameMode.value !== "player"
    ) return;
    if (result.success) singleGamePreparedTokenId.value = tokenId;
    else singleGamePreparationError.value = result.reason;
  } catch {
    if (gameLaunchEpoch.value === launchEpoch && tokenStore.selectedTokenId === tokenId) {
      singleGamePreparationError.value = "storage-failed";
    }
  } finally {
    isPreparingSingleGame.value = false;
  }
}

async function prepareMultiGame() {
  const selectedIds = [...multiGameSelectedIds.value];
  const tokens = selectedMultiGameTokens.value.filter((token) => selectedIds.includes(token.id));
  if (!tokens.length || isPreparingMultiGame.value) return;
  const launchEpoch = gameLaunchEpoch.value;
  isPreparingMultiGame.value = true;
  multiGamePreparationError.value = "";
  try {
    const { launch } = await prepareMultiGameLaunch({
      tokens,
      getArrayBuffer,
      localStorage: window.localStorage,
      sessionStorage: window.sessionStorage,
    });
    const selectionIsCurrent =
      selectedIds.length === multiGameSelectedIds.value.length &&
      selectedIds.every((id) => multiGameSelectedIds.value.includes(id));
    if (
      gameLaunchEpoch.value !== launchEpoch ||
      activeTab.value !== "game" ||
      gameMode.value !== "multi" ||
      !selectionIsCurrent
    ) return;
    if (!launch.sessions.length) {
      multiGamePreparationError.value = "所选角色均缺少可用的本机 BIN，请回账号页重新导入或下载 BIN。";
      return;
    }
    multiGameLaunchId.value = launch.id;
  } catch {
    multiGamePreparationError.value = "准备批量游戏失败，请检查浏览器本地存储后重试。";
  } finally {
    isPreparingMultiGame.value = false;
  }
}

function openPreparedMultiGame() {
  try {
    const launch = readActiveMultiGameLaunch(window.sessionStorage);
    if (launch?.sessions.length) {
      gameLaunchEpoch.value += 1;
      gameMode.value = "multi";
      multiGameLaunchId.value = launch.id;
      multiGamePreparationError.value = "";
      setTab("game");
      return;
    }
  } catch {
    // Show the account selector when no valid prepared launch is available.
  }
  setGameMode("multi");
}

function openGame(mode) {
  setGameMode(mode);
}

function openGameFeature() {
  openGame("features");
}

function openTask(mode) {
  if (mode === "push" && !selectedToken.value) {
    setTab("accounts");
    return;
  }
  taskMode.value = mode;
  setTab("tasks");
}

function resetGameViews(tokenId = "") {
  gameLaunchEpoch.value += 1;
  singleGamePreparedTokenId.value = "";
  singleGamePreparationError.value = "";
  multiGameLaunchId.value = "";
  multiGamePreparationError.value = "";
  multiGameSelectedIds.value = tokenId ? [tokenId] : [];
}

function selectAccount(event) {
  const tokenId = event.currentTarget.value;
  const previousId = tokenStore.selectedTokenId;
  if (!tokenId) {
    if (previousId) tokenStore.closeWebSocketConnection(previousId);
    tokenStore.selectedTokenId = "";
    resetGameViews();
    return;
  }
  if (!tokenStore.gameTokens.some((token) => token.id === tokenId)) return;
  tokenStore.selectToken(tokenId);
  resetGameViews(tokenId);
  if (activeTab.value === "game" && gameMode.value === "player") {
    void prepareCurrentSingleGame();
  } else if (activeTab.value === "game" && gameMode.value === "features") {
    ensureSelectedTokenConnected();
  }
}

async function workspaceNavigate(location) {
  const path = typeof location === "string" ? location : location?.path;
  const normalized = String(path || "").split(/[?#]/, 1)[0].toLowerCase();
  const routes = {
    "/tokens": () => setTab("accounts"),
    "/server": () => setTab("server"),
    "/admin/dashboard": () => openGame("features"),
    "/admin/game-features": () => openGame("features"),
    "/admin/daily-tasks": () => openGame("features"),
    "/admin/batch-daily-tasks": () => openTask("batch"),
    "/admin/pushinglevels": () => openTask("push"),
    "/admin/legion-war": () => setGameMode("legion"),
    "/game": () => openGame("player"),
    "/multi-game": () => openPreparedMultiGame(),
  };
  const action = routes[normalized];
  if (!action) {
    message.info("此页面暂未纳入统一工作区");
    return Promise.resolve();
  }
  action();
  const query = typeof location === "string"
    ? Object.fromEntries(new URLSearchParams(location.split("?")[1] || ""))
    : location?.query || {};
  if (normalized === "/admin/batch-daily-tasks" && query.batchPlanEditor) {
    await nextTick();
    return router.replace({ query: {
      ...route.query, tab: "tasks", task: "batch", batchPlanEditor: String(query.batchPlanEditor),
    } });
  }
  if (normalized === "/admin/game-features" && query.feature === "tenPalace") {
    await nextTick();
    return router.replace({ query: {
      ...route.query,
      tab: "game",
      game: "features",
      feature: "tenPalace",
      ...(query.planId ? { planId: String(query.planId) } : {}),
    } });
  }
  return Promise.resolve();
}

onMounted(() => {
  tokenStore.initTokenStore?.();
  if (activeTab.value === "game") {
    if (gameMode.value === "features") ensureSelectedTokenConnected();
    else if (gameMode.value === "player") void prepareCurrentSingleGame();
    else if (gameMode.value === "multi") openPreparedMultiGame();
  }
  void refreshHostedSummary();
});

provide(WORKSPACE_NAVIGATION_KEY, { navigate: workspaceNavigate });
</script>

<style scoped>
.hosted-page {
  --hosted-bg: #f3f6fb;
  --hosted-surface: #ffffff;
  --hosted-surface-subtle: #f8fafd;
  --hosted-ink: #15253f;
  --hosted-ink-secondary: #354761;
  --hosted-muted: #6e7c92;
  --hosted-border: #e4ebf4;
  --hosted-border-subtle: #edf1f6;
  --hosted-primary: #2563eb;
  --hosted-primary-hover: #1d4ed8;
  --hosted-primary-soft: #edf3ff;
  --hosted-success: #18794e;
  --hosted-danger: #b42318;
  --bg-primary: #ffffff;
  --bg-secondary: #f3f6fb;
  --bg-tertiary: #f8fafd;
  --text-primary: #15253f;
  --text-secondary: #6e7c92;
  --border-light: #e4ebf4;
  --primary-color: #2563eb;
  --success-color: #18794e;
  --warning-color: #9a6700;
  --error-color: #b42318;
  box-sizing: border-box;
  display: flex;
  width: 100%;
  height: 100vh;
  height: 100dvh;
  flex-direction: column;
  overflow: hidden;
  color: var(--hosted-ink);
  color-scheme: light;
  background: var(--hosted-bg);
  font-family:
    -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC",
    "Microsoft YaHei", sans-serif;
  font-size: 15px;
  line-height: 1.5;
}
.hosted-page *,
.hosted-page *::before,
.hosted-page *::after {
  box-sizing: border-box;
}
.workspace-header {
  position: relative;
  z-index: 12;
  display: flex;
  min-height: 60px;
  flex: 0 0 auto;
  align-items: center;
  gap: 16px;
  padding: 6px max(20px, calc((100vw - 1240px) / 2));
  border-bottom: 1px solid var(--hosted-border);
  background: #ffffff;
}
.workspace-brand {
  display: flex;
  min-width: 0;
  flex: 0 0 auto;
  align-items: center;
  gap: 9px;
  border: 0;
  padding: 0;
  background: transparent;
  color: var(--hosted-ink);
  cursor: pointer;
  text-decoration: none;
}
.brand-mark {
  display: grid;
  width: 36px;
  height: 36px;
  flex: 0 0 auto;
  place-items: center;
  border: 1px solid #f0e5ca;
  border-radius: 11px;
  background: #fff9eb;
}
.brand-mark img {
  width: 27px;
  height: 27px;
  object-fit: contain;
}
.brand-copy {
  display: grid;
  gap: 1px;
  white-space: nowrap;
  text-align: left;
}
.brand-kicker {
  color: var(--hosted-muted);
  font-size: 10px;
  font-weight: 620;
  letter-spacing: 0.05em;
}
.brand-copy strong {
  color: var(--hosted-ink);
  font-size: 14px;
  font-weight: 670;
  line-height: 1.2;
}
.account-switcher {
  display: flex;
  min-width: 0;
  max-width: min(300px, 42vw);
  min-height: 40px;
  flex: 0 1 250px;
  flex-direction: column;
  justify-content: center;
  gap: 1px;
  padding: 3px 11px 4px;
  border: 1px solid var(--hosted-border);
  border-radius: 11px;
  background: var(--hosted-surface-subtle);
}
.account-switcher__label {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: var(--hosted-muted);
  font-size: 10px;
  line-height: 1.1;
}
.account-switcher__dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #94a3b8;
}
.account-switcher__dot--connected {
  background: #25a56a;
}
.account-switcher__dot--error {
  background: #d92d20;
}
.account-switcher select {
  width: 100%;
  min-width: 0;
  padding: 0 14px 0 0;
  border: 0;
  outline: 0;
  color: var(--hosted-ink);
  background: transparent;
  font: inherit;
  font-size: 12.5px;
  font-weight: 640;
  cursor: pointer;
}
.desktop-tabs {
  display: flex;
  flex: 1 1 auto;
  align-items: center;
  justify-content: flex-end;
  gap: 4px;
}
.desktop-tabs button {
  min-height: 38px;
  padding: 0 13px;
  border: 1px solid transparent;
  border-radius: 10px;
  color: var(--hosted-muted);
  background: transparent;
  cursor: pointer;
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
}
.desktop-tabs button[aria-current="page"] {
  border-color: #dce7fb;
  color: var(--hosted-primary);
  background: var(--hosted-primary-soft);
}
.workspace-main {
  position: relative;
  width: min(1240px, 100%);
  min-height: 0;
  flex: 1 1 auto;
  align-self: center;
  overflow: hidden;
}
.workspace-shell--immersive .workspace-main {
  width: 100%;
  max-width: none;
}
.workspace-overview {
  width: 100%;
  height: 100%;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  padding: 24px 28px 34px;
  overscroll-behavior: contain;
}
.overview-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 18px;
}
.eyebrow {
  margin: 0 0 4px;
  color: var(--hosted-muted);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
}
.overview-heading h1,
.panel-heading h1 {
  margin: 0;
  color: var(--hosted-ink);
  font-size: clamp(22px, 2.8vw, 30px);
  font-weight: 680;
  line-height: 1.2;
  letter-spacing: -0.03em;
}
.overview-heading p:last-child {
  margin: 6px 0 0;
  color: var(--hosted-muted);
  font-size: 13px;
}
.connection-pill {
  display: inline-flex;
  min-height: 34px;
  flex: 0 0 auto;
  align-items: center;
  gap: 7px;
  padding: 0 12px;
  border: 1px solid var(--hosted-border);
  border-radius: 999px;
  color: var(--hosted-ink-secondary);
  background: var(--hosted-surface);
  font: inherit;
  font-size: 12px;
  font-weight: 640;
  white-space: nowrap;
  cursor: pointer;
}
.connection-pill > span {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #94a3b8;
}
.connection-pill--connected {
  border-color: #cce9d8;
  color: #18794e;
  background: #f0faf4;
}
.connection-pill--connected > span {
  background: #25a56a;
}
.connection-pill--error {
  border-color: #f2cfcc;
  color: #b42318;
  background: #fff6f5;
}
.connection-pill--error > span {
  background: #d92d20;
}
.overview-stats {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
  margin-bottom: 16px;
}
.overview-stat {
  display: grid;
  min-height: 104px;
  align-content: start;
  gap: 5px;
  padding: 14px 16px;
  border: 1px solid var(--hosted-border);
  border-radius: 15px;
  background: var(--hosted-surface);
  box-shadow: 0 4px 14px rgba(21, 37, 63, 0.035);
  cursor: pointer;
  transition: transform 140ms ease, border-color 140ms ease;
}
.overview-stat:hover {
  transform: translateY(-1px);
  border-color: #bfd2fb;
}
.overview-stat__label,
.overview-stat__detail {
  color: var(--hosted-muted);
  font-size: 12px;
}
.overview-stat strong {
  overflow: hidden;
  color: var(--hosted-ink);
  font-size: 24px;
  font-weight: 680;
  line-height: 1.2;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.overview-stat .overview-stat__server {
  font-size: 18px;
}
.overview-stat--connection strong {
  font-size: 18px;
}
.overview-direct-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  margin-bottom: 22px;
}
.direct-card {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: 10px;
  padding: 16px 18px;
  border: 1px solid var(--hosted-border);
  border-radius: 15px;
  background: var(--hosted-surface);
  box-shadow: 0 4px 14px rgba(21, 37, 63, 0.035);
}
.direct-card__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
}
.direct-card__kicker {
  display: block;
  color: var(--hosted-muted);
  font-size: 11px;
  font-weight: 650;
}
.direct-card__head h3 {
  margin: 2px 0 0;
  color: var(--hosted-ink);
  font-size: 16px;
  font-weight: 670;
}
.direct-pill {
  display: inline-flex;
  align-items: center;
  min-height: 24px;
  padding: 0 9px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 650;
  white-space: nowrap;
}
.direct-pill--blue {
  color: var(--hosted-primary);
  background: var(--hosted-primary-soft);
}
.direct-pill--success {
  color: var(--hosted-success);
  background: #e8f5ee;
}
.direct-pill--danger {
  color: var(--hosted-danger);
  background: #fff0ee;
}
.direct-pill--muted {
  color: var(--hosted-muted);
  background: var(--hosted-surface-subtle);
  border: 1px solid var(--hosted-border);
}
.direct-progress-track {
  width: 100%;
  height: 7px;
  overflow: hidden;
  border-radius: 999px;
  background: #edf1f7;
}
.direct-progress-fill {
  height: 100%;
  border-radius: 999px;
  background: var(--hosted-primary);
  transition: width 240ms ease;
}
.direct-progress-fill.is-full {
  background: #10b981;
}
.direct-card__Status {
  margin: 0;
  color: var(--hosted-muted);
  font-size: 12px;
  line-height: 1.45;
}
.direct-card__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 2px;
}
.section-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}
.section-heading h2 {
  margin: 0;
  color: var(--hosted-ink);
  font-size: 18px;
  font-weight: 660;
}
.quick-action-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}
.quick-action {
  display: grid;
  min-width: 0;
  min-height: 76px;
  grid-template-columns: 40px minmax(0, 1fr) 16px;
  align-items: center;
  gap: 11px;
  padding: 12px 14px;
  border: 1px solid var(--hosted-border);
  border-radius: 14px;
  color: var(--hosted-ink);
  background: var(--hosted-surface);
  cursor: pointer;
  text-align: left;
  transition: border-color 150ms ease, transform 150ms ease, box-shadow 150ms ease;
}
.quick-action:hover,
.quick-action:focus-visible {
  transform: translateY(-1px);
  border-color: rgba(37, 99, 235, 0.4);
  box-shadow: 0 6px 18px rgba(21, 37, 63, 0.07);
  outline: none;
}
.quick-action__icon {
  display: grid;
  width: 40px;
  height: 40px;
  place-items: center;
  border-radius: 12px;
  font-size: 15px;
  font-weight: 680;
}
.quick-action__icon svg {
  width: 22px;
  height: 22px;
  fill: none;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 1.7;
}
.quick-action__icon--blue { color: #2563eb; background: #edf3ff; }
.quick-action__icon--green { color: #18794e; background: #e8f5ee; }
.quick-action__icon--purple { color: #6941c6; background: #f3efff; }
.quick-action__icon--amber { color: #9a6700; background: #fff4d6; }
.quick-action > span:nth-child(2) {
  display: grid;
  min-width: 0;
  gap: 2px;
}
.quick-action strong {
  color: var(--hosted-ink);
  font-size: 14px;
  font-weight: 650;
}
.quick-action small {
  overflow: hidden;
  color: var(--hosted-muted);
  font-size: 11px;
  line-height: 1.4;
  text-overflow: ellipsis;
}
.quick-action__arrow {
  color: var(--hosted-primary);
  font-size: 16px;
}
.runtime-note {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  margin-top: 20px;
  padding: 12px 14px;
  border: 1px solid #dbe7fb;
  border-radius: 13px;
  background: #f8faff;
}
.runtime-note__mark {
  display: grid;
  width: 20px;
  height: 20px;
  flex: 0 0 auto;
  place-items: center;
  border-radius: 50%;
  color: var(--hosted-primary);
  background: var(--hosted-primary-soft);
  font-size: 12px;
  font-weight: 700;
}
.runtime-note p {
  margin: 0;
  color: var(--hosted-ink-secondary);
  font-size: 11px;
  line-height: 1.55;
}
.empty-account-card {
  display: grid;
  grid-template-columns: 42px minmax(0, 1fr) auto;
  align-items: center;
  gap: 15px;
  padding: 20px;
  border: 1px solid var(--hosted-border);
  border-radius: 16px;
  background: var(--hosted-surface);
}
.empty-account-card__mark {
  display: grid;
  width: 42px;
  height: 42px;
  place-items: center;
  border-radius: 13px;
  color: var(--hosted-primary);
  background: var(--hosted-primary-soft);
}
.empty-account-card__mark svg {
  width: 22px;
  height: 22px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.7;
}
.empty-account-card h2 {
  margin: 0 0 4px;
  color: var(--hosted-ink);
  font-size: 16px;
}
.empty-account-card p {
  margin: 0;
  color: var(--hosted-muted);
  font-size: 12px;
  line-height: 1.5;
}
.primary-button,
.secondary-button {
  min-height: 38px;
  padding: 0 14px;
  border: 1px solid transparent;
  border-radius: 10px;
  cursor: pointer;
  font: inherit;
  font-size: 12.5px;
  font-weight: 650;
  white-space: nowrap;
}
.primary-button {
  color: #fff;
  background: var(--hosted-primary);
}
.primary-button:hover:not(:disabled) { background: var(--hosted-primary-hover); }
.primary-button:disabled { opacity: 0.55; cursor: not-allowed; }
.secondary-button {
  border-color: var(--hosted-border);
  color: var(--hosted-ink);
  background: var(--hosted-surface);
}
.secondary-button:hover:not(:disabled) {
  border-color: #bfd2fb;
  background: var(--hosted-surface-subtle);
}
.workspace-panel {
  display: flex;
  width: 100%;
  height: 100%;
  min-height: 0;
  flex-direction: column;
  padding: 14px 20px 18px;
  overflow: hidden;
}
.workspace-panel--immersive {
  padding: 0 !important;
}
.panel-header {
  display: flex;
  min-height: 44px;
  flex: 0 0 auto;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  margin-bottom: 10px;
}
.panel-heading {
  display: flex;
  align-items: baseline;
  gap: 8px;
}
.panel-heading .eyebrow { margin: 0; }
.panel-heading h1 { font-size: 20px; }
.module-tabs {
  display: flex;
  max-width: 100%;
  align-items: center;
  gap: 4px;
  padding: 4px;
  overflow-x: auto;
  border: 1px solid var(--hosted-border);
  border-radius: 12px;
  background: var(--hosted-surface);
  scrollbar-width: none;
}
.module-tabs::-webkit-scrollbar { display: none; }
.module-tabs button {
  min-height: 36px;
  flex: 0 0 auto;
  padding: 0 13px;
  border: 0;
  border-radius: 9px;
  color: var(--hosted-muted);
  background: transparent;
  cursor: pointer;
  font: inherit;
  font-size: 13px;
  font-weight: 630;
  white-space: nowrap;
  transition: background-color 140ms ease, color 140ms ease;
}
.module-tabs button[aria-pressed="true"] {
  color: var(--hosted-primary);
  background: var(--hosted-primary-soft);
}
.workspace-module-host {
  position: relative;
  min-height: 0;
  flex: 1 1 auto;
  border: 1px solid var(--hosted-border);
  border-radius: 15px;
  background: var(--hosted-surface);
}
.workspace-module-host--scroller {
  overflow-x: hidden;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  overscroll-behavior: contain;
  touch-action: auto;
}
.workspace-module-host--bleed {
  overflow: hidden;
}
.workspace-module-host--immersive {
  border: 0;
  border-radius: 0;
}
.immersive-toggle-btn {
  position: absolute;
  top: 10px;
  right: 12px;
  z-index: 25;
  min-height: 32px;
  padding: 0 12px;
  border: 1px solid rgba(255, 255, 255, 0.28);
  border-radius: 999px;
  background: rgba(15, 23, 42, 0.68);
  backdrop-filter: blur(8px);
  color: #ffffff;
  font: inherit;
  font-size: 12px;
  font-weight: 620;
  cursor: pointer;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.25);
}
.immersive-toggle-btn:hover {
  background: rgba(15, 23, 42, 0.85);
}
.workspace-module-host :deep(.workspace-embedded-module) {
  min-width: 0;
  min-height: 100%;
  height: auto;
}
.workspace-module-host--bleed :deep(.workspace-embedded-module) {
  height: 100%;
  min-height: 0;
}
.module-empty-state {
  display: grid;
  min-height: 250px;
  align-content: center;
  justify-items: center;
  gap: 9px;
  padding: 24px;
  text-align: center;
}
.module-empty-state__symbol {
  display: grid;
  width: 42px;
  height: 42px;
  place-items: center;
  border-radius: 14px;
  color: var(--hosted-primary);
  background: var(--hosted-primary-soft);
  font-size: 26px;
}
.module-empty-state h2 {
  margin: 2px 0 0;
  color: var(--hosted-ink);
  font-size: 17px;
}
.module-empty-state p {
  margin: 0 0 4px;
  color: var(--hosted-muted);
  font-size: 12px;
}
.game-launch-state,
.multi-game-launch-setup {
  display: flex;
  min-height: 180px;
  flex: 0 0 auto;
  align-items: center;
  gap: 14px;
  margin: 12px;
  padding: 18px;
  border: 1px solid var(--hosted-border);
  border-radius: 14px;
  color: var(--hosted-ink);
  background: #fff;
}
.game-launch-state__mark {
  display: grid;
  width: 42px;
  height: 42px;
  flex: 0 0 auto;
  place-items: center;
  border-radius: 13px;
  background: var(--hosted-primary-soft);
}
.game-launch-state h2,
.multi-game-launch-setup h2 { margin: 0; font-size: 16px; }
.game-launch-state p,
.multi-game-launch-setup p { margin: 5px 0 0; color: var(--hosted-muted); font-size: 12px; line-height: 1.5; }
.game-launch-state button {
  min-height: 42px;
  flex: 0 0 auto;
  margin-left: auto;
  padding: 0 16px;
  border: 0;
  border-radius: 10px;
  color: #fff;
  background: var(--hosted-primary);
  cursor: pointer;
  font: inherit;
  font-size: 13px;
  font-weight: 630;
}
.game-launch-state button:disabled { opacity: .6; cursor: wait; }
.multi-game-launch-setup { align-items: stretch; flex-direction: column; }
.multi-game-setup-header { display: flex; align-items: flex-start; justify-content: space-between; flex-wrap: wrap; gap: 10px; }
.multi-game-setup-actions { display: flex; align-items: center; gap: 10px; }
.multi-game-count { color: var(--hosted-primary); font-size: 12px; font-weight: 650; }
.text-action-btn {
  padding: 2px 6px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--hosted-primary);
  font: inherit;
  font-size: 12px;
  font-weight: 630;
  cursor: pointer;
}
.text-action-btn:disabled { opacity: 0.45; cursor: not-allowed; }
.multi-game-account-list { display: grid; grid-template-columns: repeat(2, minmax(0,1fr)); gap: 8px; }
.multi-game-account-list label {
  display: flex;
  min-width: 0;
  min-height: 46px;
  align-items: center;
  gap: 9px;
  padding: 8px 11px;
  border: 1px solid var(--hosted-border);
  border-radius: 10px;
  background: #fff;
  cursor: pointer;
  transition: border-color 140ms ease, background-color 140ms ease;
}
.multi-game-account-list label.is-checked {
  border-color: #93bbf9;
  background: var(--hosted-primary-soft);
}
.multi-game-account-list input { width: 17px; height: 17px; accent-color: var(--hosted-primary); }
.multi-game-account-list__name { min-width: 0; flex: 1 1 auto; overflow: hidden; color: var(--hosted-ink); font-size: 13px; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
.multi-game-account-list small { color: var(--hosted-muted); font-size: 11px; white-space: nowrap; }
.multi-game-launch-setup > .primary-button { align-self: flex-start; min-height: 44px; }
.game-launch-error { color: var(--hosted-danger) !important; }
@media (max-width: 600px) {
  .game-launch-state { align-items: flex-start; flex-wrap: wrap; margin: 8px; padding: 15px; }
  .game-launch-state > div { flex: 1 1 calc(100% - 60px); }
  .game-launch-state button { width: 100%; margin-left: 0; }
  .multi-game-launch-setup { margin: 8px; padding: 14px; }
  .multi-game-account-list { grid-template-columns: minmax(0,1fr); }
  .multi-game-launch-setup > .primary-button { align-self: stretch; }
}
.mobile-tabs { display: none; }
@media (max-width: 900px) {
  .workspace-header { gap: 10px; padding-right: 14px; padding-left: 14px; }
  .desktop-tabs button { padding: 0 9px; }
}
@media (max-width: 760px) {
  .workspace-header {
    min-height: 52px;
    gap: 8px;
    padding: 6px 12px;
  }
  .brand-mark { width: 32px; height: 32px; border-radius: 10px; }
  .brand-mark img { width: 24px; height: 24px; }
  .brand-copy { gap: 0; }
  .brand-kicker { display: none; }
  .brand-copy strong { font-size: 13px; }
  .account-switcher {
    max-width: none;
    min-height: 36px;
    flex: 1 1 150px;
    padding: 2px 9px;
  }
  .account-switcher__label { font-size: 9px; }
  .account-switcher select { font-size: 12px; }
  .desktop-tabs { display: none; }
  .workspace-main { width: 100%; }
  .workspace-overview { padding: 16px 14px 20px; }
  .workspace-panel {
    padding: 8px 10px 8px;
    gap: 8px;
  }
  .overview-heading { align-items: flex-start; gap: 8px; margin-bottom: 14px; }
  .overview-heading h1 { max-width: 23ch; font-size: 21px; }
  .overview-heading p:last-child { font-size: 12px; }
  .connection-pill { min-height: 30px; gap: 5px; padding: 0 10px; font-size: 11px; }
  .overview-stats { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; margin-bottom: 12px; }
  .overview-stat { min-height: 88px; padding: 12px; border-radius: 13px; }
  .overview-stat--connection { grid-column: 1 / -1; min-height: 74px; }
  .overview-stat strong { font-size: 20px; }
  .overview-stat .overview-stat__server { font-size: 16px; }
  .overview-direct-grid { grid-template-columns: minmax(0, 1fr); gap: 8px; margin-bottom: 16px; }
  .direct-card { padding: 13px 14px; }
  .direct-card__actions button { flex: 1 1 auto; }
  .quick-action-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
  .quick-action { min-height: 68px; grid-template-columns: 34px minmax(0, 1fr); gap: 9px; padding: 11px; border-radius: 12px; }
  .quick-action__arrow { display: none; }
  .quick-action__icon { width: 34px; height: 34px; border-radius: 10px; font-size: 14px; }
  .quick-action strong { font-size: 13px; }
  .quick-action small { font-size: 10px; white-space: normal; }
  .runtime-note { margin-top: 16px; padding: 10px 11px; }
  .runtime-note p { font-size: 10px; }
  .empty-account-card { grid-template-columns: 36px minmax(0, 1fr); gap: 11px; padding: 15px; }
  .empty-account-card__mark { width: 36px; height: 36px; }
  .empty-account-card h2 { font-size: 14px; }
  .empty-account-card p { font-size: 11px; }
  .empty-account-card .primary-button,
  .empty-account-card .secondary-button { grid-column: 1 / -1; justify-self: stretch; }
  .panel-header {
    min-height: 0;
    margin: 0;
    padding: 0;
  }
  .panel-heading {
    display: none;
  }
  .module-tabs {
    width: 100%;
    display: grid;
    grid-auto-flow: column;
    grid-auto-columns: minmax(0, 1fr);
    padding: 3px;
    border-radius: 11px;
  }
  .module-tabs button {
    min-height: 36px;
    padding: 0 8px;
    font-size: 12.5px;
    text-align: center;
  }
  .workspace-module-host {
    border-radius: 13px;
  }
  .mobile-tabs {
    z-index: 50;
    display: grid;
    min-height: 58px;
    flex: 0 0 auto;
    grid-template-columns: repeat(5, minmax(0, 1fr));
    align-items: stretch;
    padding: 4px 6px calc(4px + env(safe-area-inset-bottom));
    border-top: 1px solid var(--hosted-border);
    background: #ffffff;
    box-shadow: 0 -4px 16px rgba(21, 37, 63, 0.055);
  }
  .mobile-tabs button {
    display: grid;
    min-width: 0;
    min-height: 48px;
    align-content: center;
    justify-items: center;
    gap: 2px;
    padding: 2px 3px;
    border: 0;
    border-radius: 11px;
    color: var(--hosted-muted);
    background: transparent;
    cursor: pointer;
    font: inherit;
    font-size: 11px;
    font-weight: 600;
  }
  .mobile-tabs button[aria-current="page"] {
    color: var(--hosted-primary);
    background: var(--hosted-primary-soft);
  }
  .mobile-tabs svg {
    width: 20px;
    height: 20px;
    fill: none;
    stroke: currentColor;
    stroke-linecap: round;
    stroke-linejoin: round;
    stroke-width: 1.7;
  }
}
@media (max-width: 380px) {
  .workspace-header { padding-right: 10px; padding-left: 10px; gap: 6px; }
  .brand-mark { width: 30px; height: 30px; }
  .brand-mark img { width: 23px; height: 23px; }
  .workspace-brand { gap: 6px; }
  .brand-copy strong { font-size: 12px; }
  .workspace-overview { padding-right: 11px; padding-left: 11px; }
  .workspace-panel { padding: 6px 8px; }
  .quick-action-grid { grid-template-columns: minmax(0, 1fr); }
  .mobile-tabs { padding-right: 3px; padding-left: 3px; }
  .mobile-tabs button { font-size: 10px; }
}
</style>
