import { system } from "@minecraft/server";
import { CommandRouter } from "./commands/CommandRouter";
import { registerToolInteraction } from "./interaction/ToolInteractionController";
import { WarehouseRuntimeRegistry } from "./runtime/WarehouseRuntimeRegistry";
import { SlotOrganizer } from "./sorting/SlotOrganizer";
import { SorterEngine } from "./sorting/SorterEngine";
import { SortingScheduler } from "./sorting/SortingScheduler";
import { WarehouseRepository } from "./storage/WarehouseRepository";
import { ModConfigStore } from "./storage/ModConfigStore";
import { WarehouseService } from "./warehouse/WarehouseService";
import { BoundaryDisplay } from "./warehouse/BoundaryDisplay";

// ── 系统初始化（在脚本启动时执行一次）───────────────────

// 模组全局配置：信物 ID 等
const configStore = new ModConfigStore();

// 数据持久层：负责从 Minecraft 动态属性中读写仓库数据
const repository = new WarehouseRepository();

// 运行时缓存层：在内存中维护仓库索引，提供高性能查询
const runtime = new WarehouseRuntimeRegistry(repository);

// 容器整理器：负责混乱度评分和自动整理
const organizer = new SlotOrganizer();

// 分拣引擎：负责计算物品应存入哪个容器，以及执行实际的物品转移操作
const engine = new SorterEngine(repository, runtime, organizer);

// 分拣调度器：按固定间隔触发分拣引擎，实现自动分类功能
const scheduler = new SortingScheduler(repository, engine);

// 边界显示：为启用了 showBoundary 的仓库渲染粒子光幕（依赖信物配置）
const boundaryDisplay = new BoundaryDisplay(configStore);

// 核心业务服务层：负责仓库创建、删除、容器扫描等业务逻辑。
// 第三个参数为脏标记回调函数：当仓库数据发生变更时通知运行时标记为脏（dirty），
// 以便后续按需重建运行时索引。
// 第四个参数为调度刷新回调：当仓库启用/禁用/速度变化/删除时通知调度器刷新 interval。
// 第五个参数为边界显示实例：showBoundary 开关变化时自动启停粒子渲染。
const service = new WarehouseService(
  repository,
  undefined,
  (id) => runtime.markDirty(id),
  (id) => scheduler.refreshOne(id),
  boundaryDisplay
);

// 注册方块放置/破坏事件监听：当仓管区域内的方块发生变化时，自动标记运行时索引为脏
service.registerBlockMaintenance();

// 注册工具交互事件：玩家手持信物右键点击方块时触发选区操作
registerToolInteraction(repository, service, configStore);

// 注册自定义指令：包括 sw:create（创建仓库）、sw:resize（调整大小）、
// sw:rescan（重新扫描）、sw:delete（删除仓库）等
const commandRouter = new CommandRouter(service, repository, configStore);
commandRouter.register();

// 延迟到下一 tick 启动调度，因为 dynamicProperty 在脚本早期执行阶段不可用
// （world.getDynamicProperty 只能在世界完全加载后调用）
system.run(() => {
  scheduler.startAll();

  // 为已启用 showBoundary 的仓库启动边界显示
  const warehouses = repository.loadAll();
  for (const w of warehouses) {
    if (w.settings.showBoundary) {
      boundaryDisplay.start(w.id, w.area, w.dimensionId);
    }
  }
});

console.warn("[SmartWarehouse] 加载完成");
