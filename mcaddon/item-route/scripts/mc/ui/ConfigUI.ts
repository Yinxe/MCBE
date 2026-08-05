// ─── 模组配置：信物/全局开关/速度上限（仅管理员） ─────────
import { type Player } from "@minecraft/server";
import { ActionFormBuilder, ModalFormBuilder } from "@yinxe/toolkit";
import type { CommandDeps } from "../commands/deps";
import { TOKEN_OPTIONS } from "../storage/McModConfig";
import * as uiColor from "./uiColor";

const SPEED_OPTIONS = [4, 8, 16, 20, 30, 40];

export async function showConfigUI(player: Player, deps: CommandDeps): Promise<void> {
  // 按钮文字深色（ActionForm 浅灰按钮背景）
  const form = new ActionFormBuilder()
    .title(`${uiColor.form.title}模组配置`)
    .body(
      [
        `${uiColor.form.muted}全局分拣：${deps.config.globalEnabled ? uiColor.form.success + "开启" : uiColor.form.error + "关闭"}`,
        `${uiColor.form.muted}速度上限：${uiColor.form.body}${deps.config.globalSpeedLimit} tick/槽`,
        `${uiColor.form.muted}信物：${uiColor.form.body}${deps.config.tokenItemId}`,
      ].join("\n")
    )
    .button(`${uiColor.btn.primary}修改设置`, () => void editConfig(player, deps))
    .button(`${uiColor.btn.info}全服统计`, () => void serverStats(player, deps));
  await form.show(player);
}

async function editConfig(player: Player, deps: CommandDeps): Promise<void> {
  const tokenIndex = Math.max(0, TOKEN_OPTIONS.indexOf(deps.config.tokenItemId));
  const speedIndex = Math.max(0, SPEED_OPTIONS.indexOf(deps.config.globalSpeedLimit));
  const form = new ModalFormBuilder()
    .title(`${uiColor.form.title}修改配置`)
    .toggle("globalEnabled", "全局分拣", { defaultValue: deps.config.globalEnabled })
    .dropdown("token", "信物", TOKEN_OPTIONS, { defaultValueIndex: tokenIndex })
    .dropdown(
      "speed",
      "全局速度上限",
      SPEED_OPTIONS.map((s) => `${s} tick`),
      { defaultValueIndex: speedIndex >= 0 ? speedIndex : 3 }
    );
  const values = await form.show(player);
  if (!values) return;
  deps.route.setGlobalEnabled(values.globalEnabled as boolean);
  deps.config.setGlobalSpeedLimit(SPEED_OPTIONS[values.speed as number] ?? 20);
  deps.config.setTokenItemId(TOKEN_OPTIONS[values.token as number] ?? TOKEN_OPTIONS[0]!);
  player.sendMessage(`${uiColor.chat.success}配置已保存`);
}

function serverStats(player: Player, deps: CommandDeps): void {
  const warehouses = deps.loadedWarehouses();
  let containerCount = 0;
  let totalItems = 0;
  for (const w of warehouses) {
    const s = deps.stats.getWarehouseStats(w);
    containerCount += s.containerCount;
    totalItems += s.totalItems;
  }
  player.sendMessage(
    `${uiColor.chat.warn}全服统计：${uiColor.chat.info}${warehouses.length}${uiColor.chat.muted} 仓库 · ${uiColor.chat.info}${containerCount}${uiColor.chat.muted} 容器 · ${uiColor.chat.info}${totalItems}${uiColor.chat.muted} 物品`
  );
}