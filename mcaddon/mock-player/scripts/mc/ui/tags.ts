// ─── 行为标签 + 帮助 ──────────────────────────────────
// 行为菜单（ModalForm）：提交时 **① setTags 先落库**（标签首先更新，
// record.tags 已是最新 + 实体同步 + 持久化），**② 发布 behaviorSubmitted
// 领域事件**（负载带表单参数 + tags）——各功能模块独立订阅，感知自己
// 感兴趣的字段执行，UI 不再直接调用任何业务动作函数。
//
// 表单布局（用户拍板）：自动重生置顶、强加载第 2；
// 自动跳跃/宝库等全部在互斥行为下拉（仅选一项），劫掠模式独立开关可并存。

import { Player, system, world } from "@minecraft/server";
import { color, style } from "@yinxe/toolkit";
import { ModalFormBuilder } from "@yinxe/toolkit";

import { TAG_BOT, TAG_AUTO_USE, TAG_AUTO_JUMP, TAG_RESPAWN, TAG_RAID_MODE, EXCLUSIVE_TAGS, getTagDef, computeTagsFromBehaviorForm } from "../../tags/BotTags";
import { BotUiEvent } from "../../events/UiEvents";
import { botRegistry } from "../bootstrap/context";
import { canManageBot, autoClaim } from "../commands/auth";
import { setTags } from "../features/setTags";
import { isFollowing } from "../features/follow";

// ─── UI 事件订阅（BOT 主菜单 → 感知行为标签动作） ──────

/** 订阅 BOT 主菜单动作事件：行为标签 → 弹表单 */
export function registerUiSubscriptions(): void {
  BotUiEvent.panelAction.subscribe((e) => {
    if (e.action !== "openBehavior") return;
    const player = world.getEntity(e.playerId) as Player | undefined;
    if (!player) return;
    showTagManagement(player, e.botName);
  });
}

// ─── 行为标签管理（含 上线/潜行 快捷开关） ───────────

