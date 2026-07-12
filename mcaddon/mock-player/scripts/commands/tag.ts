import { CustomCommandStatus, CommandPermissionLevel, CustomCommandParamType } from "@minecraft/server";
import { defineCommand } from "@yinxe/toolkit/command";
import { BOT_TAG, EXCLUSIVE_SET, getTagDef, resolveTag, buildTagListMessage } from "../features/core/tags";
import { botRegistry } from "../features/core/persistence";
import { setTags } from "../features/setTags";

/** /mp:tags — 列出所有可用标签（无需玩家身份，保持原生） */
export function registerTagsCommand(registry: any): void {
  registry.registerCommand({
    name: "mp:tags",
    description: "列出所有可用的假人标签",
    cheatsRequired: false, permissionLevel: CommandPermissionLevel.Any,
  }, () => ({ status: CustomCommandStatus.Success, message: buildTagListMessage() }));
}

/** /mp:tag — 管理假人的 tag */
export function registerTagCommand(registry: any): void {
  defineCommand(registry, {
    name: "mp:tag",
    description: "管理假人的标签：add / remove / list",
    cheatsRequired: false, permissionLevel: CommandPermissionLevel.Any,
    mandatoryParameters: [
      { name: "name", type: CustomCommandParamType.String },
      { name: "action", type: CustomCommandParamType.String },
    ],
    optionalParameters: [{ name: "tagName", type: CustomCommandParamType.String }],
  }, ({ player, params }) => {
    const targetName = params.name as string;
    const action = (params.action as string)?.toLowerCase();
    const tagInput = params.tagName as string | undefined;
    if (!targetName || !action) { player.sendMessage("§c用法: /mp:tag <假人> <add|remove|list> [标签名]"); return; }

    const record = botRegistry.get(targetName);
    if (!record) { player.sendMessage(`§c未找到假人 §e${targetName}§c 的记录`); return; }

    // ── list ──
    if (action === "list") {
      const labels = record.tags.map(v => { const d = getTagDef(v); return d ? `§e${d.label}§7` : `§7${v}`; });
      player.sendMessage(labels.length ? `§a假人 §e${targetName}§a 的标签: ${labels.join(", ")}` : `§e假人 §e${targetName}§e 没有标签`);
      return;
    }

    if (!tagInput) { player.sendMessage(`§c请指定标签名，可用标签：\n${buildTagListMessage()}`); return; }

    const tagDef = resolveTag(tagInput);
    if (!tagDef) { player.sendMessage(`§c未知标签 "§e${tagInput}§c"\n${buildTagListMessage()}`); return; }

    // ── add ──
    if (action === "add") {
      if (record.tags.includes(tagDef.value)) { player.sendMessage(`§e假人 §e${targetName}§e 已有标签 §e${tagDef.label}`); return; }
      const newTags = EXCLUSIVE_SET.has(tagDef.value)
        ? [...record.tags.filter(t => !EXCLUSIVE_SET.has(t)), tagDef.value]
        : [...record.tags, tagDef.value];
      setTags(record, newTags);
      player.sendMessage(`§a已为假人 §e${targetName}§a 添加标签 §e${tagDef.label}`);
      return;
    }

    // ── remove ──
    if (action === "remove") {
      if (!record.tags.includes(tagDef.value)) { player.sendMessage(`§e假人 §e${targetName}§e 没有标签 §e${tagDef.label}`); return; }
      setTags(record, record.tags.filter(t => t !== tagDef.value));
      player.sendMessage(`§a已为假人 §e${targetName}§a 移除标签 §e${tagDef.label}`);
      return;
    }

    player.sendMessage(`§c未知操作 "§e${action}§c"，可用操作: add / remove / list`);
  });
}
