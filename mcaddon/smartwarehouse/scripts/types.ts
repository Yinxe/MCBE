import type { Vector3 } from "@minecraft/server";

/**
 * 维度 ID（如 "minecraft:overworld"），用于标识容器所在的 Minecraft 世界维度
 */
export type DimensionId = string;

/**
 * 物品家族类型定义。每种家族包含一组互斥的物品 ID。
 */
export interface ItemFamily {
  /** 族 ID，用于持久化配置和索引 key */
  id: string;
  /** 中文显示名，用于 UI */
  displayName: string;
  /** 该族包含的所有物品 typeId */
  items: readonly string[];
}

/**
 * 仓库唯一标识符
 */
export type WarehouseId = string;

/**
 * 容器唯一标识符
 */
export type ContainerId = string;

/**
 * 方块坐标接口，表示 Minecraft 世界中的一个方块位置。
 * 使用整数坐标（通过 Math.floor 取整），与浮点数 Vector3 区分。
 */
export interface BlockLocation {
  x: number;
  y: number;
  z: number;
}

/**
 * 仓库区域范围，由两个对角方块坐标定义。
 * min 和 max 经过归一化处理，确保 min 各分量均小于等于 max。
 */
export interface WarehouseArea {
  /** 区域最小角坐标（各分量最小） */
  min: BlockLocation;
  /** 区域最大角坐标（各分量最大） */
  max: BlockLocation;
}

/**
 * 容器角色，决定容器在仓库分类系统中的分类行为：
 * - "normal":  普通容器，按物品类型自动分类存放已有同类物品
 * - "misc":    杂项容器，存放所有无法归类到普通容器的物品（兜底）
 * - "bulk":    批量容器，用于大批量同种物品的存储（不自动整理内部）
 * - "input":   输入容器，物品从此流入自动分拣系统
 *
 * 注意：容器是否启用（enabled/disabled）是独立于角色的状态，
 * 禁用容器不参与任何分拣操作。
 */
export type ContainerRole = "normal" | "misc" | "bulk" | "input";

/** 容器角色对应的中文描述文本 */
export const ROLE_DESCRIPTIONS: Record<ContainerRole, string> = {
  normal: "多物品分类",
  misc: "存储无法归类的物品",
  bulk: "单物品分类",
  input: "物品从此流入自动分拣系统",
};

/** 容器角色对应的中文标签 */
export const ROLE_LABELS: Record<ContainerRole, string> = {
  normal: "普通仓位",
  misc: "其他仓位",
  bulk: "大宗仓位",
  input: "输入",
};

/** 所有角色的有序列表，用于 UI 下拉选项的顺序 */
export const ROLE_ORDER: ContainerRole[] = ["input", "normal", "misc", "bulk"];

/**
 * 仓库处理速度选项，单位为游戏刻（tick）。
 * 值越小处理越频繁，但服务器负载越高。
 */
export type ProcessingSpeed = 4 | 8 | 16 | 20;

/** 处理速度对应的中文标签 */
export const SPEED_LABELS: Record<ProcessingSpeed, string> = {
  4: "极速（4 tick）",
  8: "快速（8 tick）",
  16: "标准（16 tick）",
  20: "慢速（20 tick）",
};

/** 默认处理速度 */
export const DEFAULT_PROCESSING_SPEED: ProcessingSpeed = 8;

/**
 * 仓库附近检测范围（格）。
 * 用于判断玩家是否在仓库附近：包括主菜单"就近管理"、搜索命令的附近筛选、
 * 以及分拣调度器的玩家接近激活检测。
 */
export const WAREHOUSE_NEARBY_MARGIN = 8;

/**
 * 仓库全局设置，控制仓库的行为开关和默认配置
 */
export interface WarehouseSettings {
  /** 新发现容器默认分配的角色 */
  defaultNewContainerRole: ContainerRole;
  /** 新发现的容器默认是否启用 */
  defaultNewContainerEnabled: boolean;
  /** 是否自动创建分类（根据物品类型自动归类） */
  autoCreateCategories: boolean;
  /** 仓库是否启用 */
  enabled: boolean;
  /** 仓库处理速度（游戏刻间隔） */
  processingSpeed: ProcessingSpeed;
  /** 是否输出调试日志 */
  debug: boolean;
  /** 是否显示仓库边界光幕 */
  showBoundary: boolean;
  /**
   * 自动整理混乱度阈值（0-100）。
   * 0 = 关闭；>0 时，容器混乱度超过此值则自动触发整理。
   */
  autoSortThreshold: number;
  /**
   * 已启用的同族物品分类 ID 列表。
   * 当分拣引擎遇到属于这些族的物品时，优先路由到已有同类族物品的容器。
   */
  enabledFamilies: string[];
  /**
   * 是否启用容量预警（总开关）。
   * 开启后，当分拣引擎向容量快满的容器放入物品时，或物品因容器满被降级时，
   * 会向附近的玩家发送预警消息。
   */
  capacityWarning: boolean;
}

