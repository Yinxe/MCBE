import { CommandRouter } from "./commands/CommandRouter";
import { registerToolInteraction } from "./interaction/ToolInteractionController";
import { WarehouseRuntimeRegistry } from "./runtime/WarehouseRuntimeRegistry";
import { SorterEngine } from "./sorting/SorterEngine";
import { SortingScheduler } from "./sorting/SortingScheduler";
import { WarehouseRepository } from "./storage/WarehouseRepository";
import { WarehouseService } from "./warehouse/WarehouseService";

// ── 系统初始化（在脚本启动时执行一次）───────────────────

// 数据持久层：负责从 Minecraft 动态属性中读写仓库数据
const repository = new WarehouseRepository();

// 运行时缓存层：在内存中维护仓库索引，提供高性能查询
const runtime = new WarehouseRuntimeRegistry(repository);

// 核心业务服务层：负责仓库创建、删除、容器扫描等业务逻辑。
// 第三个参数为脏标记回调函数：当仓库数据发生变更时通知运行时标记为脏（dirty），
// 以便后续按需重建运行时索引。
const service = new WarehouseService(repository, undefined, (id) => runtime.markDirty(id));

// 分拣引擎：负责计算物品应存入哪个容器，以及执行实际的物品转移操作
const engine = new SorterEngine(repository, runtime);

// 分拣调度器：按固定间隔触发分拣引擎，实现自动分类功能
const scheduler = new SortingScheduler(repository, engine);

// 注册方块放置/破坏事件监听：当仓管区域内的方块发生变化时，自动标记运行时索引为脏
service.registerBlockMaintenance();

// 注册工具交互事件：玩家手持木锄右键点击方块时触发选区操作
registerToolInteraction(service);

// 注册自定义指令：包括 sw:create（创建仓库）、sw:resize（调整大小）、
// sw:rescan（重新扫描）、sw:delete（删除仓库）等
const commandRouter = new CommandRouter(service);
commandRouter.register();

// 启动分拣调度器，开始定期执行自动分类任务
scheduler.start();

console.warn("[SmartWarehouse] 加载完成");
