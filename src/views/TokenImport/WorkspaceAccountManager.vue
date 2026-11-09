<template>
  <section class="workspace-account-manager" aria-labelledby="account-manager-title">
    <header class="account-manager-heading">
      <div>
        <p class="account-eyebrow">本机角色</p>
        <h2 id="account-manager-title">账号管理</h2>
        <p>管理保存在当前设备的游戏角色与凭据。</p>
      </div>
      <div class="account-heading-actions">
        <button class="account-button account-button--quiet" type="button" @click="$emit('bulkAction', 'import')">导入备份</button>
        <button class="account-button account-button--primary account-add-button" type="button" @click="$emit('openImport')">
          <span aria-hidden="true">＋</span> 添加游戏账号
        </button>
      </div>
    </header>

    <div v-if="rateLimitWaiting" class="account-alert" role="status">
      {{ rateLimitMessage }}
    </div>

    <div v-if="tokens.length" class="account-toolbar">
      <label class="account-search">
        <span class="sr-only">搜索角色</span>
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.8" cy="10.8" r="6.8"/><path d="m16 16 4.5 4.5"/></svg>
        <input v-model.trim="searchQuery" type="search" placeholder="搜索角色名、区服或备注" />
      </label>
      <div class="account-sort" aria-label="角色排序">
        <button v-for="option in sortOptions" :key="option.id" type="button" :aria-pressed="sortConfig.field === option.id" @click="$emit('sort', option.id)">
          {{ option.label }}<span v-if="sortConfig.field === option.id" aria-hidden="true">{{ sortConfig.direction === 'asc' ? ' ↑' : ' ↓' }}</span>
        </button>
      </div>
    </div>

    <div v-if="tokens.length" class="group-management">
      <div class="group-filter-list" aria-label="按分组筛选">
        <button type="button" :aria-pressed="selectedGroup === 'all'" @click="selectedGroup = 'all'">全部 <span>{{ tokens.length }}</span></button>
        <button type="button" :aria-pressed="selectedGroup === 'ungrouped'" @click="selectedGroup = 'ungrouped'">未分组 <span>{{ ungroupedCount }}</span></button>
        <button v-for="group in groups" :key="group.id" type="button" :aria-pressed="selectedGroup === group.id" @click="selectedGroup = group.id">
          <i :style="{ backgroundColor: group.color || '#2563eb' }" aria-hidden="true"></i>{{ group.name }} <span>{{ (group.tokenIds || []).length }}</span>
        </button>
      </div>
      <form class="create-group-form" @submit.prevent="createGroup">
        <input v-model.trim="newGroupName" aria-label="新分组名称" maxlength="32" placeholder="新分组名称" />
        <button class="account-button account-button--quiet" type="submit" :disabled="!newGroupName">新建分组</button>
      </form>
    </div>

    <div v-if="tokens.length" class="account-actions">
      <div class="multi-selection-summary">
        <label>
          <input type="checkbox" :checked="allMultiGameTokensSelected" :disabled="!tokens.length || isOpeningMultiGame" @change="$emit($event.target.checked ? 'selectAll' : 'clearSelection')" />
          批量选择 <strong>{{ multiGameSelectedTokenIds.size }}</strong>
        </label>
        <button v-if="multiGameSelectedTokenIds.size" type="button" class="text-button" @click="$emit('clearSelection')">清空</button>
      </div>
      <div class="account-action-buttons">
        <button class="account-button account-button--secondary" type="button" :disabled="!multiGameSelectedTokenIds.size || isOpeningMultiGame" @click="$emit('openMultiGame')">
          {{ isOpeningMultiGame ? '正在准备…' : `批量进入游戏（${multiGameSelectedTokenIds.size}）` }}
        </button>
        <button class="account-button account-button--secondary" type="button" :disabled="!selectedTokenId" @click="$emit('openGame')">打开当前角色游戏</button>
        <button class="account-button account-button--secondary" type="button" @click="$emit('openFeatures')">游戏功能</button>
        <button class="account-button account-button--secondary" type="button" @click="$emit('openPushing')">主线推关</button>
        <details class="bulk-actions">
          <summary class="account-button account-button--quiet">批量操作</summary>
          <div class="bulk-actions-menu">
            <button v-for="option in bulkOptions" :key="option.key" type="button" @click="closeDetailsAndEmit($event, 'bulkAction', option.key)">{{ option.label }}</button>
          </div>
        </details>
      </div>
    </div>

    <div v-if="visibleTokens.length" class="account-card-grid">
      <article v-for="token in visibleTokens" :key="token.id" class="account-card" :class="{ 'account-card--selected': selectedTokenId === token.id }">
        <header class="account-card-heading" @click="$emit('selectToken', token)">
          <label class="account-card-checkbox" :aria-label="`选择 ${token.name} 批量进入游戏`" @click.stop>
            <input type="checkbox" :checked="multiGameSelectedTokenIds.has(token.id)" :disabled="isOpeningMultiGame" @click.stop @change="$emit('toggleMulti', token.id, $event.target.checked)" />
          </label>
          <img v-if="token.avatar" class="account-avatar" :src="token.avatar" alt="" />
          <span v-else class="account-avatar account-avatar--fallback" aria-hidden="true">{{ token.name?.slice(0, 1) || '角' }}</span>
          <div class="account-identity">
            <h3>{{ token.name || '未命名角色' }}</h3>
            <p>{{ token.server || '未填写区服' }}<span v-if="token.roleId"> · {{ token.roleId }}</span></p>
          </div>
          <div class="account-status-group">
            <span
              class="hosted-sync-badge"
              :class="{ 'is-synced': isHostedSynced(token) }"
              :title="isHostedSynced(token) ? '已同步到云端托管' : '点击同步到云端托管'"
              @click.stop="$emit('syncHosted', token)"
            >
              <i aria-hidden="true"></i>{{ isHostedSynced(token) ? '托管就绪' : '未托管' }}
            </span>
            <span class="connection-status" :class="`connection-status--${getTokenStyle(token.id)}`">
              <i aria-hidden="true"></i>{{ getConnectionStatusText(token.id) }}
            </span>
          </div>
        </header>

        <div class="account-token-row">
          <span>Token</span><code>{{ maskToken(token.token) }}</code>
          <button class="text-button" type="button" @click="$emit('tokenAction', 'copy', token)">复制</button>
        </div>

        <div class="account-meta">
          <div class="account-remark">
            <span>备注</span>
            <input
              v-if="editingRemark === token.id"
              :value="tempRemarks[token.id] || ''"
              aria-label="角色备注"
              placeholder="添加备注"
              @input="$emit('updateRemark', token.id, $event.target.value)"
              @blur="$emit('saveRemark', token)"
              @keyup.enter="$emit('saveRemark', token)"
              @keyup.esc="$emit('cancelRemark')"
            />
            <button v-else type="button" class="text-button account-remark-value" @click="$emit('editRemark', token)">{{ token.remark || '添加备注' }}</button>
          </div>
          <div class="account-storage">
            <span>{{ isLongTerm(token) ? '长期有效' : '临时凭据' }}</span>
            <button v-if="!isLongTerm(token)" class="text-button" type="button" @click="$emit('upgradeToken', token)">升级</button>
          </div>
          <div class="account-timestamps">
            <span>创建 {{ formatTime(token.createdAt) }}</span>
            <span>使用 {{ formatTime(token.lastUsed) }}</span>
          </div>
        </div>

        <details class="account-group-editor">
          <summary>角色分组</summary>
          <p v-if="!groups.length" class="group-empty-hint">新建分组后，可在这里整理角色。</p>
          <label v-for="group in groups" :key="group.id">
            <input type="checkbox" :checked="(group.tokenIds || []).includes(token.id)" @change="$emit('groupMembership', group.id, token.id, $event.target.checked)" />
            <i :style="{ backgroundColor: group.color || '#2563eb' }" aria-hidden="true"></i>{{ group.name }}
          </label>
        </details>

        <footer class="account-card-actions">
          <button class="account-button account-button--primary" type="button" :disabled="connectingTokens.has(token.id)" @click="$emit('selectToken', token)">
            {{ selectedTokenId === token.id && getTokenStyle(token.id) === 'success' ? '断开连接' : selectedTokenId === token.id ? '重新连接' : '设为当前角色' }}
          </button>
          <button class="account-button account-button--secondary" type="button" @click="$emit('startTaskManagement', token)">日常功能</button>
          <button class="account-button account-button--secondary" type="button" @click="$emit('tokenAction', 'edit', token)">编辑</button>
          <button class="account-button account-button--secondary" type="button" :disabled="refreshingTokens.has(token.id)" @click="$emit('refreshToken', token)">{{ refreshingTokens.has(token.id) ? '刷新中…' : token.sourceUrl ? '刷新' : '重新获取' }}</button>
          <button class="account-button account-button--quiet" type="button" :disabled="syncingHostedTokens.has(token.id)" @click="$emit('syncHosted', token)">
            {{ syncingHostedTokens.has(token.id) ? '同步中…' : isHostedSynced(token) ? '更新托管' : '同步托管' }}
          </button>
          <details class="account-more-actions">
            <summary aria-label="更多账号操作">•••</summary>
            <div class="bulk-actions-menu">
              <button type="button" @click="closeDetailsAndEmit($event, 'syncHosted', token)">同步到云端托管</button>
              <button type="button" @click="closeDetailsAndEmit($event, 'tokenAction', 'download-bin', token)">下载 BIN</button>
              <button type="button" @click="closeDetailsAndEmit($event, 'startTaskManagement', token)">进入控制台</button>
              <button class="danger-action" type="button" @click="closeDetailsAndEmit($event, 'tokenAction', 'delete', token)">删除角色</button>
            </div>
          </details>
        </footer>
      </article>
    </div>

    <div v-else-if="tokens.length" class="account-empty-state">
      <h3>没有找到匹配的角色</h3>
      <p>更换搜索内容或分组筛选条件后再试。</p>
      <button type="button" class="account-button account-button--quiet" @click="clearFilters">清除筛选</button>
    </div>
    <div v-else class="account-empty-state account-empty-state--first">
      <span class="empty-account-mark" aria-hidden="true">＋</span>
      <h3>还没有本地游戏账号</h3>
      <p>添加角色后，可在这里连接账号、管理凭据并打开游戏工具。</p>
      <button type="button" class="account-button account-button--primary" @click="$emit('openImport')">添加游戏账号</button>
    </div>

    <Teleport to="body">
      <div v-if="showImportForm" class="account-import-overlay" @click.self="$emit('closeImport')">
        <section ref="importSheetRef" class="account-import-sheet" role="dialog" aria-modal="true" aria-labelledby="account-import-title" tabindex="-1">
          <header class="account-import-heading">
            <div>
              <p class="account-eyebrow">本机账号</p>
              <h2 id="account-import-title">添加游戏账号</h2>
              <p>选择一种方式导入角色凭据。</p>
            </div>
            <button class="account-close-button" type="button" aria-label="关闭添加账号" @click="$emit('closeImport')">×</button>
          </header>
          <nav class="account-import-methods" aria-label="导入方式">
            <button v-for="method in importMethods" :key="method.id" type="button" role="tab" :aria-selected="importMethod === method.id" @click="$emit('update:import-method', method.id)">{{ method.label }}</button>
          </nav>
          <div class="account-import-content">
            <slot name="import-form" />
          </div>
        </section>
      </div>
    </Teleport>
  </section>