/**
 * 仓库索引 - 顶层存储结构，记录所有仓库的 ID 列表。
 * 存储在动态属性中，用于启动时加载所有仓库。
 */
export interface WarehouseIndex {
  /** 数据格式版本号，用于未来迁移 */
  version: 1;
  /** 所有仓库的 ID 列表 */
  warehouses: WarehouseId[];
}

/**
 * 仓库元数据，记录仓库的基本信息和配置。
 * 每个仓库对应一个 WarehouseMeta，存储在独立的动态属性键中。
 */
export interface WarehouseMeta {
  /** 数据格式版本号 */
  version: 1;
  /** 仓库唯一 ID */
  id: WarehouseId;
  /** 仓库显示名称（玩家可读） */
  displayName: string;
  /** 仓库所在的维度 ID */
  dimensionId: DimensionId;
  /** 仓库覆盖的方块区域 */
  area: WarehouseArea;
  /** 仓库所有者的玩家 ID */
  ownerId: string;
  /** 仓库设置 */
  settings: WarehouseSettings;
  /**
   * 容器分片数量。为避免动态属性大小限制（约 32KB），
   * 容器数据被分割到多个分片中。此字段记录分片总数。
   */
  containerShardCount: number;
  /**
   * 容器总数。冗余存储在 meta 中，用于 `load()` 时的完整性校验。
   * 与各分片中实际容器数量之和对比，不一致说明数据已损坏。
   */
  containerCount: number;
  /**
   * 分片写入世代号。每次 `save()` 递增，写入新的分片键后更新 meta。
   * 崩溃恢复时，旧世代的分片数据不会被新数据覆盖，保证一致性。
   */
  containerShardGeneration: number;
}

/**
 * 已存储的容器数据，记录单个容器的所有持久化信息。
 */
export interface StoredContainer {
  /** 容器唯一 ID */
  id: ContainerId;
  /** 容器所在维度 */
  dimensionId: DimensionId;
  /** 容器的主要位置（用于去重和索引的基准坐标） */
  primaryLocation: BlockLocation;
  /** 容器占用的所有方块位置（可能有多格容器，如大箱子） */
  occupiedLocations: BlockLocation[];
  /** 容器角色（影响分类行为） */
  role: ContainerRole;
  /** 容器是否启用（禁用容器不参与任何分拣操作，独立于角色） */
  enabled: boolean;
  /** 独立容量预警开关（默认开，受仓库级总开关控制） */
  capacityWarningEnabled: boolean;
  /** 容器首次被发现的游戏刻时间戳 */
  discoveredAt: number;
  /** 容器信息最后更新的游戏刻时间戳 */
  updatedAt: number;
}

/**
 * 单个容器的运行时统计（用于容量概览展示，持久化到 Dynamic Property）。
 */
export interface ContainerStats {
  /** 容器 ID */
  containerId: ContainerId;
  /** 方块类型（如 chest、barrel） */
  blockType: string;
  /** 容器角色 */
  role: ContainerRole;
  /** 总槽位数 */
  totalSlots: number;
  /** 已使用槽位数 */
  usedSlots: number;
  /** 物品总数量 */
  totalItems: number;
  /** 物品种类数 */
  uniqueTypes: number;
  /** 是否处于容量告急状态（已用槽位占比 >= 80%） */
  isWarning: boolean;
}

/**
 * 仓库容器分片 - 将容器数据按分片存储，以规避动态属性的大小限制。
 * 每个分片包含一部分容器，通过 shardIndex 标识分片序号。
 */
export interface WarehouseContainerShard {
  /** 数据格式版本号 */
  version: 1;
  /** 所属仓库 ID */
  warehouseId: WarehouseId;
  /** 分片索引（从 0 开始） */
  shardIndex: number;
  /** 该分片中的容器映射表，key 为容器 ID */
  containers: Record<ContainerId, StoredContainer>;
}

/**
 * 完整的仓库数据（元数据 + 所有容器），用于一次性加载或导出。
 * 注意：此接口不用于持久化，仅用于运行时内存中的完整数据聚合。
 */
export interface WarehouseData extends WarehouseMeta {
  /** 仓库中所有容器的映射表 */
  containers: Record<ContainerId, StoredContainer>;
}

/**
 * 运行时容器信息，在 StoredContainer 基础上增加了运行时状态字段。
 * 用于追踪容器在运行时的访问状态，不持久化到磁盘。
 */
