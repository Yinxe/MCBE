// ─── 行为标签 + 帮助 ──────────────────────────────────

import { Player, system } from "@minecraft/server";
import { color, style } from "@yinxe/toolkit";
import { ModalFormBuilder } from "@yinxe/toolkit";

import { TAG_BOT, TAG_AUTO_USE, TAG_CONTROL, TAG_RAID_MODE, COEXIST_TAGS, EXCLUSIVE_TAGS, getTagDef } from "../../core/tags/BotTags";
import { botRegistry } from "../bootstrap/context";
import { setTags } from "../features/setTags";
import { setSneaking, startRaidMode } from "../features";
import { switchSpawnMode, getSpawnModeInfo } from "../features/spawnMode";
import { safeReconnect } from "../features/pendingRespawn";
import { startFollow, stopFollow, isFollowing } from "../features/follow";
import { startUseItem, stopUseItem } from "../features/useItem";

// ─── 行为标签管理（含 上线/潜行 快捷开关） ───────────

export function showTagManagement(player: Player, botName: string): void {
  const record = botRegistry.get(botName);
  if (!record) {
      player.sendMessage(`${color.error}模拟玩家 ${color.playerName}${botName}${color.error} 已被删除`);
    return;
  }

  const manageableCoexist = COEXIST_TAGS.filter((t) => t.value !== TAG_BOT.value);

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
    // ── 快捷开关 ──
    .toggle("sneaking", style("潜行", color.playerName), {
      defaultValue: record.isSneaking,
      tooltip: record.isSneaking ? "关闭将站起" : "开启将使假人潜行",
    })
    .toggle("chunkload", style("强加载模式", color.playerName), {
      defaultValue: record.spawnMode === "chunkload",
      tooltip: "区块持续加载，但不可转向。异地上线仅加载当前区块附近，需玩家靠近补足模拟距离；重新上线后需再次靠近。切换时自动重新上线",
    })
    .label("sep1", style("━━ 标签设置 ────", color.accent))
    // ── 跟随 ──
    .toggle("follow", style("自动跟随", color.playerName), {
      defaultValue: isFollowing(botName),
      tooltip: "开启后假人会持续跟随你",
    })
    // ── 使用物品（独立普通开关，每次打开默认关） ──
    .label("sepUse", style("━━ 一次性使用 ──", color.accent))
    .toggle("useItem", style("使用物品", color.accent), {
      defaultValue: false,
      tooltip: "勾选提交＝使用主手物品并约 2 秒后自动停下（吃完喝完）；取消提交＝立即停止。一次性动作，默认关闭",
    });

  for (const tag of manageableCoexist) {
    builder.toggle(tag.value, tag.label, {
      defaultValue: record.tags.includes(tag.value),
      tooltip: tag.value === "mockplayer:tag:respawn" ? "死亡后自动复活到重生点" : "每 3 tick 自动跳跃",
    });
  }

  // ── 劫掠模式（独立开关，与其它行为可共存） ──
  builder.toggle("raidMode", style("劫掠模式", color.warn), {
    defaultValue: record.tags.includes(TAG_RAID_MODE.value),
    tooltip: "持续喝不祥之瓶刷袭击：获得村庄英雄视为本次袭击胜利，自动喝下一瓶。与其它行为可共存",
  });

  const shortNames = EXCLUSIVE_TAGS.map((t) => t.value.replace("mockplayer:tag:", ""));
  builder.dropdown("exclusive", style("行为（仅选一项）", color.warn), exclusiveOptions, {
    defaultValueIndex: exclusiveIndex,
    tooltip: "自动挖掘/放置/攻击/宝库模式等，互斥只能选一项（使用物品是上方独立开关）",
  });

  builder.show(player).then((vals) => {
    if (!vals) return;
    const currentRecord = botRegistry.get(botName);
    if (!currentRecord) {
    player.sendMessage(`${color.error}模拟玩家 ${color.playerName}${botName}${color.error} 已被删除`);
      return;
    }
    // ── 处理快捷开关 ──
    const wantSneaking = vals.sneaking as boolean;
    if (wantSneaking !== currentRecord.isSneaking) {
      system.run(() => {
        try { setSneaking(currentRecord, wantSneaking); } catch (e: any) { player.sendMessage(`${color.error}切换潜行失败: ${e.message}`); }
      });
    }

    // ── 处理生成模式切换 ──
    const wantChunkload = vals.chunkload as boolean;
    const currentMode = currentRecord.spawnMode ?? "normal";
    const targetMode = wantChunkload ? "chunkload" : "normal";
    if (targetMode !== currentMode) {
      const wasOnline = currentRecord.online && !currentRecord.death;
      if (wasOnline) {
        safeReconnect(currentRecord, {
          onOffline: () => switchSpawnMode(currentRecord, targetMode),
          onOnline: () => player.sendMessage(`${color.success}已切换为 ${targetMode === "chunkload" ? "强加载" : "普通"}模式`),
        });
      } else {
        switchSpawnMode(currentRecord, targetMode);
      }
    }

    // ── 处理跟随 ──
    const wantFollow = vals.follow as boolean;
    if (wantFollow !== isFollowing(botName)) {
      system.run(() => {
        try {
          if (wantFollow) {
            startFollow(botName, player.id);
            player.sendMessage(`${color.success}${color.playerName}${botName}${color.success} 正在跟随你`);
          } else {
            stopFollow(botName);
            player.sendMessage(`${color.success}${color.playerName}${botName}${color.success} 已停止跟随`);
          }
        } catch (e: any) { player.sendMessage(`${color.error}切换跟随失败: ${e.message}`); }
      });
    }

    // ── 处理标签 ──
    const exclusiveSel = vals.exclusive as number;
    const pickedExclusive = exclusiveSel > 0 ? behaviorExclusive[exclusiveSel - 1].value : undefined;

    const newTags: string[] = [TAG_BOT.value];
    for (const tag of manageableCoexist) {
      if (vals[tag.value]) newTags.push(tag.value);
    }
    if (pickedExclusive) {
      newTags.push(pickedExclusive);
    }
    // 劫掠模式为独立开关，可与互斥行为并存（如 劫掠 + 自动攻击 = 边喝药边反击袭击者）
    if (vals.raidMode as boolean) {
      newTags.push(TAG_RAID_MODE.value);
    }

    // 「使用物品」独立开关：勾选提交=使用一次（自动停下），取消提交=停止一次。
    // 开关本身不落库（用后即停，无持续状态），每次打开行为菜单都默认关。
    const useItemOn = vals.useItem as boolean;

    system.run(() => {
      setTags(currentRecord, newTags, player);

      // 劫掠模式开启 → 立即喝第一瓶（假人在线时）
      if (newTags.includes(TAG_RAID_MODE.value)) {
        startRaidMode(botName);
      }
    });

    // 一次性动作（不在 tick 循环里）：勾选=开始使用，取消=停止使用
    if (useItemOn) {
      startUseItem(player, currentRecord);
    } else {
      stopUseItem(player, currentRecord);
    }

    player.sendMessage(`${color.success}已更新 ${color.playerName}${botName}${color.success} 的行为设置`);
  });
}