</template>

<script setup>
import { computed, ref } from "vue";

const props = defineProps({
  tokens: { type: Array, default: () => [] },
  groups: { type: Array, default: () => [] },
  selectedTokenId: { type: String, default: "" },
  multiGameSelectedTokenIds: { type: Object, default: () => new Set() },
  allMultiGameTokensSelected: Boolean,
  isOpeningMultiGame: Boolean,
  refreshingTokens: { type: Object, default: () => new Set() },
  connectingTokens: { type: Object, default: () => new Set() },
  rateLimitWaiting: Boolean,
  rateLimitMessage: { type: String, default: "" },
  importMethod: { type: String, default: "manual" },
  showImportForm: Boolean,
  bulkOptions: { type: Array, default: () => [] },
  sortConfig: { type: Object, default: () => ({ field: "createdAt", direction: "asc" }) },
  getTokenStyle: { type: Function, default: () => "danger" },
  getConnectionStatusText: { type: Function, default: () => "未连接" },
  maskToken: { type: Function, default: () => "" },
  formatTime: { type: Function, default: () => "—" },
  isLongTerm: { type: Function, default: () => false },
  editingRemark: { type: String, default: null },
  tempRemarks: { type: Object, default: () => ({}) },
  hostedSyncedRoleIds: { type: Object, default: () => new Set() },
  syncingHostedTokens: { type: Object, default: () => new Set() },
});

