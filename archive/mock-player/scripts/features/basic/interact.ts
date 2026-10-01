// ─── 定点自动交互特征：只操作假人当前准星命中的目标 ─────────────
// 方块优先；没有准星方块时交给 SimulatedPlayer.interact() 处理准星实体。
// 不扫描附近实体，不缓存目标；每次尝试前重新读取当前视线。
import { system } from "@minecraft/server";
import { SimulatedPlayer } from "@minecraft/server-gametest";
import { BotUiEvent } from "../../events/UiEvents";
import { BotEvents } from "../../events/DomainEvents";
import { botRegistry } from "../../bootstrap/context";
import { resolveBotPlayer } from "../../bot/PlayerGateway";
import type { BotRecord } from "../../rules/Types";

// 玩家正常操作的最短交互节奏：4 tick ≈ 200ms。
// 每 tick 连续调用会快过引擎/方块交互状态的处理速度，导致交互被吞掉。
const PLAYER_INTERACT_INTERVAL_TICKS = 4;
const autoNames = new Set<string>();

function interactOnce(record: BotRecord): boolean {
  const bot = resolveBotPlayer(record.name) as SimulatedPlayer | undefined;
  if (!bot || !bot.isValid) return false;
  try {
    // SimulatedPlayer.interact() 使用官方头部射线，并交互射线上的第一个方块或实体。
    // 这样实体挡在方块前面时不会误交互后方方块，也不会进行周围搜索。
    return bot.interact();
  } catch {
    return false;
  }
}

function syncAutoInteract(botName: string): void {
  const record = botRegistry.get(botName);
  if (!record || record.workMode !== "autoInteract") {
    autoNames.delete(botName);
    return;
  }
  if (autoNames.has(botName)) return;
  autoNames.add(botName);
  system.runTimeout(() => runAutoInteract(botName), botRegistry.get(botName)?.actionIntervalTicks ?? PLAYER_INTERACT_INTERVAL_TICKS);
}

function runAutoInteract(botName: string): void {
  if (!autoNames.has(botName)) return;
  const record = botRegistry.get(botName);
  if (!record || record.workMode !== "autoInteract") {
    autoNames.delete(botName);
    return;
  }
  interactOnce(record);
  system.runTimeout(() => runAutoInteract(botName), botRegistry.get(botName)?.actionIntervalTicks ?? PLAYER_INTERACT_INTERVAL_TICKS);
}
export function registerUiSubscriptions(): void {
  BotUiEvent.panelAction.subscribe((e) => {
    if (e.action !== "interact") return;
    const record = botRegistry.get(e.botName);
    if (record) interactOnce(record);
  });
  BotUiEvent.behaviorSubmitted.subscribe((e) => syncAutoInteract(e.botName));
  BotEvents.botWorkModeChanged.subscribe((e) => syncAutoInteract(e.botName));
  BotEvents.botOnline.subscribe((e) => syncAutoInteract(e.botName));
  BotEvents.botOffline.subscribe((e) => autoNames.delete(e.botName));
}