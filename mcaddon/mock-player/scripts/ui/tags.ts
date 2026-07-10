// ─── 标签管理 + 标签速查 ──────────────────────────────

import { Player, system } from "@minecraft/server";
import { ActionFormBuilder, ModalFormBuilder } from "@yinxe/toolkit/ui";

import { BOT_TAG, TAG_BOT, TAG_CONTROL, COEXIST_TAGS, EXCLUSIVE_TAGS, getTagDef } from "../features/core/tags";
import { botRegistry } from "../features/core/persistence";
import { setTags } from "../features/setTags";
import { showMainMenu } from "./menu";

// ─── 标签管理 ─────────────────────────────────────────

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
    .title(`§l标签管理 · ${botName}`)
    .label("current", `§7当前标签: §e${currentTagsText}`);

  for (const tag of manageableCoexist) {
    builder.toggle(tag.value, tag.label, { defaultValue: record.tags.includes(tag.value) });
  }

  builder.dropdown("exclusive", "§c互斥体态（仅选一项）", exclusiveOptions, { defaultValueIndex: exclusiveIndex });

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
    player.sendMessage(`§a已更新 §e${botName}§a 的标签`);
  });
}

// ─── 标签速查 ─────────────────────────────────────────

export function showTagLookup(player: Player): void {
  const builder = new ActionFormBuilder()
    .title("§l标签速查")
    .body("§7可共存标签（可同时开启多个）：");

  for (const tag of COEXIST_TAGS) {
    builder.button(`§a${tag.label}`);
  }

  builder.button("§7← 返回主菜单", () => showMainMenu(player));
  builder.show(player);
}
