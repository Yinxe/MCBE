import { system } from "@minecraft/server";
import { CommandRouter } from "./commands/CommandRouter";
import { registerToolInteraction } from "./interaction/ToolInteractionController";
import { SlotOrganizer } from "./organize/SlotOrganizer";
import { WarehouseRuntimeRegistry } from "./runtime/WarehouseRuntimeRegistry";
import { SorterEngine } from "./sorting/SorterEngine";
import { SortingScheduler } from "./sorting/SortingScheduler";
import { ModConfigStore } from "./storage/ModConfigStore";
import { WarehouseRepository } from "./storage/WarehouseRepository";
import { BoundaryDisplay } from "./warehouse/BoundaryDisplay";
import { WarehouseService } from "./warehouse/WarehouseService";

const VERSION = "v0.0.49";
const GITHUB_URL = "https://github.com/YinxSmartHouse/SmartWarehouse";

// ═══════════════════════════════════════════════════════════════════
// Phase 1: 无状态基础设施（不依赖其他 SmartWarehouse 模块）
// ═══════════════════════════════════════════════════════════════════

console.warn(`[SmartWarehouse] ${VERSION} 正在启动...`);
console.warn(`[SmartWarehouse] 项目地址: ${GITHUB_URL}`);

const configStore = new ModConfigStore(); // 模组全局配置：信物 ID、体积上限等
const repository = new WarehouseRepository(); // 数据持久层：从动态属性读写仓库数据
const runtime = new WarehouseRuntimeRegistry(repository); // 运行时缓存层：内存中的仓库索引
const organizer = new SlotOrganizer(); // 容器整理器：混乱度评分 + 自动整理

console.warn(`[SmartWarehouse] Phase 1/4 ✓ 基础设施加载完毕`);

// ═══════════════════════════════════════════════════════════════════
// Phase 2: 有状态业务逻辑（依赖 Phase 1 的产出）
// ═══════════════════════════════════════════════════════════════════

// 分拣引擎 + 调度器：实现"输入容器 → 存储容器"的自动归类
const engine = new SorterEngine(repository, runtime, organizer);
const scheduler = new SortingScheduler(repository, engine);

// 边界显示：为 showBoundary 仓库渲染粒子光幕
const boundaryDisplay = new BoundaryDisplay(configStore);

// 核心业务服务 —— 需要三个回调将变更传播到相关模块：
//   markDirty → 通知运行时缓存失效，下次分拣前重建索引
//   refreshOne → 通知调度器刷新 interval（启用/禁用/速度变更时）
const notifyDirty = (id: string) => runtime.markDirty(id);
const notifyScheduler = (id: string) => scheduler.refreshOne(id);
// 第三个参数（scanner）省略，使用 WarehouseService 默认的 ContainerScanner
const service = new WarehouseService(repository, configStore, undefined, notifyDirty, notifyScheduler, boundaryDisplay);

console.warn(`[SmartWarehouse] Phase 2/4 ✓ 业务逻辑层就绪`);

// ═══════════════════════════════════════════════════════════════════
// Phase 3: 注册事件监听与自定义命令
// ═══════════════════════════════════════════════════════════════════

// 方块放置/破坏 → 增量更新仓库容器
service.registerBlockMaintenance();

// 手持信物右键交互 → 选区/菜单
registerToolInteraction(repository, service, configStore);

// 自定义命令 sw:create / sw:resize / sw:rescan / sw:delete 等
const commandRouter = new CommandRouter(service, repository, configStore);
commandRouter.register();

console.warn(`[SmartWarehouse] Phase 3/4 ✓ 事件与命令已注册`);

// ═══════════════════════════════════════════════════════════════════
// Phase 4: 延迟启动（dynamicProperty 需要世界完全加载后才能访问）
// ═══════════════════════════════════════════════════════════════════

system.runTimeout(() => {
  // 启动分拣调度器的生命周期监控
  scheduler.start();

  // 为已启用 showBoundary 的仓库启动粒子渲染
  for (const w of repository.loadAll()) {
    if (w.settings.showBoundary) {
      boundaryDisplay.start(w.id, w.area, w.dimensionId);
    }
  }

  console.warn(`[SmartWarehouse] Phase 4/4 ✓ 调度与渲染已启动`);
  console.warn(`[SmartWarehouse] ${VERSION} 加载完成`);
  console.warn(`[SmartWarehouse] ${GITHUB_URL}`);
}, 20 * 5);
