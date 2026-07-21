// ─── 行为标签 + 帮助 ──────────────────────────────────

import { Player, system } from "@minecraft/server";
import { ModalFormBuilder } from "@yinxe/toolkit/ui";

import { TAG_BOT, TAG_CONTROL, COEXIST_TAGS, EXCLUSIVE_TAGS, getTagDef } from "../features/core/tags";
import { botRegistry } from "../features/core/persistence";
import { setTags } from "../features/setTags";
import { setSneaking } from "../features";
import { switchSpawnMode, getSpawnModeInfo } from "../features/spawnMode";
import { onlineBot } from "../features/onlineBot";
import { offlineBot } from "../features/offlineBot";

// ─── 行为标签管理（含 上线/潜行 快捷开关） ───────────

export function showTagManagement(player: Player, botName: string): void {
  const record = botRegistry.get(botName);
  if (!record) {
    player.sendMessage(`§c模拟玩家 §e${botName}§c 已被删除`);
    return;
  }

  const manageableCoexist = COEXIST_TAGS.filter((t) => t.value !== TAG_BOT.value);

  const exclusiveOptions = ["§7无", ...EXCLUSIVE_TAGS.map((t) => `§f${t.label}`)];
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
    .title(`§l行为 · ${botName}`)
    .label("current", `§7当前: §f${currentTagsText}`)
    // ── 快捷开关 ──
    .toggle("sneaking", "§b潜行", {
      defaultValue: record.isSneaking,
      tooltip: record.isSneaking ? "关闭将站起" : "开启将使假人潜行",
    })
    .toggle("chunkload", "§b强加载模式", {
      defaultValue: record.spawnMode === "chunkload",
      tooltip: "开启后区块常驻加载，但不可转向。切换时自动重新上线",
    })
    .label("sep1", "§7━━ 标签设置 ────");

  for (const tag of manageableCoexist) {
    builder.toggle(tag.value, tag.label, {
      defaultValue: record.tags.includes(tag.value),
      tooltip: tag.value === "mockplayer:tag:respawn" ? "死亡后自动复活到重生点" : "每 3 tick 自动跳跃",
    });
  }

  const shortNames = EXCLUSIVE_TAGS.map((t) => t.value.replace("mockplayer:tag:", ""));
  builder.dropdown("exclusive", "§c行为（仅选一项）", exclusiveOptions, {
    defaultValueIndex: exclusiveIndex,
    tooltip: "自动挖掘/放置/攻击/使用物品/宝库模式等，互斥只能选一项",
  });

  builder.show(player).then((vals) => {
    if (!vals) return;
    const currentRecord = botRegistry.get(botName);
    if (!currentRecord) {
      player.sendMessage(`§c模拟玩家 §e${botName}§c 已被删除`);
      return;
    }

    // ── 处理快捷开关 ──
    const wantSneaking = vals.sneaking as boolean;
    if (wantSneaking !== currentRecord.isSneaking) {
      system.run(() => {
        try { setSneaking(currentRecord, wantSneaking); } catch (e: any) { player.sendMessage(`§c切换潜行失败: ${e.message}`); }
      });
    }

    // ── 处理生成模式切换 ──
    const wantChunkload = vals.chunkload as boolean;
    const currentMode = currentRecord.spawnMode ?? "normal";
    const targetMode = wantChunkload ? "chunkload" : "normal";
    if (targetMode !== currentMode) {
      const wasOnline = currentRecord.online && !currentRecord.death;
      // 先下线
      if (wasOnline) {
        system.run(() => {
          try { offlineBot(currentRecord); } catch {}
        });
      }
      switchSpawnMode(currentRecord, targetMode);
      // 延迟 5tick 等实体完全移除再重新上线
      if (wasOnline) {
        system.runTimeout(() => {
          try {
            if (!currentRecord.death) onlineBot(currentRecord);
            player.sendMessage(`§a已切换为 ${targetMode === "chunkload" ? "强加载" : "普通"}模式`);
          } catch (e: any) {
            player.sendMessage(`§c切换失败: ${e.message}`);
          }
        }, 5);
      }
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
    player.sendMessage(`§a已更新 §e${botName}§a 的行为设置`);
  });
}
