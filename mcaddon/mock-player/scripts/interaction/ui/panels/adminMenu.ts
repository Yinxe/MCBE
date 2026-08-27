// ─── 管理员菜单 ────────────────────────────────────────
// 配置：默认配额 / 逐玩家配额（0=禁止，含占用统计）/ 管理员名单。
// 入口：主菜单"管理员菜单"按钮 或 /mp:admin（仅管理员可见/可开）。
// 额外提供：全部假人列表 / 全部假人在线管理（管理员视角，不受主人过滤）。

import { Player } from "@minecraft/server";
import { color, style } from "@yinxe/toolkit";
import { ActionFormBuilder, ModalFormBuilder, MessageFormBuilder } from "@yinxe/toolkit";

import { botRegistry, configStore } from "../../../bootstrap/context";
import { WORK_MODES, setWorkMode } from "../../../features/state/behavior";
import { MAX_SAFE_COOLDOWN_SECONDS, MIN_SAFE_COOLDOWN_SECONDS, QUOTA_SLIDER_MAX, UNLIMITED_QUOTA, AUX_TICKING_RADIUS_OPTIONS, DEFAULT_AUX_TICKING_RADIUS } from "../../../rules/Types";
import { MENU_TRIGGER_OPTIONS, DEFAULT_MENU_TRIGGER_ITEM } from "../../../rules/Types";
import { isAdmin } from "../../commands/auth";
import { showBotList } from "../bot";
import { showOnlineManagement } from "./online";

/** 概览 + 一级入口 */
export function showAdminMenu(player: Player): void {
  if (!isAdmin(player)) {
    player.sendMessage(`${color.error}只有管理员可以打开管理员菜单`);
    return;
  }
  const cfg = configStore.get();
  const all = botRegistry.all();
  const owners = new Set(all.map((r) => r.ownerName).filter((n): n is string => !!n));
  const ownerless = all.filter((r) => !r.ownerName).length;
  const triggerId = cfg.menuTriggerItemId !== undefined ? cfg.menuTriggerItemId : DEFAULT_MENU_TRIGGER_ITEM;
  const triggerLabel = MENU_TRIGGER_OPTIONS.find((o) => o.itemId === triggerId)?.label ?? (triggerId === null ? "§7无 (仅命令)" : triggerId);

  new ActionFormBuilder()
    .title(`${color.gold}⚙ 管理员菜单`)
    .body(
      `${color.muted}默认配额: ${color.info}${cfg.defaultQuota >= 999 ? "无限" : cfg.defaultQuota} ${color.muted}个/玩家\n` +
        `${color.muted}在线配额: ${color.info}${(cfg.defaultOnlineQuota ?? 3) >= 999 ? "无限" : (cfg.defaultOnlineQuota ?? 3) === 0 ? "禁止" : (cfg.defaultOnlineQuota ?? 3)}${color.muted}个/玩家\n` +
      `${color.muted}假人总数: ${color.info}${botRegistry.size} ${color.muted}（主人 ${color.info}${owners.size} ${color.muted}名，无主 ${color.warn}${ownerless} ${color.muted}个）\n` +
      `${color.muted}管理员: ${color.info}${cfg.admins.length} ${color.muted}名（名单）\n` +
      `${color.muted}重启自动上线: ${cfg.autoOnlineOnRestart ? color.success + "开" : color.error + "关"}${color.muted} / 主人下线联动: ${cfg.ownerOfflineAutoOffline ? color.success + "开" : color.error + "关"}\n` +
      `${color.muted}触发信物: ${color.info}${triggerLabel}\n` +
      `${color.muted}安全冷却: ${color.info}${cfg.safeCooldownSeconds ?? 1}s${color.muted}（上线/下线共用 1-5s）\n` +
      `${color.muted}辅助区块: ${color.info}${(cfg.auxTickingRadius ?? DEFAULT_AUX_TICKING_RADIUS) === 0 ? "关闭" : "模拟" + (cfg.auxTickingRadius ?? DEFAULT_AUX_TICKING_RADIUS)}${color.muted}（0=关闭 4/6/8）`
    )
    // ── 假人全览（管理员视角：不受主人过滤，全部可见） ──
    .button("全部假人列表", () => showBotList(player, () => showAdminMenu(player)))
    .button("全部假人在线管理", () => showOnlineManagement(player))
    .button("全局配置", () => showGlobalConfig(player))
    .button("逐玩家配额", () => showPlayerQuotaList(player))
      .button("逐玩家在线配额", () => showPlayerOnlineQuotaList(player))
    .button("管理员名单", () => showAdminList(player))
    .button(style("返回", color.darkGray), () => undefined)
    .show(player);
}

