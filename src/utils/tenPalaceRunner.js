import {
  canUseCharm,
  challengeEligibility,
  charmFestivalActive,
  charmMarketStock,
  countRoleItem,
  currentLegionSeason,
  entriesOf,
  field,
  hasClaimableTenPalaceWeekReward,
  isBoss12RoleBlocked,
  isMatchingTenPalaceRoomBattle,
  nextBattleMember,
  normalizeTenPalaceOptions,
  parseRolePayload,
  parseRoleTenPalaceTeamId,
  parseRoomFighterResult,
  parseTenPalaceFormation,
  parseTenPalaceRoleState,
  parseTenPalaceRoom,
  requiredEntryItems,
  roomHasSurvivingHero,
  teamCreateParams,
  teamJoinParams,
  TEN_PALACE_TEAM_TYPE,
  tenPalaceBattlePresentation,
  tenPalaceRoomTeamMatches,
  tenPalaceServerId,
  toGameRoleId,
  writeCheckpoint,
} from "./tenPalace.js";

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function list(value, label) {
  if (Array.isArray(value)) return value;
  if (value instanceof Map) return [...value.values()];
  if (value && typeof value === "object") return Object.values(value);
  if (value == null) return [];
  throw new Error(`${label}格式不正确`);
}
function roleIdOf(value) { return String(field(value, "roleId", field(value, "roleID", ""))); }
function memberRows(team) { return list(field(team, "fightRoleBase", []), "十殿队伍成员"); }
function roleRow(team, roleId) { return memberRows(team).find((row) => roleIdOf(row) === String(roleId)); }
function sameMap(a, b) {
  try {
    const left = entriesOf(a, "已保存十殿阵容").map(([key, value]) => [Number(key), Number(field(value, "id", field(value, "heroId", value)))])
      .filter(([, id]) => id > 0).sort((x, y) => x[0] - y[0]);
    const right = entriesOf(b, "当前十殿阵容").map(([key, value]) => [Number(key), Number(value)])
      .filter(([, id]) => id > 0).sort((x, y) => x[0] - y[0]);
    return JSON.stringify(left) === JSON.stringify(right);
  } catch { return false; }
}
function sameFormation(a, b) {
  return sameMap(a.battleTeam, b.battleTeam) && Number(a.lordWeaponId) === Number(b.lordWeaponId) && String(a.petUId) === String(b.petUId);
}
function challengeForRoom(config, room) {
  const boss = config.monsters.find((row) => row.id === room.curMonsterCfgId);
  return Number(boss?.bossType) || 0;
}
function getPrepared(row) { return Number(field(row, "prepared", 0)); }
function getRoomId(state) { return String(state?.roomId || ""); }
function getServerNow(clock, member) { return Number(member.serverTime?.() || clock()); }
function challengeName(challenge) { return String(challenge.name || `挑战 ${challenge.id}`); }