export function showTagManagement(player: Player, botName: string): void {
  const record = botRegistry.get(botName);
  if (!record) {
      player.sendMessage(`${color.error}模拟玩家 ${color.playerName}${botName}${color.error} 已被删除`);
    return;
  }
  // ⚠️ 权限守卫：本面板可改他人假人的标签/生成模式/潜行/跟随，
  // 入口可达自潜行长按假人（playerInteractWithEntity），必须校验管理权
  // 无主假人（旧版升级数据）：首次打开 tag 菜单 → 自动认领成为主人（静默标记）
  if (!canManageBot(player, record)) {
    if (autoClaim(player, record)) {
      player.sendMessage(`${color.success}已自动认领假人 ${color.playerName}${botName}${color.success}（旧版数据，首次操作生效）`);
    } else {
      player.sendMessage(`${color.error}假人 ${color.playerName}${botName}${color.error} 只允许主人或管理员操作`);
      return;
    }
  }

  // 共存标签（除 bot 标识外）：自动重生置顶单独开关，其余（自动跳跃）进共存区

  // 「使用物品」是独立的普通开关（一次性使用），不进互斥行为下拉
  const behaviorExclusive = EXCLUSIVE_TAGS.filter((t) => t.value !== TAG_AUTO_USE.value);
  const exclusiveOptions = [style("无", color.muted), ...behaviorExclusive.map((t) => style(t.label, color.black))];
  let exclusiveIndex = 0;
  for (let i = 0; i < behaviorExclusive.length; i++) {
    if (record.tags.includes(behaviorExclusive[i].value)) {
      exclusiveIndex = i + 1;
      break;
    }
  }

  const currentTagsText = record.tags
    .map((t) => { const d = getTagDef(t); return d ? d.label : t; })
    .join(" · ");

  const builder = new ModalFormBuilder()
    .title(`${color.bold}行为 · ${botName}`)
    .label("current", `${color.accent}当前: ${color.black}${currentTagsText}`)
    // ── 置顶：自动重生（最常用开关） ──
    .toggle("respawn", style("自动重生", color.playerName), {
      defaultValue: record.tags.includes(TAG_RESPAWN.value),
      tooltip: "死亡后自动复活到重生点",
    })
    // ── 第 2：强加载模式 ──
    .toggle("chunkload", style("强加载模式", color.playerName), {
      defaultValue: record.spawnMode === "chunkload",
      tooltip: "区块持续加载，体态完全可操控。异地上线仅加载当前区块附近，需玩家靠近补足模拟距离；重新上线后需再次靠近。切换时自动重新上线",
    })
    .label("sep1", style("━━ 其他开关 ────", color.accent))
    // ── 潜行 ──
    .toggle("sneaking", style("潜行", color.playerName), {
      defaultValue: record.isSneaking,
      tooltip: record.isSneaking ? "关闭将站起" : "开启将使假人潜行",
    })
    // ── 使用物品（独立普通开关，每次打开默认关） ──
    .toggle("useItem", style("使用物品", color.accent), {
      defaultValue: false,
      tooltip: "勾选提交＝使用主手物品并约 2 秒后自动停下（吃完喝完）；取消提交＝立即停止。一次性动作，默认关闭",
    })
    // ── 自动跳跃（共存标签） ──
    .toggle("autoJump", style("自动跳跃", color.playerName), {
      defaultValue: record.tags.includes(TAG_AUTO_JUMP.value),
      tooltip: "每 3 tick 自动跳跃",
    })
    // ── 自动跟随（独立开关，record.following 状态） ──
    .toggle("follow", style("自动跟随", color.playerName), {
      defaultValue: isFollowing(botName),
      tooltip: "开启后假人会持续跟随你",
    })
    // ── 劫掠模式（独立开关，与其它行为可共存） ──
    .toggle("raidMode", style("劫掠模式", color.warn), {
      defaultValue: record.tags.includes(TAG_RAID_MODE.value),
      tooltip: "持续喝不祥之瓶刷袭击：获得村庄英雄视为本次袭击胜利，自动喝下一瓶。与其它行为可共存",
    })
    .label("sep2", style("━━ 互斥行为 ────", color.accent))
    .dropdown("exclusive", style("行为（仅选一项）", color.warn), exclusiveOptions, {
      defaultValueIndex: exclusiveIndex,
      tooltip: "空闲/自动挖掘/放置/攻击/体态控制/宝库模式等，互斥只能选一项（使用物品是上方独立开关）",
    });

  builder.show(player).then((vals) => {
    if (!vals) return;
    const currentRecord = botRegistry.get(botName);
    if (!currentRecord) {
    player.sendMessage(`${color.error}模拟玩家 ${color.playerName}${botName}${color.error} 已被删除`);
      return;
    }

    // ── 表单 → 标签计算（core 纯函数） ──
    const exclusiveSel = vals.exclusive as number;
    const pickedExclusive = exclusiveSel > 0 ? behaviorExclusive[exclusiveSel - 1].value : undefined;
    const coexist: string[] = [];
    if (vals.respawn as boolean) coexist.push(TAG_RESPAWN.value);
    if (vals.autoJump as boolean) coexist.push(TAG_AUTO_JUMP.value);
    const newTags = computeTagsFromBehaviorForm({
      coexist,
      exclusive: pickedExclusive,
      raidMode: vals.raidMode as boolean,
    });

    // 一次性使用开关：勾选提交=使用一次（自动停下），取消提交=停止一次。
    // 开关本身不落库（用后即停，无持续状态），每次打开行为菜单都默认关。
    const useItemOn = vals.useItem as boolean;
    const wantSneaking = vals.sneaking as boolean;
    const wantChunkload = vals.chunkload as boolean;
    const wantFollow = vals.follow as boolean;

    system.run(() => {
      // ── ① 标签先落库（record.tags 最新 + 实体同步 + 持久化） ──
      setTags(currentRecord, newTags, player);
      // ── ② 发布行为菜单提交领域事件（负载带表单参数 + tags） ──
      BotUiEvent.behaviorSubmitted.trigger({
        playerId: player.id,
        botName,
        sneaking: wantSneaking,
        chunkload: wantChunkload,
        follow: wantFollow,
        useItem: useItemOn,
        coexist,
        exclusive: pickedExclusive,
        raidMode: vals.raidMode as boolean,
        tags: newTags,
      });
    });

    player.sendMessage(`${color.success}已更新 ${color.playerName}${botName}${color.success} 的行为设置`);
  });
}
