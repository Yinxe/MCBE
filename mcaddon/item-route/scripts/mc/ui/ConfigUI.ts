// ─── 模组配置：信物/全局开关/速度上限（仅管理员） ─────────
import { type Player } from "@minecraft/server";
import { ActionFormBuilder, ModalFormBuilder } from "@yinxe/toolkit";
import type { CommandDeps } from "../commands/deps";
import { TOKEN_OPTIONS } from "../storage/McModConfig";

const SPEED_OPTIONS = [4, 8, 16, 20, 30, 40];

export async function showConfigUI(player: Player, deps: CommandDeps): Promise<void> {
  const form = new ActionFormBuilder()
    .title("§e模组配置")
    .body(
      [
        `§7全局分拣：§f${deps.config.globalEnabled ? "§a开启" : "§c关闭"}`,
        `§7速度上限：§f${deps.config.globalSpeedLimit} tick/槽`,
        `§7信物：§f${deps.config.tokenItemId}`,
      ].join("\n")
    )
    .button("§f修改设置", () => void editConfig(player, deps))
    .button("§f全服统计", () => void serverStats(player, deps));
  await form.show(player);
}

async function editConfig(player: Player, deps: CommandDeps): Promise<void> {
  const tokenIndex = Math.max(0, TOKEN_OPTIONS.indexOf(deps.config.tokenItemId));
  const speedIndex = Math.max(0, SPEED_OPTIONS.indexOf(deps.config.globalSpeedLimit));
  const form = new ModalFormBuilder()
    .title("修改配置")
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
  player.sendMessage("§a配置已保存");
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
  player.sendMessage(`§e全服统计：§f${warehouses.length}§7 仓库 · §f${containerCount}§7 容器 · §f${totalItems}§7 物品`);
}