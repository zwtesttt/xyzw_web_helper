<template>
  <section class="ten-palace" aria-label="十殿挑战">
    <div class="ten-palace__toolbar">
      <div>
        <strong>十殿挑战</strong>
        <span class="ten-palace__muted">{{ token?.name || "选择角色后读取状态" }}</span>
      </div>
      <n-button size="small" :loading="loading" :disabled="!connected || loading || roomLoading || busy || browserRunning" @click="refresh">
        刷新状态
      </n-button>
    </div>
    <n-alert v-if="!token" type="info" :show-icon="false">先选择游戏角色，再读取十殿状态。</n-alert>
    <n-alert v-else-if="!connected" type="warning" :show-icon="false">{{ connecting ? "当前角色正在连接游戏" : "当前角色未连接游戏，请重新选择该角色后再刷新" }}。十殿操作需要保持连接。</n-alert>
    <n-alert v-if="errorMessage" type="error" :show-icon="false">{{ errorMessage }}</n-alert>
    <n-alert v-if="snapshot && eligibility && !eligibility.allowed" type="warning" :show-icon="false">
      {{ eligibility.reason }}
    </n-alert>

    <n-tabs v-model:value="activeInnerTab" type="line" animated>
      <n-tab-pane name="challenge" tab="挑战">
        <n-card size="small" title="十殿房间状态">
          <p v-if="roomStatus.status === 'idle'" class="ten-palace__muted">选择并连接角色后读取房间状态。</p>
          <p v-else-if="roomStatus.status === 'reading-role'" class="ten-palace__muted">正在读取当前角色的房间信息…</p>
          <p v-else-if="roomStatus.status === 'offline'" class="ten-palace__muted">当前角色尚未连接，房间状态未知。</p>
          <p v-else-if="roomStatus.status === 'loading'" class="ten-palace__muted">已读取房间编号 {{ roomStatus.roomId }}，正在查询房间详情…</p>
          <n-alert v-else-if="roomStatus.status === 'error'" type="error" :show-icon="false">{{ roomStatus.message }}。房间状态未知，请确认角色在线后点“刷新状态”。</n-alert>
          <p v-else-if="roomStatus.status === 'no-room'" class="ten-palace__muted">游戏确认当前角色未进入十殿房间。{{ formattedRoomRefresh }}</p>
          <p v-else-if="roomStatus.status === 'ready' && !roomStatus.room" class="ten-palace__muted">{{ roomStatus.roomMessage }}。{{ formattedRoomRefresh }}</p>
          <div v-else-if="roomStatus.status === 'ready'" class="ten-palace__facts">
            <span>房间编号 <b class="ten-palace__wrap">{{ roomStatus.room.roomId }}</b></span>
            <span>房间状态 <b>{{ roomStateName(roomStatus.room.state) }}</b></span>
            <span>当前殿层 <b>{{ roomStatus.room.curMonsterCfgId ? bossName(roomStatus.room.curMonsterCfgId) : "—" }}</b></span>
            <span>队长 <b class="ten-palace__wrap">{{ roomStatus.room.leaderId || "—" }}</b></span>
            <span>当前出战者 <b class="ten-palace__wrap">{{ roomStatus.room.fighterId || "未选择" }}</b></span>
            <span>最近读取 <b>{{ formattedRoomRefresh }}</b></span>
          </div>
          <div v-if="showTeamActionShortcut" class="ten-palace__actions">
            <n-button size="small" :disabled="busy || !connected" @click="activeInnerTab = 'team'">{{ teamActionShortcutLabel }}</n-button>
          </div>
          <p v-if="roomStatus.status === 'ready' && room && room.state === 0" class="ten-palace__muted">
            {{ isLeader ? "房间已开启，等待队员安排出战。" : "房间已开启，等待队长安排出战。" }}
          </p>
        </n-card>
        <div class="ten-palace__grid">
          <n-card size="small" title="挑战进度">
            <div v-if="snapshot" class="ten-palace__facts">
              <span>类型 <b>{{ challengeName }}</b></span>
              <span>可用挑战次数 <b>{{ ticketCount === null ? "未读取" : ticketCount }}</b></span>
            </div>
            <n-skeleton v-else-if="loading" text :repeat="3" />
            <p v-else class="ten-palace__muted">刷新后显示游戏返回的实时状态。</p>
            <div class="ten-palace__actions">
              <n-select v-model:value="challengeId" size="small" :options="challengeOptions" :disabled="busy" />
              <n-button size="small" :disabled="!canChangeChallenge" @click="changeChallenge">切换挑战类型</n-button>
            </div>
          </n-card>
          <n-card size="small" title="十殿专用阵容">
            <p v-if="formation" class="ten-palace__muted">读取游戏保存的十殿专用阵容；启动组队任务时会原样应用到本次准备。</p>
            <p class="ten-palace__muted" aria-live="polite">{{ formationStatus }}</p>
            <div v-if="formation" class="ten-palace__formation">
              <span v-for="slot in formationSlots" :key="slot.position">{{ slot.position + 1 }}号位 · {{ heroName(slot.heroId) }}</span>
            </div>
            <p v-if="formation" class="ten-palace__wrap">武器 {{ formation.lordWeaponId || "—" }} · 宠物 UID {{ formation.petUId || "未设置" }}</p>
            <n-alert v-if="formationEmpty" type="info" :show-icon="false">游戏内还没有保存十殿挑战阵容。请先在游戏中保存阵容，再点“读取十殿阵容”。</n-alert>
            <n-alert v-else-if="formationError" type="warning" :show-icon="false">{{ formationError }}</n-alert>
            <n-button size="small" :loading="formationLoading" :disabled="!connected || busy || formationLoading" @click="readFormation">读取十殿阵容</n-button>
          </n-card>
        </div>
        <n-card v-if="room" size="small" title="当前房间操作" class="ten-palace__card-gap">
          <p class="ten-palace__muted">队长：{{ room.leaderId }} · 成员 {{ room.raw.fightRoleBase?.length || 0 }} 人</p>
          <n-alert v-if="teamEligibility && !teamEligibility.allowed" type="warning" :show-icon="false">{{ teamEligibility.reason }}</n-alert>
          <div class="ten-palace__actions">
            <n-button size="small" :disabled="!canSetFighter" @click="setSelfFighter">选择当前角色出战</n-button>
            <n-button size="small" type="primary" :disabled="!canFight" @click="fight">发起本角色挑战</n-button>
            <n-button size="small" :disabled="!canCompleteFight" @click="completeFight">确认本场战斗结果</n-button>
            <n-button size="small" :disabled="!canRestore" @click="restore">恢复当前角色</n-button>
            <n-button size="small" :disabled="!canClaimKill" @click="claimKillReward">领取击杀奖励</n-button>
            <n-button size="small" :disabled="!canClaimWeek" @click="claimWeekReward">领取周奖励</n-button>
          </div>
          <n-alert v-if="pendingFight" type="warning" :show-icon="false" class="ten-palace__alert">
            <span v-if="pendingFight.status === 'sending'">正在发送角色 {{ pendingFight.roleId }} 的挑战请求。</span>
            <span v-else>角色 {{ pendingFight.roleId }} 的挑战结果尚未确认，已刷新或正在等待房间状态。请勿重发；服务器确认战斗或房间/BOSS变化后才会解除保护。</span>
          </n-alert>
          <n-button v-if="isLeader" size="small" type="error" secondary class="ten-palace__dismiss" :disabled="busy" @click="dismissRoom">
            解散当前试炼房间
          </n-button>
        </n-card>
      </n-tab-pane>

      <n-tab-pane name="team" tab="队伍">
        <div class="ten-palace__grid">
          <n-card size="small" title="当前队伍">
            <p v-if="team" class="ten-palace__wrap">队伍 ID {{ field(team, "teamId", "—") }} · {{ teamStage === 0 ? "队员准备" : teamStage === 1 ? "等待队员确认" : `状态 ${field(team, "state", "未知")}` }} · 队长 {{ field(team, "leaderId", "—") }}</p>
            <n-alert v-else-if="teamStatus.status === 'error'" type="error" :show-icon="false">{{ teamStatus.message }}。队伍状态未知，刷新成功后再操作。</n-alert>
            <p v-else-if="teamStatus.status === 'none'" class="ten-palace__muted">游戏确认当前角色未加入十殿准备队伍。</p>
            <p v-else class="ten-palace__muted">{{ teamStatus.status === "loading" ? "正在读取队伍状态…" : "队伍状态尚未读取。" }}</p>
            <n-alert v-if="team && !verifiedTeam" type="warning" :show-icon="false">队伍详情不完整或当前角色不在成员列表中，暂不开放准备/确认操作。请刷新状态。</n-alert>
            <div v-if="team" class="ten-palace__members">
              <div v-for="(member, index) in teamRows" :key="String(field(member, 'roleId', index))">
                <span>{{ index + 1 }}. {{ field(member, "name", field(member, "roleId", "未知成员")) }}</span>
                <n-tag size="small" :type="String(field(member, 'roleId', '')) === String(field(team, 'leaderId', '')) || memberPreparedValue(member, verifiedTeam) === true ? 'success' : 'default'">
                  {{ String(field(member, 'roleId', '')) === String(field(team, 'leaderId', '')) ? "队长" : memberPreparedValue(member, verifiedTeam) === true ? (teamStage === 1 ? "已确认" : "已准备") : memberPreparedValue(member, verifiedTeam) === false ? (teamStage === 1 ? "待确认" : "未准备") : "状态未知" }}
                </n-tag>
              </div>
            </div>
            <div class="ten-palace__actions">
              <n-input v-model:value="joinTeamId" size="small" placeholder="输入队伍 ID" />
              <n-button size="small" :disabled="!connected || busy || roomStatus.status !== 'no-room' || teamStatus.status !== 'none' || !joinTeamId.trim() || room" @click="joinTeam">加入队伍</n-button>
              <n-button v-if="!team" size="small" type="primary" :disabled="!canCreateTeam" @click="createTeam">创建十殿队伍</n-button>
              <n-button v-if="team && verifiedTeam && teamStage === 0 && !isLeader" size="small" :disabled="busy || !connected || !roomClear || isPrepared || room" @click="prepareTeam">{{ isPrepared ? "已准备" : "准备" }}</n-button>
              <n-button v-if="team && verifiedTeam && teamStage === 0 && isLeader" size="small" type="primary" :disabled="busy || !allPrepared || !roomClear || room || !teamEligibility.allowed" @click="openTeam">开启挑战</n-button>
              <n-button v-if="team && verifiedTeam && teamStage === 1 && !isLeader" size="small" type="primary" :disabled="busy || !connected || !roomClear || isPrepared || room" @click="confirmTeam">{{ isPrepared ? "已确认" : "确认加入挑战" }}</n-button>
              <n-button v-if="team && verifiedTeam && teamStage === 1 && isLeader" size="small" type="warning" :disabled="busy || !connected || !roomClear || room" @click="stopOpenTeam">取消等待</n-button>
              <n-button v-if="team && !isLeader && !room" size="small" type="error" secondary :disabled="busy || !connected || !roomClear" @click="leaveTeam">离开队伍</n-button>
              <n-button v-if="team && teamStage === 0 && isLeader && !room" size="small" type="error" secondary :disabled="busy || !connected || !roomClear" @click="dismissPreparedTeam">解散准备队伍</n-button>
            </div>
          </n-card>
          <n-card size="small" title="游戏账号固定队伍">
            <p class="ten-palace__muted">浏览器组队仅在页面打开且所选角色已连接时运行；服务器计划可在 App 关闭后执行。</p>
            <n-select v-model:value="selectedLocalTeam" multiple size="small" :options="localTeamOptions" placeholder="选择 2–5 个本地账号（顺序即出战顺序）" :disabled="browserRunning" />
            <n-select v-model:value="browserLeaderTokenId" size="small" :options="browserLeaderOptions" placeholder="选择队长账号" :disabled="browserRunning || !selectedLocalTeam.length" />
            <div class="ten-palace__actions">
              <n-button size="small" type="primary" :disabled="!canRunBrowserTeam" :loading="browserRunning" @click="runBrowserTeam">在浏览器协调运行</n-button>
              <n-button v-if="browserRunning" size="small" type="error" @click="stopBrowserTeam">停止本次队伍</n-button>
              <n-button size="small" :disabled="busy" @click="loadHostedPlans">刷新服务器计划</n-button>
              <n-button size="small" :disabled="busy" @click="toggleHostedPlanForm">{{ showPlanForm ? "收起计划" : "新建服务器计划" }}</n-button>
            </div>
            <div class="ten-palace__local-plan">
              <b>本机每日计划</b>
              <p class="ten-palace__muted">只在此页面打开期间按北京时间触发；本机计划不保存账号凭据。</p>
              <div class="ten-palace__actions">
                <n-input v-model:value="localPlanName" size="small" placeholder="本机计划名称" />
                <n-time-picker v-model:formatted-value="localPlanTime" value-format="HH:mm" size="small" format="HH:mm" />
                <n-button size="small" :disabled="!canRunBrowserTeam" @click="saveLocalPlan">保存本机计划</n-button>
              </div>
              <article v-for="plan in localPlans" :key="plan.id">
                <div><b>{{ plan.name }}</b><small>每天 {{ plan.time }} 北京时间 · {{ plan.accountIds.length }} 个本地账号</small></div>
                <n-switch :value="plan.enabled" @update:value="(value) => toggleLocalPlan(plan.id, value)" />
                <n-button size="small" :disabled="browserRunning" @click="runLocalPlan(plan)">立即运行</n-button>
                <n-button size="small" type="error" @click="deleteLocalPlan(plan.id)">删除</n-button>
              </article>
            </div>
            <div v-if="showPlanForm" class="ten-palace__plan-form">
              <n-input v-model:value="planForm.name" size="small" placeholder="计划名称" />
              <n-select v-model:value="planForm.accountIds" multiple size="small" :options="hostedAccountOptions" placeholder="选择 2–5 个服务器账号" />
              <n-select v-model:value="planForm.memberOrder" multiple size="small" :options="hostedAccountOptions" placeholder="出战顺序（按选择顺序，需包含全部账号）" />
              <label class="ten-palace__plan-limit"><span>计划状态</span><n-switch v-model:value="planEnabled"><template #checked>启用</template><template #unchecked>停用</template></n-switch></label>
              <label class="ten-palace__plan-limit">
                <span>单次队伍运行上限（分钟）</span>
                <n-input-number v-model:value="runLimitMinutes" :min="1" :max="120" />
              </label>
              <div class="ten-palace__actions">
                <n-select v-model:value="planForm.leaderAccountId" size="small" :options="leaderOptions" placeholder="选择队长" />
                <n-select v-model:value="planForm.scheduleType" size="small" :options="[{label:'每天',value:'daily'},{label:'Cron',value:'cron'}]" />
                <n-time-picker v-if="planForm.scheduleType === 'daily'" v-model:formatted-value="planForm.time" value-format="HH:mm" size="small" format="HH:mm" />
                <n-input v-else v-model:value="planForm.expression" size="small" placeholder="分 时 日 月 周" />
              </div>
              <n-button size="small" type="primary" :disabled="busy" @click="saveHostedPlan">保存服务器计划</n-button>
            </div>
            <n-alert v-if="planError" type="info" :show-icon="false" class="ten-palace__alert">{{ planError }} <router-link to="/server">前往托管登录</router-link></n-alert>
            <div v-if="hostedPlans.length" class="ten-palace__plans">
              <article v-for="plan in hostedPlans" :key="plan.id">
                <div><b>{{ plan.name }}</b><small>{{ plan.schedule.type === 'daily' ? `每天 ${plan.schedule.value.split(' ')[1].padStart(2,'0')}:${plan.schedule.value.split(' ')[0].padStart(2,'0')}` : plan.schedule.value }} · {{ plan.accountIds.length }} 个账号</small></div>
                <n-button size="small" type="primary" :disabled="busy" @click="runHostedPlan(plan)">运行一次</n-button>
                <n-button size="small" :disabled="busy" @click="editHostedPlan(plan)">编辑</n-button>
                <n-button size="small" type="error" :disabled="busy" @click="deleteHostedPlan(plan)">删除</n-button>
              </article>
            </div>
          </n-card>
        </div>
      </n-tab-pane>

      <n-tab-pane name="charms" tab="符咒">
        <div v-if="snapshot" class="ten-palace__facts ten-palace__facts--summary">
          <span>好心值 <b>{{ snapshot.role.kindness }}</b></span>
          <span>有效周 <b>{{ snapshot.role.charms[1]?.validThisWeek ? "本周" : "未刷新/已过期" }}</b></span>
          <span>区域商店余量 <b>{{ market ? "已读取" : "未读取" }}</b></span>
        </div>
        <div class="ten-palace__actions ten-palace__charm-actions">
          <n-button size="small" type="primary" :disabled="!giftStates.some((gift) => gift.eligible) || busy" @click="claimFreeCharms">一键领取可领免费符</n-button>
          <n-button size="small" :disabled="!snapshot || busy" @click="refreshCharmMarket">读取区域商店余量</n-button>
        </div>
        <div v-if="giftStates.length" class="ten-palace__gift-list">
          <div v-for="gift in giftStates" :key="gift.giftId">
            <span>第 {{ gift.charmId }} 殿免费符 · {{ gift.eligible ? "可领取" : gift.reason }}</span>
            <n-button size="small" :disabled="!gift.eligible || busy" @click="claimOneGift(gift)">领取</n-button>
          </div>
        </div>
        <div class="ten-palace__charm-grid">
          <n-card v-for="charm in charms" :key="charm.id" size="small" class="ten-palace__charm-card">
            <div class="ten-palace__charm-heading"><b>{{ charm.name }}</b><n-tag size="small">第 {{ charm.id }} 殿</n-tag></div>
            <p>持有 {{ snapshot?.role.charms[charm.id]?.amount ?? "—" }} · 区域余量 {{ stockLabel(charm.id) }}</p>
            <p class="ten-palace__muted">{{ charm.description || "效果与解锁条件以游戏配置为准" }}</p>
            <div class="ten-palace__buy-row">
              <n-input-number v-model:value="buyCounts[charm.id]" :min="1" :max="50" size="small" :disabled="busy" />
              <span>{{ charm.NewConsumeNum * (buyCounts[charm.id] || 1) }} 好心值</span>
              <n-button size="small" :disabled="!canBuy(charm.id)" @click="buyCharm(charm.id)">兑换</n-button>
            </div>
          </n-card>
        </div>
        <details class="ten-palace__settings">
          <summary>托管自动补符设置（默认关闭）</summary>
          <div class="ten-palace__settings-grid">
            <n-switch v-model:value="autoClaimCharms" />
            <span>自动领取符合条件的免费符</span>
            <n-switch v-model:value="claimKillRewardsEnabled" />
            <span>自动领取已达成的十殿击杀奖励</span>
            <n-switch v-model:value="requireCharm" />
            <span>没有当前殿符咒时暂停挑战</span>
            <n-switch v-model:value="preferCharm" />
            <span>优先安排持有当前殿符咒的角色</span>
            <n-switch v-model:value="autoBuy" />
            <span>开启后只补当前殿层对应的符</span>
            <n-switch v-model:value="claimWeekRewardEnabled" />
            <span>房间结束后领取可领周奖励</span>
            <n-input-number v-model:value="kindnessBudget" :min="0" :max="1000000" />
            <span>每角色好心值预算</span>
            <n-input-number v-model:value="maxBuyPerCharm" :min="0" :max="50" />
            <span>每角色每殿单次补充上限</span>
            <n-input-number v-model:value="restoreLimit" :min="0" :max="5" />
            <span>自动恢复次数上限（0 表示关闭）</span>
            <n-input-number v-model:value="runLimitMinutes" :min="1" :max="120" />
            <span>单次队伍运行上限（分钟）</span>
          </div>
          <div class="ten-palace__settings-charms" aria-label="各殿符咒目标库存">
            <label v-for="charm in charms" :key="charm.id"><span>{{ charm.name }}目标库存</span><n-input-number v-model:value="charmTargets[charm.id]" :min="0" :max="50" :disabled="busy || browserRunning" /></label>
          </div>
          <n-button size="small" :disabled="busy || browserRunning" @click="saveAutomationSettings">保存设置</n-button>
        </details>
      </n-tab-pane>

      <n-tab-pane name="records" tab="记录">
        <n-card size="small" title="本次操作记录">
          <div v-if="records.length" class="ten-palace__records">
            <p v-for="(item, index) in records" :key="index" :class="`ten-palace__record--${item.type}`"><time>{{ item.time }}</time> {{ item.text }}</p>
          </div>
          <p v-else class="ten-palace__muted">刷新、队伍操作、符咒和战斗确认结果会记录在这里。</p>
        </n-card>
      </n-tab-pane>
    </n-tabs>
  </section>
