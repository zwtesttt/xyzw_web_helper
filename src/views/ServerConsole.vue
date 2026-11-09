<template>
  <main class="hosted-page" :class="{ 'hosted-page--embedded': props.embedded }" :aria-busy="busy">
    <section v-if="!user" class="auth-screen" aria-labelledby="auth-title">
      <div class="auth-brand">
        <span class="brand-mark"
          ><img src="/icons/xiaoyugan.png" alt=""
        /></span>
        <div class="auth-brand__text">
          <p class="eyebrow">游戏账号 · 后台任务</p>
          <h1>咸鱼托管</h1>
        </div>
        <router-link v-if="!props.embedded" to="/tokens" class="button button--secondary button--small auth-back-link">
          返回本地角色
        </router-link>
        <button v-else type="button" class="button button--secondary button--small auth-back-link" @click="workspaceNavigation.push('/tokens')">
          返回本地角色
        </button>
      </div>

      <div class="auth-card">
        <div class="auth-heading">
          <p class="section-kicker">服务器账号</p>
          <h2 id="auth-title">
            {{ registering ? "创建托管账号" : "登录托管账号" }}
          </h2>
          <p>登录后管理服务器账号与定时任务。账号凭据由服务器加密保存。</p>
        </div>

        <p
          v-if="error"
          class="feedback feedback--error"
          role="alert"
          aria-live="polite"
        >
          {{ error }}
        </p>
        <p
          v-if="notice"
          class="feedback feedback--notice"
          role="status"
          aria-live="polite"
        >
          {{ notice }}
        </p>

        <div class="auth-switch" role="group" aria-label="登录或注册">
          <button
            type="button"
            :aria-pressed="!registering"
            @click="setAuthMode(false)"
          >
            登录
          </button>
          <button
            type="button"
            :aria-pressed="registering"
            @click="setAuthMode(true)"
          >
            注册
          </button>
        </div>

        <form class="auth-form" @submit.prevent="submitAuth">
          <div class="field">
            <label for="hosted-username">用户名</label>
            <input
              id="hosted-username"
              v-model.trim="authForm.username"
              autocomplete="username"
              placeholder="请输入用户名"
              required
              minlength="3"
              maxlength="32"
              aria-describedby="hosted-username-help"
            />
            <p id="hosted-username-help" class="field-hint">
              3–32 位字母、数字、点、短横线或下划线
            </p>
          </div>
          <div class="field">
            <label for="hosted-password">密码</label>
            <input
              id="hosted-password"
              v-model="authForm.password"
              :autocomplete="registering ? 'new-password' : 'current-password'"
              type="password"
              :placeholder="registering ? '设置至少 10 位密码' : '请输入密码'"
              required
              minlength="10"
              maxlength="128"
            />
            <p v-if="registering" class="field-hint">至少 10 个字符，建议包含字母与数字</p>
          </div>
          <button class="button button--primary button--wide" :disabled="busy">
            {{ busy ? "请稍候…" : registering ? "注册并登录" : "登录" }}
          </button>
        </form>
        <p class="auth-note">
          定时任务由服务器执行；关闭浏览器后仍会按计划运行。
        </p>
      </div>
      <p class="auth-footer">咸鱼托管 · 服务器任务管理</p>
    </section>

    <div v-else class="app-shell">
      <div v-if="props.embedded" class="embedded-auth-row" aria-label="托管账号控制">
        <span class="user-chip" :title="`已登录：${user.username}`">
          <span class="user-chip__dot" aria-hidden="true"></span>
          <span class="user-chip__name">{{ user.username }}</span>
        </span>
        <span v-if="activeRunsCount > 0" class="running-chip" role="status" aria-live="polite">
          <span class="running-chip__dot" aria-hidden="true"></span>
          <span>{{ activeRunsCount }} 项执行中</span>
        </span>
        <div class="embedded-auth-actions">
          <button
            class="button button--quiet header-action--refresh"
            type="button"
            :aria-label="busy ? '正在刷新托管信息' : '刷新托管信息'"
            :title="busy ? '正在刷新' : '刷新托管信息'"
            :disabled="busy"
            @click="refreshAll"
          >
            <svg viewBox="0 0 24 24" :class="{ 'spin-icon': busy }" aria-hidden="true">
              <path d="M20 7v5h-5M4 17v-5h5" />
              <path d="M5.6 9a7 7 0 0 1 11.7-2L20 12M4 12l2.7 5a7 7 0 0 0 11.7-2" />
            </svg>
          </button>
          <button class="button button--quiet header-action--logout" type="button" :disabled="busy" @click="logout">
            退出
          </button>
        </div>
      </div>
      <header class="app-header">
        <div class="app-brand">
          <span class="brand-mark brand-mark--small">
            <img src="/icons/xiaoyugan.png" alt="" />
          </span>
          <div class="app-brand__copy">
            <p class="eyebrow">游戏账号 · 后台任务</p>
            <h1>咸鱼托管</h1>
          </div>
        </div>
        <div class="header-actions">
          <span
            v-if="activeRunsCount > 0"
            class="running-chip"
            role="status"
            aria-live="polite"
          >
            <span class="running-chip__dot" aria-hidden="true"></span>
            <span>{{ activeRunsCount }} 项执行中</span>
          </span>
          <span class="user-chip" :title="`已登录：${user.username}`">
            <span class="user-chip__dot" aria-hidden="true"></span>
            <span class="user-chip__name">{{ user.username }}</span>
          </span>
          <router-link
            to="/tokens"
            class="button button--quiet header-action--local"
            title="返回浏览器本地 Token 管理"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M15 18l-6-6 6-6" />
            </svg>
            <span>本地角色</span>
          </router-link>
          <button
            class="button button--quiet header-action--refresh"
            type="button"
            :aria-label="busy ? '正在刷新' : '刷新页面'"
            :title="busy ? '正在刷新' : '刷新页面'"
            :disabled="busy"
            @click="refreshAll"
          >
            <svg viewBox="0 0 24 24" :class="{ 'spin-icon': busy }" aria-hidden="true">
              <path d="M20 7v5h-5M4 17v-5h5" />
              <path
                d="M5.6 9a7 7 0 0 1 11.7-2L20 12M4 12l2.7 5a7 7 0 0 0 11.7-2"
              />
            </svg>
            <span>{{ busy ? "刷新中" : "刷新" }}</span>
          </button>
          <button
            class="button button--quiet header-action--logout"
            type="button"
            :disabled="busy"
            @click="logout"
          >
            退出
          </button>
        </div>
      </header>

      <nav class="section-nav" aria-label="托管页面导航">
        <button
          v-for="item in sections"
          :key="item.id"
          type="button"
          :aria-pressed="activeSection === item.id"
          @click="openSection(item.id)"
        >
          <svg
            v-if="item.id === 'overview'"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path d="m3.5 10 8.5-7 8.5 7v10h-6v-6h-5v6h-6z" />
          </svg>
          <svg
            v-else-if="item.id === 'accounts'"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <circle cx="9" cy="8" r="3.5" />
            <path
              d="M2.5 20v-1.5a6.5 6.5 0 0 1 13 0V20M17 5.5a3.5 3.5 0 0 1 0 6.8M18 14a5 5 0 0 1 3.5 4.5V20"
            />
          </svg>
          <svg
            v-else-if="item.id === 'tasks'"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <rect x="3.5" y="5" width="17" height="16" rx="2" />
            <path d="M7.5 3v4M16.5 3v4M3.5 10h17M8 14h3M8 17h7" />
          </svg>
          <svg v-else viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4 5h16M4 12h16M4 19h16" />
            <circle cx="7" cy="5" r="1" />
            <circle cx="7" cy="12" r="1" />
            <circle cx="7" cy="19" r="1" />
          </svg>
          <span>{{ item.label }}</span>
          <span v-if="item.id === 'accounts'" class="nav-count">{{
            accounts.length
          }}</span>
          <span v-else-if="item.id === 'tasks'" class="nav-count">{{
            jobs.length
          }}</span>
          <span v-else-if="item.id === 'logs' && runs.length" class="nav-count">{{
            runs.length
          }}</span>
        </button>
      </nav>

      <div class="page-feedback" aria-live="polite">
        <p v-if="error" class="feedback feedback--error" role="alert">
          <span>{{ error }}</span>
          <button
            type="button"
            class="feedback__close"
            aria-label="关闭错误提示"
            @click="error = ''"
          >
            ×
          </button>
        </p>
        <p v-if="notice" class="feedback feedback--notice" role="status">
          <span>{{ notice }}</span>
          <button
            type="button"
            class="feedback__close"
            aria-label="关闭通知提示"
            @click="notice = ''"
          >
            ×
          </button>
        </p>
      </div>

      <section
        v-if="activeSection === 'overview'"
        class="view-section"
        aria-labelledby="overview-title"
      >
        <header class="view-heading">
          <div>
            <p class="section-kicker">服务器托管</p>
            <h2 id="overview-title">运行概况</h2>
            <p>账号凭据由服务器加密保存，定时任务独立运行。</p>
          </div>
          <div class="heading-actions">
            <button
              class="button button--secondary"
              type="button"
              @click="openAccountEditor"
            >
              添加账号
            </button>
            <button
              class="button button--primary"
              type="button"
              @click="openJobEditor"
            >
              新建任务
            </button>
          </div>
        </header>

        <div class="summary-grid" aria-label="服务器数据概况">
          <article class="summary-card" @click="openSection('accounts')">
            <div class="summary-card__top">
              <p class="summary-label">服务器账号</p>
              <span class="summary-icon summary-icon--blue" aria-hidden="true">
                <svg viewBox="0 0 24 24">
                  <circle cx="9" cy="8" r="3.5" />
                  <path d="M2.5 20v-1.5a6.5 6.5 0 0 1 13 0V20" />
                </svg>
              </span>
            </div>
            <strong class="summary-value">{{ accounts.length }}</strong>
            <p class="summary-detail">
              已加密保存 · {{ binSavedCount }} 个含 BIN 凭据
            </p>
          </article>
          <article class="summary-card" @click="openSection('tasks')">
            <div class="summary-card__top">
              <p class="summary-label">启用中的任务</p>
              <span class="summary-icon summary-icon--green" aria-hidden="true">
                <svg viewBox="0 0 24 24">
                  <circle cx="12" cy="12" r="8.5" />
                  <path d="M12 7.5v5l3.2 2" />
                </svg>
              </span>
            </div>
            <strong class="summary-value">
              {{ enabledJobs.length }}
              <small class="summary-total">/ {{ jobs.length }}</small>
            </strong>
            <p class="summary-detail">按北京时间 (UTC+8) 自动调度</p>
          </article>
          <article
            class="summary-card summary-card--latest"
            @click="openSection('logs')"
          >
            <div class="summary-card__top">
              <p class="summary-label">最近一次运行</p>
              <span class="summary-icon summary-icon--purple" aria-hidden="true">
                <svg viewBox="0 0 24 24">
                  <path d="M4 12h4l2.5-6 4 12 2.5-6H20" />
                </svg>
              </span>
            </div>
            <template v-if="latestRuns[0]">
              <strong class="summary-value summary-value--status">
                <span
                  class="status-dot"
                  :class="`status-dot--${statusTone(latestRuns[0].status)}`"
                ></span>
                {{ statusLabel(latestRuns[0].status) }}
              </strong>
              <p class="summary-detail summary-detail--truncate">
                {{ latestRuns[0].accountName }} ·
                {{ runTitle(latestRuns[0]) }} · {{ runOperationSummary(latestRuns[0]) }}
              </p>
            </template>
            <template v-else>
              <strong class="summary-value summary-value--empty"
                >暂无记录</strong
              >
              <p class="summary-detail">运行任务后会显示结果</p>
            </template>
          </article>
        </div>

        <div class="overview-grid">
          <section class="content-card" aria-labelledby="enabled-jobs-title">
            <div class="card-heading">
              <div>
                <h3 id="enabled-jobs-title">已启用计划</h3>
                <p>服务器会在设定时间执行所选操作。</p>
              </div>
              <button
                class="text-button"
                type="button"
                @click="openSection('tasks')"
              >
                查看任务
              </button>
            </div>
            <ul v-if="enabledJobs.length" class="schedule-list">
              <li
                v-for="job in enabledJobs.slice(0, 4)"
                :key="job.id"
                class="schedule-row"
              >
                <span class="schedule-mark" aria-hidden="true"></span>
                <div class="schedule-row__main">
                  <strong>{{ job.name }}</strong>
                  <span
                    >{{ scheduleLabel(job) }} ·
                    {{ job.accountIds.length }} 个账号 ·
                    {{ jobOperationsSummary(job) }}</span
                  >
                </div>
                <button
                  class="button button--secondary button--tiny"
                  type="button"
                  :disabled="busy"
                  @click="runJob(job)"
                >
                  运行一次
                </button>
                <span class="state-pill state-pill--enabled">启用</span>
              </li>
            </ul>
            <div v-else class="empty-state">
              <p class="empty-title">还没有启用的计划</p>
              <p>创建任务并启用后，它会显示在这里。</p>
              <button
                class="button button--secondary"
                type="button"
                @click="openJobEditor"
              >
                创建第一个任务
              </button>
            </div>
          </section>

          <section class="content-card" aria-labelledby="recent-runs-title">
            <div class="card-heading">
              <div>
                <h3 id="recent-runs-title">最近记录</h3>
                <p>最近完成或排队的服务器操作。</p>
              </div>
              <button
                class="text-button"
                type="button"
                @click="openSection('logs')"
              >
                全部记录
              </button>
            </div>
            <ul v-if="latestRuns.length" class="recent-list">
              <li
                v-for="run in latestRuns.slice(0, 4)"
                :key="run.id"
                class="recent-row"
              >
                <span
                  class="status-mark"
                  :class="`status-mark--${statusTone(run.status)}`"
                  aria-hidden="true"
                ></span>
                <div class="recent-row__main">
                  <strong
                    >{{ run.accountName }} ·
                    {{ runTitle(run) }}</strong
                  >
                  <span>{{ runOperationSummary(run) }} · {{ formatTime(run.queuedAt) }}</span>
                </div>
                <span
                  class="state-pill"
                  :class="`state-pill--${statusTone(run.status)}`"
                >
                  {{ statusLabel(run.status) }}
                </span>
              </li>
            </ul>
            <div v-else class="empty-state">
              <p class="empty-title">还没有运行记录</p>
              <p>手动运行任务或等待计划执行后，结果会显示在这里。</p>
              <button
                class="button button--secondary"
                type="button"
                @click="openSection('tasks')"
              >
                查看任务
              </button>
            </div>
          </section>
        </div>
      </section>

      <section
        v-else-if="activeSection === 'accounts'"
        class="view-section"
        aria-labelledby="accounts-title"
      >
        <header class="view-heading">
          <div>
            <p class="section-kicker">服务器凭据</p>
            <h2 id="accounts-title">游戏账号</h2>
            <p>管理已托管的角色，更新或补充登录凭据。</p>
          </div>
          <button
            class="button button--primary"
            type="button"
            :aria-expanded="showAccountEditor"
            aria-controls="account-editor"
            @click="toggleAccountEditor"
          >
            {{
              showAccountEditor
                ? "收起表单"
                : editingAccountId
                  ? "继续编辑"
                  : "添加账号"
            }}
          </button>
        </header>

        <section
          v-if="showAccountEditor"
          id="account-editor"
          class="editor-card"
          aria-labelledby="account-editor-title"
        >
          <div class="editor-heading">
            <div>
              <p class="section-kicker">账号资料</p>
              <h3 id="account-editor-title">
                {{ editingAccountId ? "编辑服务器账号" : "添加服务器账号" }}
              </h3>
            </div>
            <button
              class="text-button"
              type="button"
              @click="toggleAccountEditor"
            >
              收起
            </button>
          </div>
          <form class="editor-form" @submit.prevent="saveAccount">
            <div class="field-grid">
              <div class="field">
                <label for="account-name">角色名称</label>
                <input
                  id="account-name"
                  v-model.trim="accountForm.name"
                  maxlength="80"
                  placeholder="例如：大号吕布"
                  required
                />
              </div>
              <div class="field">
                <label for="account-server">区服</label>
                <input
                  id="account-server"
                  v-model.trim="accountForm.server"
                  maxlength="80"
                  placeholder="例如：10服"
                />
              </div>
            </div>
            <div class="field">
              <label for="account-token">角色 Token</label>
              <textarea
                id="account-token"
                v-model.trim="accountForm.roleToken"
                :required="!editingAccountId"
                rows="3"
                :placeholder="
                  editingAccountId
                    ? '留空以保留现有 Token；填写可替换'
                    : '粘贴角色 Token（Base64 或 JSON 格式）'
                "
                aria-describedby="account-token-help"
              ></textarea>
              <p id="account-token-help" class="field-hint">
                凭据只在保存时发送到服务器；列表不会显示 Token 内容。
              </p>
            </div>

            <details class="disclosure-card">
              <summary>角色 ID 与 BIN 凭据（可选）</summary>
              <div class="disclosure-content">
                <div class="field">
                  <label for="account-role-id"
                    >角色 ID（如 Token 内没有）</label
                  >
                  <input
                    id="account-role-id"
                    v-model.trim="accountForm.roleId"
                    maxlength="128"
                  />
                </div>
                <div class="field">
                  <label for="account-bin-file"
                    >选择 BIN 文件（可选，用于运行时刷新 Token）</label
                  >
                  <input
                    id="account-bin-file"
                    type="file"
                    accept=".bin,application/octet-stream"
                    :disabled="busy"
                    @change="handleBinFile"
                  />
                  <p v-if="selectedBinName" class="field-hint" role="status">
                    已读取 {{ selectedBinName }}；保存账号时会一并加密上传。
                  </p>
                </div>
                <div class="field">
                  <label for="account-bin-base64">或粘贴 BIN Base64</label>
                  <textarea
                    id="account-bin-base64"
                    v-model.trim="accountForm.binBase64"
                    rows="2"
                    :placeholder="
                      editingAccountId ? '留空以保留现有 BIN' : '可选'
                    "
                    @input="selectedBinName = ''"
                  ></textarea>
                </div>
              </div>
            </details>

            <details class="disclosure-card" :open="!editingAccountId && localAccounts.length > 0">
              <summary>
                从当前浏览器导入角色
                <span v-if="localAccounts.length" class="summary-badge">
                  {{ localAccounts.length }} 个本地角色
                </span>
              </summary>
              <div class="disclosure-content">
                <p class="field-hint">
                  只会导入你明确选择的角色（自动附带浏览器中的 BIN 数据）。若列表为空，请先到
                  <router-link v-if="!props.embedded" to="/tokens"
                    >Token 管理页扫码添加本地角色</router-link
                  >
                  <button v-else type="button" class="text-button" @click="workspaceNavigation.push('/tokens')">
                    Token 管理页扫码添加本地角色
                  </button>，再回来导入。
                </p>
                <div v-if="localAccounts.length" class="batch-import-box">
                  <div class="fieldset-toolbar">
                    <span class="fieldset-count">
                      已选 {{ selectedLocalIds.length }} / {{ localAccounts.length }} 个本地角色
                    </span>
                    <div class="fieldset-actions">
                      <button
                        type="button"
                        class="text-button"
                        @click="selectAllLocalAccounts"
                      >
                        全选
                      </button>
                      <button
                        type="button"
                        class="text-button"
                        :disabled="!selectedLocalIds.length"
                        @click="selectedLocalIds = []"
                      >
                        清空
                      </button>
                    </div>
                  </div>
                  <div class="choice-grid">
                    <label
                      v-for="item in localAccounts"
                      :key="item.id"
                      class="choice-card"
                    >
                      <input
                        v-model="selectedLocalIds"
                        type="checkbox"
                        :value="item.id"
                      />
                      <span>
                        <strong>{{ item.name }}</strong>
                        <small>
                          {{ item.server || "未知区服" }}
                          <template v-if="isLocalImported(item)">
                            · 已在服务器
                          </template>
                        </small>
                      </span>
                    </label>
                  </div>
                  <div class="import-actions">
                    <button
                      class="button button--secondary"
                      type="button"
                      :disabled="busy || !selectedLocalIds.length"
                      @click="importSelectedLocalAccounts"
                    >
                      导入所选角色（{{ selectedLocalIds.length }}）
                    </button>
                  </div>
                </div>
                <div v-else class="import-row">
                  <div class="field">
                    <label for="local-role">本地角色</label>
                    <select id="local-role" v-model="selectedLocalId" disabled>
                      <option value="">当前浏览器暂无已保存角色</option>
                    </select>
                  </div>
                </div>
              </div>
            </details>

            <div class="form-actions">
              <button class="button button--primary" :disabled="busy">
                {{
                  busy
                    ? "保存中…"
                    : editingAccountId
                      ? "保存修改"
                      : "添加到服务器"
                }}
              </button>
              <button
                v-if="editingAccountId"
                class="button button--secondary"
                type="button"
                :disabled="busy"
                @click="cancelEditAccount"
              >
                取消编辑
              </button>
            </div>
          </form>
        </section>

        <div v-if="accounts.length" class="account-grid">
          <article
            v-for="account in accounts"
            :key="account.id"
            class="data-card account-card account-card--compact"
          >
            <div class="account-card__body">
              <span class="account-mark" aria-hidden="true">{{
                account.name.slice(0, 1)
              }}</span>
              <div class="account-card__meta">
                <div class="account-card__title-row">
                  <h3 :title="account.name">{{ account.name }}</h3>
                  <span
                    class="state-pill state-pill--small"
                    :class="
                      account.hasBin ? 'state-pill--enabled' : 'state-pill--quiet'
                    "
                  >
                    {{ account.hasBin ? "BIN 就绪" : "无 BIN" }}
                  </span>
                </div>
                <div class="account-card__info-row">
                  <span class="account-card__server">{{ account.server || "未填写区服" }}</span>
                  <span v-if="account.roleId" class="account-card__id" :title="`角色ID: ${account.roleId}`">
                    ID: {{ account.roleId }}
                  </span>
                </div>
              </div>
            </div>
            <div class="account-card__action-row">
              <button
                class="button button--secondary button--tiny"
                type="button"
                :disabled="busy"
                :aria-label="`编辑 ${account.name} 的服务器凭据`"
                @click="editAccount(account)"
              >
                编辑
              </button>
              <button
                class="button button--danger-quiet button--tiny"
                type="button"
                :disabled="busy"
                :aria-label="`删除服务器账号 ${account.name}`"
                @click="deleteAccount(account)"
              >
                删除
              </button>
            </div>
          </article>
        </div>
        <div v-else class="empty-panel">
          <span class="empty-symbol" aria-hidden="true">＋</span>
          <h3>还没有服务器账号</h3>
          <p>添加角色 Token，或从当前浏览器明确导入已保存的角色。</p>
          <button
            class="button button--primary"
            type="button"
            @click="openAccountEditor"
          >
            添加第一个账号
          </button>
        </div>
      </section>

      <section
        v-else-if="activeSection === 'tasks'"
        class="view-section"
        aria-labelledby="tasks-title"
      >
        <header class="view-heading">
          <div>
            <p class="section-kicker">服务器调度</p>
            <h2 id="tasks-title">定时任务</h2>
            <p>任务由服务器运行，浏览器关闭后仍会按北京时间调度。</p>
          </div>
          <button
            class="button button--primary"
            type="button"
            @click="openJobEditor"
          >
            新建托管日常
          </button>
        </header>

        <div v-if="jobs.length" class="job-list">
          <article v-for="job in jobs" :key="job.id" class="data-card job-card">
            <header class="data-card__heading job-card__heading">
              <div class="data-card__title">
                <div class="job-title-row">
                  <h3>{{ job.actions.includes('nightmareTeam') ? `十殿队伍 · ${job.name}` : job.name }}</h3>
                  <span
                    class="state-pill"
                    :class="
                      job.enabled ? 'state-pill--enabled' : 'state-pill--quiet'
                    "
                  >
                    {{ job.enabled ? "已启用" : "已停用" }}
                  </span>
                </div>
                <p>{{ scheduleLabel(job) }}</p>
              </div>
              <button
                class="button button--secondary button--small"
                type="button"
                :disabled="busy"
                :aria-label="`立即运行任务 ${job.name} 一次`"
                @click="runJob(job)"
              >
                运行一次
              </button>
            </header>
            <div class="job-details">
              <div class="detail-line">
                <span>账号</span>
                <div v-if="job.accountIds.length" class="tag-list">
                  <span
                    v-for="accId in job.accountIds"
                    :key="accId"
                    class="tag-chip"
                  >
                    {{ accountName(accId) }}
                  </span>
                </div>
                <p v-else>未选择账号</p>
              </div>
              <div class="detail-line">
                <span>操作</span>
                <div class="tag-list">
                  <span
                    v-for="actId in jobOperationIds(job)"
                    :key="actId"
                    class="tag-chip tag-chip--action"
                  >
                    {{ actionLabel(actId) }}
                  </span>
                  <span v-if="!jobOperationIds(job).length" class="tag-chip tag-chip--action">操作不可用</span>
                </div>
              </div>
            </div>
            <footer class="card-actions">
              <button
                class="button button--secondary button--small"
                type="button"
                @click="editHostedJob(job)"
              >
                编辑计划
              </button>
              <button
                class="button button--secondary button--small"
                type="button"
                :disabled="busy"
                :aria-pressed="job.enabled"
                @click="toggleJob(job)"
              >
                {{ job.enabled ? "停用计划" : "启用计划" }}
              </button>
              <button
                class="button button--danger-quiet button--small"
                type="button"
                :disabled="busy"
                :aria-label="`删除任务 ${job.name}`"
                @click="deleteJob(job)"
              >
                删除任务
              </button>
            </footer>
          </article>
        </div>
        <div v-else class="empty-panel">
          <span class="empty-symbol" aria-hidden="true">☁️</span>
          <h3>还没有托管定时任务</h3>
          <p>创建全功能云端托管日常（涵盖答题、罐子、黑市采购、竞技场、灯神扫荡等全部 30+ 项日常），关机离线自动运行。</p>
          <button
            class="button button--primary"
            type="button"
            @click="openJobEditor"
          >
            新建托管日常
          </button>
        </div>
      </section>

      <section v-else class="view-section" aria-labelledby="logs-title">
        <header class="view-heading">
          <div>
            <p class="section-kicker">执行历史</p>
            <h2 id="logs-title">运行记录</h2>
            <p>显示服务器返回的实际状态与错误信息。</p>
          </div>
          <button
            class="button button--secondary"
            type="button"
            :disabled="busy"
            @click="refreshAll"
          >
            {{ busy ? "刷新中…" : "刷新记录" }}
          </button>
        </header>

        <div v-if="runs.length" class="log-filter-bar" role="region" aria-label="日志筛选">
          <div class="filter-pills" role="group" aria-label="按状态筛选">
            <button
              v-for="tab in logStatusTabs"
              :key="tab.id"
              type="button"
              class="filter-pill"
              :aria-pressed="logStatusFilter === tab.id"
              @click="logStatusFilter = tab.id"
            >
              <span>{{ tab.label }}</span>
              <span class="filter-pill__count">{{ tab.count }}</span>
            </button>
          </div>
          <div class="log-account-filter">
            <select
              v-model="logAccountFilter"
              aria-label="按角色筛选日志"
              class="filter-select"
            >
              <option value="">全部账号</option>
              <option
                v-for="name in runAccountNames"
                :key="name"
                :value="name"
              >
                {{ name }}
              </option>
            </select>
          </div>
        </div>

        <div v-if="filteredRuns.length" class="run-list">
          <article v-for="run in filteredRuns" :key="run.id" class="run-card">
            <div class="run-card__top">
              <span
                class="state-pill"
                :class="`state-pill--${statusTone(run.status)}`"
              >
                {{ statusLabel(run.status) }}
              </span>
              <span class="run-action">{{ runTitle(run) }}</span>
              <time class="run-time">{{ formatTime(run.queuedAt) }}</time>
            </div>
            <h3>{{ run.accountName }}</h3>
            <p v-if="run.action === 'batchPlan'" class="run-message">{{ runOperationSummary(run) }}</p>
            <p
              class="run-message"
              :class="{ 'run-message--error': run.status === 'failed' || run.status === 'partial' }"
            >
              {{ run.message || "等待服务器执行…" }}
            </p>
            <details
              v-if="run.logs && run.logs.length"
              class="run-logs-details"
            >
              <summary class="run-logs-summary">
                <span>查看步骤记录与排查详情</span>
                <span class="run-logs-count">{{ run.logs.length }} 条</span>
              </summary>
              <div class="run-logs-body">
                <div
                  v-for="(logLine, lineIdx) in run.logs"
                  :key="lineIdx"
                  class="run-log-row"
                  :class="{
                    'run-log-row--error': /失败|错误|异常/.test(logLine),
                    'run-log-row--warn': /提示|跳过|注意/.test(logLine),
                  }"
                >
                  <span class="run-log-num">{{ lineIdx + 1 }}</span>
                  <span class="run-log-text">{{ logLine }}</span>
                </div>
              </div>
            </details>
            <button
              v-if="run.status === 'queued' || run.status === 'running'"
              class="button button--secondary button--small"
              type="button"
              :disabled="cancellingRunIds.includes(run.id)"
              @click="cancelRun(run)"
            >
              {{ cancellingRunIds.includes(run.id) ? "正在停止…" : "停止此执行组" }}
            </button>
          </article>
        </div>
        <div v-else-if="runs.length" class="empty-panel">
          <span class="empty-symbol" aria-hidden="true">⌕</span>
          <h3>没有匹配的运行记录</h3>
          <p>当前筛选条件下暂无记录，可以重置筛选查看全部日志。</p>
          <button
            class="button button--secondary"
            type="button"
            @click="resetLogFilters"
          >
            重置筛选
          </button>
        </div>
        <div v-else class="empty-panel">
          <span class="empty-symbol" aria-hidden="true">≡</span>
          <h3>还没有运行记录</h3>
          <p>运行任务后，成功状态或服务器错误信息会显示在这里。</p>
          <button
            class="button button--secondary"
            type="button"
            @click="openSection('tasks')"
          >
            查看定时任务
          </button>
        </div>
      </section>

      <footer class="app-footer">
        <router-link class="app-footer__hub" to="/app">所有功能</router-link>
        <span>咸鱼托管</span>
        <span>托管凭据在服务端加密保存</span>
      </footer>
    </div>

    <nav v-if="user" class="mobile-nav" aria-label="托管页面导航">
      <button
        v-for="item in sections"
        :key="item.id"
        type="button"
        :aria-pressed="activeSection === item.id"
        @click="openSection(item.id)"
      >
        <svg
          v-if="item.id === 'overview'"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path d="m3.5 10 8.5-7 8.5 7v10h-6v-6h-5v6h-6z" />
        </svg>
        <svg
          v-else-if="item.id === 'accounts'"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <circle cx="9" cy="8" r="3.5" />
          <path
            d="M2.5 20v-1.5a6.5 6.5 0 0 1 13 0V20M17 5.5a3.5 3.5 0 0 1 0 6.8M18 14a5 5 0 0 1 3.5 4.5V20"
          />
        </svg>
        <svg
          v-else-if="item.id === 'tasks'"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <rect x="3.5" y="5" width="17" height="16" rx="2" />
          <path d="M7.5 3v4M16.5 3v4M3.5 10h17M8 14h3M8 17h7" />
        </svg>
        <svg v-else viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 5h16M4 12h16M4 19h16" />
          <circle cx="7" cy="5" r="1" />
          <circle cx="7" cy="12" r="1" />
          <circle cx="7" cy="19" r="1" />
        </svg>
        <span>{{ item.label }}</span>
      </button>
    </nav>
  </main>