const emit = defineEmits([
  "openImport", "closeImport", "update:import-method", "selectToken",
  "tokenAction", "refreshToken", "upgradeToken", "startTaskManagement",
  "openGame", "openMultiGame", "openFeatures", "openPushing", "bulkAction",
  "sort", "selectAll", "clearSelection", "toggleMulti", "editRemark",
  "updateRemark", "saveRemark", "cancelRemark", "createGroup", "groupMembership",
  "syncHosted",
]);

const focusableSelector =
  "a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])";

function handleImportKeydown(event) {
  if (event.key === "Escape") {
    event.preventDefault();
    emit("closeImport");
    return;
  }
  if (event.key !== "Tab") return;
  const elements = [...(importSheetRef.value?.querySelectorAll(focusableSelector) || [])]
    .filter((element) => element.getAttribute("aria-hidden") !== "true");
  if (!elements.length) {
    event.preventDefault();
    importSheetRef.value?.focus();
    return;
  }
  const first = elements[0];
  const last = elements[elements.length - 1];
  if (event.shiftKey && (document.activeElement === first || !importSheetRef.value?.contains(document.activeElement))) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && (document.activeElement === last || !importSheetRef.value?.contains(document.activeElement))) {
    event.preventDefault();
    first.focus();
  }
}

