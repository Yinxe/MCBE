// ─── Bot 操作面板 ───
// 入口守卫三段：存在→管理权→无主认领；body 每行 safe() 兜底，单行失败不拖垮表单。
// 按钮直调 services 不经事件总线；按钮顺序与图标对应为既定口径。

import { system } from "@minecraft/server";
import type { Player } from "@minecraft/server";
import { ActionFormBuilder, color, style, trySendMessage } from "@yinxe/toolkit";
import { BOT_MARKER_TAG } from "../../domain/Record";
import { modeSpec } from "../../domain/Catalog";
import {
  botStatus,
  ensureUiBotAvailable,
  formatDimension,
  formatPos,
  getStatusIcon,
  guardUiManage,
  invSummary,
  itemDisplayName,
  performSyncPose,
  resolveUiBotRecord,
  TELEPORT_DISABLED_NOTICE,
  teleportEnabled,
  uiViewer,
} from "../Kit";
import { services } from "../../Composition";
import { handler } from "../../engine/Handler";
import { showBehaviorPanel } from "./Behavior";
import { showRenameForm } from "./Rename";
import { showReclaimForm } from "./Reclaim";
import { showDiscardForm } from "./Discard";
import { showSwapForm } from "./Swap";
import { showMainhandSelector } from "./Mainhand";
import { showTridentSelector, showTridentClaimUI } from "./Trident";
import { showActionPanel } from "./Action";
import { sendData } from "./Data";
import { confirmDelete } from "./Delete";
import type { ItemSummary } from "../../engine/PanelOps";

