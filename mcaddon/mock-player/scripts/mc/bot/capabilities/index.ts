// ─── 能力注册表（mc/bot/capabilities） ────────────────
// 每个 MockBot 构造时 installDefaultCapabilities 安装全部默认能力。
// **可扩展**：新增持续能力 = 写一个工厂文件 + 在此注册一行，所有假人自动获得。

import type { BotCapability } from "../../../core/bot/Engine";
import type { MockBot } from "../MockBot";
import { autoMineCapability } from "./AutoMine";
import { autoAttackCapability } from "./AutoAttack";
import { autoJumpCapability } from "./AutoJump";
import { controlCapability } from "./Control";
import { autoPlaceCapability } from "./AutoPlace";
import { persistCapability } from "./Persist";

/** 能力工厂签名：由 MockBot 实例构造（闭包访问实体/记录） */
export type CapabilityFactory = (bot: MockBot) => BotCapability;

/** 默认能力注册表（按注册顺序安装） */
const defaultFactories: CapabilityFactory[] = [
  autoMineCapability,
  autoAttackCapability,
  autoJumpCapability,
  controlCapability,
  autoPlaceCapability,
  persistCapability,
];

/** 安装默认能力到假人引擎（MockBot 构造时调用一次） */
export function installDefaultCapabilities(bot: MockBot): void {
  for (const factory of defaultFactories) {
    bot.engine.addCapability(factory(bot));
  }
}