</template>

<script setup>
import { useDialog, useMessage } from "naive-ui";
import { computed, onActivated, onDeactivated, onMounted, onUnmounted, reactive, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useTokenStore } from "@/stores/tokenStore";
import { HERO_DICT } from "@/utils/HeroList.js";
import { hostedRequest } from "@/utils/serverBatchPlans.js";
import {
  buyTenPalaceCharm, challengeEligibility, charmFestivalActive,
  charmGiftEligibility, charmMarketStock, charmPurchasePreview, countRoleItem, currentLegionSeason,
  entriesOf, field, hasClaimableTenPalaceWeekReward, isBoss12RoleBlocked,
  isMatchingTenPalaceFightNotification, loadTenPalaceConfig, normalizeTenPalaceOptions, parseRolePayload,
  parseRoleTenPalaceTeamId, parseRoomFighterResult, parseTenPalaceFormation,
  parseTenPalaceRoleState, parseTenPalaceRoom, requiredEntryItems,
  roomHasSurvivingHero, runTenPalaceTeam, teamCreateParams,
  teamJoinParams, TEN_PALACE_DEFAULTS, tenPalaceBattlePresentation, tenPalaceServerId,
  toGameRoleId,
} from "@/utils/tenPalace.js";

const tokenStore = useTokenStore();
const route = useRoute();
const router = useRouter();
const message = useMessage();
const dialog = useDialog();
const token = computed(() => tokenStore.selectedToken || null);
const tokenId = computed(() => token.value?.id || "");
const connectionStatus = computed(() => tokenId.value ? tokenStore.getWebSocketStatus(tokenId.value) : "disconnected");
const connected = computed(() => connectionStatus.value === "connected");
const connecting = computed(() => connectionStatus.value === "connecting");
const loading = ref(false);
const roomLoading = ref(false);
const formationLoading = ref(false);
const busy = ref(false);
const errorMessage = ref("");
const formationError = ref("");
const formationEmpty = ref(false);
const formationStatus = ref("等待读取游戏内保存的十殿专用阵容。");
const formationUpdatedAt = ref(0);
const snapshot = ref(null);
const snapshotTokenId = ref("");
const formation = ref(null);
const room = ref(null);
const team = ref(null);
const roomStatus = ref({ status: "idle", roomId: "", room: null, message: "", updatedAt: 0 });
const teamStatus = ref({ status: "idle", message: "" });
const market = ref(null);
const challengeId = ref(1);
const joinTeamId = ref("");
const fightWriteGuards = ref(new Map());
const generation = ref(0);
const activeController = ref(null);
let activeOperation = null;
let formationRequest = null;
let teamNotificationUnsubscribe = null;
let teamNotificationRefreshTimer = null;
const records = ref([]);
const selectedLocalTeam = ref([]);
const browserLeaderTokenId = ref("");
const browserRunning = ref(false);
const browserCheckpoint = ref(null);
const activeInnerTab = ref("challenge");
const localPlans = ref(readLocalPlans());
const localPlanName = ref("十殿本机计划");
const localPlanTime = ref("08:00");
const localScheduleTimer = ref(null);
const hostedPlans = ref([]);
const handledPlanQueryId = ref("");
const hostedAccounts = ref([]);
const showPlanForm = ref(false);
const planError = ref("");
const editingPlanId = ref("");
const planEnabled = ref(true);
const planForm = reactive({ name: "十殿定时挑战", accountIds: [], memberOrder: [], leaderAccountId: "", scheduleType: "daily", time: "08:00", expression: "0 8 * * *" });
const buyCounts = reactive({ 1: 1, 2: 1, 3: 1, 4: 1, 5: 1, 6: 1 });
const charmTargets = reactive({ 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 });
const autoBuy = ref(false);
const autoClaimCharms = ref(TEN_PALACE_DEFAULTS.autoClaimCharms);
const claimKillRewardsEnabled = ref(TEN_PALACE_DEFAULTS.claimKillRewards);
const claimWeekRewardEnabled = ref(TEN_PALACE_DEFAULTS.claimWeekReward);
const requireCharm = ref(TEN_PALACE_DEFAULTS.requireCharm);
const preferCharm = ref(TEN_PALACE_DEFAULTS.preferCharm);
const restoreLimit = ref(TEN_PALACE_DEFAULTS.restoreLimit);
const runLimitMinutes = ref(TEN_PALACE_DEFAULTS.runLimitMinutes);
const kindnessBudget = ref(0);
const maxBuyPerCharm = ref(TEN_PALACE_DEFAULTS.maxBuyPerCharm);
const challengeOptions = computed(() => (snapshot.value?.config.challenges || [
  { id: 1, name: "十殿试炼1-8" }, { id: 9, name: "平等王挑战" },
]).map((item) => ({ label: item.name, value: item.id })));
const challenge = computed(() => snapshot.value?.config.challenges.find((item) => item.id === challengeId.value));
const challengeName = computed(() => challenge.value?.name || `挑战 ${challengeId.value}`);
const teamConfig = computed(() => snapshot.value?.config.teams.find((item) => item.matchTeamType === 1));
const currentRoleId = computed(() => String(field(snapshot.value?.roleInfo, "roleId", token.value?.roleId || "")));
function teamRowsOf(teamData) {
  const rows = field(teamData, "fightRoleBase", []);
  if (Array.isArray(rows)) return rows.filter((row) => row && typeof row === "object");
  if (rows instanceof Map) return [...rows.values()].filter((row) => row && typeof row === "object");
  if (rows && typeof rows === "object") return Object.values(rows).filter((row) => row && typeof row === "object");
  return [];
}
function teamMemberId(member) { return String(field(member, "roleId", "")); }
function memberPreparedValue(member, allowDefault = false) {
  const value = field(member, "prepared", undefined);
  if (value === undefined || value === null || value === "") return allowDefault ? false : null;
  if (value === true || String(value).toLowerCase() === "true") return true;
  if (value === false || String(value).toLowerCase() === "false") return false;
  const normalized = Number(value);
  return normalized === 1 ? true : normalized === 0 ? false : null;
}
function isCompleteTeamInfo(teamData, expectedTeamId, roleId) {
  const rows = teamRowsOf(teamData);
  return Boolean(teamData && String(expectedTeamId || "") && String(roleId || "") &&
    String(field(teamData, "teamId", "")) === String(expectedTeamId) &&
    String(field(teamData, "leaderId", "")) && rows.length &&
    rows.some((member) => teamMemberId(member) === String(roleId)));
}
const teamRows = computed(() => teamRowsOf(team.value));
const verifiedTeam = computed(() => Boolean(teamStatus.value.status === "ready" && team.value &&
  isCompleteTeamInfo(team.value, field(team.value, "teamId", ""), currentRoleId.value)));