/** 全局配置（整合：联动开关 + 重启自动上线 + 默认配额滑块 + 触发信物下拉 + 工作模式开关，参考 item-route） */
export async function showGlobalConfig(player: Player): Promise<void> {
  const cfg = configStore.get();
  // 默认配额 1-10 + 无限(11) 映射：999/>=11 视为无限，0 视为 1
  const quotaToSlider = (q: number): number => {
    if (q >= 999) return 11;
    if (q >= 1 && q <= 10) return q;
    return q <= 0 ? 1 : 3;
  };
  const defaultSlider = quotaToSlider(cfg.defaultQuota);
  const workModes = WORK_MODES.filter(m => m !== "none");
  const triggerId = cfg.menuTriggerItemId !== undefined ? cfg.menuTriggerItemId : DEFAULT_MENU_TRIGGER_ITEM;
  const triggerIndex = Math.max(0, MENU_TRIGGER_OPTIONS.findIndex((o) => o.itemId === triggerId));

  const builder = new ModalFormBuilder()
    .title(`${color.gold}全局配置`)
    .toggle("ownerOffline", "上下线联动（主人下线时假人联动下线）", { defaultValue: cfg.ownerOfflineAutoOffline, tooltip: "默认关：假人常驻不随主人上下线" })
    .toggle("autoOnline", "服务器重启自动上线", { defaultValue: cfg.autoOnlineOnRestart, tooltip: "默认开：重启后在线的假人自动重建" })
    .slider("quota", "默认每人配额", 1, QUOTA_SLIDER_MAX, { defaultValue: defaultSlider, valueStep: 1, tooltip: "1-10 为具体数量，11=无限（默认3）" })
      .slider("safeCooldown", "安全上下线冷却（秒）", 1, 5, { defaultValue: cfg.safeCooldownSeconds ?? 1, valueStep: 1, tooltip: "上线/下线共用，普通与常加载均等待此时间（默认1秒，1-5可选）" })
      .slider("onlineQuota", "默认在线配额", 0, QUOTA_SLIDER_MAX, { defaultValue: (()=>{const q=cfg.defaultOnlineQuota??3; if(q>=999) return 11; if(q>=0&&q<=10) return q; return 3;})(), valueStep: 1, tooltip: "0=禁止上线，1-10为数量，11=无限（默认3）" })
      .dropdown("auxRadius", "辅助区块", ["关闭", "模拟4", "模拟6", "模拟8"], { defaultValueIndex: (()=>{const r=cfg.auxTickingRadius??DEFAULT_AUX_TICKING_RADIUS; const idx=(AUX_TICKING_RADIUS_OPTIONS as readonly number[]).indexOf(r as any); return idx>=0?idx:1;})(), tooltip: "0=关闭上线辅助，4/6/8为圆形半径（默认4）" })
    .dropdown(
      "menuTrigger",
      "模组菜单触发信物",
      MENU_TRIGGER_OPTIONS.map((o) => o.label),
      { defaultValueIndex: triggerIndex >= 0 ? triggerIndex : 1, tooltip: "使用该物品右键可打开主菜单，选'无'则仅能通过命令 /mp:menu 打开（参考 item-route）" }
    )
    .label("workModeHeader", `${color.accent}— 工作模式启用 —`);

  for (const mode of workModes) {
    const enabled = cfg.enabledWorkModes?.[mode] === true;
    const labelMap: Record<string, string> = {
      wander: "闲逛模式", mine: "自动挖掘", place: "自动放置", attack: "自动攻击",
      raid: "劫掠模式", fishing: "自动钓鱼", follow: "自动跟随",
    };
    builder.toggle(`wm_${mode}`, labelMap[mode] ?? mode, { defaultValue: enabled });
  }

  const vals = await builder.show(player);
  if (!vals) return;
  // 保存联动开关
  if (typeof vals.ownerOffline === "boolean" && vals.ownerOffline !== cfg.ownerOfflineAutoOffline) {
    configStore.setOwnerOfflineAutoOffline(vals.ownerOffline as boolean);
  }
  if (typeof vals.autoOnline === "boolean" && vals.autoOnline !== cfg.autoOnlineOnRestart) {
    configStore.setAutoOnlineOnRestart(vals.autoOnline as boolean);
  }
  // 保存配额
  const sliderVal = vals.quota as number;
  const newQuota = sliderVal >= QUOTA_SLIDER_MAX ? UNLIMITED_QUOTA : Math.max(1, Math.floor(sliderVal));
  if (newQuota !== cfg.defaultQuota) {
    configStore.setDefaultQuota(newQuota);
  }
  // 保存安全冷却
  const cooldownVal = vals.safeCooldown as number;
  const newCooldown = Math.max(1, Math.min(5, Math.floor(cooldownVal ?? 1)));
  if (newCooldown !== (cfg.safeCooldownSeconds ?? 1)) {
    configStore.setSafeCooldownSeconds(newCooldown);
  }
  // 保存辅助区块
  const auxIdx = vals.auxRadius as number;
  const newAuxRadius = (AUX_TICKING_RADIUS_OPTIONS[auxIdx] ?? DEFAULT_AUX_TICKING_RADIUS) as number;
  if (newAuxRadius !== (cfg.auxTickingRadius ?? DEFAULT_AUX_TICKING_RADIUS)) {
    configStore.setAuxTickingRadius(newAuxRadius);
    player.sendMessage(`${color.success}辅助区块已设为 ${color.info}${newAuxRadius === 0 ? "关闭" : "模拟" + newAuxRadius}`);
  }
  // 保存在线配额
  const onlineSliderVal = vals.onlineQuota as number;
  const newOnlineQuota = onlineSliderVal >= QUOTA_SLIDER_MAX ? UNLIMITED_QUOTA : Math.max(0, Math.floor(onlineSliderVal));
  const curOnlineQuota = cfg.defaultOnlineQuota ?? 3;
  if (newOnlineQuota !== curOnlineQuota) {
    configStore.setDefaultOnlineQuota(newOnlineQuota);
    // 配额降低时强制下线超出部分（按名字排序保留前N个）
    try {
      const { enforceAllOnlineQuotas } = await import("../../../features/manage/onlineBot");
      const forced = await enforceAllOnlineQuotas();
      if (forced > 0) player.sendMessage(`${color.warn}已强制下线 ${forced} 个超出在线配额的假人`);
    } catch (e: any) {
      console.warn(`[MockPlayer] 强制下线超出配额失败: ${e?.message ?? e}`);
    }
  }
  // 保存触发信物（下拉，参考 item-route）
  const triggerIdx = vals.menuTrigger as number;
  const newTrigger = MENU_TRIGGER_OPTIONS[triggerIdx]?.itemId ?? DEFAULT_MENU_TRIGGER_ITEM;
  const normalizedTrigger = newTrigger as string | null;
  const currentTrigger = cfg.menuTriggerItemId !== undefined ? cfg.menuTriggerItemId : DEFAULT_MENU_TRIGGER_ITEM;
  let triggerChanged = false;
  if (normalizedTrigger !== currentTrigger) {
    configStore.setMenuTriggerItemId(normalizedTrigger);
    triggerChanged = true;
  }
  // 保存工作模式开关
  let changedMode = false;
  let disabledModes: string[] = [];
  for (const mode of workModes) {
    const v = vals[`wm_${mode}`] as boolean | undefined;
    if (typeof v === "boolean" && (cfg.enabledWorkModes?.[mode] === true) !== v) {
      configStore.setWorkModeEnabled(mode, v);
      changedMode = true;
      if (v === false) disabledModes.push(mode);
    }
  }
  // 禁用某工作模式后，立即停止所有正处于该模式的假人
  if (disabledModes.length > 0) {
    let stopped = 0;
    for (const mode of disabledModes) {
      for (const rec of botRegistry.all().filter(r => r.workMode === mode)) {
        try { setWorkMode(rec as any, "none"); stopped++; } catch {}
      }
    }
    if (stopped > 0) {
      player.sendMessage(`${color.warn}已停止 ${stopped} 个处于已禁用模式的假人`);
    }
  }
  if (triggerChanged) {
    const label = MENU_TRIGGER_OPTIONS.find((o) => o.itemId === normalizedTrigger)?.label ?? (normalizedTrigger ?? "无");
    player.sendMessage(`${color.success}触发信物已更新为 ${color.info}${label}`);
  }
  player.sendMessage(`${color.success}全局配置已更新` + (changedMode ? "（工作模式变更立即生效）" : ""));
  showAdminMenu(player);
}

