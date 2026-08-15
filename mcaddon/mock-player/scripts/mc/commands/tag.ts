import { CustomCommandStatus, CommandPermissionLevel, CustomCommandParamType } from "@minecraft/server";
import { defineCommand } from "@yinxe/toolkit";
import { color } from "@yinxe/toolkit";
import { BOT_TAG, EXCLUSIVE_SET, getTagDef, resolveTag, getTagGroups } from "../../tags/BotTags";
import { botRegistry } from "../bootstrap/context";
import { guardBotCommand } from "./auth";
import { setTags } from "../features/setTags";

/** 带色标签列表（core 只提供分组结构，渲染色码在 mc 层） */
function buildTagListMessage(): string {
  const { coexist, standalone, exclusive } = getTagGroups();
  const lines: string[] = [`${color.success}可用标签:`];
  const render = (group: string, tags: { label: string; value: string }[]): void => {
    lines.push(`${color.muted}━━ ${group} ────`);
    for (const t of tags) {
      lines.push(` ${color.playerName}${t.label}${color.muted} (${t.value})`);
    }
  };
  render("可共存", coexist);
  render("独立开关", standalone);
  render("互斥", exclusive);
  return lines.join("\n");
}

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
    if (!targetName || !action) { player.sendMessage(`${color.error}用法: /mp:tag <假人> <add|remove|list> [标签名]`); return; }

    const record = botRegistry.get(targetName);
    if (!record) { player.sendMessage(`${color.error}未找到假人 ${color.playerName}${targetName}${color.error} 的记录`); return; }

    // ── list（只读，放行） ──
    if (action === "list") {
      const labels = record.tags.map(v => { const d = getTagDef(v); return d ? `${color.playerName}${d.label}${color.muted}` : `${color.muted}${v}`; });
      player.sendMessage(labels.length ? `${color.success}假人 ${color.playerName}${targetName}${color.success} 的标签: ${labels.join(", ")}` : `${color.playerName}假人 ${color.playerName}${targetName}${color.playerName} 没有标签`);
      return;
    }

    // ── add / remove（修改操作，仅主人或管理员） ──
    const denied = guardBotCommand(player, targetName);
    if (denied) { player.sendMessage(`${color.error}${denied}`); return; }

    if (!tagInput) { player.sendMessage(`${color.error}请指定标签名，可用标签：\n${buildTagListMessage()}`); return; }

    const tagDef = resolveTag(tagInput);
    if (!tagDef) { player.sendMessage(`${color.error}未知标签 "${color.playerName}${tagInput}${color.error}"\n${buildTagListMessage()}`); return; }

    // ── add ──
    if (action === "add") {
      if (record.tags.includes(tagDef.value)) { player.sendMessage(`${color.playerName}假人 ${color.playerName}${targetName}${color.playerName} 已有标签 ${color.playerName}${tagDef.label}`); return; }
      const newTags = EXCLUSIVE_SET.has(tagDef.value)
        ? [...record.tags.filter(t => !EXCLUSIVE_SET.has(t)), tagDef.value]
        : [...record.tags, tagDef.value];
      const rejected = setTags(record, newTags);
      if (rejected) { player.sendMessage(`${color.error}${rejected}`); return; }
      player.sendMessage(`${color.success}已为假人 ${color.playerName}${targetName}${color.success} 添加标签 ${color.playerName}${tagDef.label}`);
      return;
    }

    // ── remove ──
    if (action === "remove") {
      if (!record.tags.includes(tagDef.value)) { player.sendMessage(`${color.playerName}假人 ${color.playerName}${targetName}${color.playerName} 没有标签 ${color.playerName}${tagDef.label}`); return; }
      setTags(record, record.tags.filter(t => t !== tagDef.value));
      player.sendMessage(`${color.success}已为假人 ${color.playerName}${targetName}${color.success} 移除标签 ${color.playerName}${tagDef.label}`);
      return;
    }

    player.sendMessage(`${color.error}未知操作 "${color.playerName}${action}${color.error}"，可用操作: add / remove / list`);
  });
}