function teamStateValue(teamData, allowDefault = false) {
  const state = field(teamData, "state", undefined);
  if ((state === undefined || state === null || state === "") && allowDefault) return 0;
  if (typeof state !== "number" && !(typeof state === "string" && /^\d+$/.test(state.trim()))) return -1;
  const normalized = Number(state);
  return normalized === 0 || normalized === 1 ? normalized : -1;
}
const teamStage = computed(() => teamStateValue(team.value, verifiedTeam.value));
const isLeader = computed(() => Boolean(team.value && String(field(team.value, "leaderId", "")) === currentRoleId.value));
const selectedTeamRole = computed(() => teamRows.value.find((item) => teamMemberId(item) === currentRoleId.value) || null);
const teamMemberCount = computed(() => teamRows.value.length);
const roomClear = computed(() => roomStatus.value.status === "no-room");
const formattedRoomRefresh = computed(() => roomStatus.value.updatedAt
  ? new Date(roomStatus.value.updatedAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })
  : "等待读取");
const isPrepared = computed(() => verifiedTeam.value && memberPreparedValue(selectedTeamRole.value, true) === true);
const allPrepared = computed(() => Boolean(verifiedTeam.value && teamMemberCount.value >= (teamConfig.value?.memberMin || 2) &&
  teamRows.value.every((item) => teamMemberId(item) === String(field(team.value, "leaderId", "")) || memberPreparedValue(item, true) === true)));
const showTeamActionShortcut = computed(() => Boolean(verifiedTeam.value && roomClear.value && !room.value && connected.value && [0, 1].includes(teamStage.value)));
const teamActionShortcutLabel = computed(() => teamStage.value === 0
  ? isLeader.value ? (allPrepared.value ? "前往队伍开启挑战" : "前往队伍查看准备进度") : isPrepared.value ? "前往队伍查看准备状态" : "前往队伍准备"
  : isLeader.value ? "前往队伍查看确认进度" : isPrepared.value ? "前往队伍查看确认状态" : "前往队伍确认");
const pendingFight = computed(() => {
  if (!room.value || !tokenId.value) return null;
  return [...fightWriteGuards.value.values()].find((item) => item.tokenId === String(tokenId.value) &&
    item.roomId === String(room.value.roomId) && item.bossId === Number(room.value.curMonsterCfgId)) || null;
});
const canChangeChallenge = computed(() => Boolean(snapshot.value && roomClear.value && verifiedTeam.value && isLeader.value && teamStage.value === 0 && !busy.value && snapshot.value.config.challenges.some((item) => item.id === challengeId.value)));
const eligibility = computed(() => {
  if (!challenge.value || !snapshot.value) return null;
  if (Number(challenge.value.extParam) !== 2) return { allowed: true, reason: "" };
  return selectedTeamRole.value ? challengeEligibility(selectedTeamRole.value, challenge.value) : { allowed: false, reason: "加入十殿队伍后读取平等王资格" };
});
const teamEligibility = computed(() => {
  if (!challenge.value || !team.value) return { allowed: false, reason: "请先读取队伍资格" };
  if (Number(challenge.value.extParam) !== 2) return { allowed: true, reason: "" };
  const members = teamRows.value;
  if (!members.length) return { allowed: false, reason: "无法读取队伍资格" };
  for (const row of members) {
    const result = challengeEligibility(row, challenge.value);
    if (!result.allowed) return { allowed: false, reason: `${row.name || row.roleId}：${result.reason}` };
  }
  return { allowed: true, reason: "" };
});
const giftStates = computed(() => snapshot.value ? charmGiftEligibility({ config: snapshot.value.config, roleInfo: snapshot.value.roleInfo, roleState: snapshot.value.role, season: snapshot.value.season }) : []);
const canCreateTeam = computed(() => Boolean(snapshot.value && roomClear.value && teamStatus.value.status === "none" && connected.value && !team.value && !busy.value));
const ticketCount = computed(() => challenge.value && snapshot.value ? countRoleItem(snapshot.value.rolePayload, challenge.value.useItem) : null);
const canSetFighter = computed(() => Boolean(snapshot.value && roomStatus.value.status === "ready" && room.value?.state === 0 && isLeader.value && connected.value && !busy.value && !pendingFight.value && roomHasSurvivingHero(room.value, token.value?.roleId) && !parseRoomFighterResult(room.value, token.value?.roleId) && !isBoss12RoleBlocked(room.value, token.value?.roleId)));
const canFight = computed(() => Boolean(snapshot.value && roomStatus.value.status === "ready" && room.value?.state === 0 && room.value.fighterId === String(token.value?.roleId) && connected.value && !busy.value && !pendingFight.value && roomHasSurvivingHero(room.value, token.value?.roleId) && !parseRoomFighterResult(room.value, token.value?.roleId) && !isBoss12RoleBlocked(room.value, token.value?.roleId)));
function completeFightReady(roomData = room.value) {
  const serverNow = Number(tokenStore.getWebSocketClient(tokenId.value)?.serverTime || Date.now());
  return Boolean(roomData?.state === 1 && String(roomData.leaderId) === String(token.value?.roleId) &&
    parseRoomFighterResult(roomData, roomData.fighterId) && tenPalaceBattlePresentation(roomData, challenge.value, serverNow).ready);
}
function restoreReady(roomData = room.value) {
  if (!roomData || !snapshot.value || String(roomData.leaderId) !== String(token.value?.roleId) || !connected.value) return false;
  const boss = snapshot.value.config.monsters.find((item) => item.id === roomData.curMonsterCfgId);
  return Number.isInteger(Number(boss?.restoreHpLimit)) && roomData.restoreCnt < Number(boss.restoreHpLimit) && roomHasDamagedCurrentRole(roomData, token.value?.roleId);
}
const canCompleteFight = computed(() => Boolean(snapshot.value && roomStatus.value.status === "ready" && !busy.value && completeFightReady()));
const canRestore = computed(() => Boolean(snapshot.value && roomStatus.value.status === "ready" && !busy.value && restoreReady()));
const canClaimKill = computed(() => Boolean(snapshot.value && entriesOf(snapshot.value.role.raw.killAward || new Map(), "击杀奖励").some(([, value]) => value === false || value === 0)));
const canClaimWeek = computed(() => Boolean(snapshot.value && hasClaimableTenPalaceWeekReward(snapshot.value.weekAward) && connected.value && !busy.value));
const localTeamOptions = computed(() => (tokenStore.gameTokens || []).map((item) => ({ label: `${item.name} · ${item.roleId}`, value: item.id, disabled: tokenStore.getWebSocketStatus(item.id) !== "connected" })));
const browserLeaderOptions = computed(() => localTeamOptions.value.filter((item) => selectedLocalTeam.value.includes(item.value)));
const hostedAccountOptions = computed(() => hostedAccounts.value.map((item) => ({ label: `${item.name} · ${item.server}`, value: item.id })));
const leaderOptions = computed(() => hostedAccountOptions.value.filter((item) => planForm.accountIds.includes(item.value)));
const charms = computed(() => snapshot.value?.config.charms.map((item) => ({ ...item, name: charmName(item.id), description: charmDescription(item.id) })) || []);
const formationSlots = computed(() => formation.value ? [...formation.value.battleTeam].map(([position, heroId]) => ({ position, heroId })) : []);
const canRunBrowserTeam = computed(() => selectedLocalTeam.value.length >= 2 && selectedLocalTeam.value.length <= 5 && selectedLocalTeam.value.every((id) => tokenStore.getWebSocketStatus(id) === "connected") && !browserRunning.value && !busy.value);

function charmName(id) { return ({ 1:"玄灵咒·壹",2:"落幡咒·贰",3:"九星咒·叁",4:"祝香咒·肆",5:"金光咒·伍",6:"净身咒·陆" })[id] || `符咒${id}`; }
function charmDescription(id) { return ({ 1:"第一殿对应符咒",2:"第二殿对应符咒",3:"第三殿对应符咒",4:"第四殿对应符咒",5:"第五殿对应符咒",6:"第六殿对应符咒" })[id] || ""; }
function bossName(id) { return snapshot.value?.config.monsters?.find((item) => item.id === id)?.name || `BOSS ${id}`; }
function roomStateName(state) { return ({ 0:"待出战", 1:"战斗中或等待结果", 2:"结算中", 3:"已关闭" })[state] || "未知状态"; }
function heroName(id) { return HERO_DICT[id]?.name || `武将 ${id}`; }
function stockLabel(id) { return market.value ? charmMarketStock(market.value, id) ?? "未知" : "未读取"; }
function log(text, type = "info") { records.value = [{ time: new Date().toLocaleTimeString(), text, type }, ...records.value].slice(0, 80); }
function assertCurrent(id, expectedGeneration = (activeOperation?.tokenId === id ? activeOperation.generation : generation.value)) {
  if (!id || id !== tokenId.value || expectedGeneration !== generation.value || tokenStore.getWebSocketStatus(id) !== "connected") throw new Error("角色已切换、连接已断开或操作已取消");
}
function send(id, cmd, params = {}, timeout = 12000) {
  const expectedGeneration = activeOperation?.generation ?? generation.value;
  if (activeOperation && id !== activeOperation.tokenId) throw new Error("当前操作角色已切换，已停止后续写入");
  assertCurrent(id, expectedGeneration);
  return tokenStore.sendMessageWithPromise(id, cmd, params, timeout).then((result) => {
    assertCurrent(id, expectedGeneration);
    return result;
  });
}

async function readRole(id = tokenId.value, expectedGeneration) {
  if (activeOperation && id !== activeOperation.tokenId) throw new Error("当前操作角色已切换，已停止后续读取和写入");
  expectedGeneration ??= activeOperation?.generation ?? generation.value;
  assertCurrent(id, expectedGeneration);
  const tokenRecord = (tokenStore.gameTokens || []).find((item) => item.id === id);
  const rolePayload = await tokenStore.sendMessageWithPromise(id, "role_getroleinfo", {}, 15000);
  assertCurrent(id, expectedGeneration);
  const info = parseRolePayload(rolePayload);
  const returnedRoleId = String(field(info, "roleId", ""));
  const expectedRoleId = String(tokenRecord?.roleId || returnedRoleId);
  if (expectedRoleId && returnedRoleId && returnedRoleId !== expectedRoleId) throw new Error("服务器返回了其他角色，停止十殿操作");
  const nightmarePayload = await tokenStore.sendMessageWithPromise(id, "nightmare_getroleinfo", { roleId: toGameRoleId(expectedRoleId) }, 15000);
  assertCurrent(id, expectedGeneration);
  const nightmareInfo = field(nightmarePayload, "nightMareData");
  if (!nightmareInfo || typeof nightmareInfo !== "object" || Array.isArray(nightmareInfo))
    throw new Error("游戏未返回当前角色的十殿资料，无法确认房间状态");
  const state = parseTenPalaceRoleState(nightmarePayload);
  const rawRoomId = field(nightmareInfo, "roomId", "");
  if (rawRoomId !== "" && rawRoomId !== null && rawRoomId !== undefined && rawRoomId !== 0 && rawRoomId !== "0" &&
      typeof rawRoomId !== "string" && !(typeof rawRoomId === "number" && Number.isSafeInteger(rawRoomId) && rawRoomId > 0))
    throw new Error("游戏返回的十殿房间编号格式无效");
  state.roomId = rawRoomId === null || rawRoomId === undefined || rawRoomId === 0 || rawRoomId === "0" ? "" : String(rawRoomId).trim();
  if (state.roleId && expectedRoleId && state.roleId !== expectedRoleId) throw new Error("十殿资料角色与当前账号不一致");
  return { info, rolePayload, state, payload: nightmarePayload };
}

function publishRoomResult(id, requestGeneration, freshRoom) {
  if (requestGeneration !== generation.value || id !== tokenId.value) return false;
  reconcileFightGuards(id, freshRoom);
  room.value = freshRoom.state < 2 ? freshRoom : null;
  roomStatus.value = {
    status: "ready", roomId: freshRoom.roomId, room: freshRoom,
    roomMessage: freshRoom.state === 2 ? "十殿已结算" : freshRoom.state === 3 ? "十殿房间已关闭" : "",
    message: "", updatedAt: Date.now(),
  };
  return true;
}

function publishNoRoom(id, requestGeneration) {
  if (requestGeneration !== generation.value || id !== tokenId.value) return false;
  reconcileFightGuards(id, null);
  room.value = null;
  roomStatus.value = { status: "no-room", roomId: "", room: null, message: "", updatedAt: Date.now() };
  return true;
}

async function readRoomForRefresh(id, roomId, requestGeneration) {
  if (requestGeneration !== generation.value || id !== tokenId.value) return;
  roomStatus.value = { status: "loading", roomId, room: null, message: "", updatedAt: 0 };
  try {
    const response = await tokenStore.sendMessageWithPromise(id, "nightmare_getroominfo", { roomId }, 12000);
    assertCurrent(id, requestGeneration);
    const freshRoom = parseTenPalaceRoom(response);
    if (!freshRoom.roomId || freshRoom.roomId !== String(roomId)) throw new Error("游戏返回的房间编号与当前角色不一致");
    publishRoomResult(id, requestGeneration, freshRoom);
  } catch (error) {
    if (requestGeneration !== generation.value || id !== tokenId.value) return;
    room.value = null;
    roomStatus.value = { status: "error", roomId, room: null, message: error.message || "游戏房间查询失败", updatedAt: 0 };
  } finally {
    if (requestGeneration === generation.value && id === tokenId.value) roomLoading.value = false;
  }
}