/** 修改默认配额（保留入口，实际由全局配置统一管理） */
async function editDefaultQuota(player: Player): Promise<void> {
  try {
    const cfg = configStore.get();
    const vals = await ModalFormBuilder.showQuick(player, `${color.bold}默认配额`, (f) => {
      f.textField("quota", "每玩家默认可创建的假人数（0 = 禁止）", { defaultValue: `${cfg.defaultQuota}`, tooltip: "管理员（OP 或名单）不受配额限制" });
    });
    if (!vals) return;
    const quota = parseInt(vals.quota as string, 10);
    if (isNaN(quota) || quota < 0) {
      player.sendMessage(`${color.error}无效的配额数字`);
      return;
    }
    configStore.setDefaultQuota(quota);
    player.sendMessage(`${color.success}默认配额已更新为 ${color.info}${quota}${color.success} 个/玩家`);
  } catch (e: any) {
    // ⚠️ 永不 reject：表单异常 resolve 兜底（异步环境抛异常可能致游戏崩溃）
    console.warn(`[MockPlayer] editDefaultQuota 异常: ${e?.message ?? e}`);
    player.sendMessage(`${color.error}修改默认配额失败: ${e?.message ?? e}`);
  }
}

/** 逐玩家配额列表：有覆盖的玩家 + 全部主人 */
export function showPlayerQuotaList(player: Player): void {
  const cfg = configStore.get();
  const owners = [...new Set([
    ...Object.keys(cfg.quotas),
    ...botRegistry.all().map((r) => r.ownerName).filter((n): n is string => !!n),
  ])].sort();

  if (owners.length === 0) {
    player.sendMessage(`${color.muted}暂无玩家记录，先创建假人后再来配置`);
    return;
  }

  const form = new ActionFormBuilder().title(`${color.gold}逐玩家配额`);
  for (const name of owners) {
    const owned = botRegistry.all().filter((r) => r.ownerName === name).length;
    const quota = cfg.quotas[name] !== undefined ? cfg.quotas[name] : cfg.defaultQuota;
    const tag = quota === 0 ? `${color.error}禁止` : `${color.info}${quota}`;
    form.button(
      `${color.playerName}${name} ${color.muted}(${color.info}${owned}${color.muted}/${tag}${color.muted})`,
      () => editPlayerQuota(player, name)
    );
  }
  form.button(style("返回", color.darkGray), () => showAdminMenu(player));
  form.show(player);
}