</template>
<script setup>
import { computed, onMounted, onUnmounted, reactive, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { useWorkspaceNavigation } from "@/composables/useWorkspaceNavigation";
import useIndexedDB from "@/hooks/useIndexedDB";
import { SERVER_BATCH_TASK_CATALOG } from "@/utils/serverBatchTaskConfig.js";

const props = defineProps({ embedded: Boolean });
const router = useRouter();
const workspaceNavigation = useWorkspaceNavigation(router);

const api = "/api/server";
const { getArrayBuffer } = useIndexedDB();
const user = ref(null);
const error = ref("");
const notice = ref("");
const busy = ref(false);
const registering = ref(false);
const editingAccountId = ref("");
const editingJobId = ref("");
const editingJobEnabled = ref(true);
const authEpoch = ref(0);
const accounts = ref([]);
const jobs = ref([]);
const runs = ref([]);
const cancellingRunIds = ref([]);
const actions = ref([]);
const localAccounts = ref([]);
const selectedLocalId = ref("");
const selectedLocalIds = ref([]);
const selectedBinName = ref("");
const activeSection = ref("overview");
const showAccountEditor = ref(false);
const showJobEditor = ref(false);
const logStatusFilter = ref("all");
const logAccountFilter = ref("");
let pollTimer = null;

const sections = [
  { id: "overview", label: "总览" },
  { id: "accounts", label: "账号" },
  { id: "tasks", label: "任务" },
  { id: "logs", label: "日志" },
];
const enabledJobs = computed(() => jobs.value.filter((job) => job.enabled));
const latestRuns = computed(() => runs.value.slice(0, 4));
const binSavedCount = computed(
  () => accounts.value.filter((account) => account.hasBin).length,
);
const activeRunsCount = computed(
  () =>
    runs.value.filter(
      (run) => run.status === "queued" || run.status === "running",
    ).length,
);
const runAccountNames = computed(() => {
  const names = new Set();
  for (const run of runs.value) {
    if (run.accountName) names.add(run.accountName);
  }
  return Array.from(names);
});
const logStatusTabs = computed(() => {
  const succeeded = runs.value.filter((r) => r.status === "succeeded").length;
  const failed = runs.value.filter((r) => r.status === "failed").length;
  const partial = runs.value.filter((r) => r.status === "partial").length;
  const active = runs.value.filter(
    (r) => r.status === "queued" || r.status === "running",
  ).length;
  return [
    { id: "all", label: "全部", count: runs.value.length },
    { id: "succeeded", label: "成功", count: succeeded },
    { id: "failed", label: "失败", count: failed },
    { id: "partial", label: "部分失败", count: partial },
    { id: "active", label: "执行中", count: active },
  ];
});
const filteredRuns = computed(() => {
  return runs.value.filter((run) => {
    if (logStatusFilter.value === "succeeded" && run.status !== "succeeded")
      return false;
    if (logStatusFilter.value === "failed" && run.status !== "failed")
      return false;
    if (logStatusFilter.value === "partial" && run.status !== "partial")
      return false;
    if (
      logStatusFilter.value === "active" &&
      run.status !== "queued" &&
      run.status !== "running"
    )
      return false;
    if (logAccountFilter.value && run.accountName !== logAccountFilter.value)
      return false;
    return true;
  });
});

const authForm = reactive({ username: "", password: "" });
const accountForm = reactive({
  name: "",
  server: "",
  roleToken: "",
  roleId: "",
  binBase64: "",
});
const jobForm = reactive({
  name: "每日奖励",
  accountIds: [],
  actions: ["signIn", "claimHangup", "claimMail"],
  type: "daily",
  time: "08:00",
  expression: "0 8 * * *",
});

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

watch(activeRunsCount, (count) => {
  if (count > 0 && user.value) {
    if (!pollTimer) {
      pollTimer = setInterval(async () => {
        if (!user.value || busy.value) return;
        try {
          const epoch = authEpoch.value;
          const r = await request("/runs", {}, { allowAnonymous: true });
          if (r && epoch === authEpoch.value && user.value) {
            runs.value = r.runs;
          }
        } catch {}
      }, 3000);
    }
  } else {
    stopPolling();
  }
});

onUnmounted(() => {
  stopPolling();
});

function clearSessionView() {
  stopPolling();
  user.value = null;
  accounts.value = [];
  jobs.value = [];
  runs.value = [];
  actions.value = [];
  localAccounts.value = [];
  selectedLocalId.value = "";
  selectedLocalIds.value = [];
  selectedBinName.value = "";
  editingAccountId.value = "";
  editingJobId.value = "";
  editingJobEnabled.value = true;
  activeSection.value = "overview";
  showAccountEditor.value = false;
  showJobEditor.value = false;
  logStatusFilter.value = "all";
  logAccountFilter.value = "";
  cancellingRunIds.value = [];
  jobForm.accountIds = [];
  jobForm.actions = [];
  Object.assign(accountForm, {
    name: "",
    server: "",
    roleToken: "",
    roleId: "",
    binBase64: "",
  });
}

const request = async (path, options = {}, { allowAnonymous = false } = {}) => {
  const response = await fetch(`${api}${path}`, {
    credentials: "same-origin",
    ...options,
    headers: {
      "Content-Type": "application/json",
      "X-Requested-With": "XMLHttpRequest",
      ...(options.headers || {}),
    },
  });
  if (response.status === 401) {
    if (allowAnonymous) return null;
    if (path === "/auth/login") throw new Error("用户名或密码错误");
    authEpoch.value++;
    clearSessionView();
    throw new Error("登录状态已失效，请重新登录");
  }
  if (response.status === 204) return null;
  const data = await response
    .json()
    .catch(() => ({ error: "服务器返回了无效响应" }));
  if (!response.ok)
    throw new Error(data.error || `请求失败 (${response.status})`);
  return data;
};

async function runBusy(fn) {
  error.value = "";
  notice.value = "";
  busy.value = true;
  try {
    await fn();
  } catch (e) {
    error.value = e.message || "操作失败";
  } finally {
    busy.value = false;
  }
}

async function loadLocal() {
  try {
    const saved = JSON.parse(localStorage.getItem("gameTokens") || "[]");
    localAccounts.value = Array.isArray(saved)
      ? saved
          .filter((x) => x?.id && x?.token)
          .map((x) => ({
            id: x.id,
            name: x.name || x.roleName || "角色",
            server: x.server || "",
            roleId: x.roleId || "",
          }))
      : [];
  } catch {
    localAccounts.value = [];
  }
}

function isLocalImported(localItem) {
  return accounts.value.some(
    (acc) =>
      (localItem.roleId && acc.roleId && acc.roleId === localItem.roleId) ||
      (acc.name === localItem.name &&
        (acc.server || "") === (localItem.server || "")),
  );
}

function selectAllLocalAccounts() {
  selectedLocalIds.value = localAccounts.value.map((item) => item.id);
}

async function refreshAll() {
  await runBusy(refreshData);
}

async function cancelRun(run) {
  if (!run || !["queued", "running"].includes(run.status) || cancellingRunIds.value.includes(run.id)) return;
  cancellingRunIds.value.push(run.id);
  error.value = "";
  try {
    const result = await request(`/runs/${encodeURIComponent(run.id)}/cancel`, {
      method: "POST",
      body: JSON.stringify({}),
    });
    notice.value = `已请求停止该执行组，取消排队任务 ${result.cancelledQueued} 项`;
    await refreshData();
  } catch (e) {
    error.value = e.message || "停止任务失败";
  } finally {
    cancellingRunIds.value = cancellingRunIds.value.filter((id) => id !== run.id);
  }
}

async function submitAuth() {
  await runBusy(async () => {
    const action = registering.value ? "register" : "login";
    const data = await request(`/auth/${action}`, {
      method: "POST",
      body: JSON.stringify(authForm),
    });
    authEpoch.value++;
    user.value = data.user;
    activeSection.value = "overview";
    showAccountEditor.value = false;
    showJobEditor.value = false;
    authForm.password = "";
    await loadLocal();
    await refreshData();
  });
}

async function refreshData() {
  const epoch = authEpoch.value;
  const [a, j, r, d] = await Promise.all([
    request("/accounts"),
    request("/jobs"),
    request("/runs"),
    request("/task-definitions"),
  ]);
  if (epoch !== authEpoch.value || !user.value) return;
  accounts.value = a.accounts;
  jobs.value = j.jobs;
  runs.value = r.runs;
  actions.value = d.actions;
}

async function logout() {
  authEpoch.value++;
  clearSessionView();
  await runBusy(async () => {
    await request("/auth/logout", { method: "POST", body: "{}" });
  });
}

async function saveAccount() {
  await runBusy(async () => {
    const body = { name: accountForm.name, server: accountForm.server };
    if (accountForm.roleToken.trim()) body.roleToken = accountForm.roleToken;
    if (accountForm.roleId.trim()) body.roleId = accountForm.roleId;
    if (accountForm.binBase64.trim()) body.binBase64 = accountForm.binBase64;
    const url = editingAccountId.value
      ? `/accounts/${encodeURIComponent(editingAccountId.value)}`
      : "/accounts";
    await request(url, {
      method: editingAccountId.value ? "PATCH" : "POST",
      body: JSON.stringify(body),
    });
    editingAccountId.value = "";
    selectedBinName.value = "";
    showAccountEditor.value = false;
    Object.assign(accountForm, {
      name: "",
      server: "",
      roleToken: "",
      roleId: "",
      binBase64: "",
    });
    await refreshData();
    notice.value = "服务器账号已保存";
  });
}

function editAccount(account) {
  activeSection.value = "accounts";
  showAccountEditor.value = true;
  editingAccountId.value = account.id;
  selectedBinName.value = "";
  Object.assign(accountForm, {
    name: account.name,
    server: account.server || "",
    roleToken: "",
    roleId: "",
    binBase64: "",
  });
}

function cancelEditAccount() {
  editingAccountId.value = "";
  showAccountEditor.value = false;
  selectedBinName.value = "";
  Object.assign(accountForm, {
    name: "",
    server: "",
    roleToken: "",
    roleId: "",
    binBase64: "",
  });
}

function toBase64(buffer) {
  let binary = "";
  for (const b of new Uint8Array(buffer)) binary += String.fromCharCode(b);
  return btoa(binary);
}

async function handleBinFile(event) {
  const input = event.target;
  const file = input.files?.[0];
  if (!file) return;
  error.value = "";
  if (file.size > 8 * 1024 * 1024) {
    accountForm.binBase64 = "";
    selectedBinName.value = "";
    input.value = "";
    error.value = "BIN 文件不能超过 8 MiB";
    return;
  }
  try {
    accountForm.binBase64 = toBase64(await file.arrayBuffer());
    selectedBinName.value = file.name;
  } catch {
    accountForm.binBase64 = "";
    selectedBinName.value = "";
    input.value = "";
    error.value = "无法读取所选 BIN 文件";
  }
}

async function importSelectedLocalAccounts() {
  const idsToImport = selectedLocalIds.value.length
    ? selectedLocalIds.value
    : selectedLocalId.value
      ? [selectedLocalId.value]
      : [];
  if (!idsToImport.length) return;

  await runBusy(async () => {
    const saved = JSON.parse(localStorage.getItem("gameTokens") || "[]");
    const payload = [];
    for (const id of idsToImport.slice(0, 50)) {
      const item = saved.find((x) => x?.id === id);
      if (!item?.token) continue;
      let bin = null;
      try {
        const data = await getArrayBuffer(item.id);
        if (data) bin = toBase64(data);
      } catch {}
      payload.push({
        name: item.name || item.roleName || "角色",
        server: item.server || "",
        roleId: item.roleId || "",
        roleToken: item.token,
        binBase64: bin || undefined,
        sourceLocalId: item.id || undefined,
      });
    }
    if (!payload.length) throw new Error("未找到可导入的本地角色 Token");
    await request("/accounts/import", {
      method: "POST",
      body: JSON.stringify({ accounts: payload }),
    });
    selectedLocalIds.value = [];
    selectedLocalId.value = "";
    await refreshData();
    notice.value = `已成功导入 ${payload.length} 个角色到服务器`;
  });
}

async function deleteAccount(account) {
  const confirmed =
    typeof window === "undefined" ||
    // eslint-disable-next-line no-alert -- Preserve the existing delete confirmation.
    window.confirm(`确定要从服务器删除账号「${account.name}」吗？`);
  if (!confirmed) return;
  if (editingAccountId.value === account.id) cancelEditAccount();
  await runBusy(async () => {
    await request(`/accounts/${encodeURIComponent(account.id)}`, {
      method: "DELETE",
    });
    await refreshData();
    notice.value = `已删除账号「${account.name}」`;
  });
}

function resetJobForm() {
  editingJobId.value = "";
  editingJobEnabled.value = true;
  jobForm.name = "每日奖励";
  jobForm.accountIds = accounts.value.length ? [accounts.value[0].id] : [];
  jobForm.actions = ["signIn", "claimHangup", "claimMail"].filter(
    (id) => !actions.value.length || actions.value.some((a) => a.id === id),
  );
  jobForm.type = "daily";
  jobForm.time = "08:00";
  jobForm.expression = "0 8 * * *";
}

function _editJob(job) {
  activeSection.value = "tasks";
  showJobEditor.value = true;
  editingJobId.value = job.id;
  editingJobEnabled.value = job.enabled;
  jobForm.name = job.name;
  jobForm.accountIds = [...job.accountIds];
  jobForm.actions = [...job.actions];
  jobForm.type = job.schedule.type;
  if (job.schedule.type === "daily") {
    jobForm.time = job.schedule.value
      .split(" ")
      .slice(0, 2)
      .reverse()
      .map((x) => x.padStart(2, "0"))
      .join(":");
  } else {
    jobForm.expression = job.schedule.value;
  }
}

function cancelEditJob() {
  resetJobForm();
  showJobEditor.value = false;
}

async function _saveJob() {
  await runBusy(async () => {
    const schedule =
      jobForm.type === "daily"
        ? { type: "daily", time: jobForm.time, timezone: "Asia/Shanghai" }
        : {
            type: "cron",
            expression: jobForm.expression,
            timezone: "Asia/Shanghai",
          };
    const isEditing = Boolean(editingJobId.value);
    const url = isEditing
      ? `/jobs/${encodeURIComponent(editingJobId.value)}`
      : "/jobs";
    await request(url, {
      method: isEditing ? "PATCH" : "POST",
      body: JSON.stringify({
        name: jobForm.name,
        accountIds: jobForm.accountIds,
        actions: jobForm.actions,
        schedule,
        enabled: isEditing ? editingJobEnabled.value : true,
      }),
    });
    await refreshData();
    resetJobForm();
    showJobEditor.value = false;
    notice.value = isEditing
      ? "定时任务修改已保存"
      : "定时任务已保存，将由服务器执行";
  });
}

async function runJob(job) {
  await runBusy(async () => {
    const isTenPalace = job.actions.includes("nightmareTeam");
    const result = await request(`${isTenPalace ? "/nightmare-plans" : "/jobs"}/${job.id}/run`, {
      method: "POST",
      body: "{}",
    });
    notice.value = isTenPalace
      ? `十殿队伍计划「${job.name}」已加入服务器队列（团队占用 ${job.accountIds.length} 个账号）`
      : `任务「${job.name}」已加入服务器队列（${result.count} 项）`;
    await refreshData();
  });
}

async function toggleJob(job) {
  await runBusy(async () => {
    if (job.actions.includes("nightmareTeam")) {
      await request(`/nightmare-plans/${job.id}`, {
        method: "PATCH",
        body: JSON.stringify({ enabled: !job.enabled }),
      });
      await refreshData();
      notice.value = `十殿队伍计划「${job.name}」已${job.enabled ? "停用" : "启用"}`;
      return;
    }
    await request(`/jobs/${job.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        name: job.name,
        accountIds: job.accountIds,
        actions: job.actions,
        enabled: !job.enabled,
        schedule: {
          type: job.schedule.type,
          ...(job.schedule.type === "daily"
            ? {
                time: job.schedule.value
                  .split(" ")
                  .slice(0, 2)
                  .reverse()
                  .map((x) => x.padStart(2, "0"))
                  .join(":"),
              }
            : { expression: job.schedule.value }),
          timezone: job.schedule.timezone,
        },
      }),
    });
    await refreshData();
  });
}

async function deleteJob(job) {
  const confirmed =
    typeof window === "undefined" ||
    // eslint-disable-next-line no-alert -- Preserve the existing delete confirmation.
    window.confirm(`确定要删除定时任务「${job.name}」吗？`);
  if (!confirmed) return;
  if (editingJobId.value === job.id) cancelEditJob();
  await runBusy(async () => {
    const isTenPalace = job.actions.includes("nightmareTeam");
    await request(`${isTenPalace ? "/nightmare-plans" : "/jobs"}/${job.id}`, { method: "DELETE" });
    await refreshData();
    notice.value = isTenPalace ? `已删除十殿队伍计划「${job.name}」` : `已删除任务「${job.name}」`;
  });
}

function resetLogFilters() {
  logStatusFilter.value = "all";
  logAccountFilter.value = "";
}

function scheduleLabel(job) {
  return job.schedule.type === "daily"
    ? `每天 ${job.schedule.value
        .split(" ")
        .slice(0, 2)
        .reverse()
        .map((x) => x.padStart(2, "0"))
        .join(":")} (北京时间)`
    : `Cron ${job.schedule.value} (北京时间)`;
}

function actionLabel(id) {
  if (Object.hasOwn(SERVER_BATCH_TASK_CATALOG, id)) return SERVER_BATCH_TASK_CATALOG[id];
  if (id === "batchPlan") return "托管日常";
  if (id === "nightmareTeam") return "十殿固定队伍挑战";
  return actions.value.find((x) => x.id === id)?.label || "操作不可用";
}

function jobOperationIds(job) {
  if (job?.actions?.includes("batchPlan")) {
    return (job.localPlan?.taskIds || []).filter((id) => Object.hasOwn(SERVER_BATCH_TASK_CATALOG, id));
  }
  return job?.actions || [];
}

function jobOperationsSummary(job) {
  const ids = jobOperationIds(job);
  if (!ids.length) return "操作不可用";
  const labels = ids.map(actionLabel);
  const visible = labels.slice(0, 3).join("、");
  return `${ids.length} 项操作：${visible}${ids.length > 3 ? ` 等 ${ids.length} 项` : ""}`;
}

function runTitle(run) {
  if (typeof run?.jobName === "string" && run.jobName.trim()) return run.jobName;
  if (run?.action === "batchPlan") {
    const labels = (run.taskIds || []).filter((id) => Object.hasOwn(SERVER_BATCH_TASK_CATALOG, id)).map(actionLabel);
    return labels.length ? labels.join("、") : "托管日常任务（名称不可用）";
  }
  return actionLabel(run?.action);
}

function runOperationSummary(run) {
  if (run?.action !== "batchPlan") return "";
  const labels = (run.taskIds || []).filter((id) => Object.hasOwn(SERVER_BATCH_TASK_CATALOG, id)).map(actionLabel);
  return labels.length ? `${labels.length} 项操作：${labels.join("、")}` : "计划操作不可用";
}

function statusLabel(status) {
  return (
    { queued: "排队中", running: "执行中", succeeded: "成功", failed: "失败", partial: "部分失败", cancelled: "已停止" }[
      status
    ] || status
  );
}

function statusTone(status) {
  if (status === "succeeded") return "success";
  if (status === "failed" || status === "partial") return "error";
  if (status === "running") return "active";
  return "quiet";
}

function accountName(id) {
  return (
    accounts.value.find((account) => account.id === id)?.name || "未知账号"
  );
}

function openSection(section) {
  activeSection.value = section;
}

function openAccountEditor() {
  activeSection.value = "accounts";
  showAccountEditor.value = true;
}

function toggleAccountEditor() {
  showAccountEditor.value = !showAccountEditor.value;
}

function openJobEditor() {
  workspaceNavigation.push({ path: "/admin/batch-daily-tasks", query: { batchPlanEditor: "new" } });
}

function editJobInBatchDaily(job) {
  workspaceNavigation.push({ path: "/admin/batch-daily-tasks", query: { batchPlanEditor: job.sourcePlanId || job.id } });
}

function editHostedJob(job) {
  if (job.actions.includes("nightmareTeam")) {
    workspaceNavigation.push({ path: "/admin/game-features", query: { feature: "tenPalace", planId: job.id } });
    return;
  }
  editJobInBatchDaily(job);
}

function _toggleJobEditor() {
  if (showJobEditor.value && editingJobId.value) {
    cancelEditJob();
    return;
  }
  showJobEditor.value = !showJobEditor.value;
}

function setAuthMode(register) {
  registering.value = register;
  error.value = "";
}

function formatTime(time) {
  return time ? new Date(time).toLocaleString("zh-CN") : "";
}

onMounted(async () => {
  await loadLocal();
  const epoch = authEpoch.value;
  try {
    const data = await request("/auth/me", {}, { allowAnonymous: true });
    if (!data || epoch !== authEpoch.value) return;
    user.value = data.user;
    await refreshData();
  } catch (e) {
    error.value = e.message;
  }
});
</script>

<style scoped>
.hosted-page {
  width: 100%;
  min-height: 100vh;
  min-height: 100dvh;
  margin: 0;
  padding: 0;
  overflow-x: hidden;
  color-scheme: light;
  --hosted-bg: #f3f6fb;
  --hosted-bg-accent: radial-gradient(
    1100px 420px at 50% -120px,
    rgba(37, 99, 235, 0.08),
    transparent 70%
  );
  --hosted-surface: #ffffff;
  --hosted-surface-subtle: #fbfcfe;
  --hosted-surface-hover: #f7faff;
  --hosted-ink: #15253f;
  --hosted-ink-secondary: #354761;
  --hosted-muted: #6e7c92;
  --hosted-border: #e4ebf4;
  --hosted-border-subtle: #edf1f6;
  --hosted-primary: #2563eb;
  --hosted-primary-hover: #1d4ed8;
  --hosted-primary-soft: #edf3ff;
  --hosted-success: #18794e;
  --hosted-success-bg: #e8f5ee;
  --hosted-danger: #b42318;
  --hosted-danger-bg: #fff0ee;
  --hosted-card-shadow: 0 6px 20px rgba(21, 37, 63, 0.04);
  --hosted-card-shadow-hover: 0 10px 26px rgba(21, 37, 63, 0.075);
  color: var(--hosted-ink);
  background-color: var(--hosted-bg);
  background-image: var(--hosted-bg-accent);
  font-family:
    -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC",
    "Microsoft YaHei", sans-serif;
  font-size: 15px;
  line-height: 1.55;
  transition:
    background-color 0.25s ease,
    color 0.25s ease;
}

:global(html.dark) .hosted-page,
:global(html[data-theme="dark"]) .hosted-page {
  color-scheme: dark;
  --hosted-bg: #0f172a;
  --hosted-bg-accent: radial-gradient(
    1100px 420px at 50% -120px,
    rgba(59, 130, 246, 0.16),
    transparent 70%
  );
  --hosted-surface: #1e293b;
  --hosted-surface-subtle: #162032;
  --hosted-surface-hover: #263449;
  --hosted-ink: #f1f5f9;
  --hosted-ink-secondary: #cbd5e1;
  --hosted-muted: #94a3b8;
  --hosted-border: #334155;
  --hosted-border-subtle: #283548;
  --hosted-primary: #3b82f6;
  --hosted-primary-hover: #2563eb;
  --hosted-primary-soft: rgba(59, 130, 246, 0.18);
  --hosted-success: #34d399;
  --hosted-success-bg: rgba(16, 185, 129, 0.16);
  --hosted-danger: #f87171;
  --hosted-danger-bg: rgba(239, 68, 68, 0.16);
  --hosted-card-shadow: 0 8px 24px rgba(2, 6, 23, 0.32);
  --hosted-card-shadow-hover: 0 12px 30px rgba(2, 6, 23, 0.48);
}

.hosted-page *,
.hosted-page *::before,
.hosted-page *::after {
  box-sizing: border-box;
}
.app-shell {
  width: min(1160px, 100%);
  margin: 0 auto;
  padding: 24px 28px 0;
}
.app-header {
  display: flex;
  min-height: 62px;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
}
.app-brand,
.header-actions,
.view-heading,
.heading-actions,
.card-heading,
.editor-heading,
.data-card__heading,
.card-actions,
.form-actions,
.import-row,
.job-title-row,
.run-card__top {
  display: flex;
  align-items: center;
}
.app-brand {
  min-width: 0;
  gap: 12px;
}
.app-brand__copy {
  min-width: 0;
}
.app-brand__copy h1 {
  white-space: nowrap;
}
.brand-mark {
  display: grid;
  width: 48px;
  height: 48px;
  flex: 0 0 auto;
  place-items: center;
  border: 1px solid var(--hosted-border);
  border-radius: 16px;
  background: var(--hosted-primary-soft);
  box-shadow: 0 2px 8px rgba(37, 99, 235, 0.08);
}
.brand-mark img {
  width: 34px;
  height: 34px;
  object-fit: contain;
}
.brand-mark--small {
  width: 42px;
  height: 42px;
  border-radius: 14px;
}
.brand-mark--small img {
  width: 29px;
  height: 29px;
}
.app-brand__copy h1,
.auth-brand h1 {
  margin: 0;
  color: var(--hosted-ink);
  font-size: 23px;
  font-weight: 650;
  line-height: 1.18;
  letter-spacing: -0.035em;
}
.eyebrow,
.section-kicker {
  margin: 0 0 4px;
  color: var(--hosted-muted);
  font-size: 11px;
  font-weight: 700;
  line-height: 1.2;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}
.header-actions {
  justify-content: flex-end;
  gap: 8px;
}
.running-chip {
  display: inline-flex;
  min-height: 34px;
  align-items: center;
  gap: 7px;
  padding: 0 11px;
  border: 1px solid rgba(37, 99, 235, 0.28);
  border-radius: 999px;
  background: var(--hosted-primary-soft);
  color: var(--hosted-primary);
  font-size: 12px;
  font-weight: 620;
  white-space: nowrap;
}
.running-chip__dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--hosted-primary);
  animation: hosted-pulse 1.4s ease-in-out infinite;
}
@keyframes hosted-pulse {
  0%,
  100% {
    opacity: 1;
    transform: scale(1);
  }
  50% {
    opacity: 0.4;
    transform: scale(0.85);
  }
}
@keyframes hosted-spin {
  to {
    transform: rotate(360deg);
  }
}
.spin-icon {
  animation: hosted-spin 0.9s linear infinite;
}
.user-chip {
  display: inline-flex;
  max-width: 180px;
  min-height: 36px;
  align-items: center;
  gap: 8px;
  overflow: hidden;
  padding: 0 12px;
  border: 1px solid var(--hosted-border);
  border-radius: 999px;
  background: var(--hosted-surface);
  color: var(--hosted-muted);
  font-size: 13px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.user-chip__name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.user-chip__dot {
  width: 7px;
  height: 7px;
  flex: 0 0 auto;
  border-radius: 50%;
  background: #38a169;
}
.button {
  display: inline-flex;
  min-height: 42px;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 0 16px;
  border: 1px solid transparent;
  border-radius: 12px;
  cursor: pointer;
  font: inherit;
  font-size: 14px;
  font-weight: 620;
  line-height: 1.2;
  text-decoration: none;
  transition:
    background-color 150ms ease,
    border-color 150ms ease,
    color 150ms ease,
    transform 150ms ease,
    box-shadow 150ms ease;
}
.button svg {
  width: 17px;
  height: 17px;
  fill: none;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 1.7;
}
.button--primary {
  border-color: var(--hosted-primary);
  background: var(--hosted-primary);
  color: #fff;
  box-shadow: 0 2px 8px rgba(37, 99, 235, 0.22);
}
.button--primary:hover:not(:disabled) {
  border-color: var(--hosted-primary-hover);
  background: var(--hosted-primary-hover);
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(37, 99, 235, 0.3);
}
.button--secondary {
  border-color: var(--hosted-border);
  background: var(--hosted-surface);
  color: var(--hosted-ink);
}
.button--secondary:hover:not(:disabled),
.button--quiet:hover:not(:disabled) {
  border-color: var(--hosted-primary);
  background: var(--hosted-surface-hover);
}
.button--quiet {
  border-color: transparent;
  background: transparent;
  color: var(--hosted-ink-secondary);
}
.button--danger-quiet {
  border-color: transparent;
  background: transparent;
  color: var(--hosted-danger);
}
.button--danger-quiet:hover:not(:disabled) {
  border-color: rgba(180, 35, 24, 0.25);
  background: var(--hosted-danger-bg);
}
.button--small {
  min-height: 36px;
  padding: 0 12px;
  border-radius: 10px;
  font-size: 13px;
}
.button--tiny {
  min-height: 30px;
  padding: 0 10px;
  border-radius: 8px;
  font-size: 12px;
}
.button--wide {
  width: 100%;
  min-height: 48px;
}
.button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}
button:focus-visible,
a:focus-visible,
summary:focus-visible,
input:focus-visible,
textarea:focus-visible,
select:focus-visible {
  outline: 3px solid rgba(37, 99, 235, 0.28);
  outline-offset: 2px;
}
.section-nav {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 18px;
  padding: 6px;
  border: 1px solid var(--hosted-border);
  border-radius: 16px;
  background: var(--hosted-surface);
  box-shadow: var(--hosted-card-shadow);
}
.section-nav button {
  display: inline-flex;
  min-height: 42px;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 0 16px;
  border: 0;
  border-radius: 11px;
  background: transparent;
  color: var(--hosted-muted);
  cursor: pointer;
  font: inherit;
  font-size: 14px;
  font-weight: 600;
  transition:
    background-color 150ms ease,
    color 150ms ease;
}
.section-nav button:hover:not([aria-pressed="true"]) {
  background: var(--hosted-surface-hover);
  color: var(--hosted-ink);
}
.section-nav button[aria-pressed="true"] {
  background: var(--hosted-primary-soft);
  color: var(--hosted-primary);
}
.section-nav svg,
.mobile-nav svg {
  width: 18px;
  height: 18px;
  fill: none;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 1.7;
}
.nav-count {
  min-width: 20px;
  padding: 0 6px;
  border-radius: 999px;
  background: var(--hosted-surface-subtle);
  border: 1px solid var(--hosted-border);
  color: var(--hosted-muted);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  line-height: 18px;
  text-align: center;
}
.section-nav button[aria-pressed="true"] .nav-count {
  border-color: transparent;
  background: rgba(37, 99, 235, 0.15);
  color: var(--hosted-primary);
}
.page-feedback {
  display: grid;
  gap: 8px;
  margin-top: 14px;
}
.feedback {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin: 0;
  padding: 11px 14px;
  border: 1px solid transparent;
  border-radius: 12px;
  font-size: 14px;
  overflow-wrap: anywhere;
}
.feedback--error {
  border-color: rgba(180, 35, 24, 0.25);
  background: var(--hosted-danger-bg);
  color: var(--hosted-danger);
}
.feedback--notice {
  border-color: rgba(24, 121, 78, 0.25);
  background: var(--hosted-success-bg);
  color: var(--hosted-success);
}
.feedback__close {
  border: 0;
  background: transparent;
  color: currentColor;
  cursor: pointer;
  font-size: 18px;
  line-height: 1;
  opacity: 0.7;
  padding: 2px 6px;
  border-radius: 6px;
}
.feedback__close:hover {
  opacity: 1;
  background: rgba(0, 0, 0, 0.06);
}
.view-section {
  padding: 26px 0 36px;
}
.view-heading {
  justify-content: space-between;
  gap: 20px;
  margin-bottom: 20px;
}
.view-heading h2 {
  margin: 0;
  color: var(--hosted-ink);
  font-size: 27px;
  font-weight: 650;
  line-height: 1.2;
  letter-spacing: -0.03em;
}
.view-heading > div:first-child > p:last-child {
  margin-top: 6px;
  color: var(--hosted-muted);
  font-size: 14px;
}
.heading-actions {
  flex: 0 0 auto;
  gap: 8px;
}
.summary-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px;
  margin-bottom: 16px;
}
.summary-card,
.content-card,
.editor-card,
.data-card,
.run-card,
.empty-panel {
  border: 1px solid var(--hosted-border);
  border-radius: 18px;
  background: var(--hosted-surface);
  box-shadow: var(--hosted-card-shadow);
  transition:
    transform 160ms ease,
    box-shadow 160ms ease,
    border-color 160ms ease;
}
.summary-card {
  min-height: 136px;
  padding: 18px 20px;
  cursor: pointer;
}
.summary-card:hover,
.data-card:hover {
  transform: translateY(-2px);
  box-shadow: var(--hosted-card-shadow-hover);
}
.summary-card__top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.summary-icon {
  display: grid;
  width: 34px;
  height: 34px;
  place-items: center;
  border-radius: 10px;
}
.summary-icon svg {
  width: 18px;
  height: 18px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.8;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.summary-icon--blue {
  background: var(--hosted-primary-soft);
  color: var(--hosted-primary);
}
.summary-icon--green {
  background: var(--hosted-success-bg);
  color: var(--hosted-success);
}
.summary-icon--purple {
  background: rgba(124, 58, 237, 0.12);
  color: #7c3aed;
}
.summary-label {
  margin: 0;
  color: var(--hosted-muted);
  font-size: 13px;
  font-weight: 580;
}
.summary-value {
  display: flex;
  align-items: baseline;
  gap: 6px;
  margin-top: 6px;
  color: var(--hosted-ink);
  font-size: 30px;
  font-weight: 680;
  font-variant-numeric: tabular-nums;
  line-height: 1.15;
  letter-spacing: -0.04em;
}
.summary-total {
  color: var(--hosted-muted);
  font-size: 15px;
  font-weight: 500;
}
.summary-value--status {
  align-items: center;
  gap: 8px;
  font-size: 23px;
}
.summary-value--empty {
  font-size: 22px;
}
.summary-detail {
  margin: 8px 0 0;
  color: var(--hosted-muted);
  font-size: 12px;
}
.summary-detail--truncate {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.status-dot,
.status-mark {
  display: inline-block;
  width: 8px;
  height: 8px;
  flex: 0 0 auto;
  border-radius: 50%;
  background: #95a2b4;
}
.status-dot--success,
.status-mark--success {
  background: #26845c;
}
.status-dot--error,
.status-mark--error {
  background: #c34235;
}
.status-dot--active,
.status-mark--active {
  background: #2563eb;
}
.overview-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.15fr) minmax(0, 0.85fr);
  gap: 14px;
}
.content-card {
  min-width: 0;
  padding: 20px;
}
.card-heading,
.editor-heading {
  justify-content: space-between;
  gap: 16px;
}
.card-heading h3,
.editor-heading h3 {
  margin: 0;
  color: var(--hosted-ink);
  font-size: 17px;
  font-weight: 650;
  letter-spacing: -0.015em;
}
.card-heading p {
  margin: 4px 0 0;
  color: var(--hosted-muted);
  font-size: 12px;
}
.text-button,
.inline-link {
  border: 0;
  background: transparent;
  color: var(--hosted-primary);
  cursor: pointer;
  font: inherit;
  font-size: 13px;
  font-weight: 620;
  text-decoration: none;
  padding: 2px 4px;
  border-radius: 6px;
}
.text-button:hover:not(:disabled),
.inline-link:hover:not(:disabled) {
  color: var(--hosted-primary-hover);
  text-decoration: underline;
}
.text-button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.schedule-list,
.recent-list {
  display: grid;
  gap: 4px;
  margin: 14px 0 0;
  padding: 0;
  list-style: none;
}
.schedule-row,
.recent-row {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 11px;
  padding: 12px 0;
  border-top: 1px solid var(--hosted-border-subtle);
}
.schedule-mark {
  width: 3px;
  height: 34px;
  flex: 0 0 auto;
  border-radius: 3px;
  background: var(--hosted-primary);
}
.schedule-row__main,
.recent-row__main,
.data-card__title {
  display: grid;
  min-width: 0;
  gap: 3px;
}
.schedule-row__main {
  flex: 1 1 auto;
}
.schedule-row .button,
.job-card__heading > .button {
  flex: 0 0 auto;
  white-space: nowrap;
}
.schedule-row__main strong,
.recent-row__main strong {
  overflow: hidden;
  color: var(--hosted-ink);
  font-size: 13px;
  font-weight: 620;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.schedule-row__main span,
.recent-row__main span {
  color: var(--hosted-muted);
  font-size: 12px;
}
.recent-row__main {
  flex: 1 1 auto;
}
.recent-row__main span {
  font-variant-numeric: tabular-nums;
}
.state-pill {
  display: inline-flex;
  min-height: 24px;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  padding: 2px 9px;
  border-radius: 999px;
  background: var(--hosted-surface-subtle);
  color: var(--hosted-muted);
  font-size: 11px;
  font-weight: 650;
  white-space: nowrap;
}
.state-pill--enabled,
.state-pill--success {
  background: var(--hosted-success-bg);
  color: var(--hosted-success);
}
.state-pill--error {
  background: var(--hosted-danger-bg);
  color: var(--hosted-danger);
}
.state-pill--active {
  background: var(--hosted-primary-soft);
  color: var(--hosted-primary);
}
.state-pill--quiet {
  background: var(--hosted-surface-subtle);
  border: 1px solid var(--hosted-border);
  color: var(--hosted-muted);
}
.empty-state {
  display: grid;
  justify-items: start;
  gap: 7px;
  padding: 24px 2px 5px;
}
.empty-state p,
.empty-panel p {
  margin: 0;
  color: var(--hosted-muted);
  font-size: 13px;
}
.empty-title {
  color: var(--hosted-ink) !important;
  font-size: 14px !important;
  font-weight: 640;
}
.empty-state .button {
  margin-top: 6px;
}
.account-grid,
.job-list {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}
.data-card {
  min-width: 0;
  padding: 18px 20px;
}
.data-card__heading {
  min-width: 0;
  gap: 12px;
}
.account-mark {
  display: grid;
  width: 40px;
  height: 40px;
  flex: 0 0 auto;
  place-items: center;
  border: 1px solid var(--hosted-border);
  border-radius: 12px;
  background: var(--hosted-primary-soft);
  color: var(--hosted-primary);
  font-size: 16px;
  font-weight: 650;
}
.account-card--compact {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 14px;
  border-radius: 14px;
}
.account-card__body {
  display: flex;
  align-items: center;
  gap: 11px;
  min-width: 0;
  flex: 1 1 auto;
}
.account-card__meta {
  display: grid;
  gap: 3px;
  min-width: 0;
  flex: 1 1 auto;
}
.account-card__title-row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.account-card__title-row h3 {
  margin: 0;
  color: var(--hosted-ink);
  font-size: 14px;
  font-weight: 630;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.account-card__info-row {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--hosted-muted);
  font-size: 12px;
}
.account-card__server {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.account-card__id {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11px;
  color: #64748b;
  background: var(--hosted-surface-subtle);
  padding: 1px 6px;
  border-radius: 4px;
  border: 1px solid var(--hosted-border-subtle);
}
.account-card__action-row {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 0 0 auto;
}
.state-pill--small {
  padding: 1px 7px;
  font-size: 11px;
  line-height: 1.4;
}
.data-card__title {
  flex: 1 1 auto;
}
.data-card__title h3 {
  margin: 0;
  overflow-wrap: anywhere;
  color: var(--hosted-ink);
  font-size: 16px;
  font-weight: 650;
  line-height: 1.3;
}
.data-card__title p {
  margin: 0;
  color: var(--hosted-muted);
  font-size: 12px;
}
.account-role,
.detail-line {
  display: grid;
  grid-template-columns: minmax(64px, 0.25fr) minmax(0, 1fr);
  align-items: center;
  gap: 10px;
  margin-top: 15px;
  padding-top: 13px;
  border-top: 1px solid var(--hosted-border-subtle);
  color: var(--hosted-muted);
  font-size: 12px;
}
.account-role code {
  min-width: 0;
  padding: 3px 8px;
  border-radius: 6px;
  background: var(--hosted-surface-subtle);
  color: var(--hosted-ink-secondary);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12px;
  overflow-wrap: anywhere;
  justify-self: start;
}
.tag-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.tag-chip {
  display: inline-flex;
  align-items: center;
  padding: 2px 9px;
  border: 1px solid var(--hosted-border);
  border-radius: 999px;
  background: var(--hosted-surface-subtle);
  color: var(--hosted-ink-secondary);
  font-size: 12px;
  font-weight: 550;
}
.tag-chip--action {
  border-color: transparent;
  background: var(--hosted-primary-soft);
  color: var(--hosted-primary);
}
.card-actions,
.form-actions {
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 16px;
}
.editor-card {
  margin-bottom: 16px;
  padding: 22px;
}
.editor-heading {
  margin-bottom: 17px;
}
.editor-heading .section-kicker {
  margin-bottom: 5px;
}
.editor-form {
  display: grid;
  gap: 15px;
}
.field-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 13px;
}
.field-grid--schedule {
  grid-template-columns: 1.2fr 1fr 0.9fr;
}
.field {
  display: grid;
  min-width: 0;
  gap: 6px;
  align-content: start;
}
.field label {
  color: var(--hosted-ink-secondary);
  font-size: 13px;
  font-weight: 620;
}
.field input,
.field textarea,
.field select,
.filter-select {
  display: block;
  width: 100%;
  min-height: 44px;
  padding: 9px 12px;
  border: 1px solid var(--hosted-border);
  border-radius: 12px;
  background: var(--hosted-surface-subtle);
  color: var(--hosted-ink);
  font: inherit;
  font-size: 14px;
  transition: border-color 140ms ease;
}
.field input:hover,
.field textarea:hover,
.field select:hover,
.filter-select:hover {
  border-color: var(--hosted-primary);
}
.field input[type="file"] {
  min-height: 44px;
  padding: 7px 10px;
  color: var(--hosted-muted);
  font-size: 12px;
}
.field input[type="file"]::file-selector-button {
  min-height: 28px;
  margin-right: 9px;
  padding: 0 10px;
  border: 1px solid var(--hosted-border);
  border-radius: 8px;
  background: var(--hosted-surface);
  color: var(--hosted-ink-secondary);
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}
.field textarea {
  min-height: 90px;
  resize: vertical;
  line-height: 1.5;
}
.field input::placeholder,
.field textarea::placeholder {
  color: var(--hosted-muted);
  opacity: 0.75;
}
.preset-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 2px;
}
.preset-chip {
  padding: 3px 9px;
  border: 1px solid var(--hosted-border);
  border-radius: 999px;
  background: var(--hosted-surface);
  color: var(--hosted-muted);
  font: inherit;
  font-size: 11px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  cursor: pointer;
  transition: all 140ms ease;
}
.preset-chip:hover {
  border-color: var(--hosted-primary);
  color: var(--hosted-primary);
}
.preset-chip--active {
  border-color: var(--hosted-primary);
  background: var(--hosted-primary-soft);
  color: var(--hosted-primary);
}
.disclosure-content a {
  color: var(--hosted-primary);
  text-decoration: underline;
  text-underline-offset: 2px;
}
.field-hint {
  margin: 0;
  color: var(--hosted-muted);
  font-size: 12px;
  line-height: 1.5;
}
.disclosure-card {
  border: 1px solid var(--hosted-border);
  border-radius: 14px;
  background: var(--hosted-surface-subtle);
}
.disclosure-card summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 46px;
  padding: 12px 14px;
  color: var(--hosted-ink-secondary);
  cursor: pointer;
  font-size: 13px;
  font-weight: 620;
}
.summary-badge {
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--hosted-primary-soft);
  color: var(--hosted-primary);
  font-size: 11px;
  font-weight: 600;
}
.disclosure-content {
  display: grid;
  gap: 13px;
  padding: 0 14px 15px;
}
.batch-import-box {
  display: grid;
  gap: 10px;
}
.import-actions {
  display: flex;
  justify-content: flex-start;
  margin-top: 2px;
}
.import-row {
  align-items: flex-end;
  gap: 10px;
}
.import-row .field {
  flex: 1 1 auto;
}
.choice-fieldset {
  min-width: 0;
  margin: 0;
  padding: 14px;
  border: 1px solid var(--hosted-border);
  border-radius: 14px;
  background: var(--hosted-surface-subtle);
}
.choice-fieldset legend {
  padding: 0 6px;
  color: var(--hosted-ink-secondary);
  font-size: 13px;
  font-weight: 650;
}
.fieldset-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 10px;
}
.fieldset-count {
  color: var(--hosted-muted);
  font-size: 12px;
  font-weight: 560;
}
.fieldset-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
.choice-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}
.choice-card {
  display: flex;
  min-height: 52px;
  min-width: 0;
  align-items: center;
  gap: 10px;
  padding: 9px 12px;
  border: 1px solid var(--hosted-border);
  border-radius: 12px;
  background: var(--hosted-surface);
  cursor: pointer;
  user-select: none;
  -webkit-user-select: none;
  -webkit-tap-highlight-color: transparent;
  touch-action: manipulation;
  transition:
    border-color 140ms ease,
    background-color 140ms ease;
}
.choice-card:hover {
  border-color: var(--hosted-primary);
}
.choice-card:has(input:checked) {
  border-color: var(--hosted-primary);
  background: var(--hosted-primary-soft);
}
.choice-card input {
  width: 18px;
  height: 18px;
  flex: 0 0 auto;
  accent-color: var(--hosted-primary);
  cursor: pointer;
}
.choice-card span {
  display: grid;
  min-width: 0;
  gap: 2px;
  pointer-events: none;
}
.choice-card strong {
  overflow: hidden;
  color: var(--hosted-ink);
  font-size: 13px;
  font-weight: 620;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.choice-card small {
  overflow: hidden;
  color: var(--hosted-muted);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.choice-grid--actions {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}
.choice-card--action {
  min-height: 46px;
}
.empty-panel {
  display: grid;
  min-height: 230px;
  justify-items: center;
  align-content: center;
  gap: 9px;
  padding: 28px 20px;
  text-align: center;
}
.empty-symbol {
  display: grid;
  width: 44px;
  height: 44px;
  margin-bottom: 3px;
  place-items: center;
  border: 1px solid var(--hosted-border);
  border-radius: 14px;
  background: var(--hosted-primary-soft);
  color: var(--hosted-primary);
  font-size: 22px;
  line-height: 1;
}
.empty-panel h3 {
  margin: 0;
  color: var(--hosted-ink);
  font-size: 17px;
  font-weight: 650;
}
.empty-panel .button {
  margin-top: 7px;
}
.job-card__heading {
  align-items: flex-start;
}
.job-title-row {
  flex-wrap: wrap;
  gap: 8px;
}
.job-card__heading .data-card__title p {
  margin-top: 3px;
  font-variant-numeric: tabular-nums;
}
.job-details {
  margin-top: 5px;
}
.detail-line {
  margin-top: 12px;
  padding-top: 10px;
  grid-template-columns: 46px minmax(0, 1fr);
  align-items: start;
}
.detail-line p {
  margin: 0;
  color: var(--hosted-ink-secondary);
  font-size: 12px;
  overflow-wrap: anywhere;
}
.log-filter-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;
}
.filter-pills {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.filter-pill {
  display: inline-flex;
  min-height: 36px;
  align-items: center;
  gap: 6px;
  padding: 0 12px;
  border: 1px solid var(--hosted-border);
  border-radius: 999px;
  background: var(--hosted-surface);
  color: var(--hosted-muted);
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: all 140ms ease;
}
.filter-pill:hover {
  border-color: var(--hosted-primary);
  color: var(--hosted-ink);
}
.filter-pill[aria-pressed="true"] {
  border-color: var(--hosted-primary);
  background: var(--hosted-primary-soft);
  color: var(--hosted-primary);
}
.filter-pill__count {
  min-width: 18px;
  padding: 0 5px;
  border-radius: 999px;
  background: var(--hosted-surface-subtle);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  line-height: 18px;
}
.log-account-filter {
  min-width: 160px;
}
.filter-select {
  min-height: 36px;
  padding: 6px 12px;
  border-radius: 999px;
  background: var(--hosted-surface);
  font-size: 13px;
}
.run-list {
  display: grid;
  gap: 10px;
}
.run-card {
  min-width: 0;
  padding: 16px 18px;
}
.run-card__top {
  flex-wrap: wrap;
  gap: 9px;
}
.run-action {
  color: var(--hosted-ink-secondary);
  font-size: 13px;
  font-weight: 620;
}
.run-time {
  margin-left: auto;
  color: var(--hosted-muted);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}
.run-card h3 {
  margin: 12px 0 4px;
  color: var(--hosted-ink);
  font-size: 14px;
  font-weight: 650;
}
.run-message {
  margin: 0;
  color: var(--hosted-muted);
  font-size: 13px;
  line-height: 1.55;
  overflow-wrap: anywhere;
}
.run-message--error {
  color: #dc2626;
  font-weight: 500;
}
.run-logs-details {
  margin-top: 10px;
  border: 1px solid var(--hosted-border, #e2e8f0);
  border-radius: 10px;
  background: var(--hosted-surface-alt, rgba(0, 0, 0, 0.02));
  overflow: hidden;
}
.run-logs-summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  font-size: 12px;
  font-weight: 600;
  color: var(--hosted-ink-secondary, #475569);
  cursor: pointer;
  user-select: none;
  background: var(--hosted-surface-subtle, rgba(0, 0, 0, 0.03));
}
.run-logs-summary:hover {
  color: var(--hosted-primary, #2563eb);
}
.run-logs-count {
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 999px;
  background: var(--hosted-border, #e2e8f0);
  color: var(--hosted-muted, #64748b);
}
.run-logs-body {
  max-height: 220px;
  overflow-y: auto;
  padding: 8px 12px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 12px;
  line-height: 1.6;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.run-log-row {
  display: flex;
  gap: 8px;
  color: var(--hosted-ink-secondary, #334155);
}
.run-log-row--error {
  color: #dc2626;
  font-weight: 600;
}
.run-log-row--warn {
  color: #d97706;
}
.run-log-num {
  color: var(--hosted-muted, #94a3b8);
  min-width: 20px;
  text-align: right;
  user-select: none;
}
.run-log-text {
  word-break: break-all;
}
.app-footer__hub {
  color: var(--hosted-primary);
  font-weight: 600;
  text-decoration: none;
  white-space: nowrap;
}
.app-footer {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 18px 2px 28px;
  border-top: 1px solid var(--hosted-border);
  color: var(--hosted-muted);
  font-size: 11px;
}
.auth-screen {
  display: grid;
  min-height: 100vh;
  justify-items: center;
  align-content: center;
  gap: 18px;
  padding: 36px 20px;
}
.auth-brand {
  display: flex;
  width: min(440px, 100%);
  align-items: center;
  gap: 12px;
}
.auth-brand__text {
  flex: 1 1 auto;
}
.auth-brand h1 {
  font-size: 25px;
}
.auth-back-link {
  flex: 0 0 auto;
}
.auth-card {
  width: min(440px, 100%);
  padding: 26px;
  border: 1px solid var(--hosted-border);
  border-radius: 22px;
  background: var(--hosted-surface);
  box-shadow: var(--hosted-card-shadow-hover);
}
.auth-heading h2 {
  margin: 0;
  color: var(--hosted-ink);
  font-size: 23px;
  font-weight: 650;
  letter-spacing: -0.025em;
}
.auth-heading > p:last-child {
  margin: 8px 0 0;
  color: var(--hosted-muted);
  font-size: 13px;
}
.auth-card > .feedback {
  margin-top: 14px;
}
.auth-switch {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 4px;
  margin: 19px 0;
  padding: 4px;
  border: 1px solid var(--hosted-border);
  border-radius: 13px;
  background: var(--hosted-surface-subtle);
}
.auth-switch button {
  min-height: 40px;
  border: 0;
  border-radius: 9px;
  background: transparent;
  color: var(--hosted-muted);
  cursor: pointer;
  font: inherit;
  font-size: 14px;
  font-weight: 620;
}
.auth-switch button[aria-pressed="true"] {
  background: var(--hosted-surface);
  color: var(--hosted-ink);
  box-shadow: 0 1px 4px rgba(20, 39, 67, 0.1);
}
.auth-form {
  display: grid;
  gap: 15px;
}
.auth-form .field input {
  min-height: 48px;
}
.auth-note {
  margin: 17px 0 0;
  padding-top: 14px;
  border-top: 1px solid var(--hosted-border-subtle);
  color: var(--hosted-muted);
  font-size: 12px;
}
.auth-footer {
  margin: 0;
  color: var(--hosted-muted);
  font-size: 12px;
}
.mobile-nav {
  display: none;
}
@media (max-width: 760px) {
  .hosted-page {
    padding-bottom: calc(94px + env(safe-area-inset-bottom));
  }
  .app-shell {
    padding: 12px 16px 0;
  }
  .app-header {
    min-height: 56px;
    gap: 8px;
  }
  .app-brand {
    gap: 9px;
  }
  .brand-mark--small {
    width: 36px;
    height: 36px;
    border-radius: 12px;
  }
  .brand-mark--small img {
    width: 26px;
    height: 26px;
  }
  .app-brand__copy h1 {
    font-size: 18px;
  }
  .app-brand__copy .eyebrow {
    display: none;
  }
  .header-actions {
    flex: 0 0 auto;
    gap: 4px;
    flex-wrap: nowrap;
  }
  .running-chip span:last-child {
    display: none;
  }
  .running-chip {
    padding: 0 9px;
  }
  .user-chip {
    flex: 0 1 88px;
    max-width: 88px;
    min-height: 32px;
    padding: 0 9px;
    font-size: 12px;
  }
  .user-chip__dot {
    display: none;
  }
  .header-actions .button {
    min-height: 38px;
    padding: 0 8px;
    font-size: 12px;
    white-space: nowrap;
  }
  .header-action--local {
    display: none;
  }
  .header-actions .header-action--refresh {
    width: 38px;
    flex: 0 0 38px;
    padding: 0;
  }
  .header-action--refresh span {
    display: none;
  }
  .header-actions .header-action--logout {
    flex: 0 0 auto;
  }
  .header-actions .button svg {
    width: 15px;
    height: 15px;
  }
  .section-nav {
    display: none;
  }
  .view-section {
    padding: 20px 0 20px;
  }
  .view-heading {
    align-items: flex-start;
    flex-direction: column;
    gap: 14px;
    margin-bottom: 16px;
  }
  .view-heading h2 {
    font-size: 24px;
  }
  .view-heading > div:first-child > p:last-child {
    max-width: 40ch;
    font-size: 13px;
  }
  .heading-actions {
    width: 100%;
  }
  .heading-actions .button {
    flex: 1 1 0;
  }
  .summary-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 9px;
  }
  .summary-card {
    min-height: 118px;
    padding: 14px;
    border-radius: 16px;
  }
  .summary-card--latest {
    grid-column: 1 / -1;
    min-height: 102px;
  }
  .summary-value {
    font-size: 26px;
  }
  .summary-value--status {
    font-size: 21px;
  }
  .overview-grid {
    grid-template-columns: minmax(0, 1fr);
    gap: 10px;
  }
  .content-card {
    padding: 16px;
    border-radius: 17px;
  }
  .account-grid,
  .job-list {
    grid-template-columns: minmax(0, 1fr);
    gap: 10px;
  }
  .account-card--compact {
    padding: 10px 12px;
  }
  .data-card,
  .editor-card {
    padding: 16px;
    border-radius: 17px;
  }
  .field-grid,
  .field-grid--schedule {
    grid-template-columns: minmax(0, 1fr);
    gap: 12px;
  }
  .choice-grid,
  .choice-grid--actions {
    grid-template-columns: minmax(0, 1fr);
  }
  .import-row {
    align-items: stretch;
    flex-direction: column;
  }
  .log-filter-bar {
    flex-direction: column;
    align-items: stretch;
  }
  .log-account-filter {
    width: 100%;
  }
  .card-actions .button,
  .form-actions .button {
    flex: 1 1 auto;
  }
  .run-card {
    padding: 14px;
  }
  .run-time {
    width: 100%;
    margin-left: 0;
  }
  .app-footer {
    padding-bottom: 18px;
  }
  .mobile-nav {
    position: fixed;
    z-index: 30;
    right: 0;
    bottom: 0;
    left: 0;
    display: flex;
    justify-content: space-around;
    padding: 7px 10px calc(7px + env(safe-area-inset-bottom));
    border-top: 1px solid var(--hosted-border);
    background: var(--hosted-surface);
    box-shadow: 0 -5px 20px rgba(21, 37, 63, 0.06);
    backdrop-filter: blur(12px);
  }
  .mobile-nav button {
    display: grid;
    min-width: 62px;
    min-height: 52px;
    justify-items: center;
    align-content: center;
    gap: 2px;
    padding: 3px 9px;
    border: 0;
    border-radius: 12px;
    background: transparent;
    color: var(--hosted-muted);
    cursor: pointer;
    font: inherit;
    font-size: 11px;
    font-weight: 580;
  }
  .mobile-nav button[aria-pressed="true"] {
    background: var(--hosted-primary-soft);
    color: var(--hosted-primary);
  }
  .auth-card {
    padding: 21px;
  }
}
.hosted-page--embedded {
  min-height: 100%;
  height: auto;
  overflow: visible;
  background: transparent;
  padding-bottom: 24px;
}
.hosted-page--embedded .app-header,
.hosted-page--embedded .app-footer,
.hosted-page--embedded .mobile-nav {
  display: none;
}
.hosted-page--embedded .embedded-auth-row {
  display: flex;
  min-height: 46px;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
  padding: 4px 6px;
  border: 1px solid var(--hosted-border);
  border-radius: 11px;
  background: var(--hosted-surface);
}
.embedded-auth-row .user-chip { max-width: min(180px, 40vw); min-height: 36px; flex: 0 1 auto; }
.embedded-auth-row .running-chip { min-height: 32px; padding: 0 8px; font-size: 10px; }
.embedded-auth-actions { display: flex; flex: 0 0 auto; align-items: center; gap: 5px; margin-left: auto; }
.embedded-auth-actions .header-action--refresh { width: 40px; min-height: 40px; padding: 0; }
.embedded-auth-actions .header-action--refresh svg { width: 18px; height: 18px; }
.embedded-auth-actions .header-action--logout { min-height: 40px; padding: 0 11px; font-size: 12px; }
@media (max-width: 420px) {
  .hosted-page--embedded .embedded-auth-row { flex-wrap: wrap; gap: 5px; }
  .embedded-auth-row .user-chip { max-width: 145px; }
  .embedded-auth-row .running-chip { margin-right: auto; }
}
.hosted-page--embedded .app-shell {
  width: 100%;
  margin: 0;
  padding: 12px 14px 20px;
}
.hosted-page--embedded .section-nav {
  position: sticky;
  z-index: 4;
  top: 0;
  display: flex;
  gap: 4px;
  margin: 0 0 10px;
  padding: 5px;
  overflow-x: auto;
  border: 1px solid var(--hosted-border);
  border-radius: 12px;
  background: var(--hosted-surface);
  scrollbar-width: none;
}
.hosted-page--embedded .section-nav::-webkit-scrollbar {
  display: none;
}
.hosted-page--embedded .section-nav button {
  flex: 0 0 auto;
  white-space: nowrap;
}
.hosted-page--embedded .view-section {
  padding: 12px 0 18px;
}
.hosted-page--embedded .auth-screen {
  min-height: 0;
  align-content: start;
  padding: 18px 10px;
}
.hosted-page--embedded .auth-brand,
.hosted-page--embedded .auth-footer {
  display: none;
}
.hosted-page--embedded .auth-card {
  width: min(100%, 520px);
}
@media (prefers-reduced-motion: reduce) {
  .hosted-page *,
  .hosted-page *::before,
  .hosted-page *::after {
    scroll-behavior: auto !important;
    transition-duration: 0.01ms !important;
  }
}
</style>
