import { randomUUID } from "node:crypto";
import cron from "node-cron";

export const DEFAULT_TASK_CONCURRENCY = 5;
export const MAX_TASK_CONCURRENCY = 20;

export function parseTaskConcurrency(value = DEFAULT_TASK_CONCURRENCY) {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return DEFAULT_TASK_CONCURRENCY;
    if (!/^\d+$/.test(trimmed))
      throw new TypeError("Task concurrency must be a decimal integer");
    value = Number(trimmed);
  }
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_TASK_CONCURRENCY)
    throw new RangeError(`Task concurrency must be between 1 and ${MAX_TASK_CONCURRENCY}`);
  return value;
}

export class TaskRunner {
  constructor({
    store,
    executeAction,
    clock = () => Date.now(),
    log = () => {},
    autoStart = false,
    concurrency = DEFAULT_TASK_CONCURRENCY,
  } = {}) {
    if (!store || typeof executeAction !== "function")
      throw new TypeError("store and executeAction are required");
    this.store = store;
    this.executeAction = executeAction;
    this.clock = clock;
    this.log = log;
    this.concurrency = parseTaskConcurrency(concurrency);
    this.running = false;
    this.accepting = true;
    this.pumping = false;
    this.pumpPromise = null;
    this.pumpWake = null;
    this.jobs = new Map();
    this.activeRuns = new Map();
    this.shuttingDown = false;
    if (autoStart) this.start();
  }
  enqueue(job, userId, { startPump = true } = {}) {
    if (!this.accepting) throw new Error("Task runner is shutting down");
    const accounts = job.account_ids || job.accountIds;
    const actions = job.actions;
    if (!this.store.hasAccountIds(userId, accounts))
      throw new Error("One or more accounts are unavailable");
    if (actions.includes("nightmareTeam")) {
      if (actions.length !== 1 || accounts.length < 2 || accounts.length > 5)
        throw new Error("Ten Palace team runs require 2–5 accounts and one coordinated action");
      if (accounts.length > this.concurrency)
        throw new Error(`Ten Palace team requires ${accounts.length} slots; current server capacity is ${this.concurrency}`);
    }
    const groupId = randomUUID();
    const rows = [];
    if (actions[0] === "nightmareTeam") {
      const teamConfig = job.config?.nightmareTeam || job.config || {};
      const leaderId = teamConfig.leaderAccountId || accounts[0];
      if (!accounts.includes(leaderId)) throw new Error("Ten Palace leader must be a selected account");
      const ordered = teamConfig.memberOrder || accounts;
      if (!Array.isArray(ordered) || ordered.length !== accounts.length ||
          new Set(ordered).size !== accounts.length || ordered.some((id) => !accounts.includes(id)))
        throw new Error("Ten Palace team member order is invalid");
      const leader = this.store.getAccount(userId, leaderId);
      rows.push({
        id: randomUUID(), userId, jobId: job.id, jobName: job.name, groupId, accountId: leaderId,
        accountName: leader.name, action: "nightmareTeam", accountIds: ordered,
        configJson: job.config ? JSON.stringify(job.config) : null,
      });
    } else for (const accountId of accounts) {
      const account = this.store.getAccount(userId, accountId);
      if (!account) throw new Error("One or more accounts are unavailable");
      for (const action of actions)
        rows.push({
          id: randomUUID(),
          userId,
          jobId: job.id,
          jobName: job.name,
          groupId,
          accountId,
          accountName: account.name,
          action,
          configJson: job.config ? JSON.stringify(job.config) : null,
        });
    }
    this.store.insertRuns(rows);
    if (startPump) this.pump();
    return { groupId, runIds: rows.map((r) => r.id), count: rows.length };
  }
  start() {
    if (this.running) return;
    this.accepting = true;
    this.running = true;
    this.shuttingDown = false;
    this.store.failOversizedTeamRuns?.(this.concurrency);
    this.refreshSchedules();
    this.pump();
  }
  async stop() {
    this.accepting = false;
    this.running = false;
    this.shuttingDown = true;
    for (const task of this.jobs.values()) task.stop();
    this.jobs.clear();
    for (const active of this.activeRuns.values())
      active.controller.abort(new Error("Server shutting down; active result may be unknown"));
    this.pumpWake?.();
    await this.pumpPromise;
    await Promise.allSettled([...this.activeRuns.values()].map((active) => active.promise));
  }
  refreshSchedules() {
    for (const task of this.jobs.values()) task.stop();
    this.jobs.clear();
    if (!this.accepting) return;
    for (const job of this.store.scheduledJobs()) {
      if (job.schedule_type !== "daily" && job.schedule_type !== "cron")
        continue;
      if (!cron.validate(job.schedule_value)) continue;
      try {
        const task = cron.schedule(
          job.schedule_value,
          () => this.scheduleOccurrence(job.id),
          { timezone: "Asia/Shanghai", scheduled: true },
        );
        this.jobs.set(job.id, task);
      } catch (error) {
        this.log("schedule_registration_failed", {
          jobId: job.id,
          error: error.message,
        });
      }
    }
  }
  scheduleOccurrence(jobId) {
    if (!this.accepting) return;
    const job = this.store.getJobById(jobId);
    if (!job?.enabled) return;
    const occurrence = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(new Date(this.clock()));
    try {
      const result = this.store.transaction(() => {
        if (!this.store.markOccurrence(jobId, occurrence)) return null;
        return this.enqueue(job, job.user_id, { startPump: false });
      });
      if (result) {
        this.log("scheduled_run_enqueued", { jobId, groupId: result.groupId });
        queueMicrotask(() => {
          if (this.accepting) this.pump();
        });
      }
    } catch (error) {
      this.log("schedule_enqueue_failed", {
        jobId,
        error: error.message.slice(0, 180),
      });
    }
  }
  cancelGroup(userId, groupId) {
    const runs = this.store.listGroupRuns(userId, groupId);
    if (!runs.length) return null;
    const cancelledQueued = this.store.cancelQueuedGroup(userId, groupId);
    const active = runs.filter((run) => run.status === "running");
    for (const run of active)
      this.activeRuns.get(run.id)?.controller.abort(new Error("用户已停止此执行组"));
    this.pumpWake?.();
    return { groupId, cancelledQueued, stopping: active.length };
  }
  pump() {
    if (!this.accepting) return this.pumpPromise;
    if (this.pumping) {
      this.pumpWake?.();
      return this.pumpPromise;
    }
    this.pumping = true;
    this.pumpPromise = (async () => {
      try {
        while (this.accepting) {
          this.startAvailableRuns();
          if (!this.activeRuns.size) break;
          await new Promise((resolve) => {
            const wake = () => {
              if (this.pumpWake === wake) this.pumpWake = null;
              resolve();
            };
            this.pumpWake = wake;
          });
        }
        if (!this.accepting) {
          await Promise.allSettled(
            [...this.activeRuns.values()].map((active) => active.promise),
          );
        }
      } finally {
        this.pumpWake = null;
        this.pumping = false;
        this.pumpPromise = null;
        if (this.accepting && this.hasRunnableQueuedRun())
          queueMicrotask(() => this.pump());
      }
    })();
    return this.pumpPromise;
  }
  hasRunnableQueuedRun() {
    const activeAccountIds = new Set([...this.activeRuns.values()].flatMap((active) => active.accountIds));
    const activeSlots = [...this.activeRuns.values()].reduce((sum, active) => sum + active.weight, 0);
    return this.store.listQueuedRuns(1000).some((run) => {
      const ids = run.account_ids || [run.account_id];
      return ids.length <= this.concurrency - activeSlots && ids.every((id) => !activeAccountIds.has(id));
    });
  }
  startAvailableRuns() {
    const activeAccountIds = new Set(
      [...this.activeRuns.values()].flatMap((active) => active.accountIds),
    );
    let activeSlots = [...this.activeRuns.values()].reduce((sum, active) => sum + active.weight, 0);
    while (this.accepting && activeSlots < this.concurrency) {
      const run = this.store.listQueuedRuns(1000).find((candidate) => {
        const ids = candidate.account_ids || [candidate.account_id];
        return ids.length <= this.concurrency - activeSlots &&
          ids.every((id) => !activeAccountIds.has(id));
      });
      if (!run) return;
      if (!this.store.startRun(run.id)) continue;
      const controller = new AbortController();
      const accountIds = run.account_ids || [run.account_id];
      const active = {
        accountId: run.account_id,
        accountIds,
        weight: accountIds.length,
        controller,
        userId: run.user_id,
        groupId: run.group_id,
        promise: null,
      };
      this.activeRuns.set(run.id, active);
      accountIds.forEach((id) => activeAccountIds.add(id));
      activeSlots += active.weight;
      active.promise = Promise.resolve()
        .then(() => this.executeRun(run, active))
        .then(
          () => {
            this.activeRuns.delete(run.id);
            this.pumpWake?.();
          },
          (error) => {
            this.activeRuns.delete(run.id);
            this.log("task_run_unexpected_failure", {
              runId: run.id,
              error: String(error?.message || error).slice(0, 180),
            });
            this.pumpWake?.();
          },
        );
    }
  }
  async executeRun(run, active) {
    const runLogs = [];
    try {
      if (active.controller.signal.aborted)
        throw active.controller.signal.reason || new Error("Task cancelled before execution");
      const account = this.store.getAccountById(run.account_id);
      if (!account || account.user_id !== run.user_id)
        throw new Error("Account is no longer available");
      const accountIds = run.account_ids || [run.account_id];
      const teamAccounts = accountIds.map((id) => this.store.getAccountById(id));
      if (teamAccounts.some((item) => !item || item.user_id !== run.user_id))
        throw new Error("One or more Ten Palace team accounts are no longer available");
      const result = await this.executeAction(account, run.action, run.config, {
        signal: active.controller.signal,
        teamAccounts: run.action === "nightmareTeam" ? teamAccounts : undefined,
        checkpoint: run.checkpoint,
        onCheckpoint: (checkpoint, message) => this.store.updateRunCheckpoint(run.id, checkpoint, message),
        onProgress: (message) => {
          runLogs.push(message);
          if (runLogs.length > 200) runLogs.shift();
          this.store.updateRunMessage(run.id, message);
        },
      });
      const summary = typeof result?.message === "string"
        ? result.message.slice(0, 500)
        : result && Number.isFinite(result.completed)
          ? `已完成 ${result.completed} 项，跳过 ${result.skipped || 0} 项，失败 ${result.failed || 0} 项，发送 ${result.commandCount || 0} 条指令`
          : "Action completed successfully";
      const failed = Number.isFinite(result?.failed) ? result.failed : 0;
      const status = failed > 0 ? (Number(result?.completed) > 0 ? "partial" : "failed") : "succeeded";
      this.store.finishRun(run.id, status, summary, runLogs);
    } catch (error) {
      const message = String(error?.message || "Task failed").slice(0, 500);
      const logs = Array.isArray(error?.records) && error.records.length ? error.records : runLogs;
      if (this.shuttingDown) {
        if (run.action === "nightmareTeam") this.store.requeueRun(run.id, "服务器重启，恢复前会先核对游戏内房间状态");
        else this.store.finishRun(run.id, "failed", "Server shutting down; active result is unknown", logs);
      } else if (active.controller.signal.aborted && !error?.uncertain && error?.code !== "UNCERTAIN_WRITE") {
        this.store.finishRun(run.id, "cancelled", `已停止：${message}`, logs);
      } else {
        this.store.finishRun(run.id, "failed", message, logs);
      }
    }
  }
}
