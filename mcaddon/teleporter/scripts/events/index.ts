import { subscribeDeathEvent } from "./death";
import { subscribeSpawnEvent } from "./spawn";
import { subscribeItemUseEvent } from "../teleporter/token";

/**
 * 注册所有事件订阅。
 */
export function registerAllEvents(): void {
  subscribeDeathEvent();
  subscribeSpawnEvent();
  subscribeItemUseEvent();
}
