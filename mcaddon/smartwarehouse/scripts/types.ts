import type { Vector3 } from "@minecraft/server";

/**
 * 维度 ID（如 "minecraft:overworld"），用于标识容器所在的 Minecraft 世界维度
 */
export type DimensionId = string;

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
 * 容器角色，决定容器在仓库分类系统中的行为：
 * - "disabled": 禁用，不参与任何分类/存取
 * - "normal":   普通容器，按物品类型分类存放
 * - "misc":     杂项容器，存放未归类物品
 * - "bulk":     批量容器，用于大批量物品存储
 * - "input":    输入容器，系统优先将物品存入此类容器
 */
export type ContainerRole = "disabled" | "normal" | "misc" | "bulk" | "input";

/**
 * 仓库全局设置，控制仓库的行为开关和默认配置
 */
export interface WarehouseSettings {
  /** 新发现容器默认分配的角色 */
  defaultNewContainerRole: ContainerRole;
  /** 是否自动创建分类（根据物品类型自动归类） */
  autoCreateCategories: boolean;
  /** 仓库是否启用 */
  enabled: boolean;
  /** 是否输出调试日志 */
  debug: boolean;
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
  /** 仓库设置 */
  settings: WarehouseSettings;
  /**
   * 容器分片数量。为避免动态属性大小限制（约 32KB），
   * 容器数据被分割到多个分片中。此字段记录分片总数。
   */
  containerShardCount: number;
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
  /** 容器角色 */
  role: ContainerRole;
  /** 容器首次被发现的游戏刻时间戳 */
  discoveredAt: number;
  /** 容器信息最后更新的游戏刻时间戳 */
  updatedAt: number;
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
   * 轮询游标，用于在 input 容器之间轮询分配存入任务，
   * 避免总是使用同一个容器造成热点。
   */
  inputCursor: number;
  /** 最后一次重建索引的游戏刻时间戳 */
  lastBuiltAt: number;
  /**
   * "脏"标记。当仓库数据发生变更时设为 true，
   * 触发按需重建运行时索引，避免每次操作都重建。
   */
  dirty: boolean;
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