function releaseImportSheet() {
  document.removeEventListener("keydown", handleImportKeydown);
  if (previousBodyOverflow !== null) {
    document.body.style.overflow = previousBodyOverflow;
    previousBodyOverflow = null;
  }
  const target = lastFocusedElement;
  lastFocusedElement = null;
  if (target?.isConnected) nextTick(() => target.focus({ preventScroll: true }));
}

watch(
  () => props.showImportForm,
  async (open) => {
    if (!open) {
      releaseImportSheet();
      return;
    }
    lastFocusedElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    await nextTick();
    if (!props.showImportForm) return;
    document.addEventListener("keydown", handleImportKeydown);
    importSheetRef.value?.querySelector(".account-close-button")?.focus();
  },
  { flush: "post" },
);

onBeforeUnmount(releaseImportSheet);

const searchQuery = ref("");
const selectedGroup = ref("all");
const newGroupName = ref("");
const importSheetRef = ref(null);
let lastFocusedElement = null;
let previousBodyOverflow = null;
const sortOptions = [
  { id: "name", label: "名称" },
  { id: "server", label: "区服" },
  { id: "createdAt", label: "创建时间" },
  { id: "lastUsed", label: "最近使用" },
];
const importMethods = [
  { id: "manual", label: "手动输入" },
  { id: "url", label: "URL 获取" },
  { id: "wxQrcode", label: "微信扫码" },
  { id: "mobile", label: "手机号验证码" },
  { id: "bin", label: "BIN 多角色" },
  { id: "singlebin", label: "BIN 单角色" },
];
const ungroupedCount = computed(() =>
  props.tokens.filter((token) => !props.groups.some((group) => (group.tokenIds || []).includes(token.id))).length,
);
const visibleTokens = computed(() => {
  const query = searchQuery.value.toLocaleLowerCase();
  return props.tokens.filter((token) => {
    const matchesQuery = !query || [token.name, token.server, token.remark].some((value) => String(value || "").toLocaleLowerCase().includes(query));
    const memberships = props.groups.filter((group) => (group.tokenIds || []).includes(token.id));
    const matchesGroup = selectedGroup.value === "all"
      || (selectedGroup.value === "ungrouped" && memberships.length === 0)
      || memberships.some((group) => group.id === selectedGroup.value);
    return matchesQuery && matchesGroup;
  });
});

function createGroup() {
  const name = newGroupName.value.trim();
  if (!name) return;
  emit("createGroup", name);
  newGroupName.value = "";
}

function clearFilters() {
  searchQuery.value = "";
  selectedGroup.value = "all";
}

function isHostedSynced(token) {
  if (!token) return false;
  return Boolean(
    (token.roleId && props.hostedSyncedRoleIds.has(token.roleId)) ||
      props.hostedSyncedRoleIds.has(token.id),
  );
}

function closeDetailsAndEmit(event, eventName, ...args) {
  const details = event?.currentTarget?.closest?.("details");
  if (details) details.open = false;
  emit(eventName, ...args);
}
</script>

