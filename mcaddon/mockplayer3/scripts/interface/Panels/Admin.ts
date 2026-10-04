// ─── 管理员菜单树 ──────────────────────────────────────────────────
// 暴露默认配额/逐玩家配额/管理员名单/工作模式启用表/信物；只暴露真实生效的配置项。
// 规则零于此文件：配额降低的强制下线与模式禁用的停假人都经 Lifecycle 执行。

import { system } from "@minecraft/server";
import type { Player } from "@minecraft/server";
import { ActionFormBuilder, color, MessageFormBuilder, ModalFormBuilder, style, trySendMessage } from "@yinxe/toolkit";
import type { WorkMode } from "../../domain/Record";
import { WORK_MODES } from "../../domain/Catalog";
import {
  AUX_RADIUS_CHOICES,
  normalizeAuxTickingRadius,
  TOKEN_ITEM_OPTIONS,
  UNLIMITED_QUOTA,
} from "../../domain/Config";
import type { Viewer } from "../../domain/Permissions";
import { playerKey } from "../../domain/Identity";
import { botStatus, uiViewer } from "../Kit";
import { services } from "../../Composition";
import { showBotList } from "./BotList";
import { showOnlineManagement } from "./Online";

function quotaLabel(n: number): string {
  return n >= UNLIMITED_QUOTA ? "无限" : n === 0 ? "禁止" : String(n);
}

/** 辅助常加载半径档位文案（0/4/6/8 → 关闭/模拟4/模拟6/模拟8） */
function auxRadiusLabel(n: number): string {
  return n === 0 ? `${color.error}关` : `${color.info}模拟${n}`;
}

// ─── 概览 ──

/** 打开管理员菜单根面板 */
export function showAdminMenu(player: Player): void {
  const config = services.runtime.config;
  const records = [...services.runtime.records.values()];
  const owners = new Set(records.map((r) => r.ownerKey).filter((k): k is string => k !== null));
  const ownerless = records.length - owners.size;
  const tokenLabel = config.tokenItem.enabled
    ? (TOKEN_ITEM_OPTIONS.find((o) => o.typeId === config.tokenItem.typeId)?.label ?? config.tokenItem.typeId)
    : "§7无 (仅命令 /mp:menu)";
  void ActionFormBuilder.showQuick(player, `${color.gold}⚙ 管理员菜单`, (f) => {
    f.body(
      `${color.muted}默认配额: ${color.info}${quotaLabel(config.quotas.create)} ${color.muted}个/玩家\n` +
        `${color.muted}在线配额: ${color.info}${quotaLabel(config.quotas.online)}${color.muted}个/玩家\n` +
        `${color.muted}假人总数: ${color.info}${records.length} ${color.muted}（主人 ${color.info}${owners.size} ${color.muted}名，无主 ${color.warn}${ownerless} ${color.muted}个）\n` +
        `${color.muted}管理员: ${color.info}${config.adminKeys.length} ${color.muted}名（名单）\n` +
        `${color.muted}主人下线联动: ${config.ownerDownOfflineDefault ? color.success + "开" : color.error + "关"}${color.muted} / 实现性功能(砍树等): ${config.experimentalEnabled ? color.success + "开" : color.error + "关"}${color.muted} / 触发信物: ${color.info}${tokenLabel}${color.muted} / 辅助常加载: ${auxRadiusLabel(config.auxTickingRadius)}`
    );
    // 假人全览：管理员视角不受主人过滤
    f.buttonWithIcon("全部假人列表", "textures/ui/mockplayer/bot_list", () =>
      showBotList(player, () => showAdminMenu(player))
    );
    f.buttonWithIcon("全部假人在线管理", "textures/ui/mockplayer/online_management", () =>
      showOnlineManagement(player)
    );
    f.buttonWithIcon("全局配置", "textures/ui/mockplayer/admin_settings", () => showGlobalConfig(player));
    f.buttonWithIcon("逐玩家配额", "textures/ui/mockplayer/inventory", () => showPlayerQuotaList(player));
    f.buttonWithIcon("逐玩家在线配额", "textures/ui/mockplayer/toggle_online", () => showPlayerOnlineQuotaList(player));
    f.buttonWithIcon("管理员名单", "textures/ui/mockplayer/admin_settings", () => showAdminList(player));
    // 顶层"返回"是空按钮：主菜单之上无层级
    f.buttonWithIcon(style("返回", color.darkGray), "textures/ui/mockplayer/back", () => undefined);
  });
}

// ─── 全局配置 ──