/** 修改单个玩家配额（留空 = 恢复默认） */
async function editPlayerQuota(player: Player, targetName: string): Promise<void> {
  try {
    const cfg = configStore.get();
    const owned = botRegistry.all().filter((r) => r.ownerName === targetName).length;
    const current = cfg.quotas[targetName] !== undefined ? `${cfg.quotas[targetName]}` : "";

    const vals = await ModalFormBuilder.showQuick(player, `${color.bold}配额：${targetName}`, (f) => {
      f.textField("quota", `配额（留空恢复默认 ${cfg.defaultQuota}；0 = 禁止）`, { defaultValue: current, tooltip: `当前占用 ${owned} 个假人` });
    });
    if (!vals) return;
    const raw = (vals.quota as string).trim();
    if (raw === "") {
      configStore.setPlayerQuota(targetName, undefined);
      player.sendMessage(`${color.success}${targetName} 已恢复默认配额 ${color.info}${cfg.defaultQuota}`);
      return;
    }
    const quota = parseInt(raw, 10);
    if (isNaN(quota) || quota < 0) {
      player.sendMessage(`${color.error}无效的配额数字`);
      return;
    }
    configStore.setPlayerQuota(targetName, quota);
    player.sendMessage(`${color.success}${targetName} 的配额已设为 ${color.info}${quota}${color.success} 个`);
  } catch (e: any) {
    // ⚠️ 永不 reject：表单异常 resolve 兜底
    console.warn(`[MockPlayer] editPlayerQuota 异常: ${e?.message ?? e}`);
    player.sendMessage(`${color.error}修改配额失败: ${e?.message ?? e}`);
  }
}

/** 逐玩家在线配额列表：有覆盖的玩家 + 全部主人（在线数统计） */
export function showPlayerOnlineQuotaList(player: Player): void {
  const cfg = configStore.get();
  const owners = [...new Set([
    ...Object.keys(cfg.onlineQuotas ?? {}),
    ...botRegistry.all().map((r) => r.ownerName).filter((n): n is string => !!n),
  ])].sort();

  if (owners.length === 0) {
    player.sendMessage(`${color.muted}暂无玩家记录，先创建假人后再来配置`);
    return;
  }

  const form = new ActionFormBuilder().title(`${color.gold}逐玩家在线配额`);
  for (const name of owners) {
    const online = botRegistry.all().filter((r) => r.ownerName === name && r.online).length;
    const quota = cfg.onlineQuotas?.[name] !== undefined ? cfg.onlineQuotas[name] : (cfg.defaultOnlineQuota ?? 3);
    const tag = quota >= UNLIMITED_QUOTA ? `${color.success}无限` : quota === 0 ? `${color.error}禁止` : `${color.info}${quota}`;
    form.button(
      `${color.playerName}${name} ${color.muted}(${color.info}${online}${color.muted}/${tag}${color.muted})`,
      () => editPlayerOnlineQuota(player, name)
    );
  }
  form.button(style("返回", color.darkGray), () => showAdminMenu(player));
  form.show(player);
}