/** A single fixed-team invocation. State writes are checkpointed and never blindly replayed. */
export async function runTenPalaceTeam({
  members,
  config,
  settings: rawSettings = {},
  leaderRoleId,
  memberOrder,
  checkpoint: savedCheckpoint = null,
  signal,
  onCheckpoint,
  waitForBattle,
  onProgress = () => {},
  sleep = wait,
  clock = () => Date.now(),
  pollMs = 5000,
  maxCommands = 10000,
} = {}) {
  const settings = normalizeTenPalaceOptions(rawSettings);
  if (!Array.isArray(members) || members.length < 2 || members.length > 5) throw new Error("十殿固定队伍需要 2–5 个账号");
  const ids = members.map((member) => String(toGameRoleId(member.roleId)));
  if (ids.some((id) => !id) || new Set(ids).size !== ids.length) throw new Error("十殿队伍必须使用不同且有效的游戏角色");
  if (members.some((member) => typeof member.send !== "function")) throw new Error("十殿队伍传输接口不完整");
  const orderedRoleIds = (memberOrder || ids).map(String);
  if (orderedRoleIds.length !== ids.length || new Set(orderedRoleIds).size !== ids.length || orderedRoleIds.some((id) => !ids.includes(id)))
    throw new Error("十殿队伍角色顺序无效");
  const leaderId = String(leaderRoleId || ids[0]);
  const leader = members.find((member) => String(member.roleId) === leaderId);
  if (!leader) throw new Error("十殿队长必须是所选角色");
  const teamConfig = config?.teams?.find((row) => row.matchTeamType === 1);
  const challenge = config?.challenges?.find((row) => row.id === settings.challengeId);
  if (!teamConfig || !challenge) throw new Error("当前游戏配置中没有所选十殿挑战/队伍");
  if (members.length < teamConfig.memberMin || members.length > teamConfig.memberMax) throw new Error(`当前挑战要求 ${teamConfig.memberMin}–${teamConfig.memberMax} 人`);

  const startedAt = savedCheckpoint?.startedAt || clock();
  const userDeadline = startedAt + settings.runLimitMinutes * 60 * 1000;
  const challengeLimit = Number(challenge.totalTime) > 0 ? Number(challenge.totalTime) * 1000 : 2 * 60 * 60 * 1000;
  const initialDeadline = Math.min(userDeadline, startedAt + challengeLimit, startedAt + 2 * 60 * 60 * 1000);
  let deadline = Math.min(Number(savedCheckpoint?.deadline) || initialDeadline, initialDeadline, userDeadline, startedAt + 2 * 60 * 60 * 1000);
  let commandCount = 0;
  let checkpoint = {
    ...(savedCheckpoint || {}),
    identity: ids,
    leaderRoleId: leaderId,
    challengeId: challenge.id,
    startedAt,
    deadline,
    stage: savedCheckpoint?.stage || "read-state",
    teamId: savedCheckpoint?.teamId || "",
    roomId: savedCheckpoint?.roomId || "",
    pendingAction: savedCheckpoint?.pendingAction || null,
    charmSpent: savedCheckpoint?.charmSpent || {},
    restoreCount: Number(savedCheckpoint?.restoreCount || 0),
  };
  const progress = (text, type = "info") => onProgress({ text, type, checkpoint: { ...checkpoint } });
  const delay = (ms, abortSignal = signal) => {
    if (!abortSignal) return sleep(ms);
    let abortHandler;
    const aborted = new Promise((_, reject) => {
      abortHandler = () => reject(abortSignal.reason || new Error("十殿队伍任务已停止"));
      if (abortSignal.aborted) abortHandler();
      else abortSignal.addEventListener("abort", abortHandler, { once: true });
    });
    return Promise.race([sleep(ms), aborted]).finally(() => abortSignal.removeEventListener("abort", abortHandler));
  };
  const sleepChecked = async (ms, abortSignal = signal) => {
    let remaining = Math.max(0, Number(ms) || 0);
    while (remaining > 0) {
      assertRunning();
      const slice = Math.min(remaining, 500);
      await delay(slice, abortSignal);
      remaining -= slice;
    }
    assertRunning();
  };
  const assertRunning = () => {
    if (signal?.aborted) throw signal.reason || new Error("十殿队伍任务已停止");
    if (clock() >= deadline) throw new Error("十殿房间运行时限已到，已停止后续操作");
    if (commandCount >= maxCommands) throw new Error("十殿操作达到安全上限，已停止后续操作");
    for (const member of members) if (typeof member.connected === "function" && !member.connected()) throw new Error(`角色 ${member.roleId} 连接已断开，停止当前队伍`);
  };
  const send = async (member, cmd, params = {}, timeout = 15000) => {
    assertRunning();
    commandCount++;
    return member.send(cmd, params, timeout);
  };
  const save = async (stage, pendingAction = null, extra = {}) => {
    checkpoint = { ...checkpoint, stage, pendingAction, ...extra };
    await writeCheckpoint({ onCheckpoint }, checkpoint);
    progress(stage || "状态已复核");
  };
  const narrowDeadlineFromRoom = (value) => {
    const raw = Number(field(value, "createAt", 0));
    if (!Number.isFinite(raw) || raw <= 0 || !Number.isFinite(Number(challenge.totalTime)) || Number(challenge.totalTime) <= 0) return;
    const createdAt = raw > 1e12 ? raw : raw * 1000;
    deadline = Math.min(deadline, createdAt + Number(challenge.totalTime) * 1000);
    checkpoint.deadline = deadline;
  };
  const mutate = async ({ member = leader, command, params, checkpointParams = params, stage, verify, message }) => {
    if (checkpoint.pendingAction) throw new Error(`存在未确认的 ${checkpoint.pendingAction.command} 操作，停止以避免重复写入`);
    await save(stage, { command, roleId: String(member.roleId), params: checkpointParams, sentAt: clock() });
    let response;
    try { response = await send(member, command, params, 15000); }
    catch (error) {
      error.uncertain = true;
      error.code = "UNCERTAIN_WRITE";
      throw error;
    }
    let observed;
    try { observed = await verify(response); }
    catch (error) { error.uncertain = true; error.code = "UNCERTAIN_WRITE"; throw error; }
    if (!observed) throw Object.assign(new Error(`${message || command}结果无法从游戏状态确认；不会自动重试`), { uncertain: true, code: "UNCERTAIN_WRITE" });
    await save(stage, null);
    if (observed.rejected) progress(observed.message || `${command}被游戏明确拒绝`, "warning");
    else progress(message || `${command}已确认`, "success");
    return observed;
  };
  const waitUntil = async (read, predicate, { timeout = 30000, interval = pollMs } = {}) => {
    const end = Math.min(deadline, clock() + timeout);
    while (clock() < end) {
      assertRunning();
      const value = await read();
      if (predicate(value)) return value;
      await sleepChecked(Math.min(interval, Math.max(50, end - clock())));
    }
    return null;
  };
  const readProfile = async (member) => {
    const rolePayload = await send(member, "role_getroleinfo", {}, 15000);
    const role = parseRolePayload(rolePayload);
    const actualRoleId = String(field(role, "roleId", field(rolePayload, "roleId", "")));
    if (actualRoleId !== String(member.roleId)) throw new Error(`游戏连接角色与队伍账号不匹配：预期 ${member.roleId}，返回 ${actualRoleId || "空"}`);
    const nightmarePayload = await send(member, "nightmare_getroleinfo", { roleId: toGameRoleId(member.roleId) }, 15000);
    const state = parseTenPalaceRoleState(nightmarePayload, getServerNow(clock, member));
    return { member, rolePayload, role, nightmarePayload, state, entryCount: countRoleItem(rolePayload, challenge.useItem, getServerNow(clock, member)) };
  };
  const readTeam = async (teamId) => {
    const response = await send(leader, "matchteam_getteaminfo", { teamId: String(teamId) }, 15000);
    const value = field(response, "teamInfo", response);
    if (!value || String(field(value, "teamId", "")) !== String(teamId)) throw new Error("游戏返回的十殿队伍编号不匹配");
    return value;
  };
  const readRoleTeamId = async (member) => {
    const response = await send(member, "matchteam_getroleteaminfo", { roleID: toGameRoleId(member.roleId) }, 15000);
    return parseRoleTenPalaceTeamId(response, teamConfig.id);
  };
  const readRoom = async (roomId) => {
    const response = await send(leader, "nightmare_getroominfo", { roomId: String(roomId) }, 15000);
    const room = parseTenPalaceRoom(response);
    if (String(room.roomId) !== String(roomId)) throw new Error("游戏返回的十殿房间编号不匹配");
    narrowDeadlineFromRoom(room.raw);
    return room;
  };
  const readProfiles = async () => Promise.all(members.map(readProfile));
  const currentRoomIds = (profiles) => [...new Set(profiles.map((profile) => getRoomId(profile.state)).filter(Boolean))];
  const applySavedFormation = async (member) => {
    const response = await send(member, "role_gettargetteam", { targetId: toGameRoleId(member.roleId), teamType: TEN_PALACE_TEAM_TYPE, cCMonsterId: 0 }, 15000);
    const saved = parseTenPalaceFormation(response);
    const pending = checkpoint.pendingAction;
    if (pending?.command === "team_setteam" && pending.roleId === String(member.roleId)) {
      throw new Error(`服务器重启时角色 ${member.roleId} 的阵容应用结果不明；不会重发此写入`);
    }
    if (checkpoint.formationApplied?.includes(String(member.roleId))) return saved;
    const params = { teamType: TEN_PALACE_TEAM_TYPE, battleTeam: saved.battleTeam, lordWeaponId: saved.lordWeaponId, petUId: saved.petUId, cCMonsterId: 0 };
    await mutate({ member, command: "team_setteam", params, checkpointParams: { ...params, battleTeam: [...saved.battleTeam.entries()] }, stage: "applying-saved-formation", verify: async () => {
      const fresh = parseTenPalaceFormation(await send(member, "role_gettargetteam", { targetId: toGameRoleId(member.roleId), teamType: TEN_PALACE_TEAM_TYPE, cCMonsterId: 0 }, 15000));
      return sameFormation(saved, fresh) ? fresh : null;
    }, message: `角色 ${member.roleId} 已应用游戏内十殿阵容` });
    checkpoint.formationApplied = [...new Set([...(checkpoint.formationApplied || []), String(member.roleId)])];
    await save("formation-applied", null, { formationApplied: checkpoint.formationApplied });
    return saved;
  };

  if (savedCheckpoint?.identity && (savedCheckpoint.identity.length !== ids.length || savedCheckpoint.identity.some((id, index) => String(id) !== ids[index])))
    throw new Error("恢复任务的角色列表与原队伍不一致，停止接管");
  progress(`读取 ${members.length} 个角色、十殿状态与专用阵容`);
  let profiles = await readProfiles();
  let roleTeamIds = await Promise.all(members.map(readRoleTeamId));
  let rooms = currentRoomIds(profiles);
  if (rooms.length > 1) throw new Error("队伍成员正在不同十殿房间，停止自动接管");
  let teamId = String(checkpoint.teamId || roleTeamIds.find(Boolean) || "");
  if (roleTeamIds.some((id) => id && String(id) !== teamId)) throw new Error("所选角色已在不同十殿队伍，停止自动合并");
  const hadPendingAction = Boolean(checkpoint.pendingAction);
  if (checkpoint.pendingAction) {
    const pending = checkpoint.pendingAction;
    const pendingParams = pending.params && typeof pending.params === "object" ? pending.params : {};
    const pendingValue = (key) => pending[key] ?? pendingParams[key];
    if (pending.command === "team_setteam") {
      const member = members.find((item) => String(item.roleId) === String(pending.roleId));
      if (!member) throw new Error("待核对的阵容角色不在当前队伍");
      await applySavedFormation(member);
    } else if (pending.command === "matchteam_create" && roleTeamIds[members.indexOf(leader)]) {
      teamId = roleTeamIds[members.indexOf(leader)];
      checkpoint.teamId = teamId;
      await save("restart-team-created", null, { teamId });
    } else if (pending.command === "matchteam_join" && roleTeamIds[members.findIndex((item) => String(item.roleId) === String(pending.roleId))] === teamId) {
      await save("restart-join-confirmed", null);
    } else if (["matchteam_memberprepare", "matchteam_memberconfirm"].includes(pending.command) && teamId) {
      const current = await readTeam(teamId);
      if (getPrepared(roleRow(current, pending.roleId)) === 1) await save("restart-member-state-confirmed", null);
      else throw new Error("服务器重启时队员准备/确认结果不明，需要在游戏内核对");
    } else if (["matchteam_openteam"].includes(pending.command) && (rooms.length || profiles.some((p) => p.state.roomId))) {
      const roomId = rooms[0] || profiles.find((p) => p.state.roomId).state.roomId;
      checkpoint.roomId = String(roomId);
      await save("restart-room-created", null, { roomId: String(roomId) });
    } else if (pending.command === "nightmare_fight" && (checkpoint.roomId || rooms[0])) {
      const room = await readRoom(checkpoint.roomId || rooms[0]);
      if (!parseRoomFighterResult(room, pending.roleId) || !isMatchingTenPalaceRoomBattle(room, { roomId: room.roomId, roleId: pending.roleId, bossId: pending.bossId }))
        throw new Error("服务器重启时挑战结果不明；不会重新发起挑战");
      await save("restart-fight-result-confirmed", null);
    } else if (pending.command === "nightmare_leadercomplete" && (checkpoint.roomId || rooms[0])) {
      const room = await readRoom(checkpoint.roomId || rooms[0]);
      if (room.state === 1 && Number(room.curMonsterCfgId) === Number(pending.bossId))
        throw new Error("服务器重启时战斗提交结果不明；不会重复提交");
      await save("restart-battle-submit-confirmed", null);
    } else if (pending.command === "nightmare_buycharm") {
      const member = members.find((item) => String(item.roleId) === String(pending.roleId));
      if (!member) throw new Error("待核对的符咒兑换角色不在当前队伍");
      const profile = await readProfile(member);
      const charmId = Number(pendingValue("charmId"));
      const quantity = Number(pendingValue("quantity"));
      const beforeAmount = Number(pendingValue("beforeAmount"));
      const beforeKindness = Number(pendingValue("beforeKindness"));
      const expectedCost = Number(pendingValue("cost"));
      const spent = Number(checkpoint.charmSpent[pending.roleId] || 0);
      if (Number.isSafeInteger(charmId) && Number.isSafeInteger(quantity) && Number.isSafeInteger(beforeAmount) && Number.isSafeInteger(beforeKindness) &&
        Number.isSafeInteger(expectedCost) && profile.state.charms[charmId]?.amount >= beforeAmount + quantity &&
        profile.state.kindness === beforeKindness - expectedCost) {
        checkpoint.charmSpent[pending.roleId] = spent + expectedCost;
        await save("restart-buy-confirmed", null);
      } else throw new Error("服务器重启时符咒兑换结果不明；不会再次扣费");
    } else if (pending.command === "nightmare_claimcharm") {
      const member = members.find((item) => String(item.roleId) === String(pending.roleId));
      if (!member) throw new Error("待核对的免费符咒领取角色不在当前队伍");
      const profile = await readProfile(member);
      const charmId = Number(pendingValue("charmId"));
      if (profile.state.charms[charmId]?.giftClaimedThisWeek) await save("restart-gift-claim-confirmed", null);
      else throw new Error("服务器重启时免费符咒领取结果不明；不会重复领取");
    } else if (pending.command === "nightmare_takekillaward") {
      const member = members.find((item) => String(item.roleId) === String(pending.roleId));
      const monsterId = Number(pendingValue("monsterId"));
      if (!member || !Number.isSafeInteger(monsterId) || monsterId <= 0) throw new Error("待核对的十殿击杀奖励参数无效");
      const profile = await readProfile(member);
      const value = field(profile.state.raw.killAward, monsterId);
      if (value === true || value === 1) await save("restart-kill-reward-confirmed", null);
      else throw new Error("服务器重启时十殿击杀奖励领取结果不明；不会重新领取");
    } else if (pending.command === "nightmare_claimweekreward") {
      const member = members.find((item) => String(item.roleId) === String(pending.roleId));
      const profile = await readProfile(member);
      if (!hasClaimableTenPalaceWeekReward(field(profile.nightmarePayload, "weekAward"))) await save("restart-week-reward-confirmed", null);
      else throw new Error("服务器重启时周奖励领取结果不明；不会自动重试");
    } else if (pending.command === "nightmare_restore") {
      const room = await readRoom(checkpoint.roomId || rooms[0]);
      const beforeRestoreCnt = Number(pendingValue("beforeRestoreCnt"));
      if (roomHasSurvivingHero(room, pending.roleId) && Number.isFinite(beforeRestoreCnt) && Number(room.restoreCnt) > beforeRestoreCnt)
        await save("restart-restore-confirmed", null, { restoreCount: Number(checkpoint.restoreCount || 0) + 1 });
      else throw new Error("服务器重启时恢复结果不明；不会重复消耗恢复次数");
    } else throw new Error(`服务器重启时 ${pending.command} 结果不明，需人工核对`);
  }
  if (hadPendingAction) {
    profiles = await readProfiles();
    roleTeamIds = await Promise.all(members.map(readRoleTeamId));
    rooms = currentRoomIds(profiles);
    if (rooms.length > 1) throw new Error("恢复待确认操作后发现角色处于不同十殿房间，停止自动接管");
    if (roleTeamIds.some((id) => id && String(id) !== String(teamId))) throw new Error("恢复待确认操作后发现队员已更换十殿队伍，停止自动接管");
  }

  let team = teamId ? await readTeam(teamId) : null;
  if (team && Number(field(team, "teamCfgId", -1)) !== Number(teamConfig.id)) throw new Error("现有队伍不是十殿队伍，停止自动操作");
  if (team) {
    const leaderTeamId = await readRoleTeamId(leader);
    if (String(leaderTeamId) !== teamId || String(field(team, "leaderId", "")) !== leaderId || !roleRow(team, leaderId))
      throw new Error("现有十殿队伍的队长与服务器计划不一致，停止自动操作");
    if (memberRows(team).some((row) => !ids.includes(roleIdOf(row)))) throw new Error("现有十殿队伍包含计划外角色，停止自动操作");
  }
  if (team && Number(field(team, "extParam", Number.NaN)) !== Number(challenge.extParam) && field(team, "extParam") !== undefined) {
    if (Number(field(team, "state", -1)) !== 0) throw new Error("已开始的队伍挑战类型与计划不匹配");
    const leaderTeamId = roleTeamIds[members.indexOf(leader)];
    if (!leaderTeamId || String(leaderTeamId) !== teamId || String(field(team, "leaderId", "")) !== leaderId || !roleRow(team, leaderId))
      throw new Error("当前角色已不是该准备队伍的队长，停止切换挑战类型");
    if (memberRows(team).some((row) => !ids.includes(roleIdOf(row)))) throw new Error("准备队伍包含计划外角色，停止切换挑战类型");
    team = await readTeam(teamId);
    if (Number(field(team, "state", -1)) !== 0 || String(field(team, "leaderId", "")) !== leaderId || !roleRow(team, leaderId) || memberRows(team).some((row) => !ids.includes(roleIdOf(row))))
      throw new Error("队伍成员或队长在切换前发生变化，停止写入");
    await mutate({ command: "matchteam_changeextparam", params: { teamId, extParam: challenge.extParam }, stage: "switching-challenge", verify: async () => {
      team = await readTeam(teamId);
      return Number(field(team, "extParam", Number.NaN)) === Number(challenge.extParam) ? team : null;
    }, message: `队伍挑战已切换为 ${challengeName(challenge)}` });
  }
  if (!team && !rooms.length && !checkpoint.roomId) {
    if (roleTeamIds.some(Boolean)) throw new Error("角色已有队伍但无法读取详情，停止自动建队");
    await applyAllSavedFormations();
    const params = teamCreateParams({ challenge, teamConfig, name: `十殿-${leaderId}` });
    await mutate({ command: "matchteam_create", params, stage: "creating-team", verify: async () => {
      const createdId = await readRoleTeamId(leader);
      if (!createdId) return null;
      teamId = createdId;
      checkpoint.teamId = createdId;
      team = await readTeam(createdId);
      return team;
    }, message: "十殿队伍已创建" });
  }
  if (!team && (rooms.length || checkpoint.roomId)) throw new Error("已找到十殿房间，但无法确认所属十殿队伍，停止恢复");
  teamId = String(field(team, "teamId", teamId));
  if (!teamId) throw new Error("未能确认十殿队伍编号");
  checkpoint.teamId = teamId;
  await save("team-loaded", null, { teamId });

  if (rooms.length || checkpoint.roomId) {
    const roomId = String(checkpoint.roomId || rooms[0] || "");
    if (!roomId) throw new Error("持久化房间编号缺失，停止自动接管");
    const room = await readRoom(roomId);
    if (room.state >= 2) {
      profiles = await readProfiles();
      if (settings.claimKillRewards) await claimEligibleKillRewards(profiles);
      if (settings.claimWeekReward) await claimAvailableWeekRewards(profiles);
      return { message: "十殿房间已进入结算或关闭状态，未自动开新房间", completed: 1, failed: 0, commandCount, checkpoint };
    }
    if (!tenPalaceRoomTeamMatches(room, ids, leaderId)) throw new Error("当前房间成员或队长与计划队伍不匹配，停止后续操作");
    if (room.matchTeamId && String(room.matchTeamId) !== teamId) throw new Error("当前房间关联的队伍与计划不匹配");
    checkpoint.roomId = roomId;
    await save("room-reconciled", null, { roomId });
    profiles = await readProfiles();
    return advanceRoom(room, roomId);
  }

  if (Number(field(team, "state", -1)) === 1) {
    const joinedRoom = await confirmWaitingMembers(teamId);
    if (!joinedRoom) throw new Error("队伍等待确认超时，未确认到实际十殿房间；不会重复开启");
    checkpoint.roomId = String(joinedRoom.roomId);
    await save("room-confirmed", null, { roomId: String(joinedRoom.roomId) });
    return advanceRoom(joinedRoom, joinedRoom.roomId);
  }

  await applyAllSavedFormations();
  roleTeamIds = await Promise.all(members.map(readRoleTeamId));
  team = await readTeam(teamId);
  if (Number(field(team, "state", -1)) === 2) throw new Error("十殿队伍已结束，停止自动重建");
  if (Number(field(team, "state", -1)) === 1) {
    const joinedRoom = await confirmWaitingMembers(teamId);
    if (!joinedRoom) throw new Error("队伍等待确认超时，未确认到实际十殿房间；不会重复开启");
    checkpoint.roomId = String(joinedRoom.roomId);
    await save("room-confirmed", null, { roomId: String(joinedRoom.roomId) });
    return advanceRoom(joinedRoom, joinedRoom.roomId);
  }
  if (Number(field(team, "state", -1)) !== 0) throw new Error("十殿队伍状态不支持安全开启");
  let teamMembers = memberRows(team);
  for (const member of members) {
    if (roleRow(team, member.roleId)) continue;
    await mutate({ member, command: "matchteam_join", params: teamJoinParams(teamId), stage: "joining-team", verify: async () => {
      team = await readTeam(teamId);
      return roleRow(team, member.roleId) ? team : null;
    }, message: `角色 ${member.roleId} 已加入队伍` });
  }
  team = await readTeam(teamId);
  teamMembers = memberRows(team);
  if (teamMembers.length !== ids.length || teamMembers.some((row) => !ids.includes(roleIdOf(row)))) throw new Error("队伍成员与计划不完全一致，停止开启挑战");
  if (Number(field(team, "extParam", Number.NaN)) !== Number(challenge.extParam)) throw new Error("队伍挑战类型与计划不一致");
  for (const member of members) {
    if (String(member.roleId) === leaderId) continue;
    team = await readTeam(teamId);
    const row = roleRow(team, member.roleId);
    if (!row) throw new Error(`队伍中缺少角色 ${member.roleId}`);
    if (getPrepared(row) === 1) continue;
    await mutate({ member, command: "matchteam_memberprepare", params: { teamId }, stage: "preparing-team", verify: async () => {
      team = await readTeam(teamId);
      return getPrepared(roleRow(team, member.roleId)) === 1 ? team : null;
    }, message: `角色 ${member.roleId} 已准备` });
  }
  team = await readTeam(teamId);
  if (memberRows(team).some((row) => getPrepared(row) !== 1 && roleIdOf(row) !== leaderId)) throw new Error("仍有队员没有准备，停止开启挑战");
  await assertChallengeEligibility(team);
  profiles = await readProfiles();
  await assertEntryItems(profiles);
  if (settings.autoClaimCharms) await claimEligibleGifts(profiles);
  if (settings.claimKillRewards) await claimEligibleKillRewards(profiles);
  if (settings.claimWeekReward) await claimAvailableWeekRewards(profiles);
  await ensureCurrentCharms(profiles, 0);

  await mutate({ command: "matchteam_openteam", params: { teamId }, stage: "opening-team", verify: async () => {
    const opened = await waitUntil(async () => {
      team = await readTeam(teamId);
      profiles = await readProfiles();
      const roomId = currentRoomIds(profiles)[0];
      if (roomId) {
        const room = await readRoom(roomId);
        return tenPalaceRoomTeamMatches(room, ids, leaderId) ? { room } : null;
      }
      return Number(field(team, "state", -1)) === 1 ? { waiting: true } : null;
    }, Boolean, { timeout: 30000 });
    return opened;
  }, message: "十殿队伍已进入确认阶段" });
  const joinedRoom = await confirmWaitingMembers(teamId);
  if (!joinedRoom) throw new Error("队伍开启后未能确认实际房间，停止后续操作");
  checkpoint.roomId = String(joinedRoom.roomId);
  await save("room-confirmed", null, { roomId: String(joinedRoom.roomId) });
  return advanceRoom(joinedRoom, joinedRoom.roomId);

  async function applyAllSavedFormations() {
    for (const member of members) await applySavedFormation(member);
  }
  async function assertChallengeEligibility(currentTeam) {
    if (challenge.extParam !== 2) return;
    const rows = memberRows(currentTeam);
    for (const id of ids) {
      const row = rows.find((item) => roleIdOf(item) === id);
      const result = challengeEligibility(row, challenge, getServerNow(clock, members.find((item) => String(item.roleId) === id)));
      if (!result.allowed) throw new Error(`角色 ${id}：${result.reason}`);
      if (!row || field(row, "extParam") === undefined) throw new Error(`角色 ${id} 的平等王资格状态不可读取`);
    }
  }
  async function assertEntryItems(currentProfiles) {
    for (const profile of currentProfiles) {
      const needed = requiredEntryItems(profile.state, challenge, getServerNow(clock, profile.member));
      if (profile.entryCount === null || profile.entryCount < needed) throw new Error(`角色 ${profile.member.roleId} 入场门票不足或无法从游戏背包确认（需要 ${needed}）`);
    }
  }
  async function confirmWaitingMembers(waitingTeamId) {
    const active = await waitUntil(async () => {
      profiles = await readProfiles();
      const roomIds = currentRoomIds(profiles);
      if (roomIds.length > 1) throw new Error("队伍成员进入了不同十殿房间");
      if (roomIds.length) {
        const room = await readRoom(roomIds[0]);
        if (!tenPalaceRoomTeamMatches(room, ids, leaderId)) throw new Error("房间成员或队长与计划不匹配");
        return { room, roomId: roomIds[0] };
      }
      team = await readTeam(waitingTeamId);
      if (Number(field(team, "state", -1)) !== 1) return null;
      for (const member of members) {
        const row = roleRow(team, member.roleId);
        if (!row) throw new Error(`等待确认队伍缺少角色 ${member.roleId}`);
        if (getPrepared(row) === 1) continue;
        await mutate({ member, command: "matchteam_memberconfirm", params: { teamId: waitingTeamId }, stage: "confirming-member", verify: async () => {
          const freshProfiles = await readProfiles();
          if (freshProfiles.some((profile) => profile.state.roomId)) return true;
          const freshTeam = await readTeam(waitingTeamId);
          return getPrepared(roleRow(freshTeam, member.roleId)) === 1 ? freshTeam : null;
        }, message: `角色 ${member.roleId} 已确认挑战` });
        team = await readTeam(waitingTeamId);
      }
      return null;
    }, Boolean, { timeout: 60000, interval: 1000 });
    return active?.room || null;
  }
  async function firstMonth(profile) {
    try {
      const legion = await send(profile.member, "legion_getinfo", {}, 12000);
      const date = field(legion, "firstMonthDate", field(field(legion, "legionInfo"), "firstMonthDate", ""));
      if (typeof date === "string" && date) return date;
    } catch {}
    try {
      const response = await send(profile.member, "role_getfirstmonthdate", {}, 12000);
      const date = field(response, "firstMonthDate", "");
      return typeof date === "string" ? date : "";
    } catch { return ""; }
  }
  async function seasonFor(profile) {
    const date = await firstMonth(profile);
    return currentLegionSeason(config, date, getServerNow(clock, profile.member));
  }
  async function claimEligibleGifts(currentProfiles) {
    if (!config.gifts?.length) { progress("当前动态配置未公开免费符资格表，跳过自动领取", "warning"); return; }
    for (const profile of currentProfiles) {
      const season = await seasonFor(profile);
      const eligible = (await import("./tenPalace.js")).charmGiftEligibility({ config, roleInfo: profile.role, roleState: profile.state, season, now: getServerNow(clock, profile.member) });
      for (const gift of eligible.filter((item) => item.eligible)) {
        await mutate({ member: profile.member, command: "nightmare_claimcharm", params: { giftId: gift.giftId },
          checkpointParams: { giftId: gift.giftId, charmId: gift.charmId }, stage: "claiming-free-charm", verify: async () => {
          const fresh = await readProfile(profile.member);
          return fresh.state.charms[gift.charmId]?.giftClaimedThisWeek ? fresh : null;
        }, message: `角色 ${profile.member.roleId} 已领取第 ${gift.charmId} 殿免费符` });
      }
    }
  }
  async function claimAvailableWeekRewards(currentProfiles) {
    for (const profile of currentProfiles) {
      const before = field(profile.nightmarePayload, "weekAward", null);
      if (!hasClaimableTenPalaceWeekReward(before)) continue;
      await mutate({ member: profile.member, command: "nightmare_claimweekreward", params: {}, stage: "claiming-week-reward", verify: async () => {
        const fresh = await readProfile(profile.member);
        const after = field(fresh.nightmarePayload, "weekAward", null);
        return !hasClaimableTenPalaceWeekReward(after) ? fresh : null;
      }, message: `角色 ${profile.member.roleId} 周奖励已领取` });
    }
  }
  async function claimEligibleKillRewards(currentProfiles) {
    for (const profile of currentProfiles) {
      const eligible = entriesOf(profile.state.raw.killAward, "十殿击杀奖励")
        .filter(([, value]) => value === false || value === 0)
        .map(([id]) => Number(id));
      for (const monsterId of eligible) {
        if (!Number.isSafeInteger(monsterId) || monsterId <= 0) throw new Error("十殿击杀奖励 BOSS 编号无效，停止领取");
        await mutate({ member: profile.member, command: "nightmare_takekillaward", params: { monsterId },
          checkpointParams: { monsterId }, stage: "claiming-kill-reward", verify: async () => {
            const fresh = await readProfile(profile.member);
            const value = field(fresh.state.raw.killAward, monsterId);
            return value === true || value === 1 ? fresh : null;
          }, message: `角色 ${profile.member.roleId} 已领取 BOSS ${monsterId} 击杀奖励` });
      }
    }
  }
  async function ensureCurrentCharms(currentProfiles, bossId) {
    const charmId = bossId ? challengeForRoom(config, { curMonsterCfgId: bossId }) : 0;
    if (charmId < 1 || charmId > 6) return currentProfiles;
    const updatedProfiles = [...currentProfiles];
    for (let profileIndex = 0; profileIndex < currentProfiles.length; profileIndex++) {
      const profile = currentProfiles[profileIndex];
      const target = Number(settings.charmTargets[charmId] || 0);
      if (!settings.autoBuyCharms || profile.state.charms[charmId].amount >= target) continue;
      const serverId = tenPalaceServerId(profile.rolePayload);
      if (!serverId) {
        if (settings.requireCharm) throw new Error(`角色 ${profile.member.roleId} 无法确认区域商店服务器编号`);
        continue;
      }
      const market = await send(profile.member, "nightmare_getcharm", { serverId }, 12000);
      const stock = charmMarketStock(market, charmId);
      const charm = config.charms.find((item) => item.id === charmId);
      if (!charm || stock === null) {
        if (settings.requireCharm) throw new Error(`角色 ${profile.member.roleId} 符咒商店余量无法确认`);
        continue;
      }
      const spent = Number(checkpoint.charmSpent[profile.member.roleId] || 0);
      const budgetLeft = Math.max(0, settings.kindnessBudget - spent);
      const limit = charmFestivalActive(config, getServerNow(clock, profile.member) / 1000) ? charm.festivalLimit : charm.dayLimitNum;
      const quantity = Math.min(target - profile.state.charms[charmId].amount, settings.maxBuyPerCharm, stock, limit, Math.floor(profile.state.kindness / charm.NewConsumeNum), Math.floor(budgetLeft / charm.NewConsumeNum));
      if (!Number.isSafeInteger(quantity) || quantity < 1) {
        if (settings.requireCharm) throw new Error(`角色 ${profile.member.roleId} 无可用预算/余量补充第 ${charmId} 殿符咒`);
        continue;
      }
      const cost = quantity * charm.NewConsumeNum;
      const purchased = await mutate({ member: profile.member, command: "nightmare_buycharm", params: { charmId, buyNum: quantity },
        checkpointParams: { charmId, quantity, beforeAmount: profile.state.charms[charmId].amount, beforeKindness: profile.state.kindness, cost }, stage: "buying-current-charm", verify: async (response) => {
        if (field(response, "success") === false) return { rejected: true, message: `角色 ${profile.member.roleId} 的第 ${charmId} 殿符咒兑换被游戏拒绝` };
        if (field(response, "success") !== true) return null;
        const fresh = await readProfile(profile.member);
        if (fresh.state.charms[charmId].amount < profile.state.charms[charmId].amount + quantity || fresh.state.kindness !== profile.state.kindness - cost) return null;
        checkpoint.charmSpent[profile.member.roleId] = spent + cost;
        return fresh;
      }, message: `角色 ${profile.member.roleId} 已补充第 ${charmId} 殿符咒 ×${quantity}` });
      if (purchased.rejected) {
        if (settings.requireCharm) throw new Error(`角色 ${profile.member.roleId} 兑换第 ${charmId} 殿符咒被游戏拒绝，已暂停挑战`);
        continue;
      }
      updatedProfiles[profileIndex] = purchased;
    }
    return updatedProfiles;
  }
  async function fightCooldown(room) {
    const nowSeconds = getServerNow(clock, leader) / 1000;
    const until = Number(room.fightLimitTime || 0);
    const remaining = until > 1e9 ? until - nowSeconds : until;
    if (remaining > 0) {
      progress(`等待十殿战斗冷却 ${Math.ceil(remaining)} 秒`);
      await sleepChecked(Math.min(remaining * 1000, deadline - clock()));
    }
  }
  function hasDamagedHeroes(room, roleId) {
    const player = field(room.playerTeamInfo, roleId);
    if (!player) return false;
    let currentHeroes;
    try { currentHeroes = entriesOf(field(player, "curHeroData"), `角色 ${roleId} 当前阵容`); } catch { return false; }
    if (!currentHeroes.length) return false;
    if (currentHeroes.every(([, hero]) => Number(field(hero, "curHp", Number.NaN)) <= 0)) return true;
    const member = memberRows(room.raw).find((row) => roleIdOf(row) === String(roleId));
    const savedHeroes = field(field(member, "battleData"), "team");
    for (const [heroId, hero] of currentHeroes) {
      const currentHp = Number(field(hero, "curHp", Number.NaN));
      const saved = field(savedHeroes, heroId);
      const maxHp = Number(field(saved, "hp", Number.NaN));
      if (Number.isFinite(currentHp) && Number.isFinite(maxHp) && maxHp > 0 && currentHp < maxHp) return true;
    }
    return false;
  }
  async function waitForBattlePlayback(room) {
    const timing = tenPalaceBattlePresentation(room, challenge, getServerNow(clock, leader));
    if (timing.readyAt === null)
      throw new Error("战斗结果已记录，但服务器缺少播放时长字段；为避免提前提交，已暂停");
    if (!timing.ready) await sleepChecked(Math.min(timing.waitMs, deadline - clock()));
    const fresh = await readRoom(room.roomId);
    return fresh;
  }
  async function advanceRoom(initialRoom, roomId) {
    let current = initialRoom || await readRoom(roomId);
    if (!current || String(current.roomId) !== String(roomId)) throw new Error("十殿房间状态无法确认");
    if (!tenPalaceRoomTeamMatches(current, ids, leaderId)) throw new Error("十殿房间的队伍成员或队长不匹配");
    if (current.state >= 2) {
      profiles = await readProfiles();
      if (settings.claimKillRewards) await claimEligibleKillRewards(profiles);
      if (settings.claimWeekReward) await claimAvailableWeekRewards(profiles);
      return { message: "十殿挑战已进入结算/关闭", completed: 1, failed: 0, commandCount, checkpoint };
    }
    profiles = await readProfiles();
    if (settings.autoClaimCharms) await claimEligibleGifts(profiles);
    let completedFights = 0;
    for (let turn = 0; turn < 100; turn++) {
      assertRunning();
      current = await readRoom(roomId);
      if (current.state >= 2) break;
      if (current.state === 1) {
        const pending = checkpoint.pendingAction;
        const expectedRole = pending?.command === "nightmare_fight" ? pending.roleId : current.fighterId;
        if (!expectedRole) throw new Error("房间显示战斗中但未提供出战角色，停止推进");
        const expectedBoss = Number(pending?.bossId || current.curMonsterCfgId);
        if (!parseRoomFighterResult(current, expectedRole) || !isMatchingTenPalaceRoomBattle(current, { roomId, roleId: expectedRole, bossId: expectedBoss })) {
          const timeout = Math.min(600000, Math.max(15000, Number(challenge.fightTimeLimit || 600) * 1000));
          const afterTime = Number(pending?.sentAt || clock());
          let notification = typeof waitForBattle === "function" ? waitForBattle(String(expectedRole), timeout, { signal, roomId, bossId: expectedBoss, afterTime }) : null;
          const until = Math.min(deadline, clock() + timeout);
          let confirmed = false;
          try {
            while (clock() < until) {
              assertRunning();
              if (notification) {
                const pollAbort = new AbortController();
                const hint = await Promise.race([
                  notification.then((event) => { pollAbort.abort(); return event; }),
                  sleepChecked(Math.min(pollMs, until - clock()), pollAbort.signal).catch((error) => {
                    if (!pollAbort.signal.aborted) throw error;
                    return undefined;
                  }),
                ]);
                if (hint !== undefined) notification = null;
              } else await sleepChecked(Math.min(pollMs, until - clock()));
              current = await readRoom(roomId);
              if (parseRoomFighterResult(current, expectedRole) && isMatchingTenPalaceRoomBattle(current, { roomId, roleId: expectedRole, bossId: expectedBoss })) { confirmed = true; break; }
              if (current.state !== 1 && current.curMonsterCfgId !== expectedBoss) break;
            }
          } finally { notification?.cancel?.(); }
          if (!confirmed) throw new Error(`角色 ${expectedRole} 本场战斗结果无法从房间权威状态确认；不会重复挑战`);
        }
        if (String(current.leaderId) !== leaderId) throw new Error("房间队长已变化，停止提交战斗结果");
        if (checkpoint.pendingAction?.command === "nightmare_fight") {
          await save("fight-result-confirmed", null);
          completedFights++;
        }
        current = await waitForBattlePlayback(current);
        if (current.state !== 1) continue;
        if (!parseRoomFighterResult(current, expectedRole) || !isMatchingTenPalaceRoomBattle(current, { roomId, roleId: expectedRole, bossId: expectedBoss }))
          throw new Error("战斗播放结束后，房间结果与本场出战信息不匹配；停止提交");
        await mutate({ command: "nightmare_leadercomplete", params: { roomId }, stage: "completing-fight", verify: async () => {
          const beforeBoss = current.curMonsterCfgId;
          const changed = await waitUntil(async () => readRoom(roomId), (next) => next.state !== 1 || Number(next.curMonsterCfgId) !== Number(beforeBoss), { timeout: Math.min(30000, Math.max(5000, Number(challenge.fightIntervalTime || 15) * 1000)) });
          return changed;
        }, message: "当前战斗已提交并回到房间流程" });
        continue;
      }
      if (current.state !== 0) throw new Error(`十殿房间状态 ${current.state} 不支持安全推进`);
      const bossId = Number(current.curMonsterCfgId);
      if (!bossId || !config.monsters.some((row) => row.id === bossId)) throw new Error("当前十殿BOSS不在动态配置中，停止自动挑战");
      if (isBoss12RoleBlocked(current, orderedRoleIds.find((id) => !parseRoomFighterResult(current, id)))) throw new Error("平等王角色已挑战过前置隐藏BOSS，停止自动推进");
      await fightCooldown(current);
      profiles = await readProfiles();
      const charmId = challengeForRoom(config, current);
      profiles = await ensureCurrentCharms(profiles, bossId);
      let nextRole = nextBattleMember(current, orderedRoleIds, { bossId });
      if (settings.preferCharm && charmId >= 1 && charmId <= 6 && nextRole) {
        const candidates = orderedRoleIds.filter((id) => !parseRoomFighterResult(current, id) && roomHasSurvivingHero(current, id));
        nextRole = candidates.find((id) => canUseCharm(profiles.find((item) => String(item.member.roleId) === id)?.state, charmId)) || nextRole;
      }
      if (!nextRole) {
        const bossConfig = config.monsters.find((row) => row.id === bossId);
        const restoreCap = Number(field(bossConfig, "restoreHpLimit", challenge.restoreHpLimit));
        const woundedRole = orderedRoleIds.find((id) => {
          return !parseRoomFighterResult(current, id) && !isBoss12RoleBlocked(current, id) && hasDamagedHeroes(current, id);
        });
        if (woundedRole && settings.restoreLimit > checkpoint.restoreCount && Number.isInteger(restoreCap) && current.restoreCnt < restoreCap) {
          const beforeRestoreCount = current.restoreCnt;
          await mutate({ command: "nightmare_restore", params: { roomId, roleId: toGameRoleId(woundedRole) }, checkpointParams: { roomId, roleId: woundedRole, beforeRestoreCnt: beforeRestoreCount }, stage: "restoring-member", verify: async () => {
            current = await readRoom(roomId);
            if (Number(current.restoreCnt) <= beforeRestoreCount || !roomHasSurvivingHero(current, woundedRole)) return null;
            checkpoint.restoreCount = Number(checkpoint.restoreCount || 0) + 1;
            return current;
          }, message: `已恢复角色 ${woundedRole}` });
          continue;
        }
        if (orderedRoleIds.every((id) => parseRoomFighterResult(current, id))) {
          if (current.state >= 2) break;
          throw new Error("本殿所有队员已完成出战，但房间未进入下一阶段；不会重复挑战");
        }
        throw new Error("没有可验证存活且未出战的队员，停止自动挑战");
      }
      const profile = profiles.find((item) => String(item.member.roleId) === nextRole);
      if (!profile) throw new Error(`无法读取角色 ${nextRole} 的新鲜状态`);
      if (settings.requireCharm && charmId >= 1 && charmId <= 6 && !canUseCharm(profile.state, charmId)) throw new Error(`角色 ${nextRole} 缺少本周有效的${charmId}号符咒，已暂停`);
      if (isBoss12RoleBlocked(current, nextRole)) throw new Error(`角色 ${nextRole} 已出战过前置BOSS11，不能挑战BOSS12`);
      if (current.fightLimitTime > getServerNow(clock, leader) / 1000) throw new Error("十殿战斗冷却尚未结束");
      if (String(current.leaderId) !== leaderId) throw new Error("当前角色已不是十殿队长，停止出战编排");
      if (String(current.fighterId) !== nextRole) {
        await mutate({ command: "nightmare_setfighter", params: { roomId, roleId: toGameRoleId(nextRole) }, stage: "selecting-fighter", verify: async () => {
          current = await readRoom(roomId);
          return String(current.fighterId) === nextRole ? current : null;
        }, message: `已选择角色 ${nextRole} 出战` });
      }
      const battleParams = { roomId, roleId: toGameRoleId(nextRole) };
      await save("starting-fight", { command: "nightmare_fight", roleId: nextRole, bossId, sentAt: clock(), beforeState: current.state });
      try { await send(leader, "nightmare_fight", battleParams, 15000); }
      catch (error) { error.uncertain = true; error.code = "UNCERTAIN_WRITE"; throw error; }
      progress(`角色 ${nextRole} 已发起本殿挑战，等待战斗结果`);
      // Force an immediate fresh room read. Only authoritative battle fields may advance the state.
      current = await readRoom(roomId);
      if (current.state === 1 && parseRoomFighterResult(current, nextRole) && isMatchingTenPalaceRoomBattle(current, { roomId, roleId: nextRole, bossId })) {
        await save("fight-result-confirmed", null);
        completedFights++;
      } else if (current.state !== 1) {
        throw Object.assign(new Error("挑战请求后房间没有进入战斗，结果不确定；不会重复发起"), { uncertain: true, code: "UNCERTAIN_WRITE" });
      }
    }
    current = await readRoom(roomId);
    if (current.state < 2) throw new Error("十殿挑战达到安全推进上限，停止后续写入");
    profiles = await readProfiles();
    if (settings.claimKillRewards) await claimEligibleKillRewards(profiles);
    if (settings.claimWeekReward) await claimAvailableWeekRewards(profiles);
    return { message: `十殿挑战已完成，确认记录 ${completedFights} 场战斗`, completed: 1, failed: 0, commandCount, checkpoint };
  }
}