async function refresh({ throwOnError = false, allowDuringBrowserRun = false } = {}) {
  if (browserRunning.value && !allowDuringBrowserRun) return;
  const id = tokenId.value;
  if (!id || !connected.value) return;
  const requestGeneration = ++generation.value;
  formationLoading.value = false;
  loading.value = true;
  roomLoading.value = true;
  errorMessage.value = "";
  snapshot.value = null;
  snapshotTokenId.value = "";
  room.value = null;
  team.value = null;
  formation.value = null;
  formationError.value = "";
  formationEmpty.value = false;
  formationUpdatedAt.value = 0;
  formationStatus.value = "正在读取当前角色的十殿专用阵容…";
  market.value = null;
  roomStatus.value = { status: "reading-role", roomId: "", room: null, message: "", updatedAt: 0 };
  teamStatus.value = { status: "loading", message: "" };
  let formationReadStarted = false;
  try {
    const profile = await readRole(id, requestGeneration);
    assertCurrent(id, requestGeneration);
    const verifiedRoleId = toGameRoleId(profile.info.roleId || token.value?.roleId);
    formationReadStarted = true;
    void loadFormation(id, requestGeneration, verifiedRoleId);
    const currentRoomId = String(profile.state.roomId || "").trim();
    const roomTask = currentRoomId && currentRoomId !== "0"
      ? readRoomForRefresh(id, currentRoomId, requestGeneration)
      : Promise.resolve(publishNoRoom(id, requestGeneration));

    void loadRefreshDetails(id, requestGeneration, profile);
    await roomTask;
    assertCurrent(id, requestGeneration);
    if (throwOnError && roomStatus.value.status === "error") throw new Error(roomStatus.value.message);
    if (roomStatus.value.status === "ready" || roomStatus.value.status === "no-room") {
      log("十殿房间状态已读取");
    }
  } catch (error) {
    if (requestGeneration === generation.value) {
      snapshot.value = null;
      snapshotTokenId.value = "";
      team.value = null;
      room.value = null;
      if (!formationReadStarted) {
        formation.value = null;
        formationEmpty.value = false;
        formationError.value = "";
        formationUpdatedAt.value = 0;
        formationLoading.value = false;
        formationStatus.value = "未能确认当前角色，阵容尚未读取。请检查登录状态后重试。";
      }
      const messageText = `读取角色状态失败：${error.message || "游戏未返回有效角色数据"}`;
      roomStatus.value = { status: "error", roomId: "", room: null, message: messageText, updatedAt: 0 };
      teamStatus.value = { status: "error", message: "角色状态未读到，无法确认是否加入队伍" };
      errorMessage.value = messageText;
    }
    if (throwOnError) throw error;
  } finally {
    if (requestGeneration === generation.value) {
      loading.value = false;
      roomLoading.value = false;
    }
  }
}

async function loadRefreshDetails(id, requestGeneration, profile) {
  try {
    const config = await loadTenPalaceConfig(tokenStore, id, globalThis.fetch, { check: () => assertCurrent(id, requestGeneration) });
    assertCurrent(id, requestGeneration);
    const selectedChallenge = config.challenges.find((item) => item.id === challengeId.value) || config.challenges[0];
    challengeId.value = selectedChallenge.id;
    snapshot.value = {
      role: profile.state, roleInfo: profile.info, rolePayload: profile.rolePayload, config, season: null,
      weekAward: field(profile.payload, "weekAward", null), options: localOptions(),
    };
    snapshotTokenId.value = id;
    if (!editingPlanId.value) hydrateAutomationSettings(localOptions());
    teamStatus.value = { status: "loading", message: "" };

    const roleId = toGameRoleId(profile.info.roleId || token.value?.roleId);
    const loadTeam = async () => {
      const response = await tokenStore.sendMessageWithPromise(id, "matchteam_getroleteaminfo", { roleID: roleId }, 12000);
      assertCurrent(id, requestGeneration);
      const teamId = parseRoleTenPalaceTeamId(response, config.team.id);
      if (!teamId) return { status: "none", value: null };
      const teamResponse = await tokenStore.sendMessageWithPromise(id, "matchteam_getteaminfo", { teamId }, 12000);
      assertCurrent(id, requestGeneration);
      const value = field(teamResponse, "teamInfo", teamResponse);
      if (!isCompleteTeamInfo(value, teamId, profile.info.roleId || token.value?.roleId)) throw new Error("游戏返回的十殿队伍详情不完整、编号不一致或缺少当前角色成员");
      return { status: "ready", value };
    };
    const teamTask = loadTeam();
    const seasonTask = readSeason(id, profile.info, config).catch(() => null);

    void teamTask.then(({ status, value }) => {
      if (requestGeneration !== generation.value || id !== tokenId.value) return;
      team.value = value;
      teamStatus.value = { status, message: "" };
      if (!editingPlanId.value && value?.extParam !== undefined) {
        challengeId.value = config.challenges.find((item) => item.extParam === Number(value.extParam))?.id || challengeId.value;
      }
    }).catch((error) => {
      if (requestGeneration !== generation.value || id !== tokenId.value) return;
      team.value = null;
      teamStatus.value = { status: "error", message: `十殿队伍读取失败：${error.message || "游戏返回格式无法识别"}` };
    });
    void seasonTask.then((season) => {
      if (requestGeneration !== generation.value || id !== tokenId.value || !snapshot.value) return;
      snapshot.value = { ...snapshot.value, season };
    });
  } catch (error) {
    if (requestGeneration !== generation.value || id !== tokenId.value) return;
    snapshot.value = null;
    snapshotTokenId.value = "";
    team.value = null;
    teamStatus.value = { status: "error", message: "玩法配置未读取，无法确认队伍状态" };
    errorMessage.value = `十殿玩法配置读取失败：${error.message || "请检查网络并刷新"}`;
  }
}

async function readSeason(id, role, config) {
  let firstMonthDate = "";
  try {
    const legion = await tokenStore.sendMessageWithPromise(id, "legion_getinfo", {}, 12000);
    firstMonthDate = field(legion, "firstMonthDate", field(field(legion, "legionInfo"), "firstMonthDate", ""));
  } catch {}
  if (!firstMonthDate) {
    const firstMonth = await tokenStore.sendMessageWithPromise(id, "role_getfirstmonthdate", {}, 12000);
    firstMonthDate = field(firstMonth, "firstMonthDate", "");
  }
  const serverTime = Number(tokenStore.getWebSocketClient(id)?.serverTime || 0);
  return typeof firstMonthDate === "string" ? currentLegionSeason(config, firstMonthDate, serverTime > 0 ? serverTime : Date.now()) : null;
}
function roomHasDamagedCurrentRole(currentRoom, roleId) {
  if (!currentRoom || !roleId) return false;
  const player = field(currentRoom.playerTeamInfo, roleId);
  const currentHeroes = field(player, "curHeroData");
  let currentRows;
  try { currentRows = entriesOf(currentHeroes, "当前角色阵容"); } catch { return false; }
  if (!currentRows.length) return false;
  if (currentRows.every(([, hero]) => Number(field(hero, "curHp", Number.NaN)) <= 0)) return true;
  const member = (currentRoom.raw?.fightRoleBase || []).find((row) => String(row.roleId) === String(roleId));
  const fullTeam = field(field(member, "battleData"), "team");
  return currentRows.some(([heroId, hero]) => {
    const maxHp = Number(field(field(fullTeam, heroId), "hp", Number.NaN));
    const currentHp = Number(field(hero, "curHp", Number.NaN));
    return Number.isFinite(maxHp) && maxHp > 0 && Number.isFinite(currentHp) && currentHp < maxHp;
  });
}

