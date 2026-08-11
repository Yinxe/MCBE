// ─── 行为标签 + 帮助 ──────────────────────────────────

import { Player, system } from "@minecraft/server";
import { color, style } from "@yinxe/toolkit";
import { ModalFormBuilder } from "@yinxe/toolkit";

import { TAG_BOT, TAG_IDLE, TAG_AUTO_USE, TAG_RAID_MODE, TAG_CONTROL, COEXIST_TAGS, EXCLUSIVE_TAGS, getTagDef } from "../features/core/tags";
import { botRegistry } from "../features/core/persistence";
import { setTags } from "../features/setTags";
import { setSneaking, initRaidSession, cleanupRaidSession } from "../features";
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

  const shortNames = EXCLUSIVE_TAGS.map((t) => t.value.replace("mockplayer:tag:", ""));
  builder.dropdown("exclusive", style("行为（仅选一项）", color.warn), exclusiveOptions, {
    defaultValueIndex: exclusiveIndex,
    tooltip: "自动挖掘/放置/攻击/宝库模式等，互斥只能选一项（使用物品是上方独立开关）",
  });

  // ── 劫掠区域配置（始终显示） ──
  const raidCfg = record.raidConfig;
  builder
    .label("sepRaid", style("━━ 劫掠区域 ────", color.accent))
    .textField("raidX", "X 半尺寸（以假人为中心）", {
      defaultValue: String(raidCfg?.x ?? 20),
      tooltip: "劫掠检测区域 X 轴半尺寸，默认 20（区域宽度 40 格）",
    })
    .textField("raidY", "Y 半尺寸（以假人为中心）", {
      defaultValue: String(raidCfg?.y ?? 50),
      tooltip: "劫掠检测区域 Y 轴半尺寸，默认 50（区域高度 100 格）",
    })
    .textField("raidZ", "Z 半尺寸（以假人为中心）", {
      defaultValue: String(raidCfg?.z ?? 20),
      tooltip: "劫掠检测区域 Z 轴半尺寸，默认 20（区域深度 40 格）",
    })
    .toggle("raidBoundary", style("显示劫掠区域边框", color.playerName), {
      defaultValue: raidCfg?.showBoundary ?? true,
      tooltip: "开启后持续显示劫掠检测区域的粒子线框",
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

    // ⚠️ 冲突检测：劫掠模式与强加载模式互斥（劫掠需要普通模式使用物品）
    // 同时勾选 → 取消劫掠模式，保留强加载切换，避免 safeReconnect 与 initRaidSession 时序竞争
    let raidTagBlocked = false;
    if (pickedExclusive === TAG_RAID_MODE.value && wantChunkload) {
      raidTagBlocked = true;
      player.sendMessage(
        `${color.warn}劫掠模式与强加载模式冲突：劫掠模式只能在普通模式使用，已取消劫掠模式，保留强加载切换`
      );
    }

    const newTags: string[] = [TAG_BOT.value];
    for (const tag of manageableCoexist) {
      if (vals[tag.value]) newTags.push(tag.value);
    }
    if (pickedExclusive && !raidTagBlocked) {
      newTags.push(pickedExclusive);
    } else if (raidTagBlocked) {
      // 劫掠被拦截 → 恢复空闲，避免无互斥标签
      newTags.push(TAG_IDLE.value);
    }

    // 「使用物品」独立开关：勾选提交=使用一次（自动停下），取消提交=停止一次。
    // 开关本身不落库（用后即停，无持续状态），每次打开行为菜单都默认关。
    const useItemOn = vals.useItem as boolean;

    // ── 处理劫掠区域配置 ──
    const rawX = parseInt(vals.raidX as string, 10);
    const rawY = parseInt(vals.raidY as string, 10);
    const rawZ = parseInt(vals.raidZ as string, 10);
    const raidX = isNaN(rawX) || rawX <= 0 ? 20 : rawX;
    const raidY = isNaN(rawY) || rawY <= 0 ? 50 : rawY;
    const raidZ = isNaN(rawZ) || rawZ <= 0 ? 20 : rawZ;
    const raidBoundary = vals.raidBoundary as boolean;

    system.run(() => {
      setTags(currentRecord, newTags, player);

      // 如果选中劫掠模式，初始化会话
      const hasRaidTag = newTags.includes(TAG_RAID_MODE.value);
      if (hasRaidTag) {
        initRaidSession(botName, { x: raidX, y: raidY, z: raidZ, showBoundary: raidBoundary });
      } else {
        // 劫掠模式被移除，清理会话
        cleanupRaidSession(botName);
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
