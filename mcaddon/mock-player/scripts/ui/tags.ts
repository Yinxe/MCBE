// ─── 行为标签 + 帮助 ──────────────────────────────────

import { Player, system } from "@minecraft/server";
import { ActionFormBuilder, ModalFormBuilder } from "@yinxe/toolkit/ui";

import { BOT_TAG, TAG_BOT, TAG_CONTROL, COEXIST_TAGS, EXCLUSIVE_TAGS, getTagDef } from "../features/core/tags";
import { botRegistry } from "../features/core/persistence";
import { setTags } from "../features/setTags";
import { showMainMenu } from "./menu";

// ─── 行为标签管理 ─────────────────────────────────────

export function showTagManagement(player: Player, botName: string): void {
  const record = botRegistry.get(botName);
  if (!record) {
    player.sendMessage(`§c模拟玩家 §e${botName}§c 已被删除`);
    return;
  }

  const manageableCoexist = COEXIST_TAGS.filter((t) => t.value !== TAG_BOT.value);

  const exclusiveOptions = ["§7无", ...EXCLUSIVE_TAGS.map((t) => `§e${t.label}`)];
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
    .title(`§l行为标签 · ${botName}`)
    .label("current", `§7当前标签: §e${currentTagsText}`);

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

    const newTags: string[] = [TAG_BOT.value];
    for (const tag of manageableCoexist) {
      if (vals[tag.value]) newTags.push(tag.value);
    }
    const exclusiveSel = vals.exclusive as number;
    if (exclusiveSel > 0) newTags.push(EXCLUSIVE_TAGS[exclusiveSel - 1].value);

    system.run(() => {
      setTags(currentRecord, newTags, player);
    });
    player.sendMessage(`§a已更新 §e${botName}§a 的行为标签`);
  });
}