/** 配额↔滑块映射：slider>=11→无限；create 的 0 视为 1、online 的 0=禁止 */
function sliderToQuota(v: number, allowZeroBan: boolean): number {
  if (v >= 11) return UNLIMITED_QUOTA;
  return allowZeroBan ? Math.max(0, Math.floor(v)) : Math.max(1, Math.floor(v));
}

function sliderFromQuota(n: number, floor: number): number {
  if (n >= UNLIMITED_QUOTA) return 11;
  return Math.max(floor, Math.min(10, n));
}

const MODE_META: Partial<Record<WorkMode, { label: string; tooltip: string }>> = {
  wander: {
    label: `${color.warn}⚠ ${color.gold}闲逛模式`,
    tooltip: "随机游走探索周围方块，持续寻路与碰撞检测，§c性能开销较高§r。默认§a开启§r",
  },
  mine: {
    label: `${color.success}⛏ 定点挖掘`,
    tooltip: "定点挖掘前方方块，需频繁方块扫描与破坏。默认§a开启§r，适中开销",
  },
  place: { label: `${color.success}▣ 定点放置`, tooltip: "定点放置方块，适中开销。默认§a开启§r" },
  attack: { label: `${color.success}⚔ 定点攻击`, tooltip: "定点攻击生物，范围实体扫描。默认§a开启§r，适中开销" },
  raid: {
    label: `${color.warn}⚠ ${color.error}劫掠模式`,
    tooltip: "每 5 秒施加一次袭击之兆引发袭击，胜利结算与瓶费记账，§c常驻节拍§r。默认§a开启§r，多人同时开启注意性能",
  },
  fishing: {
    label: `${color.warn}⚠ ${color.aqua}自动钓鱼`,
    tooltip: "水体探测+抛竿循环+鱼钩追踪，§c常驻定时器§r。默认§a开启§r，占用较高",
  },
  follow: {
    label: `${color.warn}⚠ ${color.info}跟随`,
    tooltip: "高频追踪主人位置与寻路，§c持续移动§r。默认§a开启§r，随主人移动频繁时开销明显",
  },
  vault: {
    label: `${color.success}◆ 宝库模式`,
    tooltip: "扫描并自动寻路开启试炼宝库，含交互与系统重连。事件驱动，开销低",
  },
};

