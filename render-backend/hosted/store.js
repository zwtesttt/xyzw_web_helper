import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

export class HostedStore {
  constructor({
    dbPath = "/data/hosted.sqlite",
    clock = () => Date.now(),
  } = {}) {
    this.clock = clock;
    this.transactionDepth = 0;
    if (dbPath !== ":memory:")
      mkdirSync(path.dirname(dbPath), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(dbPath);
    this.db.exec(`
      PRAGMA foreign_keys=ON;
      PRAGMA busy_timeout=5000;
      PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE COLLATE NOCASE,
        password_hash TEXT NOT NULL, created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sessions (
        id_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);
      CREATE TABLE IF NOT EXISTS accounts (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL, server TEXT NOT NULL DEFAULT '', role_id TEXT NOT NULL,
        credential_enc TEXT NOT NULL, bin_enc TEXT, source_local_id TEXT,
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS accounts_user_idx ON accounts(user_id);
      CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL, account_ids TEXT NOT NULL, actions TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1, schedule_type TEXT NOT NULL,
        schedule_value TEXT NOT NULL, timezone TEXT NOT NULL DEFAULT 'Asia/Shanghai',
        source_plan_id TEXT, local_task_ids TEXT, config_json TEXT,
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS jobs_user_idx ON jobs(user_id);
      CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        job_id TEXT REFERENCES jobs(id) ON DELETE SET NULL, job_name TEXT, group_id TEXT NOT NULL,
        account_id TEXT NOT NULL, account_name TEXT NOT NULL, action TEXT NOT NULL,
        status TEXT NOT NULL, message TEXT NOT NULL DEFAULT '', queued_at INTEGER NOT NULL,
        started_at INTEGER, finished_at INTEGER, config_json TEXT,
        account_ids_json TEXT, checkpoint_json TEXT
      );
      CREATE INDEX IF NOT EXISTS runs_user_idx ON runs(user_id, queued_at DESC);
      CREATE TABLE IF NOT EXISTS schedule_marks (
        job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
        occurrence TEXT NOT NULL, created_at INTEGER NOT NULL,
        PRIMARY KEY(job_id, occurrence)
      );
    `);
    for (const [table, column, definition] of [
      ["accounts", "source_local_id", "TEXT"],
      ["jobs", "source_plan_id", "TEXT"],
      ["jobs", "local_task_ids", "TEXT"],
      ["jobs", "config_json", "TEXT"],
      ["runs", "config_json", "TEXT"],
      ["runs", "job_name", "TEXT"],
      ["runs", "logs_json", "TEXT"],
      ["runs", "account_ids_json", "TEXT"],
      ["runs", "checkpoint_json", "TEXT"],
    ]) {
      const columns = this.db.prepare(`PRAGMA table_info(${table})`).all();
      if (!columns.some((item) => item.name === column))
        this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
    this.db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS accounts_source_local_idx
        ON accounts(user_id,source_local_id) WHERE source_local_id IS NOT NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS jobs_source_plan_idx
        ON jobs(user_id,source_plan_id) WHERE source_plan_id IS NOT NULL;
    `);
    this.db
      .prepare("UPDATE runs SET status='failed', message='Server restarted while this action was running; result is unknown', finished_at=? WHERE status='running' AND action!='nightmareTeam'")
      .run(this.clock());
    this.db.prepare("UPDATE runs SET status='queued',message='服务器重启，先核对游戏内队伍与房间状态后恢复',started_at=NULL WHERE status='running' AND action='nightmareTeam'").run();
  }

  now() {
    return this.clock();
  }
  transaction(fn) {
    const depth = this.transactionDepth++;
    const savepoint = `hosted_${depth}`;
    this.db.exec(depth === 0 ? "BEGIN IMMEDIATE" : `SAVEPOINT ${savepoint}`);
    try {
      const result = fn();
      this.db.exec(depth === 0 ? "COMMIT" : `RELEASE SAVEPOINT ${savepoint}`);
      return result;
    } catch (error) {
      try {
        this.db.exec(
          depth === 0
            ? "ROLLBACK"
            : `ROLLBACK TO SAVEPOINT ${savepoint}; RELEASE SAVEPOINT ${savepoint}`,
        );
      } catch {}
      throw error;
    } finally {
      this.transactionDepth--;
    }
  }
  close() {
    this.db.close();
  }

  createUser(username, passwordHash) {
    const id = randomUUID();
    this.db
      .prepare(
        "INSERT INTO users(id, username, password_hash, created_at) VALUES(?,?,?,?)",
      )
      .run(id, username, passwordHash, this.now());
    return { id, username };
  }
  getUserByUsername(username) {
    return this.db
      .prepare(
        "SELECT id, username, password_hash FROM users WHERE username=? COLLATE NOCASE",
      )
      .get(username);
  }
  getUser(id) {
    return this.db
      .prepare("SELECT id, username, created_at FROM users WHERE id=?")
      .get(id);
  }
  createSession(idHash, userId, expiresAt) {
    this.db
      .prepare(
        "INSERT INTO sessions(id_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)",
      )
      .run(idHash, userId, expiresAt, this.now());
  }
  getSession(idHash) {
    return this.db
      .prepare("SELECT user_id, expires_at FROM sessions WHERE id_hash=?")
      .get(idHash);
  }
  deleteSession(idHash) {
    this.db.prepare("DELETE FROM sessions WHERE id_hash=?").run(idHash);
  }
  cleanExpiredSessions() {
    this.db.prepare("DELETE FROM sessions WHERE expires_at<=?").run(this.now());
  }

  insertAccount({
    id = randomUUID(),
    userId,
    name,
    server = "",
    roleId,
    credentialEnc,
    binEnc = null,
    sourceLocalId = null,
  }) {
    if (
      this.db
        .prepare("SELECT COUNT(*) AS n FROM accounts WHERE user_id=?")
        .get(userId).n >= 100
    )
      throw new Error("Account limit reached (100 per user)");
    const now = this.now();
    this.db
      .prepare(
        "INSERT INTO accounts(id,user_id,name,server,role_id,credential_enc,bin_enc,source_local_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
      )
      .run(id, userId, name, server, roleId, credentialEnc, binEnc, sourceLocalId, now, now);
    return this.getAccount(userId, id);
  }
  getAccount(userId, id) {
    return this.db
      .prepare(
        "SELECT id,user_id,name,server,role_id,credential_enc,bin_enc,source_local_id,created_at,updated_at FROM accounts WHERE user_id=? AND id=?",
      )
      .get(userId, id);
  }
  getAccountById(id) {
    return this.db
      .prepare(
        "SELECT id,user_id,name,server,role_id,credential_enc,bin_enc,source_local_id,created_at,updated_at FROM accounts WHERE id=?",
      )
      .get(id);
  }
  getAccountBySourceLocalId(userId, sourceLocalId) {
    return this.db.prepare(
      "SELECT * FROM accounts WHERE user_id=? AND source_local_id=?",
    ).get(userId, sourceLocalId);
  }
  getAccountByRoleId(userId, roleId) {
    if (!roleId) return null;
    return this.db.prepare(
      "SELECT id,user_id,name,server,role_id,credential_enc,bin_enc,source_local_id,created_at,updated_at FROM accounts WHERE user_id=? AND role_id=?",
    ).get(userId, roleId);
  }
  upsertSourceAccount({
    userId, sourceLocalId, name, server = "", roleId, credentialEnc, binEnc,
  }) {
    const old = this.getAccountBySourceLocalId(userId, sourceLocalId);
    if (!old) return this.insertAccount({
      userId, sourceLocalId, name, server, roleId, credentialEnc, binEnc,
    });
    this.db.prepare(
      "UPDATE accounts SET name=?,server=?,role_id=?,credential_enc=?,bin_enc=?,updated_at=? WHERE user_id=? AND id=?",
    ).run(name, server, roleId, credentialEnc,
      binEnc === undefined ? old.bin_enc : binEnc,
      this.now(), userId, old.id);
    return this.getAccount(userId, old.id);
  }
  listAccounts(userId) {
    return this.db
      .prepare(
        "SELECT id,user_id,name,server,role_id,CASE WHEN bin_enc IS NOT NULL THEN 1 ELSE 0 END AS has_bin,created_at,updated_at FROM accounts WHERE user_id=? ORDER BY created_at",
      )
      .all(userId);
  }
  updateAccount(userId, id, { name, server, credentialEnc, binEnc, roleId }) {
    const row = this.getAccount(userId, id);
    if (!row) return null;
    this.db
      .prepare(
        "UPDATE accounts SET name=?,server=?,role_id=?,credential_enc=?,bin_enc=?,updated_at=? WHERE user_id=? AND id=?",
      )
      .run(
        name ?? row.name,
        server ?? row.server,
        roleId ?? row.role_id,
        credentialEnc ?? row.credential_enc,
        binEnc === undefined ? row.bin_enc : binEnc,
        this.now(),
        userId,
        id,
      );
    return this.getAccount(userId, id);
  }
  deleteAccount(userId, id) {
    if (!this.getAccount(userId, id)) return false;
    this.transaction(() => {
      this.db
        .prepare("DELETE FROM accounts WHERE user_id=? AND id=?")
        .run(userId, id);
      for (const job of this.listJobs(userId))
        if (job.account_ids.includes(id)) {
          const accountIds = job.account_ids.filter(
            (accountId) => accountId !== id,
          );
          if (accountIds.length) {
            const config = job.config ? { ...job.config } : undefined;
            const wasTeam = job.actions.includes("nightmareTeam");
            if (wasTeam && config?.nightmareTeam) {
              config.nightmareTeam = {
                ...config.nightmareTeam,
                memberOrder: (config.nightmareTeam.memberOrder || job.account_ids).filter((memberId) => memberId !== id),
              };
            }
            if (config) {
              const remainingAccounts = accountIds.map((id) => this.getAccountById(id)).filter(Boolean);
              const remainingLocalIds = new Set(remainingAccounts.map((account) => account.source_local_id).filter(Boolean));
              config.accountLocalIds = (config.accountLocalIds || []).filter((localId) => remainingLocalIds.has(localId));
              config.dailySettingsByAccount = Object.fromEntries(
                Object.entries(config.dailySettingsByAccount || {}).filter(([id]) => accountIds.includes(id)),
              );
            }
            this.updateJob(userId, job.id, { accountIds, config, ...(wasTeam ? { enabled: false } : {}) });
          } else if (job.source_plan_id) {
            this.updateJob(userId, job.id, { accountIds: [], enabled: false, config: {
              ...job.config,
              accountLocalIds: [],
              dailySettingsByAccount: {},
            } });
          } else this.deleteJob(userId, job.id);
        }
    });
    return true;
  }

  insertJob({
    id = randomUUID(),
    userId,
    name,
    accountIds,
    actions,
    enabled = true,
    scheduleType,
    scheduleValue,
    timezone,
    sourcePlanId = null,
    localTaskIds = null,
    config = null,
  }) {
    if (
      this.db
        .prepare("SELECT COUNT(*) AS n FROM jobs WHERE user_id=?")
        .get(userId).n >= 100
    )
      throw new Error("Job limit reached (100 per user)");
    const now = this.now();
    this.db
      .prepare(
        "INSERT INTO jobs(id,user_id,name,account_ids,actions,enabled,schedule_type,schedule_value,timezone,source_plan_id,local_task_ids,config_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      )
      .run(
        id,
        userId,
        name,
        JSON.stringify(accountIds),
        JSON.stringify(actions),
        enabled ? 1 : 0,
        scheduleType,
        scheduleValue,
        timezone,
        sourcePlanId,
        localTaskIds ? JSON.stringify(localTaskIds) : null,
        config ? JSON.stringify(config) : null,
        now,
        now,
      );
    return this.getJob(userId, id);
  }
  decodeJob(row) {
    return (
      row && {
        ...row,
        account_ids: JSON.parse(row.account_ids),
        actions: JSON.parse(row.actions),
        enabled: !!row.enabled,
        local_task_ids: row.local_task_ids ? JSON.parse(row.local_task_ids) : null,
        config: row.config_json ? JSON.parse(row.config_json) : null,
      }
    );
  }
  getJob(userId, id) {
    return this.decodeJob(
      this.db
        .prepare("SELECT * FROM jobs WHERE user_id=? AND id=?")
        .get(userId, id),
    );
  }
  getJobById(id) {
    return this.decodeJob(
      this.db.prepare("SELECT * FROM jobs WHERE id=?").get(id),
    );
  }
  getBatchPlan(userId, sourcePlanId) {
    const row = this.db.prepare(
      "SELECT * FROM jobs WHERE user_id=? AND source_plan_id=?",
    ).get(userId, sourcePlanId);
    return this.decodeJob(row);
  }
  listJobs(userId) {
    return this.db
      .prepare("SELECT * FROM jobs WHERE user_id=? ORDER BY created_at")
      .all(userId)
      .map((r) => this.decodeJob(r));
  }
  updateJob(userId, id, input) {
    const old = this.getJob(userId, id);
    if (!old) return null;
    this.db
      .prepare(
        "UPDATE jobs SET name=?,account_ids=?,actions=?,enabled=?,schedule_type=?,schedule_value=?,timezone=?,source_plan_id=?,local_task_ids=?,config_json=?,updated_at=? WHERE user_id=? AND id=?",
      )
      .run(
        input.name ?? old.name,
        JSON.stringify(input.accountIds ?? old.account_ids),
        JSON.stringify(input.actions ?? old.actions),
        (input.enabled ?? old.enabled) ? 1 : 0,
        input.scheduleType ?? old.schedule_type,
        input.scheduleValue ?? old.schedule_value,
        input.timezone ?? old.timezone,
        input.sourcePlanId === undefined ? old.source_plan_id : input.sourcePlanId,
        input.localTaskIds === undefined ? (old.local_task_ids ? JSON.stringify(old.local_task_ids) : null) : JSON.stringify(input.localTaskIds),
        input.config === undefined ? old.config_json : JSON.stringify(input.config),
        this.now(),
        userId,
        id,
      );
    return this.getJob(userId, id);
  }
  deleteJob(userId, id) {
    return (
      this.db
        .prepare("DELETE FROM jobs WHERE user_id=? AND id=?")
        .run(userId, id).changes > 0
    );
  }
  insertRuns(rows) {
    const stmt = this.db.prepare(
      "INSERT INTO runs(id,user_id,job_id,job_name,group_id,account_id,account_name,action,status,message,queued_at,config_json,account_ids_json,checkpoint_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    );
    const now = this.now();
    this.transaction(() => {
      if (
        this.db
          .prepare("SELECT COUNT(*) AS n FROM runs WHERE status='queued'")
          .get().n +
          rows.length >
        1000
      )
        throw new Error("Task queue is full");
      for (const r of rows)
        stmt.run(
          r.id ?? randomUUID(),
          r.userId,
          r.jobId ?? null,
          r.jobName ?? null,
          r.groupId,
          r.accountId,
          r.accountName,
          r.action,
          "queued",
          "",
          now,
          r.configJson ?? null,
          JSON.stringify(r.accountIds || [r.accountId]),
          r.checkpointJson || null,
        );
    });
  }
  decodeRun(row) {
    if (!row) return row;
    const { effective_job_name, ...decoded } = row;
    return {
      ...decoded,
      job_name: effective_job_name ?? decoded.job_name ?? null,
      config: row.config_json ? JSON.parse(row.config_json) : null,
      account_ids: row.account_ids_json ? JSON.parse(row.account_ids_json) : [row.account_id],
      checkpoint: row.checkpoint_json ? JSON.parse(row.checkpoint_json) : null,
    };
  }
  nextQueuedRun(excludedAccountIds = []) {
    const excluded = [...new Set(excludedAccountIds)];
    const exclusion = excluded.length
      ? `AND account_id NOT IN (${excluded.map(() => "?").join(",")})`
      : "";
    const row = this.db.prepare(
      `SELECT * FROM runs WHERE status='queued' ${exclusion} ORDER BY queued_at,rowid LIMIT 1`,
    ).get(...excluded);
    return this.decodeRun(row);
  }
  listQueuedRuns(limit = 100) {
    return this.db
      .prepare(
        "SELECT * FROM runs WHERE status='queued' ORDER BY queued_at,rowid LIMIT ?",
      )
      .all(limit).map((row) => this.decodeRun(row));
  }
  updateRunCheckpoint(id, checkpoint, message = undefined) {
    this.db.prepare("UPDATE runs SET checkpoint_json=?,message=COALESCE(?,message) WHERE id=? AND status='running'")
      .run(checkpoint == null ? null : JSON.stringify(checkpoint), message == null ? null : String(message).slice(0, 500), id);
  }
  requeueRun(id, message = "服务器正在重启，等待恢复") {
    return this.db.prepare("UPDATE runs SET status='queued',message=?,started_at=NULL,finished_at=NULL WHERE id=? AND action='nightmareTeam' AND status='running'")
      .run(String(message).slice(0, 500), id).changes === 1;
  }
  failOversizedTeamRuns(capacity) {
    const rows = this.db.prepare("SELECT id,account_ids_json FROM runs WHERE status='queued' AND action='nightmareTeam'").all();
    const fail = this.db.prepare("UPDATE runs SET status='failed',message=?,finished_at=? WHERE id=? AND status='queued'");
    for (const row of rows) {
      let count = 0;
      try { count = JSON.parse(row.account_ids_json || "[]").length; } catch {}
      if (count > capacity || count < 2)
        fail.run(`十殿队伍需要 ${count} 个账号并发名额，当前容量为 ${capacity}；请调整容量或队伍后重新运行`, this.now(), row.id);
    }
  }
  startRun(id) {
    return (
      this.db
        .prepare(
          "UPDATE runs SET status='running',started_at=? WHERE id=? AND status='queued'",
        )
        .run(this.now(), id).changes === 1
    );
  }
  updateRunMessage(id, message) {
    this.db.prepare("UPDATE runs SET message=? WHERE id=? AND status='running'")
      .run(String(message || "").slice(0, 500), id);
  }
  cancelQueuedGroup(userId, groupId) {
    const result = this.db.prepare(
      "UPDATE runs SET status='cancelled',message='已停止，任务未开始',finished_at=? WHERE user_id=? AND group_id=? AND status='queued'",
    ).run(this.now(), userId, groupId);
    return result.changes;
  }
  listGroupRuns(userId, groupId) {
    return this.db.prepare(
      "SELECT * FROM runs WHERE user_id=? AND group_id=? ORDER BY queued_at,rowid",
    ).all(userId, groupId).map((row) => this.decodeRun(row));
  }
  finishRun(id, status, message, logs = null) {
    const logsJson = Array.isArray(logs)
      ? JSON.stringify(logs)
      : typeof logs === "string"
        ? logs
        : null;
    this.db
      .prepare(
        "UPDATE runs SET status=?,message=?,finished_at=?,logs_json=? WHERE id=?",
      )
      .run(status, String(message || "").slice(0, 500), this.now(), logsJson, id);
    this.db
      .prepare(
        "DELETE FROM runs WHERE id IN (SELECT id FROM runs ORDER BY queued_at DESC LIMIT -1 OFFSET 10000) AND status NOT IN ('queued','running')",
      )
      .run();
  }
  listRuns(userId, limit = 100) {
    return this.db
      .prepare(
        "SELECT r.*, COALESCE(NULLIF(r.job_name,''),j.name) AS effective_job_name FROM runs r LEFT JOIN jobs j ON j.id=r.job_id AND j.user_id=r.user_id WHERE r.user_id=? ORDER BY r.queued_at DESC LIMIT ?",
      )
      .all(userId, limit).map((row) => this.decodeRun(row));
  }
  getRun(userId, id) {
    return this.decodeRun(this.db
      .prepare("SELECT r.*, COALESCE(NULLIF(r.job_name,''),j.name) AS effective_job_name FROM runs r LEFT JOIN jobs j ON j.id=r.job_id AND j.user_id=r.user_id WHERE r.user_id=? AND r.id=?")
      .get(userId, id));
  }
  scheduledJobs() {
    return this.db
      .prepare("SELECT * FROM jobs WHERE enabled=1")
      .all()
      .map((r) => this.decodeJob(r));
  }
  markOccurrence(jobId, occurrence) {
    return (
      this.db
        .prepare(
          "INSERT OR IGNORE INTO schedule_marks(job_id,occurrence,created_at) VALUES(?,?,?)",
        )
        .run(jobId, occurrence, this.now()).changes === 1
    );
  }
  hasAccountIds(userId, ids) {
    if (!ids.length) return false;
    const q = ids.map(() => "?").join(",");
    return (
      this.db
        .prepare(
          `SELECT COUNT(*) AS n FROM accounts WHERE user_id=? AND id IN (${q})`,
        )
        .get(userId, ...ids).n === ids.length
    );
  }
}
