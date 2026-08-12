// ── NBT 存储测试（nds-demo）入口 ────────────────────────────────────
// @yinxe/nbt-data-storage 的游戏内演示 addon：
//   - Phase 3：注册 nds-demo:* 命令 + 库自带的 nds:regions/nds:stats 管理命令
//   - Phase 4：延迟初始化（DP 读取/区域注册需世界完全加载）
// 初始化后即可用命令或 UI 存入/取出物品（完整 NBT）。
import { system } from "@minecraft/server";
import { installNdsCommands } from "@yinxe/nbt-data-storage";
import { registerDemoCommands } from "./commands";
import { storage } from "./storageService";
import { VERSION } from "./version";

// ── Phase 3：注册事件与命令（无世界访问） ─────────────────────────────
system.beforeEvents.startup.subscribe((event) => {
  registerDemoCommands(event.customCommandRegistry);
});
// 库自带管理命令（幂等；多模组重复打包调用也安全）
installNdsCommands();

// ── Phase 4：延迟启动（dynamicProperty 需世界完全加载） ───────────────
system.run(() => {
  try {
    storage.init();
  } catch (e) {
    console.warn(`[nds-demo] 初始化失败 v${VERSION}`, e);
  }
});