function readLocalPlans() {
  try {
    const rows = JSON.parse(localStorage.getItem("tenPalaceLocalPlans") || "[]");
    if (!Array.isArray(rows)) return [];
    return rows.filter((row) => row && typeof row.id === "string" && Array.isArray(row.accountIds) && row.accountIds.length >= 2 && row.accountIds.length <= 5 && typeof row.time === "string");
  } catch { return []; }
}
function persistLocalPlans() {
  localStorage.setItem("tenPalaceLocalPlans", JSON.stringify(localPlans.value.map((plan) => ({
    id: plan.id, name: plan.name, accountIds: plan.accountIds, memberOrder: plan.memberOrder,
    leaderTokenId: plan.leaderTokenId, challengeId: plan.challengeId, settings: plan.settings,
    time: plan.time, timezone: "Asia/Shanghai", enabled: Boolean(plan.enabled), lastOccurrence: plan.lastOccurrence || "",
  }))));
}
function saveLocalPlan() {
  if (selectedLocalTeam.value.length < 2 || selectedLocalTeam.value.length > 5) { message.error("先选择 2–5 个本地账号"); return; }
  const leader = selectedLocalTeam.value.includes(browserLeaderTokenId.value) ? browserLeaderTokenId.value : selectedLocalTeam.value[0];
  if (selectedLocalTeam.value.some((id) => tokenStore.getWebSocketStatus(id) !== "connected")) { message.error("本机计划需要所有账号当前已连接"); return; }
  const uuid = globalThis.crypto?.randomUUID?.() || `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const plan = {
    id: uuid, name: localPlanName.value.trim() || "十殿本机计划", accountIds: [...selectedLocalTeam.value],
    memberOrder: [...selectedLocalTeam.value], leaderTokenId: leader, challengeId: challengeId.value,
    settings: currentSettings(challengeId.value), time: localPlanTime.value || "08:00", timezone: "Asia/Shanghai",
    enabled: true, lastOccurrence: "",
  };
  localPlans.value = [...localPlans.value.filter((item) => item.id !== plan.id), plan];
  persistLocalPlans();
  message.success("本机计划已保存；只在十殿页面打开期间运行");
}
function toggleLocalPlan(id, enabled) {
  localPlans.value = localPlans.value.map((plan) => plan.id === id ? { ...plan, enabled: Boolean(enabled) } : plan);
  persistLocalPlans();
}
function deleteLocalPlan(id) {
  localPlans.value = localPlans.value.filter((plan) => plan.id !== id);
  persistLocalPlans();
}
function beijingOccurrence(date = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(date).map((part) => [part.type, part.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}
function checkLocalSchedules() {
  const occurrence = beijingOccurrence();
  const due = localPlans.value.filter((plan) => plan.enabled && plan.time === occurrence.time && plan.lastOccurrence !== `${occurrence.date} ${occurrence.time}`);
  if (!due.length) return;
  const mark = `${occurrence.date} ${occurrence.time}`;
  localPlans.value = localPlans.value.map((plan) => due.some((item) => item.id === plan.id) ? { ...plan, lastOccurrence: mark } : plan);
  persistLocalPlans();
  for (const plan of due) {
    if (browserRunning.value) { log(`本机计划「${plan.name}」本次跳过：另一个十殿队伍仍在运行`, "warning"); continue; }
    void runLocalPlan(plan);
  }
}
async function runLocalPlan(plan) {
  if (!plan || plan.accountIds.some((id) => tokenStore.getWebSocketStatus(id) !== "connected")) {
    log(`本机计划「${plan?.name || ""}」未运行：所有账号需要保持连接`, "error");
    return;
  }
  await runBrowserTeam({ accountIds: plan.memberOrder || plan.accountIds, leaderTokenId: plan.leaderTokenId, plan });
}

function localOptions() {
  try { return normalizeTenPalaceOptions(JSON.parse(localStorage.getItem("tenPalaceOptions") || "{}")); }
  catch { return { ...TEN_PALACE_DEFAULTS, charmTargets: {} }; }
}
function hydrateAutomationSettings(settings = {}) {
  const normalized = normalizeTenPalaceOptions(settings);
  autoBuy.value = normalized.autoBuyCharms;
  autoClaimCharms.value = normalized.autoClaimCharms;
  claimKillRewardsEnabled.value = normalized.claimKillRewards;
  claimWeekRewardEnabled.value = normalized.claimWeekReward;
  requireCharm.value = normalized.requireCharm;
  preferCharm.value = normalized.preferCharm;
  restoreLimit.value = normalized.restoreLimit;
  runLimitMinutes.value = normalized.runLimitMinutes;
  kindnessBudget.value = normalized.kindnessBudget;
  maxBuyPerCharm.value = normalized.maxBuyPerCharm;
  for (let id = 1; id <= 6; id++) charmTargets[id] = normalized.charmTargets[id] || 0;
}
function requireFresh(id = tokenId.value, expectedGeneration = (activeOperation?.tokenId === id ? activeOperation.generation : generation.value)) {
  if (!snapshot.value) throw new Error("请先刷新十殿状态");
  assertCurrent(id, expectedGeneration);
}
async function withBusy(label, action, { refreshAfter = true, preserveMarket = false } = {}) {
  if (busy.value) return;
  if (browserRunning.value) {
    errorMessage.value = "浏览器十殿队伍正在运行，当前操作已停止；请先停止或等待队伍完成";
    return;
  }
  const context = { tokenId: tokenId.value, generation: generation.value };
  if (!context.tokenId) return;
  activeOperation = context;
  busy.value = true;
  try {
    assertCurrent(context.tokenId, context.generation);
    requireFresh(context.tokenId, context.generation);
    await action();
    assertCurrent(context.tokenId, context.generation);
    const preservedMarket = preserveMarket ? market.value : null;
    const expectedRefreshGeneration = generation.value + 1;
    activeOperation = null;
    if (refreshAfter) await refresh({ keepLoading: true, throwOnError: true });
    if (preserveMarket && preservedMarket && refreshAfter && tokenId.value === context.tokenId && generation.value === expectedRefreshGeneration) market.value = preservedMarket;
    message.success(`${label}完成`);
    log(`${label}完成`, "success");
  }
  catch (error) { errorMessage.value = error.message || `${label}失败`; message.error(errorMessage.value); log(`${label}失败：${errorMessage.value}`, "error"); }
  finally { activeOperation = null; busy.value = false; loading.value = false; }
}

function isCurrentFormationRead(id, requestGeneration) {
  return requestGeneration === generation.value && id === tokenId.value && connected.value;
}

async function resolveFormationRoleId(id, requestGeneration) {
  const storedRoleId = String((tokenStore.gameTokens || []).find((item) => item.id === id)?.roleId || "");
  const verifiedRoleId = snapshotTokenId.value === id ? String(field(snapshot.value?.roleInfo, "roleId", "") || "") : "";
  if (verifiedRoleId) {
    if (storedRoleId && verifiedRoleId !== storedRoleId) throw new Error("已读取角色与当前账号不一致");
    return toGameRoleId(verifiedRoleId);
  }

  const rolePayload = await tokenStore.sendMessageWithPromise(id, "role_getroleinfo", {}, 15000);
  assertCurrent(id, requestGeneration);
  const roleInfo = parseRolePayload(rolePayload);
  const returnedRoleId = String(field(roleInfo, "roleId", "") || "");
  if (!returnedRoleId) throw new Error("游戏没有返回当前角色 ID");
  if (storedRoleId && returnedRoleId !== storedRoleId) throw new Error("游戏返回的角色与当前账号不一致");
  return toGameRoleId(returnedRoleId);
}

async function fetchSavedFormation(id, roleId) {
  const requestKey = `${id}:${roleId}`;
  if (formationRequest?.key === requestKey) return formationRequest.promise;

  const pending = {
    key: requestKey,
    promise: tokenStore.sendMessageWithPromise(id, "role_gettargetteam", { targetId: roleId, teamType: 3, cCMonsterId: 0 }, 12000)
      .then(parseTenPalaceFormation),
  };
  formationRequest = pending;
  try {
    return await pending.promise;
  } finally {
    if (formationRequest === pending) formationRequest = null;
  }
}

async function loadFormation(id, requestGeneration, knownRoleId, { manual = false } = {}) {
  if (!isCurrentFormationRead(id, requestGeneration)) return null;
  formationLoading.value = true;
  formationError.value = "";
  formationEmpty.value = false;
  formationStatus.value = manual ? "正在读取当前角色的十殿专用阵容…" : "正在自动读取游戏保存的十殿专用阵容…";
  try {
    const roleId = knownRoleId || await resolveFormationRoleId(id, requestGeneration);
    assertCurrent(id, requestGeneration);
    const freshFormation = await fetchSavedFormation(id, roleId);
    assertCurrent(id, requestGeneration);
    formation.value = freshFormation;
    formationError.value = "";
    formationEmpty.value = false;
    formationUpdatedAt.value = Date.now();
    const readTime = new Date(formationUpdatedAt.value).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    formationStatus.value = `已读取游戏保存的十殿阵容 · 最近读取 ${readTime}`;
    if (manual) {
      message.success("十殿专用阵容已读取");
      log("已读取游戏内十殿专用阵容", "success");
    }
    return freshFormation;
  } catch (error) {
    if (isCurrentFormationRead(id, requestGeneration)) {
      formation.value = null;
      formationUpdatedAt.value = 0;
      formationEmpty.value = error.code === "TEN_PALACE_FORMATION_NOT_SAVED";
      formationError.value = formationEmpty.value ? "" : `十殿专用阵容读取失败：${error.message || "未读取到阵容"}`;
      formationStatus.value = formationEmpty.value
        ? "当前角色尚未在游戏中保存十殿阵容。"
        : manual ? "手动读取失败，请查看提示并重试。" : "自动读取失败，可以点下方按钮重新读取。";
      if (manual && !formationEmpty.value) message.error(formationError.value);
    }
    return null;
  } finally {
    if (isCurrentFormationRead(id, requestGeneration)) formationLoading.value = false;
  }
}

function readFormation() {
  if (!connected.value) return;
  const id = tokenId.value;
  return loadFormation(id, generation.value, null, { manual: true });
}
function ask(title, content, action, { scope = "game" } = {}) {
  const context = scope === "game" ? {
    tokenId: tokenId.value, generation: generation.value,
    teamId: String(team.value?.teamId || ""), roomId: String(room.value?.roomId || ""),
  } : null;
  dialog.warning({ title, content, positiveText: "确认", negativeText: "取消", onPositiveClick: () => {
    if (context && (context.tokenId !== tokenId.value || context.generation !== generation.value ||
      context.teamId !== String(team.value?.teamId || "") || context.roomId !== String(room.value?.roomId || ""))) {
      message.error("角色或十殿队伍/房间状态已变化，请重新打开确认框");
      return;
    }
    return action(context);
  } });
}
async function readCurrentTeam(expectedTeamId, { allowRoomTransition = false } = {}) {
  if (!snapshot.value?.config?.team || !currentRoleId.value) throw new Error("无法确认当前角色或十殿队伍配置");
  const profile = await readRole();
  const activeRoomId = String(profile.state.roomId || "").trim();
  if (activeRoomId && activeRoomId !== "0") {
    if (!allowRoomTransition) throw new Error("当前角色已进入十殿房间，不能执行队伍准备/确认或离队操作");
    const roomResponse = await send(tokenId.value, "nightmare_getroominfo", { roomId: activeRoomId });
    const freshRoom = parseTenPalaceRoom(roomResponse);
    const roleId = currentRoleId.value;
    const roleIsInRoom = teamRowsOf(freshRoom.raw).some((member) => teamMemberId(member) === roleId) || Boolean(field(freshRoom.playerTeamInfo, roleId));
    if (freshRoom.roomId !== activeRoomId || freshRoom.matchTeamId !== String(expectedTeamId) || !roleIsInRoom)
      throw new Error("当前角色的房间无法确认为本十殿队伍，请刷新后检查状态");
    return { profile, team: null, room: freshRoom };
  }
  const roleTeamResponse = await send(tokenId.value, "matchteam_getroleteaminfo", { roleID: toGameRoleId(currentRoleId.value) });
  const actualTeamId = parseRoleTenPalaceTeamId(roleTeamResponse, snapshot.value.config.team.id);
  if (!actualTeamId || String(actualTeamId) !== String(expectedTeamId)) throw new Error("当前角色已不在原十殿队伍，请刷新后重试");
  const response = await send(tokenId.value, "matchteam_getteaminfo", { teamId: String(expectedTeamId) });
  const freshTeam = field(response, "teamInfo", response);
  if (!isCompleteTeamInfo(freshTeam, expectedTeamId, currentRoleId.value)) throw new Error("游戏返回的十殿队伍详情不完整、编号不一致或缺少当前角色成员");
  team.value = freshTeam;
  return { profile, team: freshTeam, room: null };
}
async function leaveTeam() {
  const expectedTeamId = String(team.value?.teamId || "");
  if (!expectedTeamId) return;
  ask("离开十殿队伍", "确认离开当前准备/等待中的队伍？此操作不会解散队伍。", (context) => withBusy("离开队伍", async () => {
    const { team: freshTeam } = await readCurrentTeam(expectedTeamId);
    if (String(field(freshTeam, "leaderId", "")) === currentRoleId.value) throw new Error("当前角色已成为队长；请由队长解散准备队伍");
    if (![0, 1].includes(Number(field(freshTeam, "state", -1)))) throw new Error("当前队伍状态不支持离队");
    await send(context.tokenId, "matchteam_leave", { teamId: expectedTeamId });
    const readback = await send(context.tokenId, "matchteam_getroleteaminfo", { roleID: toGameRoleId(token.value.roleId) });
    const remainingTeamId = parseRoleTenPalaceTeamId(readback, snapshot.value.config.team.id);
    if (remainingTeamId) throw new Error("离队请求已发送，但游戏仍显示角色在队伍中；不会自动重试");
    team.value = null;
  }));
}
async function dismissPreparedTeam() {
  const expectedTeamId = String(team.value?.teamId || "");
  if (!expectedTeamId) return;
  ask("解散准备队伍", "仅解散当前十殿准备队伍；队伍中其他成员将一同离开。", (context) => withBusy("解散准备队伍", async () => {
    const { team: freshTeam } = await readCurrentTeam(expectedTeamId);
    if (teamStateValue(freshTeam, true) !== 0 || String(field(freshTeam, "leaderId", "")) !== currentRoleId.value)
      throw new Error("仅当前准备队伍的队长可以解散；队伍状态已变化");
    await send(context.tokenId, "matchteam_dismiss", { teamId: expectedTeamId });
    const readback = await send(context.tokenId, "matchteam_getroleteaminfo", { roleID: toGameRoleId(currentRoleId.value) });
    if (parseRoleTenPalaceTeamId(readback, snapshot.value.config.team.id)) throw new Error("解散请求已发送，但游戏仍显示角色在队伍中；不会自动重试");
    team.value = null;
  }));
}
async function createTeam() {
  const config = snapshot.value?.config;
  const currentChallenge = challenge.value;
  if (!config || !currentChallenge) return;
  const args = teamCreateParams({ challenge: currentChallenge, teamConfig: config.team, name: `${token.value?.name || "十殿"}队伍` });
  ask("创建十殿队伍", `创建 ${currentChallenge.name} 队伍。创建本身不会立即开始战斗；开启挑战前会复核全队门票与资格。`, () => withBusy("创建队伍", async () => {
    await send(tokenId.value, "matchteam_create", args, 15000);
    const created = await waitForTeamId(tokenId.value);
    if (!created) throw new Error("建队结果无法复核；不会重复创建");
  }));
}
async function waitForTeamId(id, timeout = 15000) {
  const expected = toGameRoleId(token.value?.roleId);
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const response = await send(id, "matchteam_getroleteaminfo", { roleID: expected }, 10000);
    const teamId = parseRoleTenPalaceTeamId(response, snapshot.value.config.team.id);
    if (teamId) return teamId;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return "";
}
async function joinTeam() { await withBusy("加入队伍", async () => { await send(tokenId.value, "matchteam_join", teamJoinParams(joinTeamId.value)); }); }
async function waitForTeamPhase(expectedTeamId, { stage, prepared = true, allowWaitingTransition = false, actionLabel }) {
  let lastReadError = "";
  for (let attempt = 0; attempt < 4; attempt++) {
    if (!tokenId.value || !connected.value || String(team.value?.teamId || expectedTeamId) !== String(expectedTeamId))
      throw new Error("角色或目标队伍已变化；不会自动重发队伍操作");
    try {
      const { team: freshTeam, room: freshRoom } = await readCurrentTeam(expectedTeamId, { allowRoomTransition: true });
      if (freshRoom) return { team: null, room: freshRoom };
      const freshStage = teamStateValue(freshTeam, true);
      const self = teamRowsOf(freshTeam).find((member) => teamMemberId(member) === currentRoleId.value);
      if (freshStage === stage && memberPreparedValue(self, true) === prepared) return { team: freshTeam, room: null };
      if (allowWaitingTransition && stage === 0 && freshStage === 1) return { team: freshTeam, room: null };
      lastReadError = `当前队伍阶段为 ${freshStage}，成员状态为 ${memberPreparedValue(self, true) ? "已确认" : "未确认"}`;
    } catch (error) {
      lastReadError = error.message || "游戏暂未返回可核对的队伍状态";
    }
    if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 350));
  }
  throw new Error(`${actionLabel}请求已发送，但暂未从游戏状态确认成功；不会自动重发。请刷新状态后核对。${lastReadError ? ` 最近读取：${lastReadError}` : ""}`);
}
async function writeTeamPhaseAndVerify(expectedTeamId, command, actionLabel, options) {
  let writeError = null;
  try {
    await send(tokenId.value, command, { teamId: String(expectedTeamId) });
  } catch (error) {
    if (error?.gameCode !== undefined) throw error;
    if (!activeOperation || activeOperation.tokenId !== tokenId.value || activeOperation.generation !== generation.value) throw error;
    writeError = error;
  }
  try {
    return await waitForTeamPhase(expectedTeamId, { ...options, actionLabel });
  } catch (readError) {
    if (writeError) throw new Error(`${actionLabel}请求未收到确认（${writeError.message || "连接超时"}）；${readError.message}`);
    throw readError;
  }
}
async function prepareTeam() { await withBusy("准备队伍", async () => {
  const expectedTeamId = String(team.value?.teamId || "");
  if (!expectedTeamId || !roomClear.value || room.value) throw new Error("请先确认当前角色仍在队伍且未进入十殿房间");
  const { team: freshTeam } = await readCurrentTeam(expectedTeamId);
  if (teamStateValue(freshTeam, true) !== 0 || String(field(freshTeam, "leaderId", "")) === currentRoleId.value) throw new Error("仅非队长成员可在准备阶段操作");
  const self = teamRowsOf(freshTeam).find((row) => teamMemberId(row) === currentRoleId.value);
  if (!self) throw new Error("当前角色已不在该队伍");
  const prepared = memberPreparedValue(self, true);
  if (prepared === true) return;
  if (prepared !== false) throw new Error("游戏未返回可确认的当前成员准备状态，已停止操作");
  await writeTeamPhaseAndVerify(expectedTeamId, "matchteam_memberprepare", "准备", { stage: 0, prepared: true, allowWaitingTransition: true });
}); }
async function confirmTeam() { await withBusy("确认加入挑战", async () => {
  const expectedTeamId = String(team.value?.teamId || "");
  if (!expectedTeamId || !roomClear.value || room.value) throw new Error("请先确认当前角色仍在队伍且未进入十殿房间");
  const { team: freshTeam } = await readCurrentTeam(expectedTeamId);
  if (teamStateValue(freshTeam, true) !== 1 || String(field(freshTeam, "leaderId", "")) === currentRoleId.value) throw new Error("仅非队长成员可在等待确认阶段操作");
  const self = teamRowsOf(freshTeam).find((row) => teamMemberId(row) === currentRoleId.value);
  if (!self) throw new Error("当前角色已不在该队伍");
  const prepared = memberPreparedValue(self, true);
  if (prepared === true) return;
  if (prepared !== false) throw new Error("游戏未返回可确认的当前成员确认状态，已停止操作");
  await writeTeamPhaseAndVerify(expectedTeamId, "matchteam_memberconfirm", "确认加入挑战", { stage: 1, prepared: true });
}); }
async function openTeam() {
  if (!teamEligibility.value?.allowed) { errorMessage.value = teamEligibility.value?.reason || "无法确认队伍资格"; return; }
  const needed = requiredEntryItems(snapshot.value.role, challenge.value);
  if (ticketCount.value === null || ticketCount.value < needed) { errorMessage.value = `当前角色入场门票不足或无法读取（需要 ${needed}）`; return; }
  ask("开启十殿挑战", `游戏会检查并消耗入场资源（当前队长需要 ${needed} 个）。确认后需要队员确认，房间创建后不会自动解散。`, (context) => withBusy("开启挑战", async () => {
    const { profile, team: freshTeam } = await readCurrentTeam(context.teamId);
    const freshMembers = teamRowsOf(freshTeam);
    if (teamStateValue(freshTeam, true) !== 0 || String(field(freshTeam, "leaderId", "")) !== currentRoleId.value ||
      freshMembers.length < (teamConfig.value?.memberMin || 2) || freshMembers.some((row) => teamMemberId(row) !== currentRoleId.value && memberPreparedValue(row, true) !== true))
      throw new Error("队伍状态、队长或准备成员已变化");
    const freshChallenge = challenge.value;
    const freshNeeded = requiredEntryItems(profile.state, freshChallenge, Number(tokenStore.getWebSocketClient(context.tokenId)?.serverTime || Date.now()));
    if (countRoleItem(profile.rolePayload, freshChallenge.useItem) < freshNeeded) throw new Error(`队长门票不足（需要 ${freshNeeded}）`);
    if (Number(freshChallenge.extParam) === 2 && freshMembers.some((row) => !challengeEligibility(row, freshChallenge).allowed)) throw new Error("队员平等王资格已变化，停止开启");
    await send(context.tokenId, "matchteam_openteam", { teamId: String(freshTeam.teamId) });
  }));
}
async function stopOpenTeam() { await withBusy("取消队伍等待", async () => {
  const { team: freshTeam } = await readCurrentTeam(team.value.teamId);
  if (teamStateValue(freshTeam, true) !== 1 || String(field(freshTeam, "leaderId", "")) !== currentRoleId.value) throw new Error("当前角色不再是等待队伍的队长");
  await send(tokenId.value, "matchteam_leaderstop", { teamId: String(freshTeam.teamId) });
}); }
async function changeChallenge() {
  await withBusy("切换挑战类型", async () => {
    const { team: freshTeam } = await readCurrentTeam(team.value.teamId);
    if (String(field(freshTeam, "leaderId", "")) !== currentRoleId.value || teamStateValue(freshTeam, true) !== 0) throw new Error("仅准备阶段的当前队长可以切换挑战类型");
    await send(tokenId.value, "matchteam_changeextparam", { teamId: String(freshTeam.teamId), extParam: challenge.value.extParam });
  });
}
async function readRoomById(id, roomId) {
  const requestGeneration = generation.value;
  try {
    const response = await send(id, "nightmare_getroominfo", { roomId: String(roomId) }, 12000);
    const freshRoom = parseTenPalaceRoom(response);
    if (!freshRoom.roomId || String(freshRoom.roomId) !== String(roomId)) throw new Error("游戏返回的房间编号与当前角色不一致");
    publishRoomResult(id, requestGeneration, freshRoom);
    return freshRoom;
  } catch (error) {
    if (requestGeneration === generation.value && id === tokenId.value) {
      room.value = null;
      roomStatus.value = { status: "error", roomId: String(roomId), room: null, message: error.message || "游戏房间查询失败", updatedAt: 0 };
    }
    throw error;
  }
}
function manualFightKey(tokenRecordId, roomId, bossId, roleId) {
  return [String(tokenRecordId), String(roomId), Number(bossId), String(roleId)].join("|");
}
function hasPendingFightInRoom(tokenRecordId, roomData) {
  if (!tokenRecordId || !roomData?.roomId) return false;
  return [...fightWriteGuards.value.values()].some((item) => item.tokenId === String(tokenRecordId) &&
    item.roomId === String(roomData.roomId) && item.bossId === Number(roomData.curMonsterCfgId));
}
function saveFightGuard(context, status) {
  const key = manualFightKey(context.tokenId, context.roomId, context.bossId, context.roleId);
  const guards = new Map(fightWriteGuards.value);
  guards.set(key, { ...context, key, status });
  fightWriteGuards.value = guards;
  return key;
}
function reconcileFightGuards(tokenRecordId, freshRoom) {
  const id = String(tokenRecordId || "");
  if (!id) return;
  let changed = false;
  const guards = new Map(fightWriteGuards.value);
  for (const [key, item] of guards) {
    if (item.tokenId !== id) continue;
    const roomChanged = !freshRoom || String(freshRoom.roomId) !== item.roomId;
    const bossChanged = !roomChanged && Number(freshRoom.curMonsterCfgId) !== item.bossId;
    const outcomeConfirmed = !roomChanged && !bossChanged && (freshRoom.state !== 0 || parseRoomFighterResult(freshRoom, item.roleId));
    if (roomChanged || bossChanged || outcomeConfirmed) {
      guards.delete(key);
      changed = true;
    }
  }
  if (changed) fightWriteGuards.value = guards;
}
function captureManualRoomContext() {
  return {
    tokenId: String(tokenId.value || ""),
    generation: generation.value,
    roomId: String(room.value?.roomId || ""),
    bossId: Number(room.value?.curMonsterCfgId || 0),
    roleId: String(token.value?.roleId || ""),
  };
}
function assertManualRoomContext(context, freshRoom) {
  assertCurrent(context.tokenId, context.generation);
  if (String(tokenId.value || "") !== context.tokenId || String(token.value?.roleId || "") !== context.roleId)
    throw new Error("当前角色已变化，请刷新后重试");
  if (!context.roomId || String(freshRoom?.roomId || "") !== context.roomId || Number(freshRoom?.curMonsterCfgId) !== context.bossId)
    throw new Error("十殿房间或当前BOSS已变化，请刷新后重试");
}
async function readFreshManualRoom(context) {
  if (!context.tokenId || !context.roleId || !context.roomId) throw new Error("请先读取当前角色与十殿房间");
  assertCurrent(context.tokenId, context.generation);
  const profile = await readRole(context.tokenId, context.generation);
  if (String(tokenId.value || "") !== context.tokenId || String(token.value?.roleId || "") !== context.roleId)
    throw new Error("当前角色已变化，未发送十殿操作");
  if (String(profile.state.roomId || "") !== context.roomId) {
    reconcileFightGuards(context.tokenId, null);
    room.value = null;
    throw new Error("当前角色已不在原十殿房间，未发送操作");
  }
  const freshRoom = await readRoomById(context.tokenId, context.roomId);
  assertManualRoomContext(context, freshRoom);
  return freshRoom;
}
function serverNowMilliseconds(id) {
  const value = Number(tokenStore.getWebSocketClient(id)?.serverTime || 0);
  return Number.isFinite(value) && value > 0 ? value : Date.now();
}
function fightCooldownRemainingSeconds(roomData, id) {
  const until = Number(roomData?.fightLimitTime || 0);
  if (!Number.isFinite(until) || until <= 0) return 0;
  const nowSeconds = serverNowMilliseconds(id) / 1000;
  return Math.max(0, until > 1e9 ? until - nowSeconds : until);
}
function validateManualRoomWrite(context, freshRoom, { requireLeader = false, requireFighter = false } = {}) {
  assertManualRoomContext(context, freshRoom);
  if (freshRoom.state !== 0) throw new Error("当前十殿房间不在准备状态，未发送操作");
  if (requireLeader && String(freshRoom.leaderId) !== context.roleId) throw new Error("当前角色已不是十殿队长，未发送操作");
  if (requireFighter && String(freshRoom.fighterId) !== context.roleId) throw new Error("当前角色已不是本场出战者，未发送挑战");
  if (!roomHasSurvivingHero(freshRoom, context.roleId)) throw new Error("当前角色没有存活武将，未发送操作");
  if (parseRoomFighterResult(freshRoom, context.roleId)) throw new Error("当前角色本殿已有战斗记录，未发送重复挑战");
  if (isBoss12RoleBlocked(freshRoom, context.roleId)) throw new Error("当前角色已挑战过前置隐藏BOSS，不能重复出战平等王");
  if (hasPendingFightInRoom(context.tokenId, freshRoom)) throw new Error("本房间已有一条结果未确认的挑战请求，已禁止再次写入；请刷新等待服务器确认");
  const cooldown = fightCooldownRemainingSeconds(freshRoom, context.tokenId);
  if (cooldown > 0) throw new Error(`十殿战斗冷却尚未结束（约 ${Math.ceil(cooldown)} 秒），未发送操作`);
}
async function dismissRoom() {
  ask("解散十殿房间", "这会结束当前试炼房间，队友也无法继续本次挑战。", (context) => withBusy("解散房间", async () => {
    const profile = await readRole(context.tokenId, context.generation);
    if (String(profile.state.roomId) !== context.roomId) throw new Error("当前角色已离开原房间");
    const freshRoom = await readRoomById(context.tokenId, context.roomId);
    if (String(freshRoom.leaderId) !== String(token.value.roleId)) throw new Error("当前角色已不是该房间队长");
    await send(context.tokenId, "nightmare_dismiss", { roomId: context.roomId });
    const after = await readRole(context.tokenId, context.generation);
    if (String(after.state.roomId) === context.roomId) throw new Error("解散请求已发送，但游戏仍显示角色在房间中；不会自动重试");
    room.value = null;
  }));
}
async function setSelfFighter() {
  const context = captureManualRoomContext();
  await withBusy("选择出战角色", async () => {
    const freshRoom = await readFreshManualRoom(context);
    validateManualRoomWrite(context, freshRoom, { requireLeader: true });
    await send(context.tokenId, "nightmare_setfighter", { roomId: context.roomId, roleId: toGameRoleId(context.roleId) });
  });
}
async function fight() {
  const context = captureManualRoomContext();
  if (hasPendingFightInRoom(context.tokenId, room.value)) {
    const text = "本房间已有一条结果未确认的挑战请求，已禁止再次写入；请刷新等待服务器确认";
    errorMessage.value = text;
    message.warning(text);
    return;
  }
  await withBusy("发起挑战", async () => {
    const freshRoom = await readFreshManualRoom(context);
    validateManualRoomWrite(context, freshRoom, { requireFighter: true });
    const key = saveFightGuard(context, "sending");
    try {
      await send(context.tokenId, "nightmare_fight", { roomId: context.roomId, roleId: toGameRoleId(context.roleId) }, 15000);
      saveFightGuard(context, "unknown");
      log("挑战请求已发送；正在核对房间状态，不会自动重发", "info");
    } catch (requestError) {
      saveFightGuard(context, "unknown");
      let refreshed = false;
      try {
        const profile = await readRole(context.tokenId, context.generation);
        if (String(profile.state.roomId || "") === context.roomId) {
          await readRoomById(context.tokenId, context.roomId);
        } else {
          reconcileFightGuards(context.tokenId, null);
          room.value = null;
        }
        refreshed = true;
      } catch (readError) {
        log(`挑战请求响应不确定，房间刷新失败：${readError.message || "未知错误"}`, "error");
      }
      if (!fightWriteGuards.value.has(key)) {
        log("挑战请求响应异常，但服务器房间状态已推进或记录本场结果；不会重发", "success");
        return;
      }
      throw new Error(`挑战请求结果未确认，${refreshed ? "已刷新房间" : "已尝试刷新房间"}；为避免重复挑战，保护仍生效。请稍后刷新，勿重发。${requestError?.message ? `（${requestError.message}）` : ""}`);
    }
  });
}
async function completeFight() {
  ask("确认本场战斗结果", "只提交已记录且完成播放的当前战斗结果，不会解散试炼房间。", (context) => withBusy("确认战斗结果", async () => {
    const profile = await readRole(context.tokenId, context.generation);
    if (String(profile.state.roomId) !== context.roomId) throw new Error("当前角色已离开原房间");
    const freshRoom = await readRoomById(context.tokenId, context.roomId);
    if (!completeFightReady(freshRoom)) throw new Error("新鲜房间状态尚未满足提交条件");
    const beforeBoss = Number(freshRoom.curMonsterCfgId);
    await send(context.tokenId, "nightmare_leadercomplete", { roomId: context.roomId });
    const end = Date.now() + 30000;
    while (Date.now() < end) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      const fresh = await readRoomById(context.tokenId, context.roomId);
      if (fresh.state !== 1 || Number(fresh.curMonsterCfgId) !== beforeBoss) return;
    }
    throw new Error("提交请求已发送，但房间未确认进入下一阶段；不会重复提交");
  }));
}
function currentHpTotal(roomData, roleId) {
  const player = field(roomData.playerTeamInfo, roleId);
  try { return entriesOf(field(player, "curHeroData"), "角色当前阵容").reduce((sum, [, hero]) => sum + Math.max(0, Number(field(hero, "curHp", 0))), 0); }
  catch { return null; }
}
async function restore() {
  ask("恢复当前角色", "此操作会使用当前BOSS设置的游戏内恢复次数。", (context) => withBusy("恢复角色", async () => {
    const profile = await readRole(context.tokenId, context.generation);
    if (String(profile.state.roomId) !== context.roomId) throw new Error("当前角色已离开原房间");
    const freshRoom = await readRoomById(context.tokenId, context.roomId);
    if (!restoreReady(freshRoom)) throw new Error("当前角色没有可确认的受损武将或恢复次数不足");
    const beforeCount = freshRoom.restoreCnt;
    const beforeHp = currentHpTotal(freshRoom, token.value.roleId);
    if (beforeHp === null) throw new Error("无法读取恢复前阵容血量，停止消耗恢复次数");
    await send(context.tokenId, "nightmare_restore", { roomId: context.roomId, roleId: toGameRoleId(token.value.roleId) });
    const after = await readRoomById(context.tokenId, context.roomId);
    const afterHp = currentHpTotal(after, token.value.roleId);
    if (after.restoreCnt <= beforeCount || afterHp === null || afterHp <= beforeHp) throw new Error("恢复结果未能从房间状态确认；不会重复消耗次数");
  }));
}
function canBuy(charmId) {
  if (!snapshot.value || !connected.value || busy.value || browserRunning.value) return false;
  const quantity = Number(buyCounts[charmId]);
  if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 50) return false;
  if (market.value) {
    try { charmPurchasePreview({ config: snapshot.value.config, roleState: snapshot.value.role, market: market.value, charmId, quantity }); return true; }
    catch { return false; }
  }
  const charm = snapshot.value.config.charms.find((item) => item.id === charmId);
  return Boolean(charm && snapshot.value.role.kindness >= charm.NewConsumeNum * quantity);
}
async function readCharmMarket(id, expectedGeneration) {
  const profile = await readRole(id, expectedGeneration);
  const serverId = tenPalaceServerId(profile.rolePayload);
  if (!serverId) throw new Error("游戏角色未提供有效区域服务器编号，无法兑换符咒");
  const result = await send(id, "nightmare_getcharm", { serverId }, 12000);
  result.festival = charmFestivalActive(snapshot.value?.config || {});
  market.value = result;
  return result;
}
function buyCharm(charmId) {
  const quantity = Number(buyCounts[charmId]);
  if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 50) return;
  ask("兑换十殿符咒", `确认兑换第 ${charmId} 殿符咒 ×${quantity}？确认后会重新读取好心值和区域余量，并核对兑换结果。`, (context) => withBusy("兑换符咒", async () => {
    const transaction = await buyTenPalaceCharm({
      send: (command, params, timeout) => send(context.tokenId, command, params, timeout),
      refresh: async () => (await readRole(context.tokenId, context.generation)).state,
      loadMarket: () => readCharmMarket(context.tokenId, context.generation),
      config: snapshot.value.config,
      charmId,
      quantity,
    });
    const afterMarket = await readCharmMarket(context.tokenId, context.generation);
    const stockAfter = charmMarketStock(afterMarket, charmId);
    if (stockAfter === null || stockAfter > transaction.preview.stock - quantity)
      throw new Error("兑换后的区域商店余量无法确认；兑换可能已成功，请刷新状态后检查，勿直接重复兑换");
    log(`第 ${charmId} 殿符咒 ×${quantity} 已确认；好心值与区域余量均已复核`, "success");
  }, { preserveMarket: true }));
}
async function claimKillReward() {
  if (!canClaimKill.value) return;
  await withBusy("领取击杀奖励", async () => {
    const fresh = await readRole();
    const freshEligible = entriesOf(fresh.state.raw.killAward, "击杀奖励").filter(([, value]) => value === false || value === 0).map(([id]) => Number(id));
    for (const monsterId of freshEligible) {
      if (!Number.isSafeInteger(monsterId) || monsterId <= 0) throw new Error("十殿击杀奖励 BOSS 编号无效");
      await send(tokenId.value, "nightmare_takekillaward", { monsterId: toGameRoleId(monsterId) });
      const refreshed = await readRole();
      if (field(refreshed.state.raw.killAward, monsterId) !== true && field(refreshed.state.raw.killAward, monsterId) !== 1) throw new Error(`BOSS ${monsterId} 奖励领取结果无法确认；停止继续领取`);
    }
  });
}
async function claimWeekReward() {
  await withBusy("领取周奖励", async () => {
    if (!hasClaimableTenPalaceWeekReward(snapshot.value?.weekAward)) throw new Error("当前没有可领取的周奖励");
    await send(tokenId.value, "nightmare_claimweekreward", {});
    const fresh = await readRole();
    if (hasClaimableTenPalaceWeekReward(field(fresh.payload, "weekAward", null))) throw new Error("服务器仍显示有未领取周奖励；本次结果不确定，不会自动重试");
  });
}
async function claimOneGift(gift) {
  if (!gift?.eligible) return;
  await withBusy("领取免费符咒", async () => {
    await send(tokenId.value, "nightmare_claimcharm", { giftId: Number(gift.giftId) });
    const fresh = await readRole();
    if (!fresh.state.charms[gift.charmId]?.giftClaimedThisWeek) throw new Error("领取结果无法从本周领取记录确认；不会重复领取");
  });
}
async function claimFreeCharms() {
  const eligible = giftStates.value.filter((gift) => gift.eligible);
  if (!eligible.length) return;
  await withBusy("领取可领免费符", async () => {
    for (const gift of eligible) {
      await send(tokenId.value, "nightmare_claimcharm", { giftId: Number(gift.giftId) });
      const fresh = await readRole();
      if (!fresh.state.charms[gift.charmId]?.giftClaimedThisWeek) throw new Error(`第 ${gift.charmId} 殿领取结果不明；停止继续领取`);
    }
  });
}
async function refreshCharmMarket() {
  await withBusy("读取区域商店余量", async () => {
    const profile = await readRole();
    const serverId = tenPalaceServerId(profile.rolePayload);
    if (!serverId) throw new Error("游戏角色信息未提供有效区域服务器编号，无法查询区域商店");
    market.value = await send(tokenId.value, "nightmare_getcharm", { serverId }, 12000);
    market.value.festival = charmFestivalActive(snapshot.value.config);
    log("已读取区域限量库存（与个人持有量分开展示）", "success");
  }, { preserveMarket: true });
}

function currentSettings(challengeValue = challengeId.value) {
  const existing = localOptions();
  return normalizeTenPalaceOptions({
    ...existing,
    challengeId: challengeValue,
    requireCharm: requireCharm.value,
    preferCharm: preferCharm.value,
    autoClaimCharms: autoClaimCharms.value,
    claimKillRewards: claimKillRewardsEnabled.value,
    claimWeekReward: claimWeekRewardEnabled.value,
    autoBuyCharms: autoBuy.value,
    kindnessBudget: kindnessBudget.value,
    restoreLimit: restoreLimit.value,
    runLimitMinutes: runLimitMinutes.value,
    maxBuyPerCharm: maxBuyPerCharm.value,
    charmTargets: Object.fromEntries(Array.from({ length: 6 }, (_, index) => [String(index + 1), Number(charmTargets[index + 1] || 0)])),
  });
}
function saveAutomationSettings() {
  try {
    const settings = currentSettings();
    localStorage.setItem("tenPalaceOptions", JSON.stringify(settings));
    message.success("十殿托管设置已保存；浏览器计划与服务器计划分别生效");
  } catch (error) { message.error(error.message || "十殿设置保存失败"); }
}

async function loadHostedPlans() {
  planError.value = "";
  try {
    const [plans, accounts] = await Promise.all([hostedRequest("/nightmare-plans"), hostedRequest("/accounts")]);
    hostedPlans.value = plans.plans || [];
    hostedAccounts.value = accounts.accounts || [];
  } catch (error) {
    hostedPlans.value = [];
    hostedAccounts.value = [];
    planError.value = error.message || "无法读取服务器计划";
  }
}
function buildPlanPayload() {
  if (planForm.accountIds.length < 2 || planForm.accountIds.length > 5) throw new Error("请选择 2–5 个服务器账号");
  if (!planForm.name.trim()) throw new Error("请填写计划名称");
  if (planForm.memberOrder.length !== planForm.accountIds.length || new Set(planForm.memberOrder).size !== planForm.accountIds.length || planForm.memberOrder.some((id) => !planForm.accountIds.includes(id))) throw new Error("出战顺序需要且只能包含已选账号");
  const settings = currentSettings(challengeId.value);
  return {
    name: planForm.name.trim(), accountIds: planForm.accountIds,
    leaderAccountId: planForm.leaderAccountId || planForm.accountIds[0],
    memberOrder: planForm.memberOrder, challengeId: challengeId.value, settings,
    enabled: editingPlanId.value ? planEnabled.value : true,
    schedule: planForm.scheduleType === "daily"
      ? { type: "daily", time: planForm.time || "08:00", timezone: "Asia/Shanghai" }
      : { type: "cron", expression: planForm.expression, timezone: "Asia/Shanghai" },
  };
}
async function saveHostedPlan() {
  try {
    busy.value = true;
    const body = buildPlanPayload();
    const path = editingPlanId.value ? `/nightmare-plans/${encodeURIComponent(editingPlanId.value)}` : "/nightmare-plans";
    const result = await hostedRequest(path, { method: editingPlanId.value ? "PATCH" : "POST", body });
    const plan = result.plan;
    const index = hostedPlans.value.findIndex((item) => item.id === plan.id);
    if (index >= 0) hostedPlans.value[index] = plan; else hostedPlans.value.push(plan);
    editingPlanId.value = "";
    showPlanForm.value = false;
    clearPlanQuery();
    message.success("服务器十殿计划已保存");
  } catch (error) { planError.value = error.message || "保存计划失败"; }
  finally { busy.value = false; }
}
function editHostedPlan(plan) {
  editingPlanId.value = plan.id;
  planForm.name = plan.name;
  planForm.accountIds = [...plan.accountIds];
  const savedOrder = plan.teamPlan?.memberOrder || plan.accountIds;
  planForm.memberOrder = [...savedOrder.filter((id) => plan.accountIds.includes(id)), ...plan.accountIds.filter((id) => !savedOrder.includes(id))];
  planForm.leaderAccountId = plan.teamPlan?.leaderAccountId || plan.accountIds[0];
  planEnabled.value = Boolean(plan.enabled);
  planForm.scheduleType = plan.schedule.type;
  if (plan.schedule.type === "daily") {
    const [minute, hour] = plan.schedule.value.split(" ");
    planForm.time = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  } else planForm.expression = plan.schedule.value;
  challengeId.value = plan.teamPlan?.challengeId || 1;
  hydrateAutomationSettings({ ...(plan.teamPlan?.settings || {}), challengeId: challengeId.value });
  showPlanForm.value = true;
  activeInnerTab.value = "team";
}
function clearPlanQuery() {
  if (!route.query.planId) return;
  const query = { ...route.query };
  delete query.planId;
  void router.replace({ query });
  handledPlanQueryId.value = "";
}
function toggleHostedPlanForm() {
  if (showPlanForm.value) { showPlanForm.value = false; return; }
  editingPlanId.value = "";
  planForm.name = "十殿定时挑战";
  planForm.accountIds = [];
  planForm.memberOrder = [];
  planForm.leaderAccountId = "";
  planForm.scheduleType = "daily";
  planForm.time = "08:00";
  planForm.expression = "0 8 * * *";
  planEnabled.value = true;
  hydrateAutomationSettings(localOptions());
  showPlanForm.value = true;
  activeInnerTab.value = "team";
  clearPlanQuery();
}
async function runHostedPlan(plan) {
  try { busy.value = true; const result = await hostedRequest(`/nightmare-plans/${encodeURIComponent(plan.id)}/run`, { method: "POST", body: {} }); log(`服务器计划「${plan.name}」已进入队列，团队占用 ${plan.accountIds.length} 个并发名额`, "success"); message.success(`已加入服务器队列（${result.count} 项）`); }
  catch (error) { planError.value = error.message || "运行计划失败"; }
  finally { busy.value = false; }
}
async function deleteHostedPlan(plan) {
  ask("删除服务器计划", `确定删除「${plan.name}」？`, async () => {
    try { busy.value = true; await hostedRequest(`/nightmare-plans/${encodeURIComponent(plan.id)}`, { method: "DELETE" }); hostedPlans.value = hostedPlans.value.filter((item) => item.id !== plan.id); if (editingPlanId.value === plan.id) { editingPlanId.value = ""; showPlanForm.value = false; } clearPlanQuery(); message.success("计划已删除"); }
    catch (error) { planError.value = error.message || "删除计划失败"; }
    finally { busy.value = false; }
  }, { scope: "none" });
}
function normalizeLocalPacket(packet) {
  const envelope = packet?._raw || packet || {};
  const cmd = String(envelope.cmd || envelope.resp || "").toLowerCase();
  if (!cmd.endsWith("nightmare_fightnotify") && !cmd.endsWith("nightmare_roominfo_notify")) return null;
  const body = packet?.rawData ?? packet?.decodedBody ?? envelope.rawData ?? envelope.decodedBody ?? packet?.body ?? envelope.body ?? {};
  return { body, envelope, cmd, code: Number(envelope.code ?? body.code ?? 0), seq: envelope.seq, receivedAt: Date.now() };
}
async function runBrowserTeam({ accountIds = selectedLocalTeam.value, leaderTokenId: requestedLeader = browserLeaderTokenId.value, plan = null } = {}) {
  if (browserRunning.value || accountIds.length < 2 || accountIds.length > 5) return;
  const records = new Map((tokenStore.gameTokens || []).map((item) => [item.id, item]));
  const tokens = accountIds.map((id) => records.get(id));
  if (tokens.some((item) => !item || tokenStore.getWebSocketStatus(item.id) !== "connected")) throw new Error("所有本地队伍角色都需要保持连接");
  const leaderToken = tokens.find((item) => item.id === requestedLeader) || tokens[0];
  const controller = new AbortController();
  activeController.value?.abort();
  activeController.value = controller;
  browserRunning.value = true;
  const unlisten = [];
  const waiters = new Set();
  const dedupe = new Set();
  const notify = (packet) => {
    const event = normalizeLocalPacket(packet);
    if (!event || event.code !== 0 || event.cmd !== "nightmare_fightnotify") return;
    const body = event.body;
    const key = `${field(body, "roleId", "")}|${field(body, "bossCfgId", "")}|${String(field(body, "result", ""))}|${event.seq ?? ""}`;
    if (dedupe.has(key)) return;
    dedupe.add(key);
    if (dedupe.size > 100) dedupe.delete(dedupe.values().next().value);
    for (const waiter of [...waiters]) waiter(event);
  };
  const waitForBattle = (roleId, timeout, { signal, bossId, afterTime = 0 } = {}) => {
    let timer;
    let abortHandler;
    let waiter;
    const promise = new Promise((resolve) => {
      const finish = (event = null) => {
        clearTimeout(timer);
        if (signal && abortHandler) signal.removeEventListener("abort", abortHandler);
        waiters.delete(waiter);
        resolve(event);
      };
      waiter = (event) => {
        if (event.receivedAt < afterTime || !isMatchingTenPalaceFightNotification(event, { roleId, bossId, afterTime })) return;
        finish(event);
      };
      waiter.cancel = () => finish(null);
      waiters.add(waiter);
      timer = setTimeout(() => finish(null), timeout);
      abortHandler = () => finish(null);
      signal?.addEventListener("abort", abortHandler, { once: true });
    });
    promise.cancel = () => waiter?.cancel?.();
    return promise;
  };
  try {
    for (const item of tokens) unlisten.push(tokenStore.addMessageListener(item.id, notify));
    const config = await loadTenPalaceConfig(tokenStore, leaderToken.id, globalThis.fetch, { check: () => {
      if (controller.signal.aborted || tokenStore.getWebSocketStatus(leaderToken.id) !== "connected") throw new Error("队长连接已断开或队伍任务已停止");
    } });
    const teamMembers = tokens.map((item) => ({
      roleId: toGameRoleId(item.roleId),
      accountId: item.id,
      send: (cmd, params, timeout) => {
        if (controller.signal.aborted) return Promise.reject(controller.signal.reason || new Error("队伍任务已停止"));
        if (tokenStore.getWebSocketStatus(item.id) !== "connected") return Promise.reject(new Error(`角色 ${item.roleId} 连接已断开`));
        return tokenStore.sendMessageWithPromise(item.id, cmd, params, timeout || 15000);
      },
      connected: () => tokenStore.getWebSocketStatus(item.id) === "connected",
      serverTime: () => Number(tokenStore.getWebSocketClient(item.id)?.serverTime || 0) || undefined,
    }));
    const settings = plan?.settings ? normalizeTenPalaceOptions({ ...plan.settings, challengeId: Number(plan.challengeId || challengeId.value) }) : currentSettings(challengeId.value);
    const result = await runTenPalaceTeam({
      members: teamMembers,
      config,
      settings,
      leaderRoleId: toGameRoleId(leaderToken.roleId),
      memberOrder: tokens.map((item) => toGameRoleId(item.roleId)),
      signal: controller.signal,
      onProgress: (event) => log(event.text, event.type),
      onCheckpoint: async (checkpoint) => { browserCheckpoint.value = checkpoint; },
      waitForBattle,
    });
    log(result.message || "浏览器十殿队伍任务完成", "success");
    message.success(result.message || "浏览器十殿任务完成");
    activeController.value = null;
    if (connected.value) await refresh({ throwOnError: true, allowDuringBrowserRun: true });
  } catch (error) {
    errorMessage.value = error.message || "浏览器十殿队伍执行失败";
    log(errorMessage.value, "error");
    if (!controller.signal.aborted) message.error(errorMessage.value);
  } finally {
    for (const stop of unlisten) stop?.();
    for (const waiter of [...waiters]) waiter.cancel?.();
    waiters.clear();
    if (activeController.value === controller) activeController.value = null;
    browserRunning.value = false;
  }
}
function stopBrowserTeam() {
  activeController.value?.abort(new Error("已停止浏览器十殿队伍任务"));
  log("已请求停止当前浏览器队伍；未解散游戏房间", "warning");
}

function startLocalSchedule() {
  if (localScheduleTimer.value) return;
  checkLocalSchedules();
  localScheduleTimer.value = setInterval(checkLocalSchedules, 15000);
}
function stopLocalSchedule() {
  clearInterval(localScheduleTimer.value);
  localScheduleTimer.value = null;
}

watch(selectedLocalTeam, (ids) => {
  if (!ids.includes(browserLeaderTokenId.value)) browserLeaderTokenId.value = ids[0] || "";
});
watch(() => planForm.accountIds, (accountIds) => {
  const nextOrder = planForm.memberOrder.filter((id) => accountIds.includes(id));
  for (const id of accountIds) if (!nextOrder.includes(id)) nextOrder.push(id);
  planForm.memberOrder = nextOrder;
  if (!accountIds.includes(planForm.leaderAccountId)) planForm.leaderAccountId = accountIds[0] || "";
}, { deep: true });
watch(() => route.query.planId, (value) => {
  const planId = String(value || "");
  if (!planId) { handledPlanQueryId.value = ""; return; }
  if (handledPlanQueryId.value === planId) return;
  handledPlanQueryId.value = planId;
  activeInnerTab.value = "team";
  void loadHostedPlans().then(() => {
    if (String(route.query.planId || "") !== planId) return;
    const plan = hostedPlans.value.find((item) => String(item.id) === planId);
    if (plan) editHostedPlan(plan);
    else if (!planError.value) planError.value = "找不到该服务器十殿计划，可能已删除或无权访问";
  });
}, { immediate: true });
function unbindTeamNotifications() {
  teamNotificationUnsubscribe?.();
  teamNotificationUnsubscribe = null;
  if (teamNotificationRefreshTimer) clearTimeout(teamNotificationRefreshTimer);
  teamNotificationRefreshTimer = null;
}
function bindTeamNotifications(id = tokenId.value) {
  unbindTeamNotifications();
  if (!id || !connected.value) return;
  teamNotificationUnsubscribe = tokenStore.addMessageListener(id, (packet) => {
    const envelope = packet?._raw || packet || {};
    const command = String(packet?.cmd || envelope.cmd || packet?.resp || "").toLowerCase();
    if (command !== "matchteam_notify") return;
    const body = packet?.rawData ?? packet?.decodedBody ?? envelope.rawData ?? envelope.decodedBody ?? packet?.body ?? envelope.body ?? {};
    const notifiedTeam = field(body, "matchTeamData", null);
    const notifiedTeamId = String(field(notifiedTeam, "teamId", field(body, "teamId", "")));
    if (!notifiedTeamId) return;
    const knownTeamMatches = Boolean(team.value && String(field(team.value, "teamId", "")) === notifiedTeamId &&
      isCompleteTeamInfo(team.value, notifiedTeamId, currentRoleId.value));
    const notificationContainsCurrentRole = isCompleteTeamInfo(notifiedTeam, notifiedTeamId, currentRoleId.value);
    if (!knownTeamMatches && !notificationContainsCurrentRole) return;
    if (teamNotificationRefreshTimer) return;
    const expectedGeneration = generation.value;
    teamNotificationRefreshTimer = setTimeout(() => {
      teamNotificationRefreshTimer = null;
      if (id !== tokenId.value || expectedGeneration !== generation.value || !connected.value || busy.value ||
        loading.value || roomLoading.value || browserRunning.value || showPlanForm.value || editingPlanId.value ||
        !["challenge", "team"].includes(activeInnerTab.value)) return;
      void refresh();
    }, 120);
  });
}
watch([tokenId, connected], ([id, isConnected], [previousId] = []) => {
  unbindTeamNotifications();
  generation.value++;
  activeController.value?.abort();
  snapshot.value = null;
  snapshotTokenId.value = "";
  room.value = null;
  team.value = null;
  formation.value = null;
  formationError.value = "";
  formationEmpty.value = false;
  formationUpdatedAt.value = 0;
  formationStatus.value = isConnected ? "正在读取当前角色的十殿专用阵容…" : "等待读取游戏内保存的十殿专用阵容。";
  errorMessage.value = "";
  market.value = null;
  loading.value = false;
  roomLoading.value = false;
  formationLoading.value = false;
  teamStatus.value = { status: "idle", message: "" };
  roomStatus.value = { status: isConnected ? "reading-role" : id ? "offline" : "idle", roomId: "", room: null, message: "", updatedAt: 0 };
  if (isConnected) bindTeamNotifications(id);
  if (isConnected) void refresh({ allowDuringBrowserRun: true });
  else if (id !== previousId && browserRunning.value) stopBrowserTeam();
}, { immediate: true });
onMounted(() => {
  void loadHostedPlans();
  startLocalSchedule();
});
onActivated(() => {
  bindTeamNotifications();
  startLocalSchedule();
  if (connected.value && !loading.value && !roomLoading.value && !busy.value) void refresh();
});
onDeactivated(() => {
  unbindTeamNotifications();
  stopLocalSchedule();
  if (browserRunning.value) stopBrowserTeam();
});
onUnmounted(() => {
  unbindTeamNotifications();
  generation.value++;
  activeController.value?.abort();
  stopLocalSchedule();
});
</script>

<style scoped>
.ten-palace { --tp-primary:#2563eb; --tp-border:#dce5f0; display:grid; gap:12px; min-width:0; color:#15253f; }
.ten-palace__toolbar { display:flex; align-items:center; justify-content:space-between; gap:10px; flex-wrap:wrap; }
.ten-palace__toolbar > div { display:grid; gap:2px; min-width:0; }
.ten-palace__toolbar strong { font-size:18px; }
.ten-palace__muted { color:#6e7c92; }
.ten-palace__wrap { overflow-wrap:anywhere; }
.ten-palace__grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:12px; }
.ten-palace__card-gap { margin-top:12px; }
.ten-palace__facts { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:10px 14px; }
.ten-palace__facts span { min-width:0; display:grid; gap:3px; color:#6e7c92; }
.ten-palace__facts b { color:#15253f; overflow-wrap:anywhere; }
.ten-palace__facts--summary { margin-bottom:12px; }
.ten-palace__actions { display:flex; flex-wrap:wrap; align-items:center; gap:8px; margin-top:12px; min-width:0; }
.ten-palace__actions > * { min-width:0; flex:1 1 150px; }
.ten-palace__formation { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:6px; margin:10px 0; }
.ten-palace__formation span, .ten-palace__members > div, .ten-palace__plans article { display:flex; align-items:center; justify-content:space-between; gap:8px; min-width:0; }
.ten-palace__members { display:grid; gap:6px; }
.ten-palace__members span { overflow-wrap:anywhere; }
.ten-palace__plan-form { display:grid; gap:8px; margin-top:12px; padding-top:12px; border-top:1px solid var(--tp-border); }
.ten-palace__plans { display:grid; gap:8px; margin-top:12px; }
.ten-palace__plans article { flex-wrap:wrap; padding:9px; border:1px solid var(--tp-border); border-radius:10px; }
.ten-palace__plans article > div { display:grid; flex:1 1 160px; min-width:0; }
.ten-palace__plans small { color:#6e7c92; overflow-wrap:anywhere; }
.ten-palace__charm-actions { margin:12px 0; }
.ten-palace__charm-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:10px; }
.ten-palace__charm-heading, .ten-palace__buy-row { display:flex; align-items:center; justify-content:space-between; gap:8px; min-width:0; }
.ten-palace__charm-heading b { overflow-wrap:anywhere; }
.ten-palace__charm-card p { margin:8px 0; }
.ten-palace__buy-row > span { color:#6e7c92; font-size:12px; }
.ten-palace__buy-row :deep(.n-input-number) { max-width:100px; }
.ten-palace__settings { border:1px solid var(--tp-border); border-radius:10px; padding:12px; }
.ten-palace__settings summary { cursor:pointer; font-weight:600; }
.ten-palace__settings-grid { display:grid; grid-template-columns:auto minmax(0,1fr); align-items:center; gap:10px; margin:12px 0; }
.ten-palace__records { display:grid; gap:7px; max-height:360px; overflow:auto; }
.ten-palace__records p { margin:0; overflow-wrap:anywhere; }
.ten-palace__records time { color:#6e7c92; font-variant-numeric:tabular-nums; }
.ten-palace__record--error { color:#c2414a; }
.ten-palace__record--success { color:#15803d; }
.ten-palace__alert { margin-top:10px; }
.ten-palace__dismiss { margin-top:12px; }
@media (max-width:640px) {
  .ten-palace__grid,.ten-palace__charm-grid { grid-template-columns:minmax(0,1fr); }
  .ten-palace__facts { grid-template-columns:minmax(0,1fr); }
  .ten-palace__formation { grid-template-columns:minmax(0,1fr); }
  .ten-palace__actions :deep(button) { min-height:44px; }
  .ten-palace__buy-row { flex-wrap:wrap; justify-content:flex-start; }
}
</style>
