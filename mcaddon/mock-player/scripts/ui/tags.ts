// ─── 标签管理 + 标签速查 ──────────────────────────────

import { Player, system } from "@minecraft/server";
import { ActionFormData, ModalFormData } from "@minecraft/server-ui";

import { BOT_TAG } from "../features/types";
import {
  TAG_BOT,
  TAG_CONTROL,
  COEXIST_TAGS,
  EXCLUSIVE_TAGS,
  getTagDef,
} from "../features/tags";
import { botRegistry } from "../features/persistence";
import { setTags } from "../features/operations";
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

  const form = new ModalFormData().title(`§l标签管理 · ${botName}`);

  const currentTagsText = record.tags
    .map((t) => {
      const def = getTagDef(t);
      return def ? def.label : t;
    })
    .join(" · ");
  form.label(`§7当前标签: §e${currentTagsText}`);

  for (const tag of manageableCoexist) {
    form.toggle(tag.label, { defaultValue: record.tags.includes(tag.value) });
  }

  form.dropdown("§c互斥体态（仅选一项）", exclusiveOptions, { defaultValueIndex: exclusiveIndex });

  form.show(player).then((response) => {
    if (response.canceled || !response.formValues) {
      showTagManagement(player, botName);
      return;
    }

    const currentRecord = botRegistry.get(botName);
    if (!currentRecord) {
      player.sendMessage(`§c模拟玩家 §e${botName}§c 已被删除`);
      return;
    }

    const toggleValues: boolean[] = [];
    for (let i = 0; i < manageableCoexist.length; i++) {
      toggleValues.push(response.formValues[1 + i] as boolean);
    }
    const exclusiveSelection = response.formValues[1 + manageableCoexist.length] as number;

    const newTags: string[] = [TAG_BOT.value];
    for (let i = 0; i < manageableCoexist.length; i++) {
      if (toggleValues[i]) newTags.push(manageableCoexist[i].value);
    }
    if (exclusiveSelection > 0) newTags.push(EXCLUSIVE_TAGS[exclusiveSelection - 1].value);

    system.run(() => {
      setTags(currentRecord, newTags, player);
    });

    player.sendMessage(`§a已更新 §e${botName}§a 的标签`);
  });
}

// ─── 标签速查 ─────────────────────────────────────────

export function showTagLookup(player: Player): void {
  const form = new ActionFormData()
    .title("§l标签速查")
    .body("§7可共存标签（可同时开启多个）：");

  for (const tag of COEXIST_TAGS) {
    form.button(`§a${tag.label}`);
  }

  form.label("§7━━━━━━━━━━━━━━━━━━━━━━━");
  form.label("§7互斥标签（同一时间只能开启一个）：");

  for (const tag of EXCLUSIVE_TAGS) {
    form.button(`§c${tag.label}`);
  }

  form.button("§7← 返回主菜单");

  form.show(player).then((response) => {
    if (response.canceled) return;
    showMainMenu(player);
  });
}
