# SmartWarehouse — 智能仓库

Minecraft Bedrock 智能仓库管理 Add-On，自动分拣、容器整理、仓库统计。

> 通用代码规范请参考根目录 `CLAUDE.md`。

---

## 架构

```
scripts/
├── main.ts              # 入口
├── commands/
│   └── CommandRouter.ts # 命令路由（sw:create, sw:list 等）
├── data/
│   ├── ItemFamilies.ts  # 51 个家族 / 1431 物品（自动生成）
│   └── name-maps/       # 中文名映射（物品/实体/效果/附魔）
├── interaction/
│   └── ToolInteractionController.ts  # 木锄交互
├── organize/
│   └── SlotOrganizer.ts # 容器整理器（三段式 API：analyze → apply → organize）
├── runtime/
│   └── WarehouseRuntimeRegistry.ts    # 运行时缓存（脏标记 + 惰性重建）
├── sorting/
│   ├── SorterEngine.ts           # 分拣引擎（5 级优先级路由）
│   ├── SortingScheduler.ts       # 分拣调度器（惰性生命周期 + 邻近检测）
│   ├── SortingIndexManager.ts    # 物品索引（itemTypeIndex / familyTypeIndex）
│   ├── CapacityWarningService.ts # 三级容量预警（黄/红/深红）
│   ├── ContainerInventory.ts     # 容器物品操作
│   ├── ContainerSnapshot.ts      # 容器快照（用于回滚）
│   ├── MoveJournal.ts            # 分拣事务日志
│   └── SortEffects.ts            # 分拣粒子/音效
├── storage/
│   ├── DynamicPropertyStore.ts   # Dynamic Property 读写
│   ├── WarehouseRepository.ts    # 仓库数据仓储
│   ├── WarehouseStatsStore.ts    # 容量统计持久化
│   └── ModConfigStore.ts         # 模组配置
├── ui/                   # ActionForm/ModalForm UI
├── util/                 # 工具函数
└── warehouse/            # 核心业务
    ├── WarehouseService.ts     # 仓库 CRUD
    ├── ContainerScanner.ts     # 容器扫描
    ├── SearchService.ts        # 物品搜索
    ├── BoundaryDisplay.ts      # 边界粒子光幕
    └── SafeProbe.ts            # 双箱安全探针
```

---

## 分拣路由（5 级优先级）

1. **大宗** — 已有同类物品的大宗仓位优先
2. **普通** — 已有同类物品的普通仓位
3. **大宗** — 空大宗仓位（需设置 bulkTypeId）
4. **普通** — 空普通仓位
5. **杂项** — 兜底

---

## 关键约定

### 命令
- 前缀 `sw:`（如 `/sw:create`, `/sw:list`, `/sw:search`）
- 部分命令无需作弊权限

### 容量预警
- 三级：黄色（80%+）、红色（90%+）、深红（95%+）
- 支持降级动态追踪、防刷消息抑制

### 仓库生命周期
- 玩家接近 16 格内激活分拣
- 玩家离开后自动停用

---

## 维护工具

```bash
# 重新生成物品家族分类（修改 data/ 后运行）
node tools/generateItemFamilies.mjs

# 注入中文注释到分类文件
node tools/annotateFamilies.mjs
```

---

## 依赖

| 包 | 版本 |
|---|------|
| @minecraft/server | ^2.6.0 |
| @minecraft/server-ui | ^2.0.0 |
| @minecraft/math | 2.2.7 |
| @minecraft/core-build-tasks | 5.5.0 |
