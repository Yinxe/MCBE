# Lifecycle 生命周期内聚模块

> **单一真源**：BOT 的一切生命周期事务在此模块集中维护，外部不再散落订阅。

## 目录

```
scripts/lifecycle/
  BotLifecycle.ts              # 编排器：队列 / 守卫 / 核心动作 / 事件广播
  LifecycleContext.ts          # DI 容器：registry/store/config/save/inventory
  LifecycleEvents.ts           # 12 组信号：before/after/fail 的生命周期事件
  LifecycleComponent.ts        # 组件接口：id / priority / 10+ 钩子
  components/
    QuotaComponent.ts          # 10 配额守卫（可中断）
    NameGuardComponent.ts      # 11 重名守卫
    SessionComponent.ts        # 30 会话：playerJoin/playerLeave 集中订阅
    DeathComponent.ts          # 40 死亡复活：entityDie/playerSpawn
    InventoryComponent.ts      # 60 库存：playerInventoryItemChange + botEquipSlotChanged 集中订阅
    PositionComponent.ts       # 70 位置：botMoved → lastPoint
    TickingAreaComponent.ts    # 80 辅助常加载：Sim4 / SingleChunk + onWorldLoad 孤儿清理
    AutoOnlineComponent.ts     # 85 自动上线：worldLoad 后排队恢复
    CleanupComponent.ts        # 90 清理：raid/指纹
    LoggingComponent.ts        # 200 日志观察
  index.ts                     # createDefaultLifecycle 工厂
```

## 内聚点

| 原分散位置 | 现内聚位置 | 订阅方式 |
|---|---|---|
| `events/playerJoin.ts` | `SessionComponent` | `world.afterEvents.playerJoin` 集中订阅于 `onRegister` |
| `events/playerLeave.ts` | `SessionComponent` | `world.afterEvents.playerLeave` |
| `events/entityDie.ts` + `events/playerSpawn.ts` | `DeathComponent` | `world.afterEvents.entityDie / playerSpawn` |
| `events/playerInventoryItemChange.ts` + `features/inventoryStorage.register()` | `InventoryComponent` | `world.playerInventoryItemChange` + `BotEvents.botEquipSlotChanged` |
| `features/basic/PositionTracker.ts` | `PositionComponent` | `BotEvents.botMoved` |
| `features/manage/*` (create/online/offline/delete) | `BotLifecycle` + 各守卫/辅助组件 | `LifecycleEvents` + `BotEvents` |

外部 `events/index.ts` 仅保留非生命周期交互事件（`itemUse` / `playerInteractWithEntity` / `botActions`），生命周期事件已在 `bootstrap/context` 创建 `botLifecycle` 时自动订阅，**不再外部单独注册**，`worldLoad` 阶段通过 `botLifecycle.worldLoad()` 触发各组件 `onWorldLoad`（含 TickingArea 孤儿清理、AutoOnline 排队）。

`bootstrap/worldLoad.ts` 已瘦身为纯编排：`config.refresh → initGameTestContext → registerAllEvents(非生命周期) → botLifecycle.worldLoad() → runMigrations → 启动引擎`，不再包含辅助清理与自动上线散落逻辑。

## 订阅复用（可再次订阅，集中维护）

每个组件可在 `onRegister` 中自由订阅世界事件或领域事件，示例：

```ts
export class MyComponent implements LifecycleComponent {
  readonly id = "my"; readonly priority = 150;
  private off?: () => void;
  onRegister(ctx: LifecycleContext) {
    // 世界事件
    const h = (e: PlayerJoinAfterEvent) => { /* ... */ };
    world.afterEvents.playerJoin.subscribe(h);
    this.off = () => world.afterEvents.playerJoin.unsubscribe(h);
    // 领域事件
    const off2 = BotEvents.botOnline.subscribe(e => { /* ... */ });
    const off3 = LifecycleEvents.afterOnline.subscribe(e => { /* ... */ });
  }
  onUnregister() { this.off?.(); }
  async onAfterOnline(ctx, record, bot) { /* 编排钩子 */ }
}
botLifecycle.use(new MyComponent());
```

`onRegister` / `onUnregister` 成对管理，`BotLifecycle.use()/unuse()` 热插拔，优先级决定执行顺序，异常隔离。

## DI 与测试

`LifecycleContext` 持有全部依赖，组件不直接 `import { botRegistry } from "../bootstrap/context"`，而是通过 `ctx.registry` 取得，测试可注入替身：

```ts
const ctx = {
  registry: new BotRegistry(new InMemoryBotStore()),
  store: new InMemoryBotStore() as any,
  configStore: { get: () => ({}) } as any,
  save: { saveRecord: vi.fn() } as any,
  inventory: { restoreInto: vi.fn(), saveInventorySlot: vi.fn() } as any,
};
const lc = createDefaultLifecycle(ctx);
await lc.create({ rawName: "test", ... });
```

## 兼容

- 旧 `events/*.ts` / `PositionTracker.initPositionTracker()` / `autoOnline.initAutoOnline()` 保留为空实现或兼容壳，不再包含领域事件触发/恢复/订阅逻辑；正常环境全部由生命周期组件（Session/Death/Inventory/Position/AutoOnline）统一处理，避免双重订阅与重复触发。
- 旧 `features/inventoryStorage.register()` / `initPositionTracker()` 已改为空实现，重复调用不会产生额外订阅。
- 对外 `safeOnline` / `createBot` 等薄壳仍可用，内部已委托 `botLifecycle`。

