// ─── /mp:tags / /mp:tag — 标签管理 ─────────────────────

import {
  system,
  world,
  Player,
  CustomCommandStatus,
  CommandPermissionLevel,
  CustomCommandParamType,
} from "@minecraft/server";
import { BOT_TAG, EXCLUSIVE_SET, getTagDef, resolveTag, buildTagListMessage, syncEntityTags } from "../features/tags";
import { botRegistry, saveBotRecord } from "../features/persistence";

/** /mp:tags — 列出所有可用标签 */
export function registerTagsCommand(registry: any): void {
  registry.registerCommand(
    {
      name: "mp:tags",
      description: "列出所有可用的假人标签",
      cheatsRequired: false,
      permissionLevel: CommandPermissionLevel.Any,
    },
    () => {
      return { status: CustomCommandStatus.Success, message: buildTagListMessage() };
    }
  );
}

/** /mp:tag — 管理假人的 tag */
export function registerTagCommand(registry: any): void {
  registry.registerCommand(
    {
      name: "mp:tag",
      description: "管理假人的标签：add / remove / list",
      cheatsRequired: false,
      permissionLevel: CommandPermissionLevel.Any,
      mandatoryParameters: [
        { name: "name", type: CustomCommandParamType.String },
        { name: "action", type: CustomCommandParamType.String },
      ],
      optionalParameters: [{ name: "tagName", type: CustomCommandParamType.String }],
    },
    (origin: any, ...args: any[]) => {
      if (!origin.sourceEntity) return { status: CustomCommandStatus.Failure, message: "该命令只能由玩家执行" };
      const player = origin.sourceEntity as Player;
      const targetName = args[0] as string;
      const action = (args[1] as string)?.toLowerCase();
      const tagInput = args[2] as string | undefined;
      if (!targetName || !action)
        return { status: CustomCommandStatus.Failure, message: "用法: /mp:tag <假人> <add|remove|list> [标签名]" };

      system.run(() => {
        const record = botRegistry.get(targetName);
        if (!record) {
          player.sendMessage(`§c未找到假人 §e${targetName}§c 的记录`);
          return;
        }

        // ── list ──
        if (action === "list") {
          const tagLabels = record.tags.map((v) => {
            const def = getTagDef(v);
            return def ? `§e${def.label}§7` : `§7${v}`;
          });
          if (tagLabels.length === 0) player.sendMessage(`§e假人 §e${targetName}§e 没有标签`);
          else player.sendMessage(`§a假人 §e${targetName}§a 的标签: ${tagLabels.join(", ")}`);
          return;
        }

        if (!tagInput) {
          player.sendMessage(`§c请指定标签名，可用标签：\n${buildTagListMessage()}`);
          return;
        }

        const tagDef = resolveTag(tagInput);
        if (!tagDef) {
          player.sendMessage(`§c未知标签 "§e${tagInput}§c"\n${buildTagListMessage()}`);
          return;
        }

        // ── add ──
        if (action === "add") {
          if (record.tags.includes(tagDef.value)) {
            player.sendMessage(`§e假人 §e${targetName}§e 已有标签 §e${tagDef.label}`);
            return;
          }
          if (EXCLUSIVE_SET.has(tagDef.value)) record.tags = record.tags.filter((t) => !EXCLUSIVE_SET.has(t));
          record.tags.push(tagDef.value);
          if (record.online) {
            const entity = record.entityId ? world.getEntity(record.entityId) : undefined;
            if (entity) syncEntityTags(entity, record.tags);
          }
          botRegistry.set(record.name, record);
          saveBotRecord(record);
          player.sendMessage(`§a已为假人 §e${targetName}§a 添加标签 §e${tagDef.label}`);
          return;
        }

        // ── remove ──
        if (action === "remove") {
          if (!record.tags.includes(tagDef.value)) {
            player.sendMessage(`§e假人 §e${targetName}§e 没有标签 §e${tagDef.label}`);
            return;
          }
          record.tags = record.tags.filter((t) => t !== tagDef.value);
          if (record.online) {
            const entity = record.entityId ? world.getEntity(record.entityId) : undefined;
            if (entity) syncEntityTags(entity, record.tags);
          }
          botRegistry.set(record.name, record);
          saveBotRecord(record);
          player.sendMessage(`§a已为假人 §e${targetName}§a 移除标签 §e${tagDef.label}`);
          return;
        }

        player.sendMessage(`§c未知操作 "§e${action}§c"，可用操作: add / remove / list`);
      });
      return { status: CustomCommandStatus.Success, message: "§a正在处理标签操作..." };
    }
  );
}
