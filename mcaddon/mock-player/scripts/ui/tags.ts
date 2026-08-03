// ─── 行为标签 + 帮助 ──────────────────────────────────

import { Player, system } from "@minecraft/server";
import { color, style } from "@yinxe/toolkit";
import { ModalFormBuilder } from "@yinxe/toolkit";

import { TAG_BOT, TAG_CONTROL, COEXIST_TAGS, EXCLUSIVE_TAGS, getTagDef } from "../features/core/tags";
import { botRegistry } from "../features/core/persistence";
import { setTags } from "../features/setTags";
import { setSneaking } from "../features";
import { switchSpawnMode, getSpawnModeInfo } from "../features/spawnMode";
import { safeReconnect } from "../features/pendingRespawn";
import { startFollow, stopFollow, isFollowing } from "../features/follow";

// ─── 行为标签管理（含 上线/潜行 快捷开关） ───────────

export function showTagManagement(player: Player, botName: string): void {
  const record = botRegistry.get(botName);
  if (!record) {
      player.sendMessage(`${color.error}模拟玩家 ${color.playerName}${botName}${color.error} 已被删除`);
    return;
  }

  const manageableCoexist = COEXIST_TAGS.filter((t) => t.value !== TAG_BOT.value);

  const exclusiveOptions = [style("无", color.muted), ...EXCLUSIVE_TAGS.map((t) => style(t.label, color.black))];
  let exclusiveIndex = 0;
  for (let i = 0; i < EXCLUSIVE_TAGS.length; i++) {
    if (record.tags.includes(EXCLUSIVE_TAGS[i].value)) {
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
    });

  for (const tag of manageableCoexist) {
    builder.toggle(tag.value, tag.label, {
      defaultValue: record.tags.includes(tag.value),
      tooltip: tag.value === "mockplayer:tag:respawn" ? "死亡后自动复活到重生点" : "每 3 tick 自动跳跃",
    });
  }

  const shortNames = EXCLUSIVE_TAGS.map((t) => t.value.replace("mockplayer:tag:", ""));
  builder.dropdown("exclusive", style("行为（仅选一项）", color.warn), exclusiveOptions, {
    defaultValueIndex: exclusiveIndex,
    tooltip: "自动挖掘/放置/攻击/使用物品/宝库模式等，互斥只能选一项",
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
    const newTags: string[] = [TAG_BOT.value];
    for (const tag of manageableCoexist) {
      if (vals[tag.value]) newTags.push(tag.value);
    }
    const exclusiveSel = vals.exclusive as number;
    if (exclusiveSel > 0) newTags.push(EXCLUSIVE_TAGS[exclusiveSel - 1].value);

    system.run(() => {
      setTags(currentRecord, newTags, player);
    });
    player.sendMessage(`${color.success}已更新 ${color.playerName}${botName}${color.success} 的行为设置`);
  });
}