<style scoped>
.workspace-account-manager {
  --account-ink: #15253f;
  --account-muted: #6e7c92;
  --account-border: #e4ebf4;
  --account-surface: #ffffff;
  --account-soft: #f8fafd;
  --account-blue: #2563eb;
  --account-blue-soft: #edf3ff;
  box-sizing: border-box;
  min-height: 100%;
  padding: 20px;
  color: var(--account-ink);
  background: #f3f6fb;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
}
.workspace-account-manager *,
.workspace-account-manager *::before,
.workspace-account-manager *::after { box-sizing: border-box; }
.account-manager-heading,
.account-toolbar,
.group-management,
.account-actions { display: flex; align-items: center; justify-content: space-between; gap: 14px; }
.account-manager-heading { margin-bottom: 17px; }
.account-heading-actions { display: flex; align-items: center; flex-wrap: wrap; gap: 7px; }
.account-eyebrow { margin: 0 0 4px; color: var(--account-muted); font-size: 11px; font-weight: 700; letter-spacing: .08em; }
.account-manager-heading h2,
.account-import-heading h2 { margin: 0; color: var(--account-ink); font-size: 22px; line-height: 1.25; }
.account-manager-heading p:last-child,
.account-import-heading p:last-child { margin: 5px 0 0; color: var(--account-muted); font-size: 12px; }
.account-button { display: inline-flex; min-height: 44px; align-items: center; justify-content: center; gap: 6px; padding: 0 12px; border: 1px solid transparent; border-radius: 10px; cursor: pointer; font: inherit; font-size: 13px; font-weight: 640; white-space: nowrap; }
.account-button:disabled { opacity: .55; cursor: not-allowed; }
.account-button--primary { color: #fff; background: var(--account-blue); }
.account-button--primary:hover:not(:disabled) { background: #1d4ed8; }
.account-button--secondary { border-color: var(--account-border); color: var(--account-ink); background: #fff; }
.account-button--secondary:hover:not(:disabled),
.account-button--quiet:hover:not(:disabled) { border-color: #b9cff8; color: var(--account-blue); background: #f6f9ff; }
.account-button--quiet { border-color: var(--account-border); color: #52647d; background: #fff; }
.account-add-button { min-height: 44px; padding: 0 16px; font-size: 13px; }
.account-add-button > span { font-size: 19px; line-height: 1; }
.account-alert { margin-bottom: 13px; padding: 10px 12px; border: 1px solid #f2d7a0; border-radius: 10px; color: #805b12; background: #fff9e8; font-size: 12px; }
.account-toolbar { align-items: stretch; margin-bottom: 12px; }
.account-search { display: flex; min-width: 0; max-width: 520px; min-height: 48px; flex: 1 1 auto; align-items: center; gap: 8px; padding: 0 12px; border: 1px solid var(--account-border); border-radius: 11px; background: #fff; }
.account-search svg { width: 18px; height: 18px; flex: 0 0 auto; fill: none; stroke: #8190a4; stroke-linecap: round; stroke-width: 1.7; }
.account-search input { width: 100%; min-width: 0; border: 0; outline: 0; color: var(--account-ink); background: transparent; font: inherit; font-size: 14px; }
.account-sort { display: flex; flex: 0 0 auto; align-items: center; gap: 3px; padding: 3px; border: 1px solid var(--account-border); border-radius: 11px; background: #fff; overflow-x: auto; }
.account-sort button { min-height: 40px; padding: 0 8px; border: 0; border-radius: 8px; color: var(--account-muted); background: transparent; cursor: pointer; font: inherit; font-size: 12px; white-space: nowrap; }
.account-sort button[aria-pressed="true"] { color: var(--account-blue); background: var(--account-blue-soft); }
.group-management { align-items: flex-start; margin-bottom: 12px; }
.group-filter-list { display: flex; min-width: 0; flex: 1 1 auto; gap: 6px; overflow-x: auto; padding: 1px 0 5px; scrollbar-width: thin; }
.group-filter-list button { display: inline-flex; min-height: 32px; flex: 0 0 auto; align-items: center; gap: 6px; padding: 0 9px; border: 1px solid var(--account-border); border-radius: 999px; color: #50627b; background: #fff; cursor: pointer; font: inherit; font-size: 11px; white-space: nowrap; }
.group-filter-list button[aria-pressed="true"] { border-color: #bfd2fb; color: var(--account-blue); background: var(--account-blue-soft); }
.group-filter-list button span { color: var(--account-muted); font-size: 10px; }
.group-filter-list i,
.account-group-editor i { width: 8px; height: 8px; flex: 0 0 auto; border-radius: 50%; }
.create-group-form { display: flex; flex: 0 0 auto; gap: 5px; }
.create-group-form input { width: 118px; min-width: 0; height: 32px; padding: 0 8px; border: 1px solid var(--account-border); border-radius: 8px; color: var(--account-ink); background: #fff; font: inherit; font-size: 11px; }
.create-group-form .account-button { min-height: 32px; padding: 0 8px; font-size: 10px; }
.account-actions { align-items: flex-start; flex-wrap: wrap; margin-bottom: 14px; padding: 10px; border: 1px solid var(--account-border); border-radius: 12px; background: #fff; }
.multi-selection-summary { display: flex; min-height: 34px; flex: 0 0 auto; align-items: center; gap: 8px; color: #53657e; font-size: 11px; }
.multi-selection-summary label { display: inline-flex; align-items: center; gap: 6px; }
.multi-selection-summary input,
.account-card-checkbox input,
.account-group-editor input { accent-color: var(--account-blue); }
.multi-selection-summary strong { color: var(--account-ink); }
.text-button { padding: 0; border: 0; color: var(--account-blue); background: transparent; cursor: pointer; font: inherit; font-size: 11px; }
.account-action-buttons { display: flex; flex: 1 1 auto; align-items: center; justify-content: flex-end; flex-wrap: wrap; gap: 6px; }
.account-action-buttons .account-button { min-height: 44px; padding: 0 11px; font-size: 13px; }
.bulk-actions,
.account-more-actions { position: relative; }
.bulk-actions > summary,
.account-more-actions > summary { list-style: none; cursor: pointer; }
.bulk-actions > summary::-webkit-details-marker,
.account-more-actions > summary::-webkit-details-marker { display: none; }
.bulk-actions-menu { position: absolute; z-index: 20; top: calc(100% + 5px); right: 0; display: grid; min-width: 160px; padding: 5px; border: 1px solid var(--account-border); border-radius: 10px; background: #fff; box-shadow: 0 8px 22px rgba(21,37,63,.12); }
.bulk-actions-menu button { min-height: 34px; padding: 0 9px; border: 0; border-radius: 7px; color: var(--account-ink); background: transparent; cursor: pointer; font: inherit; font-size: 11px; text-align: left; white-space: nowrap; }
.bulk-actions-menu button:hover { background: var(--account-soft); }
.bulk-actions-menu .danger-action { color: #b42318; }
.account-card-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.account-card { min-width: 0; padding: 14px; border: 1px solid var(--account-border); border-radius: 13px; background: #fff; box-shadow: 0 2px 8px rgba(21,37,63,.025); }
.account-card--selected { border-color: #8eaff3; box-shadow: 0 0 0 2px rgba(37,99,235,.08); }
.account-card-heading { display: flex; min-width: 0; align-items: center; gap: 9px; }
.account-card-checkbox { display: grid; width: 22px; height: 34px; flex: 0 0 auto; place-items: center; }
.account-avatar { width: 36px; height: 36px; flex: 0 0 auto; border-radius: 11px; object-fit: cover; }
.account-avatar--fallback { display: grid; place-items: center; color: #1d4ed8; background: #edf3ff; font-size: 14px; font-weight: 700; }
.account-identity { min-width: 0; flex: 1 1 auto; }
.account-identity h3 { overflow: hidden; margin: 0; color: var(--account-ink); font-size: 16px; font-weight: 680; text-overflow: ellipsis; white-space: nowrap; }
.account-identity p { overflow: hidden; margin: 3px 0 0; color: var(--account-muted); font-size: 13px; text-overflow: ellipsis; white-space: nowrap; }
.account-status-group {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 4px;
  flex: 0 0 auto;
}
.hosted-sync-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 1px 7px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 600;
  color: #64748b;
  background: #f1f5f9;
  border: 1px solid #e2e8f0;
  cursor: pointer;
  transition: all 140ms ease;
}
.hosted-sync-badge i {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #94a3b8;
}
.hosted-sync-badge.is-synced {
  color: #15803d;
  background: #f0fdf4;
  border-color: #bbf7d0;
}
.hosted-sync-badge.is-synced i {
  background: #22c55e;
}
.connection-status { display: inline-flex; flex: 0 0 auto; align-items: center; gap: 5px; color: var(--account-muted); font-size: 12px; white-space: nowrap; }
.connection-status i { width: 7px; height: 7px; border-radius: 50%; background: #9aa7b8; }
.connection-status--success { color: #18794e; }
.connection-status--success i { background: #25a56a; }
.connection-status--warning { color: #9a6700; }
.connection-status--warning i { background: #d89a16; }
.connection-status--danger { color: #b42318; }
.connection-status--danger i { background: #d92d20; }
.account-token-row { display: flex; min-width: 0; align-items: center; gap: 7px; margin-top: 12px; padding: 8px 9px; border-radius: 9px; background: #f8fafd; }
.account-token-row > span { flex: 0 0 auto; color: var(--account-muted); font-size: 10px; }
.account-token-row code { min-width: 0; flex: 1 1 auto; overflow: hidden; color: #43546b; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }
.account-token-row .text-button { flex: 0 0 auto; }
.account-meta { display: grid; grid-template-columns: minmax(0,1fr) auto; gap: 8px 12px; margin-top: 10px; }
.account-remark,
.account-storage { display: flex; min-width: 0; align-items: center; gap: 6px; }
.account-remark > span,
.account-storage > span { flex: 0 0 auto; color: var(--account-muted); font-size: 10px; }
.account-remark-value { max-width: 100%; overflow: hidden; color: #52647d; text-overflow: ellipsis; white-space: nowrap; text-align: left; }
.account-remark input { width: 100%; min-width: 0; height: 28px; padding: 0 7px; border: 1px solid #bfd2fb; border-radius: 7px; color: var(--account-ink); background: #fff; font: inherit; font-size: 11px; }
.account-storage > span { padding: 3px 7px; border-radius: 999px; color: #18794e; background: #eaf6ef; white-space: nowrap; }
.account-timestamps { display: flex; grid-column: 1 / -1; justify-content: space-between; gap: 8px; color: #8491a3; font-size: 10px; }
.account-group-editor { margin-top: 10px; padding-top: 9px; border-top: 1px solid #edf1f6; }
.account-group-editor summary { color: #52647d; cursor: pointer; font-size: 10px; }
.account-group-editor label { display: inline-flex; min-height: 28px; align-items: center; gap: 6px; margin: 6px 8px 0 0; color: #52647d; font-size: 10px; }
.group-empty-hint { margin: 7px 0 0; color: var(--account-muted); font-size: 10px; }
.account-card-actions { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; margin-top: 12px; }
.account-card-actions .account-button { min-height: 44px; padding: 0 11px; font-size: 13px; }
.account-more-actions { margin-left: auto; }
.account-more-actions > summary { display: grid; width: 34px; height: 32px; place-items: center; border: 1px solid var(--account-border); border-radius: 8px; color: #52647d; background: #fff; font-size: 14px; }
.account-empty-state { display: grid; min-height: 180px; align-content: center; justify-items: center; gap: 8px; padding: 24px; border: 1px dashed #cad5e3; border-radius: 14px; background: #fff; text-align: center; }
.account-empty-state h3 { margin: 0; color: var(--account-ink); font-size: 15px; }
.account-empty-state p { max-width: 340px; margin: 0; color: var(--account-muted); font-size: 12px; line-height: 1.5; }
.account-empty-state--first { min-height: 260px; }
.empty-account-mark { display: grid; width: 46px; height: 46px; place-items: center; border-radius: 14px; color: var(--account-blue); background: var(--account-blue-soft); font-size: 28px; }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0; }

.account-import-overlay { --bg-primary: #fff; --bg-secondary: #f3f6fb; --bg-tertiary: #f8fafd; --text-primary: #15253f; --text-secondary: #52647d; --text-tertiary: #6e7c92; --border-light: #e4ebf4; --border-medium: #cbd5e1; --primary-color: #2563eb; --success-color: #18794e; --warning-color: #9a6700; --error-color: #b42318; position: fixed; z-index: 10000; inset: 0; display: flex; align-items: center; justify-content: center; padding: 16px; color: #15253f; color-scheme: light; background: rgba(15,23,42,.48); }
.account-import-sheet { display: flex; width: min(680px, 100%); max-height: min(84dvh, 820px); flex-direction: column; overflow: hidden; border: 1px solid #e4ebf4; border-radius: 18px; color: #15253f; background: #fff; box-shadow: 0 24px 70px rgba(15,23,42,.24); }
.account-import-heading { display: flex; flex: 0 0 auto; align-items: flex-start; justify-content: space-between; gap: 12px; padding: 18px 20px 14px; border-bottom: 1px solid #e9eef5; }
.account-close-button { display: grid; width: 38px; height: 38px; flex: 0 0 auto; place-items: center; border: 1px solid var(--account-border); border-radius: 10px; color: #52647d; background: #fff; cursor: pointer; font-size: 22px; }
.account-import-methods { display: grid; flex: 0 0 auto; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 7px; padding: 13px 18px 10px; }
.account-import-methods button { min-width: 0; min-height: 44px; padding: 6px 8px; border: 1px solid #e4ebf4; border-radius: 10px; color: #52647d; background: #fff; cursor: pointer; font: inherit; font-size: 12px; font-weight: 600; line-height: 1.3; }
.account-import-methods button[aria-selected="true"] { border-color: #b9cff8; color: #1d4ed8; background: #edf3ff; }
.account-import-content { min-height: 0; overflow: auto; padding: 12px 20px 20px; overscroll-behavior: contain; font-size: 14px; }
.account-import-content :deep(.n-form-item-label) { color: #354761; }
.account-import-content :deep(.n-input),
.account-import-content :deep(.n-base-selection) { color: #15253f; background-color: #fff; }
.account-import-content :deep(.n-button) { min-height: 42px; }
.account-import-content :deep(.n-collapse-item__header) { color: #354761; }
.account-import-content :deep(.optional-fields) { display: grid; grid-template-columns: repeat(2, minmax(0,1fr)); gap: 10px; }
@media (max-width: 760px) {
  .workspace-account-manager { padding: 13px; }
  .account-manager-heading { align-items: flex-start; flex-wrap: wrap; }
  .account-heading-actions { width: 100%; justify-content: flex-end; }
  .account-manager-heading h2 { font-size: 20px; }
  .account-manager-heading p:last-child { max-width: 210px; font-size: 11px; }
  .account-add-button { min-height: 44px; padding: 0 10px; font-size: 12px; }
  .account-toolbar { flex-direction: column; gap: 8px; }
  .account-search { max-width: none; min-height: 40px; }
  .account-sort { width: 100%; }
  .account-sort button { flex: 1 0 auto; }
  .group-management { align-items: stretch; flex-direction: column; gap: 6px; }
  .create-group-form { align-self: flex-end; }
  .account-actions { align-items: stretch; flex-direction: column; gap: 6px; padding: 8px; }
  .account-action-buttons { justify-content: flex-start; }
  .account-action-buttons .account-button { flex: 1 1 auto; }
  .account-card-grid { grid-template-columns: minmax(0,1fr); gap: 8px; }
  .account-card { padding: 12px; }
  .account-import-overlay { align-items: flex-end; padding: 0; }
  .account-import-sheet { width: 100%; max-height: 88dvh; border-radius: 18px 18px 0 0; }
  .account-import-heading { padding: 15px 16px 12px; }
  .account-import-heading h2 { font-size: 19px; }
  .account-import-methods { gap: 6px; padding: 10px 12px 8px; }
  .account-import-methods button { min-height: 46px; padding: 5px 4px; font-size: 12px; }
  .account-import-content { padding: 10px 15px calc(18px + env(safe-area-inset-bottom)); }
  .account-import-content :deep(.optional-fields) { grid-template-columns: minmax(0,1fr); gap: 0; }
}
@media (max-width: 360px) {
  .workspace-account-manager { padding: 10px; }
  .account-manager-heading { gap: 8px; }
  .account-manager-heading p:last-child { max-width: 170px; }
  .account-add-button { min-height: 44px; padding: 0 8px; font-size: 12px; }
  .account-import-methods { gap: 5px; padding-right: 9px; padding-left: 9px; }
  .account-import-methods button { min-height: 45px; font-size: 12px; }
}
</style>
