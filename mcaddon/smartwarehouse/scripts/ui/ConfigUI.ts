import { type Player, world } from "@minecraft/server";
import { ModalFormBuilder, ActionFormBuilder } from "./FormHelper";
import type { ModConfig, ModConfigStore } from "../storage/ModConfigStore";
import { TOKEN_OPTIONS, VOLUME_OPTIONS, CONTAINER_OPTIONS, GLOBAL_SPEED_OPTIONS } from "../storage/ModConfigStore";
import { ModuleController } from "../util/ModuleController";
import { WarehouseRepository } from "../storage/WarehouseRepository";
import { ROLE_LABELS, ROLE_ORDER } from "../types";

/**
 * 显示模组管理员面板（配置 + 总开关 + 全服统计）。
 */
export async function showConfigUI(player: Player, configStore: ModConfigStore): Promise<void> {
  const form = new ActionFormBuilder()
    .title("§eSmartWarehouse 管理")
    .body("§7选择操作")
    .button("模组配置", () => showModalConfig(player, configStore))
    .button("全服统计", () => showServerStats(player));

  // 总开关始终可见（即使模组关闭也能打开）
  const isOn = ModuleController.isEnabled();
  form.button(isOn ? "§c暂停分拣" : "§a恢复分拣", () => {
    ModuleController.setEnabled(!isOn);
    player.sendMessage(isOn ? "§c分拣系统已暂停" : "§a分拣系统已恢复");
  });

  await form.show(player);
}

async function showModalConfig(player: Player, configStore: ModConfigStore): Promise<void> {
  const config = configStore.load();
  const tokenIdx = TOKEN_OPTIONS.findIndex((o) => o.itemId === config.tokenItemId);
  const volIdx = VOLUME_OPTIONS.findIndex((o) => o.value === config.maxWarehouseVolume);
  const conIdx = CONTAINER_OPTIONS.findIndex((o) => o.value === config.maxContainers);
  const speedIdx = GLOBAL_SPEED_OPTIONS.findIndex((o) => o.value === config.globalSpeedLimit);

  const vals = await new ModalFormBuilder()
    .title("SmartWarehouse 配置")
    .label("info", "§7配置模组的全局设置")
    .dropdown(
      "token",
      "§a信物物品",
      TOKEN_OPTIONS.map((o) => o.label),
      {
        defaultValueIndex: Math.max(0, tokenIdx),
      }
    )
    .dropdown(
      "volume",
      "§a仓库最大体积",
      VOLUME_OPTIONS.map((o) => o.label),
      {
        defaultValueIndex: Math.max(0, volIdx),
      }
    )
    .dropdown(
      "containers",
      "§a单仓最大容器数",
      CONTAINER_OPTIONS.map((o) => o.label),
      {
        defaultValueIndex: Math.max(0, conIdx),
      }
    )
    .slider("maxWarehouses", "§a每玩家最多仓库数", 1, 5, { defaultValue: config.maxWarehousesPerPlayer })
    .dropdown(
      "speedLimit",
      "§a全局处理速度最快限制",
      GLOBAL_SPEED_OPTIONS.map((o) => o.label),
      {
        defaultValueIndex: Math.max(0, speedIdx),
      }
    )
    .show(player);

  if (!vals) return;

  const newConfig: ModConfig = {
    tokenItemId: TOKEN_OPTIONS[vals.token as number]?.itemId ?? null,
    maxWarehouseVolume: VOLUME_OPTIONS[vals.volume as number]?.value ?? 16384,
    maxContainers: CONTAINER_OPTIONS[vals.containers as number]?.value ?? 100,
    maxWarehousesPerPlayer: vals.maxWarehouses as number,
    globalSpeedLimit: GLOBAL_SPEED_OPTIONS[vals.speedLimit as number]?.value ?? null,
  };

  const newLimit = newConfig.globalSpeedLimit;
  if (config.globalSpeedLimit !== newLimit && newLimit !== null) {
    const repo = new WarehouseRepository();
    for (const w of repo.loadAll()) {
      if (w.settings.processingSpeed < newLimit) {
        w.settings.processingSpeed = newLimit as any;
        repo.saveMetaOnly(w);
      }
    }
    player.sendMessage("§7已调整所有仓库的处理速度以符合新限制");
  }

  configStore.save(newConfig);
  const tokenLabel = TOKEN_OPTIONS.find((o) => o.itemId === newConfig.tokenItemId);
  player.sendMessage(
    `§a配置已保存。信物: §e${tokenLabel?.label ?? "无"}§a` +
      `，每玩家最多 §f${newConfig.maxWarehousesPerPlayer}§a 个仓库`
  );
}

/** 全服统计面板 */
async function showServerStats(player: Player): Promise<void> {
  const repo = new WarehouseRepository();
  const all = repo.loadAll();

  // 构建玩家 ID→名称映射（在线玩家）
  const nameMap = new Map<string, string>();
  try {
    for (const p of world.getPlayers()) {
      nameMap.set(p.id, p.name);
    }
  } catch {
    /* 忽略 */
  }

  // 按玩家聚合
  const perPlayer = new Map<string, { name: string; warehouses: number; containers: number }>();
  for (const w of all) {
    const ownerId = w.ownerId || "";
    if (!ownerId) continue;
    const displayName = nameMap.get(ownerId) ?? ownerId.slice(-8);
    const entry = perPlayer.get(ownerId) ?? { name: displayName, warehouses: 0, containers: 0 };
    // 如果玩家在线，始终使用最新名字
    if (nameMap.has(ownerId)) entry.name = displayName;
    entry.warehouses++;
    entry.containers += Object.keys(w.containers).length;
    perPlayer.set(ownerId, entry);
  }

  const totalWH = all.length;
  const totalContainers = all.reduce((s, w) => s + Object.keys(w.containers).length, 0);

  const lines: string[] = [
    `§e=== SmartWarehouse 全服统计 ===`,
    `§7仓库总数: §f${totalWH}`,
    `§7容器总数: §f${totalContainers}`,
    `§7玩家数: §f${perPlayer.size}`,
    ``,
    `§e玩家排名（按仓库数）:`,
  ];

  const sorted = [...perPlayer.values()].sort((a, b) => b.warehouses - a.warehouses);

  for (const p of sorted) {
    lines.push(`  §7${p.name}: §f${p.warehouses}§7仓 §f${p.containers}§7箱`);
  }

  for (const line of lines) {
    player.sendMessage(line);
  }
}