function showGlobalConfig(player: Player): void {
  const say = (t: string) => trySendMessage(player, t);
  const config = services.runtime.config;
  // 逐模式启用列表不含采集族：采集模式（现仅原木）归"实现性功能"总闸管辖，无独立开关
  const modes = WORK_MODES.filter((m) => m.id !== "none" && !m.id.startsWith("harvest_"));
  void ModalFormBuilder.showQuick(player, `${color.gold}全局配置`, (f) => {
    f.toggle("ownerOffline", "上下线联动（主人下线时假人联动下线）", {
      defaultValue: config.ownerDownOfflineDefault,
      tooltip: "默认关：假人常驻不随主人上下线",
    });
    f.slider("quota", "默认每人配额", 1, 11, {
      valueStep: 1,
      defaultValue: sliderFromQuota(config.quotas.create, 1),
      tooltip: "1-10 为具体数量，11=无限（默认3）",
    });
    f.slider("onlineQuota", "默认在线配额", 0, 11, {
      valueStep: 1,
      defaultValue: sliderFromQuota(config.quotas.online, 0),
      tooltip: "0=禁止上线，1-10为数量，11=无限（默认3）",
    });
    const tokenIdx = Math.max(
      0,
      TOKEN_ITEM_OPTIONS.findIndex((o) => o.typeId === config.tokenItem.typeId)
    );
    f.dropdown(
      "menuTrigger",
      "模组菜单触发信物",
      TOKEN_ITEM_OPTIONS.map((o) => o.label),
      {
        defaultValueIndex: config.tokenItem.enabled ? tokenIdx : 0,
        tooltip: "手持该物品长按（电脑端右键）可打开主菜单；选'无'则仅能通过命令 /mp:menu 打开",
      }
    );
    f.label("expHeader", `${color.accent}— 实现性功能 —`);
    f.toggle("experimental", `${color.warn}⚠ ${color.gold}实现性功能总闸`, {
      defaultValue: config.experimentalEnabled,
      tooltip:
        "未完成验收的实验模式（现仅「资源采集·原木」）总开关：关=玩家侧不可选且该类在线假人停回空闲，开=按各模式启用规则可用。默认关",
    });
    f.dropdown(
      "auxRadius",
      "上线辅助常加载半径",
      AUX_RADIUS_CHOICES.map((n) => (n === 0 ? "关（不做上线刷新）" : `模拟${n}（圆 r=${n} 区块）`)),
      {
        defaultValueIndex: Math.max(0, AUX_RADIUS_CHOICES.indexOf(config.auxTickingRadius)),
        tooltip:
          "假人上线后一次性刷新的圆形常加载范围（tickingarea add circle，以假人所在区块为中心）。容量不足会失败并私信警告，不影响在线",
      }
    );
    f.label("workModeHeader", `${color.accent}— 工作模式启用 —`);
    f.label(
      "workModeHint",
      `${color.muted}提示: ${color.warn}⚠§r${color.muted} 标记为性能敏感模式（持续寻路/定时器/全局监听），${color.success}默认全部启用§r${color.muted}，卡顿按需逐项关闭`
    );
    for (const m of modes) {
      const meta = MODE_META[m.id];
      f.toggle(`wm_${m.id}`, meta?.label ?? m.label, {
        defaultValue: config.workModeEnabled[m.id] === true,
        tooltip: meta?.tooltip ?? `工作模式 ${m.label} 的启用开关`,
      });
    }
  }).then((vals) => {
    if (!vals) return;
    void system.run(() => {
      try {
        let changed = false;
        const ownerOffline = Boolean(vals.ownerOffline);
        if (ownerOffline !== config.ownerDownOfflineDefault) {
          config.ownerDownOfflineDefault = ownerOffline;
          changed = true;
        }
        const experimental = Boolean(vals.experimental);
        const experimentalChanged = experimental !== config.experimentalEnabled;
        if (experimentalChanged) {
          config.experimentalEnabled = experimental;
          changed = true;
        }
        const quota = sliderToQuota(Number(vals.quota) || 1, false);
        if (quota !== config.quotas.create) {
          config.quotas.create = quota;
          changed = true;
        }
        const onlineQuota = sliderToQuota(Number(vals.onlineQuota ?? 0), true);
        const onlineChanged = onlineQuota !== config.quotas.online;
        if (onlineChanged) {
          config.quotas.online = onlineQuota;
          changed = true;
        }
        const tokenOpt = TOKEN_ITEM_OPTIONS[Number(vals.menuTrigger ?? 0)];
        if (tokenOpt) {
          const enabled = tokenOpt.typeId !== null;
          const typeId = tokenOpt.typeId ?? config.tokenItem.typeId;
          if (enabled !== config.tokenItem.enabled || (enabled && typeId !== config.tokenItem.typeId)) {
            config.tokenItem = { enabled, typeId };
            changed = true;
            say(`${color.success}触发信物已更新为 ${color.info}${tokenOpt.label}`);
          }
        }
        const auxRadius = normalizeAuxTickingRadius(AUX_RADIUS_CHOICES[Number(vals.auxRadius ?? 0)]);
        if (auxRadius !== config.auxTickingRadius) {
          config.auxTickingRadius = auxRadius;
          changed = true;
        }
        // 禁用模式即停假人：本次 true→false 的模式逐个回空闲
        const disabledModes: WorkMode[] = [];
        for (const m of modes) {
          const now = Boolean(vals[`wm_${m.id}`]);
          if (config.workModeEnabled[m.id] !== now) {
            config.workModeEnabled[m.id] = now;
            changed = true;
            if (!now) disabledModes.push(m.id);
          }
        }
        if (changed) services.saveGate.saveConfig(config);
        // 需停回空闲的模式：本次逐模式禁用 + 实现性总闸关（其下所有实验模式）
        const modesToStop: WorkMode[] = [...disabledModes];
        if (experimentalChanged && !experimental) {
          for (const m of WORK_MODES) if (m.experimental === true) modesToStop.push(m.id);
        }
        if (modesToStop.length > 0) {
          const adminViewer: Viewer = { ...uiViewer(player), isOp: true };
          let stopped = 0;
          for (const record of [...services.runtime.records.values()]) {
            if (!modesToStop.includes(record.workMode)) continue;
            if (services.lifecycle.changeWorkMode(adminViewer, record.botId, "none").ok) stopped++;
          }
          if (stopped > 0) say(`${color.warn}已停止 ${stopped} 个处于已禁用或未开放模式的假人`);
        }
        if (onlineChanged) {
          const forced = services.lifecycle.enforceOnlineQuotas();
          if (forced > 0) say(`${color.warn}已强制下线 ${forced} 个超出在线配额的假人`);
        }
        say(`${color.success}全局配置已更新${modesToStop.length > 0 ? "（工作模式/实现性功能变更立即生效）" : ""}`);
        showAdminMenu(player);
      } catch (e) {
        say(`${color.error}全局配置保存失败: ${(e as Error).message}`);
      }
    });
  });
}

// ─── 逐玩家配额 ──