/** 修改单个玩家在线配额（留空 = 恢复默认） */
async function editPlayerOnlineQuota(player: Player, targetName: string): Promise<void> {
  try {
    const cfg = configStore.get();
    const online = botRegistry.all().filter((r) => r.ownerName === targetName && r.online).length;
    const current = cfg.onlineQuotas?.[targetName] !== undefined ? `${cfg.onlineQuotas[targetName]}` : "";

    const vals = await ModalFormBuilder.showQuick(player, `${color.bold}在线配额：${targetName}`, (f) => {
      f.textField("quota", `在线配额（留空恢复默认 ${cfg.defaultOnlineQuota ?? 3}；0=禁止，999=无限）`, { defaultValue: current, tooltip: `当前在线 ${online} 个假人` });
    });
    if (!vals) return;
    const raw = (vals.quota as string).trim();
    if (raw === "") {
      configStore.setPlayerOnlineQuota(targetName, undefined);
      player.sendMessage(`${color.success}${targetName} 已恢复默认在线配额 ${color.info}${cfg.defaultOnlineQuota ?? 3}`);
      // 恢复默认后若仍超出，需强制下线
      try {
        const { enforceOnlineQuotaForOwner } = await import("../../../features/manage/onlineBot");
        await enforceOnlineQuotaForOwner(targetName);
      } catch {}
      return;
    }
    const quota = parseInt(raw, 10);
    if (isNaN(quota) || quota < 0) {
      player.sendMessage(`${color.error}无效的配额数字`);
      return;
    }
    const normalized = quota >= UNLIMITED_QUOTA ? 999 : quota;
    configStore.setPlayerOnlineQuota(targetName, normalized);
    player.sendMessage(`${color.success}${targetName} 的在线配额已设为 ${color.info}${normalized >= 999 ? "无限" : normalized}${color.success} 个`);
    // 配额降低或设为0时强制下线超出部分
    try {
      const { enforceOnlineQuotaForOwner } = await import("../../../features/manage/onlineBot");
      const forced = await enforceOnlineQuotaForOwner(targetName);
      if (forced > 0) player.sendMessage(`${color.warn}已强制下线 ${forced} 个超出在线配额的假人`);
    } catch (e: any) {
      console.warn(`[MockPlayer] 强制下线失败: ${e?.message ?? e}`);
    }
  } catch (e: any) {
    console.warn(`[MockPlayer] editPlayerOnlineQuota 异常: ${e?.message ?? e}`);
    player.sendMessage(`${color.error}修改在线配额失败: ${e?.message ?? e}`);
  }
}

/** 管理员名单管理 */
export function showAdminList(player: Player): void {
  const admins = configStore.get().admins;
  const form = new ActionFormBuilder().title(`${color.gold}管理员名单`);
  form.body(`${color.muted}名单内的玩家（无需 OP）与 OP 一样不受配额限制、可管理所有假人`);

  for (const name of admins) {
    form.button(`${color.playerName}${name}`, () => {
      MessageFormBuilder.confirm(player, "移除管理员", `确定将 ${color.playerName}${name}${color.info} 移出管理员名单？`, () => {
        configStore.removeAdmin(name);
        player.sendMessage(`${color.success}已移除管理员 ${color.playerName}${name}`);
        showAdminList(player);
      });
    });
  }

  form.button(`${color.success}+ 添加管理员`, async () => {
    const vals = await ModalFormBuilder.showQuick(player, `${color.bold}添加管理员`, (f) => {
      f.textField("name", "玩家名", { defaultValue: "", tooltip: "该玩家无需 OP 也可管理所有假人、不受配额限制" });
    });
    if (!vals) return;
    const name = (vals.name as string).trim();
    if (!name) {
      player.sendMessage(`${color.error}玩家名不能为空`);
      return;
    }
    configStore.addAdmin(name);
    player.sendMessage(`${color.success}已将 ${color.playerName}${name}${color.success} 加入管理员名单`);
    showAdminList(player);
  });

  form.button(style("返回", color.darkGray), () => showAdminMenu(player));
  form.show(player);
}