# EventSignal — 自定义事件订阅触发机制设计

日期：2026-08-04
状态：已批准（用户确认：独立事件定义、subscribe / unsubscribe / trigger 三操作、去掉 EventBus）

## 背景

MCBE addon 开发中，模块间需要解耦通信。参考 MCBE 原生事件机制（`world.afterEvents.playerJoin.subscribe(fn)` / `unsubscribe(fn)` 模式），在 `@yinxe/toolkit` 中实现纯自定义的事件订阅触发机制。

## 目标

- 每个事件**独立定义**：一个 interface 描述该事件的属性（如 `PlayerJoinEvent { playerId; playerName }`），对应一个独立的 signal 实例，各自维护自己的订阅列表
- 三个操作：`subscribe` / `unsubscribe` / `trigger`
- 支持可取消事件（`CancelableEventSignal`，订阅者置 `event.cancel = true` 取消本次触发）
- **不引入 EventBus 容器**、不提供全局单例；各模块自行持有自己的事件 signal 实例（YAGNI）
- 纯 TS 逻辑，不依赖 `@minecraft/server`，可在 node 环境直接行为测试

## 文件结构

```
packages/toolkit/src/events/
├── EventSignal.ts   # EventSignal<T>（仅通知）+ CancelableEventSignal<T>（可取消）
└── index.ts         # 统一导出
```

同时更新 `packages/toolkit/src/index.ts` 导出与 `packages/toolkit/README.md` 文档。

## API

```typescript
// ─── 1. 每个事件独立定义：一个 interface = 该事件的属性 ───
interface PlayerJoinEvent {
  playerId: string;
  playerName: string;
}

// ─── 2. 每个事件一个独立的 signal 实例 ───
const playerJoin = new EventSignal<PlayerJoinEvent>();

// ─── 3. 订阅（注册后，后续 trigger 才会派发到它）→ 取消订阅 → 触发 ───
playerJoin.subscribe((e) => console.warn(`[demo] ${e.playerName} 加入`));
playerJoin.unsubscribe(cb);                             // 用同一回调引用取消
playerJoin.trigger({ playerId: "x", playerName: "Alice" });  // 同步派发给所有订阅者
```

### 可取消事件

```typescript
interface ItemUseEvent { playerId: string; itemTypeId: string }

const itemUse = new CancelableEventSignal<ItemUseEvent>();
itemUse.subscribe((e) => {
  if (e.itemTypeId === "minecraft:bedrock") e.cancel = true;
});
const ok = itemUse.trigger({ playerId: "x", itemTypeId: "minecraft:bedrock" });
// ok === false（被取消）
```

### 类签名

```typescript
export class EventSignal<T> {
  subscribe(callback: (event: T) => void): void;
  unsubscribe(callback: (event: T) => void): void;
  trigger(event: T): void;
}

export type CancelableEvent<T> = T & { cancel: boolean };

export class CancelableEventSignal<T> {
  subscribe(callback: (event: CancelableEvent<T>) => void): void;
  unsubscribe(callback: (event: CancelableEvent<T>) => void): void;
  trigger(event: T): boolean;   // 被取消返回 false，否则 true
}
```

## 行为语义

| 场景 | 行为 |
|------|------|
| trigger 时无订阅者 | 安全空操作，不报错 |
| 订阅者回调抛异常 | try-catch 包裹，`console.warn("[events] 订阅者回调异常:", e)` 记录，不影响其他订阅者 |
| 回调中 subscribe / unsubscribe | 快照遍历，安全 |
| 同一回调重复 subscribe | 只注册一次（去重） |
| unsubscribe 未注册的回调 | 静默忽略 |
| 可取消事件 trigger | 内部构造 `{ ...event, cancel: false }` 浅拷贝派发；任一订阅者置 `cancel = true` 即取消，其余订阅者仍会收到（忠实 MCBE：所有 before 订阅者都收到事件），trigger 返回 `false` |

## 错误处理与日志

- 订阅者异常不影响派发（见上表）
- 日志格式遵循项目规范：`[events] 前缀` + 中文描述或英文调试信息

## 验证方案

1. **类型检查**：借用一个 addon 的 tsconfig 对 toolkit 源码做 `tsc --noEmit`，或使用最小临时 tsconfig
2. **行为测试**：编写 node 可运行的测试脚本（不依赖 `@minecraft/server`），覆盖：
   - 订阅后 trigger 收到事件、未订阅不报错
   - unsubscribe 后不再收到
   - 可取消事件：cancel 后 trigger 返回 false、after 侧语义（普通 signal 不受影响）
   - 异常隔离：一个订阅者抛错，其余订阅者仍收到
   - 去重：同一回调订阅两次只触发一次
   - 回调中 subscribe/unsubscribe 安全

## 不做的事（YAGNI）

- 不提供 `once()` / 一次性订阅
- 不提供 EventBus 容器 / 事件命名空间 / 全局单例
- 不桥接 MCBE 原生事件
- 不提供异步派发 / 优先级 / 订阅排序