function quotaSubjectKeys(): string[] {
  const { runtime } = services;
  const keys = new Set<string>(Object.keys(runtime.config.quotas.perPlayer));
  for (const r of runtime.records.values()) if (r.ownerKey) keys.add(r.ownerKey);
  return [...keys].sort((a, b) => a.localeCompare(b));
}

function ownedCount(key: string): number {
  let n = 0;
  for (const r of services.runtime.records.values()) if (r.ownerKey === key) n++;
  return n;
}

function onlineCount(key: string): number {
  let n = 0;
  for (const r of services.runtime.records.values()) {
    if (r.ownerKey !== key) continue;
    const st = botStatus(r);
    if (st.online && !st.death) n++;
  }
  return n;
}

function showPlayerQuotaList(player: Player): void {
  const say = (t: string) => trySendMessage(player, t);
  const config = services.runtime.config;
  const keys = quotaSubjectKeys();
  if (keys.length === 0) {
    say(`${color.muted}暂无玩家记录，先创建假人后再来配置`);
    return;
  }
  void ActionFormBuilder.showQuick(player, `${color.gold}逐玩家配额`, (f) => {
    for (const key of keys) {
      const owned = ownedCount(key);
      const quota = config.quotas.perPlayer[key]?.create ?? config.quotas.create;
      const tag = quota === 0 ? `${color.error}禁止` : `${color.info}${quota}`;
      f.buttonWithIcon(
        `${color.playerName}${key} ${color.muted}(${color.info}${owned}${color.muted}/${tag}${color.muted})`,
        "textures/ui/mockplayer/bot_list",
        () => editPlayerQuota(player, key)
      );
    }
    f.buttonWithIcon(style("返回", color.darkGray), "textures/ui/mockplayer/back", () => showAdminMenu(player));
  });
}

function editPlayerQuota(player: Player, targetKey: string): void {
  const say = (t: string) => trySendMessage(player, t);
  const config = services.runtime.config;
  const owned = ownedCount(targetKey);
  void ModalFormBuilder.showQuick(player, `${color.bold}配额：${targetKey}`, (f) => {
    f.textField("quota", `配额（留空恢复默认 ${config.quotas.create}；0 = 禁止）`, {
      defaultValue:
        config.quotas.perPlayer[targetKey]?.create !== undefined
          ? String(config.quotas.perPlayer[targetKey]?.create)
          : "",
      tooltip: `当前占用 ${owned} 个假人`,
    });
  }).then((vals) => {
    if (!vals) return;
    void system.run(() => {
      try {
        const text = String(vals.quota ?? "").trim();
        if (text === "") {
          if (config.quotas.perPlayer[targetKey]) delete config.quotas.perPlayer[targetKey].create;
          if (config.quotas.perPlayer[targetKey] && Object.keys(config.quotas.perPlayer[targetKey]).length === 0)
            delete config.quotas.perPlayer[targetKey];
          services.saveGate.saveConfig(config);
          say(`${color.success}${targetKey} 已恢复默认配额 ${color.info}${config.quotas.create}`);
          return;
        }
        const n = Number(text);
        if (!Number.isFinite(n) || n < 0) {
          say(`${color.error}无效的配额数字`);
          return;
        }
        config.quotas.perPlayer[targetKey] = { ...config.quotas.perPlayer[targetKey], create: Math.floor(n) };
        services.saveGate.saveConfig(config);
        say(`${color.success}${targetKey} 的配额已设为 ${color.info}${Math.floor(n)}${color.success} 个`);
      } catch (e) {
        say(`${color.error}修改配额失败: ${(e as Error).message}`);
      }
    });
  });
}

function showPlayerOnlineQuotaList(player: Player): void {
  const say = (t: string) => trySendMessage(player, t);
  const config = services.runtime.config;
  const keys = quotaSubjectKeys();
  if (keys.length === 0) {
    say(`${color.muted}暂无玩家记录，先创建假人后再来配置`);
    return;
  }
  void ActionFormBuilder.showQuick(player, `${color.gold}逐玩家在线配额`, (f) => {
    for (const key of keys) {
      const online = onlineCount(key);
      const quota = config.quotas.perPlayer[key]?.online ?? config.quotas.online;
      const tag =
        quota >= UNLIMITED_QUOTA
          ? `${color.success}无限`
          : quota === 0
            ? `${color.error}禁止`
            : `${color.info}${quota}`;
      f.buttonWithIcon(
        `${color.playerName}${key} ${color.muted}(${color.info}${online}${color.muted}/${tag}${color.muted})`,
        "textures/ui/mockplayer/online_management",
        () => editPlayerOnlineQuota(player, key)
      );
    }
    f.buttonWithIcon(style("返回", color.darkGray), "textures/ui/mockplayer/back", () => showAdminMenu(player));
  });
}

