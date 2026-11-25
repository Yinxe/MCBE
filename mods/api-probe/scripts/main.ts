// ─── API 探针:开发期读取容器真实 Script API 数据 ────────────────
//
// 入口只做一件事:注册各条命令。真正的读取、绘制与表单逻辑在各自模块里。
// 这里的启动日志用于确认行为包确实被游戏加载。

import { registerProbeCommand } from "./ProbeCommand";
import { registerBoxCommand } from "./BoxCommand";
import { registerDebugCommands } from "./DebugCommand";
import { registerDebugProbeCommands } from "./DebugProbeCommands";

console.log("[api-probe] 启动");

registerProbeCommand();
registerBoxCommand();
registerDebugCommands();
registerDebugProbeCommands();
