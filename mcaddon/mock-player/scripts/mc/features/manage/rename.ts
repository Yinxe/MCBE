// ─── 改名（BOT 主菜单 rename 动作，含数据安全迁移） ────
//
// 改名涉及的数据迁移：
//   1. 在线实体的 nameTag（Player.name 只读无法修改）
//   2. registry key 迁移（botRegistry.rename 内部完成内存 key 迁移 +
//      恢复标记随迁 + 持久化；NBT 绑定表随记录，无需迁移物品数据）
//
// ⚠️ Minecraft API 限制：Player.name 只读，实体内部标识不变。
//    不影响功能，仅头顶显示名和 registry key 更新。

import { Player, system, world } from "@minecraft/server";
import { color } from "@yinxe/toolkit";
import { ModalFormBuilder } from "@yinxe/toolkit";

import { isValidBotName, normalizeBotName } from "../../../model/Types";
import { BotUiEvent } from "../../../events/UiEvents";
import { isNameOccupiedInWorld } from "../../adapters/PlayerGateway";
import { botRegistry } from "../../bootstrap/context";

// ─── UI 事件订阅（BOT 主菜单 → 感知改名动作） ──────────

/** 订阅 BOT 主菜单动作事件：弹出改名表单并处理提交 */
export function registerUiSubscriptions(): void {
  BotUiEvent.panelAction.subscribe((e) => {
    if (e.action !== "rename") return;
    const player = world.getEntity(e.playerId) as Player | undefined;
    if (!player) return;
    doRename(player, e.botName);
  });
}

function doRename(player: Player, botName: string): void {
  ModalFormBuilder.showQuick(player, `${color.bold}修改名字`, (f) => {
    f.textField("name", "新名字", { defaultValue: botName, tooltip: "自动加假人前缀 $，无需手动输入" });
  }).then((vals) => {
    if (!vals) return;
    // 名字规范化：自动加假人前缀（"刷铁机" → "$刷铁机"）
    const newName = normalizeBotName(vals.name as string);
    if (!newName || newName === botName) return;
    // ⚠️ 名字合法性：长度限制（生成 "(2)" 重名防护边界）；NBT 存储绑定表随
    //    BotRecord 持久化，改名无需迁移物品数据（与旧 DP 槽位 key 无关）
    if (!isValidBotName(newName)) { player.sendMessage(`${color.error}名字不合法：不能为空、超过 16 字符或包含 ":inv:" / ":equip:"`); return; }
    if (botRegistry.has(newName)) { player.sendMessage(`${color.error}假人 ${color.playerName}${newName}${color.error} 已存在`); return; }
    // 真实玩家冲突检查（双重）：输入原始名 / 规范化完整名 与在线真人同名都拒绝
    const rawName = (vals.name as string).trim();
    if (rawName !== newName && isNameOccupiedInWorld(rawName)) {
      player.sendMessage(`${color.error}名字 ${color.playerName}${rawName}${color.error} 与真实玩家相同，请更换名字`);
      return;
    }
    if (isNameOccupiedInWorld(newName)) {
      player.sendMessage(`${color.error}世界中已存在同名玩家实体 ${color.playerName}${newName}${color.error}，请更换名字`);
      return;
    }

    const r = botRegistry.get(botName);
    if (!r) { player.sendMessage(`${color.error}假人已不存在`); return; }

    // ⚠️ 在线改名会导致 Player.name（只读）与 registry key 不一致，
    //    事件处理器（playerLeave、背包保存等）用 Player.name 查 registry 失败，
    //    造成数据泄露或写错前缀。
    if (r.online) { player.sendMessage(`${color.error}请先将假人下线后再改名`); return; }

    system.run(() => {
      try {
        // ── 1. 更新实体头顶显示名 ──
        // Player.name 只读无法修改，只改 nameTag（影响的头顶显示）
        if (r.online && r.entityId) {
          const entity = world.getEntity(r.entityId);
          if (entity) entity.nameTag = newName;
        }

        // ── 2. 改名（registry 内部完成内存 key 迁移 + 恢复标记随迁 + 持久化） ──
        // 背包/装备数据存 NBT 木桶阵列（绑定表随记录），无需迁移任何物品数据
        botRegistry.rename(botName, newName);

        player.sendMessage(`${color.success}已重命名为 ${color.playerName}${newName}`);
      } catch (e: any) { player.sendMessage(`${color.error}改名失败: ${e.message}`); }
    });
  });
}