function editPlayerOnlineQuota(player: Player, targetKey: string): void {
  const say = (t: string) => trySendMessage(player, t);
  const config = services.runtime.config;
  const online = onlineCount(targetKey);
  void ModalFormBuilder.showQuick(player, `${color.bold}在线配额：${targetKey}`, (f) => {
    f.textField("quota", `在线配额（留空恢复默认 ${config.quotas.online}；0=禁止，999=无限）`, {
      defaultValue:
        config.quotas.perPlayer[targetKey]?.online !== undefined
          ? String(config.quotas.perPlayer[targetKey]?.online)
          : "",
      tooltip: `当前在线 ${online} 个假人`,
    });
  }).then((vals) => {
    if (!vals) return;
    void system.run(() => {
      try {
        const text = String(vals.quota ?? "").trim();
        if (text === "") {
          if (config.quotas.perPlayer[targetKey]) delete config.quotas.perPlayer[targetKey].online;
          if (config.quotas.perPlayer[targetKey] && Object.keys(config.quotas.perPlayer[targetKey]).length === 0)
            delete config.quotas.perPlayer[targetKey];
          services.saveGate.saveConfig(config);
          const forced = services.lifecycle.enforceOnlineQuotas(targetKey);
          if (forced > 0) say(`${color.warn}已强制下线 ${forced} 个超出在线配额的假人`);
          say(`${color.success}${targetKey} 已恢复默认在线配额 ${color.info}${quotaLabel(config.quotas.online)}`);
          return;
        }
        const n = Number(text);
        if (!Number.isFinite(n) || n < 0) {
          say(`${color.error}无效的配额数字`);
          return;
        }
        const normalized = n >= UNLIMITED_QUOTA ? UNLIMITED_QUOTA : Math.floor(n);
        config.quotas.perPlayer[targetKey] = { ...config.quotas.perPlayer[targetKey], online: normalized };
        services.saveGate.saveConfig(config);
        say(`${color.success}${targetKey} 的在线配额已设为 ${color.info}${quotaLabel(normalized)}${color.success} 个`);
        const forced = services.lifecycle.enforceOnlineQuotas(targetKey);
        if (forced > 0) say(`${color.warn}已强制下线 ${forced} 个超出在线配额的假人`);
      } catch (e) {
        say(`${color.error}修改在线配额失败: ${(e as Error).message}`);
      }
    });
  });
}

// ─── 管理员名单 ──

function showAdminList(player: Player): void {
  const say = (t: string) => trySendMessage(player, t);
  const config = services.runtime.config;
  void ActionFormBuilder.showQuick(player, `${color.gold}管理员名单`, (f) => {
    f.body(`${color.muted}名单内的玩家（无需 OP）与 OP 一样不受配额限制、可管理所有假人`);
    for (const name of config.adminKeys) {
      f.buttonWithIcon(`${color.playerName}${name}`, "textures/ui/mockplayer/admin_settings", () => {
        void MessageFormBuilder.confirm(
          player,
          "移除管理员",
          `确定将 ${color.playerName}${name}${color.info} 移出管理员名单？`,
          () => {
            void system.run(() => {
              const i = config.adminKeys.indexOf(name);
              if (i >= 0) config.adminKeys.splice(i, 1);
              services.saveGate.saveConfig(config);
              say(`${color.success}已移除管理员 ${color.playerName}${name}`);
              showAdminList(player);
            });
          }
        );
      });
    }
    f.buttonWithIcon(`${color.success}+ 添加管理员`, "textures/ui/mockplayer/create_bot", () => {
      void ModalFormBuilder.showQuick(player, `${color.bold}添加管理员`, (g) => {
        g.textField("name", "玩家名", { defaultValue: "", tooltip: "该玩家无需 OP 也可管理所有假人、不受配额限制" });
      }).then((vals) => {
        if (!vals) return;
        const raw = String(vals.name ?? "").trim();
        if (!raw) {
          say(`${color.error}玩家名不能为空`);
          return;
        }
        const key = playerKey(raw);
        if (!config.adminKeys.includes(key)) config.adminKeys.push(key);
        services.saveGate.saveConfig(config);
        say(`${color.success}已将 ${color.playerName}${key}${color.success} 加入管理员名单`);
        showAdminList(player);
      });
    });
    f.buttonWithIcon(style("返回", color.darkGray), "textures/ui/mockplayer/back", () => showAdminMenu(player));
  });
}