/** 单行统计兜底：任意异常返回"无法统计"，不重抛 */
function safe(fn: () => string, fallback = `${color.muted}无法统计`): string {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

function shortItem(s: ItemSummary | null | undefined): string {
  if (!s) return `${color.muted}空`;
  const dur =
    s.maxDurability !== undefined && s.damage !== undefined
      ? ` ${color.muted}[${s.maxDurability - s.damage}/${s.maxDurability}]`
      : "";
  return `${itemDisplayName(s)}${s.amount > 1 ? ` ${color.muted}x${s.amount}` : ""}${dur}`;
}

/** 4 行摘要 body：状态/位置/持有/归属 */
function buildBody(botId: number, name: string): string {
  const { runtime, ops, panelOps } = services;
  const record = runtime.record(botId);
  if (!record) return `${color.muted}记录已消失`;
  const st = botStatus(record);
  const spec = modeSpec(record.workMode);
  const lines: string[] = [];

  lines.push(
    safe(() => {
      const deathStr = st.death ? `${color.error}死亡` : `${color.success}存活`;
      const onlineStr = st.online ? `${color.success}在线` : `${color.warn}离线`;
      const workColor = record.workMode === "none" ? color.muted : color.success;
      const sneakStr = record.switches.sneaking ? `${color.success}潜行` : `${color.muted}正常`;
      return `${deathStr} ${color.muted}| ${onlineStr} ${color.muted}| ${color.accent}模式:${workColor}${spec.label} ${color.muted}| ${sneakStr}`;
    })
  );

  lines.push(
    safe(() => {
      const pose = st.online ? ops.readPose(botId) : null;
      const curPos = pose
        ? `${formatPos(pose.position)} ${color.gold}${formatDimension(pose.dimensionId)}`
        : `${formatPos(record.home.position)} ${color.gold}${formatDimension(record.dimensionId)} ${color.muted}(家点)`;
      const rp = record.respawnPoint;
      const rpPos = rp
        ? `${formatPos(rp.position)} ${color.gold}${formatDimension(rp.dimensionId)}`
        : `${color.muted}无`;
      return `${color.accent}位置:${color.muted} ${curPos} ${color.muted}→ 重生:${color.muted} ${rpPos}`;
    })
  );

  lines.push(
    safe(() => {
      const view = st.online ? panelOps.liveSlots(botId) : undefined;
      if (view) {
        const inv = invSummary(view.inv);
        return `${color.accent}持有:${color.muted} 主手 ${shortItem(view.inv[view.selected])} ${color.muted}| 背包 ${color.info}${inv.filled}/36 ${color.muted}格 §7| ${color.info}${inv.summary}`;
      }
      const vault = panelOps.vaultSlots(botId);
      if (!vault.inv) return `${color.muted}无背包信息`;
      const inv = invSummary(vault.inv);
      const mh = vault.equip?.offhand;
      return `${color.accent}持有:${color.muted} 主手 ${shortItem(mh)}${mh ? ` ${color.muted}(离线·副手缓存)` : ` ${color.muted}(离线)`} ${color.muted}| 背包 ${color.info}${inv.filled}/36 ${color.muted}格 §7| ${color.info}${inv.summary} ${color.muted}(离线缓存)`;
    })
  );

  lines.push(
    safe(() => {
      const owner = record.ownerKey === null ? `${color.muted}无主` : `${color.playerName}${record.ownerKey}`;
      const exp = record.experience;
      const expShort = `Lv.${exp.level} ${color.muted}(${exp.totalXp}XP)`;
      const tags = record.tags.filter((t) => t !== BOT_MARKER_TAG && !t.endsWith(":idle"));
      const tagShort = tags.length
        ? `${tags.slice(0, 2).join(", ")}${tags.length > 2 ? `${color.muted}…` : ""}`
        : `${color.muted}无`;
      return `${color.accent}归属:${owner} ${color.muted}| 经验:${color.playerName}${expShort} ${color.muted}| 标签:${tagShort}`;
    })
  );

  return `${color.muted}${name} ${lines.join("\n")}`;
}

export function showBotPanel(player: Player, rawName: string, onBack?: () => void): void {
  const say = (t: string) => trySendMessage(player, t);
  const viewer = uiViewer(player);
  const record = resolveUiBotRecord(say, rawName);
  if (!record) return;
  if (!guardUiManage(say, viewer, record)) return;
  const { botId, name } = record;
  const st = botStatus(record);
  const { lifecycle, ops, panelOps } = services;

  /** 上线/下线一键（已在线=下线） */
  const toggleOnline = async (): Promise<void> => {
    const now = botStatus(record);
    if (now.online) {
      const res = await lifecycle.offline(botId, "command");
      system.run(() =>
        say(
          res.ok
            ? `${color.success}${color.playerName}${name}${color.success} 已下线`
            : `${color.error}${name} 下线失败: ${res.reason ?? "unknown"}`
        )
      );
      return;
    }
    say(`${color.muted}正在为 ${color.playerName}${name}${color.muted} 安全上线...`);
    const res = await lifecycle.online(viewer, botId);
    system.run(() =>
      say(
        res.ok
          ? `${color.success}${color.playerName}${name}${color.success} 已上线`
          : `${color.error}${name} 上线失败: ${res.reason ?? "unknown"}`
      )
    );
  };

  /** 传送过去：先过管理员开关，再看离线/死亡是否先安全上线 */
  const tpToBot = async (): Promise<void> => {
    if (!teleportEnabled()) {
      say(`${color.error}${TELEPORT_DISABLED_NOTICE}`);
      return;
    }
    const now = botStatus(record);
    if (!now.online || now.death) {
      const on = await lifecycle.online(viewer, botId);
      if (!on.ok) {
        system.run(() => say(`${color.error}${name} 上线失败，无法传送: ${on.reason ?? "unknown"}`));
        return;
      }
    }
    system.run(() => {
      const pose = ops.readPose(botId);
      if (!pose) {
        say(`${color.error}无法在世界中找到该模拟玩家`);
        return;
      }
      const r = ops.tpPlayerTo(player.name, pose.position, pose.dimensionId);
      say(
        r.ok ? `${color.success}已传送到 ${color.playerName}${name}${color.success} 身边` : `${color.error}${r.reason}`
      );
    });
  };

  /** 同步姿态：假人→玩家位置+朝向+潜行（口径见 Kit.performSyncPose） */
  const syncPose = (): void => {
    if (!ensureUiBotAvailable(say, record)) return;
    const r = performSyncPose(player, botId);
    say(
      r.ok
        ? `${color.success}已同步 ${color.playerName}${name}${color.success} 姿态与朝向`
        : `${color.error}${r.reason}`
    );
  };

  /** 使用物品一次性 */
  const useItem = async (): Promise<void> => {
    const res = await panelOps.useItemOnce(botId);
    system.run(() => {
      if (res === "fully-fed") say(`${color.warn}${color.playerName}${name}${color.warn} 饱食度已满，无法进食`);
      else if (res === "unusable")
        say(`${color.warn}${color.playerName}${name}${color.warn} 主手物品当前不可用（空手或不能右键使用）`);
      /* used/offline 无玩家反馈 */
    });
  };

  /** 交互一次性（官方头部射线；无消息反馈） */
  const interact = (): void => {
    if (!ensureUiBotAvailable(say, record)) return;
    handler.interactSight(botId);
  };

  const kill = (): void => {
    const now = botStatus(record);
    if (!now.online || now.death) {
      say(`${color.error}模拟玩家不在线或已死亡`);
      return;
    }
    const r = ops.kill(botId);
    say(r.ok ? `${color.success}已杀死 ${color.playerName}${name}` : `${color.error}杀死假人失败: ${r.reason}`);
  };

  void ActionFormBuilder.showQuick(player, `${color.bold}${name} ${getStatusIcon(record)}`, (f) => {
    f.body(buildBody(botId, name));
    // 按钮—图标对应为既定口径
    f.buttonWithIcon(
      st.online ? style("安全下线", color.darkGreen) : style("安全上线", color.darkGreen),
      "textures/ui/mockplayer/toggle_online",
      () => void toggleOnline()
    );
    // 管理员关掉传送功能时入口不显示（动作侧也守一次，防旧面板表单误触发）
    if (teleportEnabled())
      f.buttonWithIcon(style("传送过去", color.darkBlue), "textures/ui/mockplayer/teleport", () => void tpToBot());
    f.buttonWithIcon(style("同步姿态", color.darkBlue), "textures/ui/mockplayer/sync_pose", syncPose);
    f.buttonWithIcon(style("选择主手", color.darkBlue), "textures/ui/mockplayer/select_mainhand", () =>
      showMainhandSelector(player, record)
    );
    f.buttonWithIcon(style("物品互换", color.darkBlue), "textures/ui/mockplayer/swap_items", () =>
      showSwapForm(player, record)
    );
    f.buttonWithIcon(style("回收资源", color.darkBlue), "textures/ui/mockplayer/reclaim", () =>
      showReclaimForm(player, record)
    );
    f.buttonWithIcon(style("丢弃物品", color.darkRed), "textures/ui/mockplayer/discard", () =>
      showDiscardForm(player, record)
    );
    f.buttonWithIcon(style("行为菜单", color.darkGreen), "textures/ui/mockplayer/inventory", () =>
      showBehaviorPanel(player, rawName)
    );
    f.buttonWithIcon(style("自定义动作", color.darkGreen), "textures/ui/mockplayer/inventory", () =>
      showActionPanel(player, rawName)
    );
    f.buttonWithIcon(style("使用物品", color.darkGreen), "textures/ui/mockplayer/use_item", () => void useItem());
    f.buttonWithIcon(style("交互", color.darkGreen), "textures/ui/mockplayer/use_item", interact);
    f.buttonWithIcon(style("设置重生", color.darkBlue), "textures/ui/mockplayer/set_spawn", () => {
      const r = lifecycle.setRespawnHere(viewer, botId);
      say(
        r.ok
          ? `${color.success}已更新 ${color.playerName}${name}${color.success} 的重生点`
          : `${color.error}${r.reason}`
      );
    });
    f.buttonWithIcon(style("修改名字", color.darkBlue), "textures/ui/mockplayer/rename", () =>
      showRenameForm(player, record)
    );
    f.buttonWithIcon(
      style("投三叉戟", color.darkBlue),
      "textures/ui/mockplayer/throw_trident",
      () => void showTridentSelector(player, record)
    );
    f.buttonWithIcon(style("投掷物认主", color.darkBlue), "textures/ui/mockplayer/throw_trident", () =>
      showTridentClaimUI(player, record)
    );
    f.buttonWithIcon(style("查看数据", color.darkBlue), "textures/ui/mockplayer/view_data", () =>
      sendData(player, record)
    );
    f.buttonWithIcon(style("击杀假人", color.darkRed), "textures/ui/mockplayer/kill_bot", kill);
    f.buttonWithIcon(
      style("删除假人", color.darkRed),
      "textures/ui/mockplayer/delete_bot",
      () => void confirmDelete(player, record)
    );
    f.buttonWithIcon(style("返回列表", color.darkBlue), "textures/ui/mockplayer/back", () => {
      if (onBack) onBack();
    });
  });
}
