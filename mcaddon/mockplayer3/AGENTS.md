# mockplayer3

> 模拟玩家（假人）Addon。当前 `3.0.32`，显示名「模拟玩家III」，`module_name = "MockPlayer"`，`min_engine_version [1,21,130]`。
> 架构、读码顺序、排障路径、新增能力步骤见仓库根 `.agents/skills/mcbe-addon-dev/SKILL.md` 和 `references/mockplayer3.md`；本文件只写模块身份与不可违反的事实。

## 模块红线

- **版本**：只在用户明说“打包/发版”时改 `package.json#version`，且每次只 `+patch`；未经用户实机验收不得 `+0.1.0/+1.0.0`。
- **日常验证**：`npx tsc --noEmit -p tsconfig.json` + `pnpm run test:core`。不要跑 `build`/`pack`，二者会通过 `update-version` 改写 manifest。`pnpm run local-deploy` 可增量部署；lint 排除 `lib/**`。
- **包标识**：BP/RP 的 UUID、`module_name = "MockPlayer"`、structures `mockplayer:void`、测试维度 `mockplayer:test` 与 GameTest 注册标识均沿用 v2。DP 键实际存为 `MockPlayer:<键>`，改 `module_name` 会让迁移检测恒假；改 UUID 不解决数据读取。迁移完成前不得改。
- **层级**：`domain` 零 `@minecraft`/`@yinxe`；`engine` 是唯一直接触碰 ScriptAPI 的层；`application` 不直接 import `@minecraft`，也不 import `interface`；`interface` 只翻译意图，不持有持久化写逻辑。
- **入口**：`main.ts` 只装配；`Composition.ts` 是唯一跨层依赖图。新增单例走 `services`，不要在各处 `new`。
- **局部约束**：`world.getPlayers`/`world.getEntity` 只允许出现在 `engine/EntityGateway.ts`；`@minecraft/server-gametest` 只允许出现在 `engine/`；`as any` 当前为零，确需绕行只能进 `engine/Compat.ts` 并注明原因。

## 引擎事实（勿凭直觉改）

- GameTest 生成体旋转逐 tick 锁回 (0,-135)：装置只做中转出生 (0,8,0) → 立即 teleport 离开；装置几何/时序为实测结论。
- `disconnect` 名字释放 ≥20t；撞名引擎会加 `(2)`，生成后必须验名。
- `respawn()` 只能在 `entityDie` 的 before 回调内调用。
- 假人生成自带空背包：恢复完成（`epoch ≥ 1`）前 SaveGate 拒绝一切物品/状态写。
- 注视一律租约化；`gaze` HOLD 到期必须中性化，忘续租不能把视角焊死。
- 容器不走右键：`minecraft:inventory` 组件直读直写 + 写后 2t 回读；interact 节流 ≥4t。
- tickingarea circle r=4 实占 49 列；启动早期不要用 `getBlock` 探路。
- register 篡改游戏规则 → 回调内即时写回 + 装置流程 `finally` 无条件写回固定原版默认（`RIG_DEFAULT_RULES`，1/true/true），不读当前值也不回读。
- tick 回调同步、短、无 `await`、无自旋；长流程 = 相位机 + 单一时钟。

## 低版本兼容（游戏 < 1.26.20，无自定义维度 API）

- 判据 `engine/Rig.customDimensionAvailable()`：startup 时 `event.dimensionRegistry` 不存在即不可用。
- 不可用：`initTestField` 直接返回，不注册 GameTest；假人由 `engine/Spawner` 直生目标坐标。
- 物品仓锚点：可用 = 测试维度 (16,0,16)；不可用 = 末地 (300000,0,300000)。`ItemVault.storageOf` 按绑定表严格寻址，找不到就判区域不可用，绝不回落。
- 引擎地板 1.21.130（`world.tickingAreaManager`）；更低版本需先给存储层加不依赖 Manager 的加载路径。
- v2 物品迁移逐格“写成功才删键”；写不进仓的格保留旧键并落 `mp:legacy:pending:<旧名>`，记录照迁。
- 物品仓迁回：`application/VaultRelocation` 走 `clock`，40t 起每 2t 一个，≤15 轮；单格读源 → 写目标 → 全成功才改绑定表并清源槽。
- 兼容提示：装配期 warn + 玩家入服私信一次，文案在 `domain/Compat.dimensionFailureNotice`。

## 长流程模式（script，取代 custom）

- 运行态只有 `workMode === "script"` 一个真源；旧 `custom` 由 `domain/Migrate.ts` 归一，不另设运行标志。
- 指令模型、解析、归一化、中文描述都在 `domain/ActionRules.ts`；执行游标在 `domain/ActionCursor.ts`；状态板在 `domain/ActionStatus.ts`。
- 读写口只有 `application/ScriptLibrary.ts`；落盘 `engine/ScriptStore.ts`（独立键 `mp:script:<botId>`，不塞进 `BotRecord`）。
- 执行器 `application/Capabilities/Script.ts`（`id="script"`，租约 hands+motion）：`tick` 只看门狗，业务节拍在协程 `await` 内；重跑靠版本号在指令边界换表。
- 入口：`/mp:flow <假人> add|list|clear|loop|run|stop|status|dump|help` 与 `Panels/Script.ts`。
- 失败按 `onFail` 停下或跳过，不自动换模式；坐标留空＝操作者当前格，可空坐标留空仍是无坐标。

## 注释纪律

- 注释只写事实与约束（几何、时序、不变量、失败语义），不写设计史；台账只留 F-NN，缺NN 只进提交信息。
- 一行一个事实，≤110 显示列；平实中文，细则与自检命令见 `SKILL.md`。

## 文档与测试

- 功能语义变化同步 `docs/features/<功能>.md`（现有 13 篇）；功能增删在提交信息记「缺NN」。
- 测试入口：`pnpm run test:core`；纯逻辑测试在 `tests/domain.*.test.ts`，模拟在 `tests/engine.*Sim.test.ts` / `tests/sim.*Sim.test.ts`。
- 离线测试不代表实机验收；世界行为以游戏内冒烟为准，冒烟只做验收级。
