import { world } from "@minecraft/server";
import { ModConfig, DEFAULT_CONFIG } from "./types";

// ─── Key ────────────────────────────────────────────────────────────

const CONFIG_KEY = "teleporter:config";

// ─── 加载配置 ───────────────────────────────────────────────────────

export function loadConfig(): ModConfig {
  try {
    const raw = world.getDynamicProperty(CONFIG_KEY);
    if (typeof raw !== "string") return { ...DEFAULT_CONFIG };
    return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

// ─── 保存配置 ───────────────────────────────────────────────────────

export function saveConfig(config: ModConfig): void {
  try {
    world.setDynamicProperty(CONFIG_KEY, JSON.stringify(config));
  } catch (e: any) {
    console.warn(`[Teleporter] 保存配置失败: ${e.message}`);
  }
}