export interface RuntimeContainer extends StoredContainer {
  /** 上一次访问失败的 tick 时间戳，用于失败重试和故障检测 */
  lastAccessFailedAt?: number;
}

/**
 * 仓库运行时模型，在内存中维护仓库的所有运行时数据。
 * 包括容器索引、角色分类索引、物品类型索引等，用于高效查询和分拣。
 */
export interface WarehouseRuntimeModel {
  /** 仓库 ID */
  warehouseId: WarehouseId;
  /** 容器 ID → 运行时容器的映射 */
  containersById: Map<ContainerId, RuntimeContainer>;
  /** 位置键（dimensionId|x|y|z）→ 容器 ID 的映射，用于快速通过坐标查找容器 */
  occupiedLocationIndex: Map<string, ContainerId>;
  /** 角色为 "input" 的容器 ID 列表 */
  inputContainerIds: ContainerId[];
  /** 角色为 "normal" 的容器 ID 列表 */
  normalContainerIds: ContainerId[];
  /** 角色为 "misc" 的容器 ID 列表 */
  miscContainerIds: ContainerId[];
  /** 角色为 "bulk" 的容器 ID 列表 */
  bulkContainerIds: ContainerId[];
  /** 角色为 "disabled" 的容器 ID 列表 */
  disabledContainerIds: ContainerId[];
  /**
   * 物品类型 → 容器 ID 列表的索引。
   * 用于快速找到存储特定物品类型的容器，key 为物品类型 ID。
   */
  itemTypeIndex: Map<string, ContainerId[]>;

  /**
   * 同族物品分类 → 容器 ID 列表的索引。
   * 用于快速找到存储某个同族分类物品的容器，key 为族 ID。
   * 由分拣引擎在放置物品时惰性构建。
   */
  familyTypeIndex: Map<string, ContainerId[]>;

  /**
   * 轮询游标，用于在 input 容器之间轮询分配存入任务，
   * 避免总是使用同一个容器造成热点。
   */
  inputCursor: number;

  /**
   * 每个输入容器当前处理的槽位游标（容器 ID → 槽位索引）。
   * 每次 interval 仅处理该游标指向的一个槽位，处理完毕后游标 +1。
   * 当游标超出容器大小时回绕到 0。
   * 配合 processingSpeed 实现"每 interval 分拣一个物品"的效果。
   */
  inputSlotCursors: Map<ContainerId, number>;
  /** 最后一次重建索引的游戏刻时间戳 */
  lastBuiltAt: number;
  /**
   * "脏"标记。当仓库数据发生变更时设为 true，
   * 触发按需重建运行时索引，避免每次操作都重建。
   */
  dirty: boolean;

  /**
   * 上一次检查仓库区域所在区块是否已加载的游戏刻。
   * 与 `inputCursor` 配合使用，每 40 tick 约 2 秒检查一次，避免每 tick 都采样。
   */
  areaLoadedCheckedTick: number;

  /**
   * 缓存的上一次区域加载检查结果。
   * - `true`：所有采样点均位于已加载区块
   * - `false`：至少有一个采样点在未加载区块
   * - `undefined`：尚未检查
   */
  areaLoaded: boolean | undefined;

}

/**
 * 选区会话状态，用于记录玩家正在进行的方块选区操作。
 * 支持两种操作：创建仓库和调整仓库大小。
 */
export type SelectionSession =
  | {
      /** 选区类型：创建新仓库 */
      type: "createWarehouse";
      /** 玩家指定的仓库名称 */
      warehouseName: string;
      /** 新容器的默认角色 */
      defaultNewContainerRole: ContainerRole;
      /** 新容器默认是否启用 */
      defaultNewContainerEnabled: boolean;
      /** 选区的第一个角点坐标（未设置时为 undefined） */
      pointA?: BlockLocation;
    }
  | {
      /** 选区类型：调整已有仓库的大小 */
      type: "resizeWarehouse";
      /** 要调整的仓库 ID */
      warehouseId: WarehouseId;
      /** 选区的第一个角点坐标（未设置时为 undefined） */
      pointA?: BlockLocation;
    };

/**
 * 将 Minecraft 的 Vector3（浮点数坐标）转换为 BlockLocation（整数方块坐标）。
 * 使用 Math.floor 向下取整，确保与方块网格对齐。
 *
 * @param vector - Minecraft 的 Vector3 坐标
 * @returns 对应的方块坐标
 */
export function toBlockLocation(vector: Vector3): BlockLocation {
  return { x: Math.floor(vector.x), y: Math.floor(vector.y), z: Math.floor(vector.z) };
}
