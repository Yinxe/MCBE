# Design: 记录 Script API 受限上下文约束

## Context

见 `proposal.md` 的 Why。这里只记录写 spec 时需要的事实依据。

### 已核实的事实

用 `@minecraft/server` **2.1.0** 的 `index.d.ts` 逐成员扫描注释标注,得到本项目相关结论:

| 成员 | 上下文标注 | 能否在命令回调内直接调用 |
| --- | --- | --- |
| `Player.setGameMode` | `can't be called in read-only mode` | 否 |
| `Player.teleport` | `can't be called in read-only mode` | 否 |
| `Dimension.spawnParticle` | `can't be called in read-only mode` | 否 |
| `Player.addTag` / `removeTag` / `setRotation` / `addEffect` | `can't be called in read-only mode` | 否 |
| `Player.runCommand` / `setTitle` / `playSound` / `setSpawnPoint` | `can't be called in read-only mode` | 否 |
| `Player.sendMessage` | 无受限标注 | 是 |
| `Player.getGameMode` / `playerPermissionLevel` / `isValid` | 无受限标注 | 是 |
| `Player.setDynamicProperty` / `getDynamicProperty` | 无受限标注 | 是 |
| `world.getPlayers` / `Dimension.getBlock` | 无受限标注 | 是 |
| `system.run` / `runInterval` / `runTimeout` / `clearRun` | 无受限标注,且可早执行 | 是 |
| `CustomCommandRegistry.registerCommand` | 受限,但**可早执行** | 仅限 `startup` 阶段 |

同一家族内标注并不一致(如 `setDynamicProperty` 不标受限、`setGameMode` 标受限),因此判定必须逐成员进行。

`@minecraft/server` 2.1.0 全量标注为受限的成员共 **137 个**。

### 事故经过(作为 spec 的反例素材)

`mods/spectator-mode/scripts/mc/commands.ts` 起初在命令回调内同步调用 `controller.toggle(player)`,其调用链含 `setGameMode` / `teleport` / `spawnParticle`,三者均受限。玩家在生存模式下执行 `/sp:soul` 时,`enterSoul` 内的 `setGameMode` 抛错被 `catch` 捕获,返回「无法进入旁观模式(游戏模式切换被拒绝)」。

同一文件里 `menu` 分支却正确地用了 `system.run`,因为 `mods/auto-refill/scripts/AdminMenu.ts` 恰好有一句注释提示这一点。两个分支的差异说明:**约束当时只存在于一句代码注释里,没有进入任何 spec**,因此无法在实施前被系统性检查。

上游模组之所以没有这个问题,是因为它用 `@yinxe/toolkit` 的 `defineCommand` 包装注册,该包装内部(推测)做了 `system.run` 推迟。替换为原生 `registerCommand` 时这层推迟消失,而 `@yinxe/toolkit` 在迁移机器上不可读,无法核对。

## Goals / Non-Goals

**Goals**

- 把"命令回调是受限上下文"变成可在实施前检查的 spec 条款,而不是靠口口相传的注释。
- 给出可机械执行的判定依据(类型定义标注),避免依赖经验推断。
- 记录"封装替换须核对隐藏行为"这条方法论,防止同类问题在换库时复发。

**Non-Goals**

- 不修改任何模组代码(事故点已修复,本变更只补文档)。
- 不在 `@mc-toolchain/shared` 里新增 `defineCommand` 等价物。当前只有两个模组注册命令,且两者的参数/权限需求不同;等第三个消费方出现再抽象,避免过早定型。
- 不改 `mct` CLI 行为、打包逻辑或产物格式。
- 不尝试枚举全部 137 个受限成员到 spec 正文(会随 API 版本漂移);spec 只固化判定方法,清单留在 design 作为参考快照。

## Decisions

### D1: 约束写入 `mct-toolchain-usage`,不新建能力

- **选择**:扩展现有 `mct-toolchain-usage` 能力。
- **理由**:该能力的 Purpose 是"约束本项目如何使用工具链与运行时",而受限上下文正是运行时侧的硬约束;新建 `script-api-context` 之类的能力会让"本仓模组必须遵守什么"散落在两处。
- **代价**:该能力 Purpose 目前只提到 `mct` CLI,需要同步扩写 Purpose,使其覆盖运行时约束。
- **否决方案**:新建独立能力 `script-api-context`——能力过窄,且与本能力的受众(模组作者)完全重合。

### D2: 判定依据写"类型定义标注",不写具体成员清单

- **选择**:spec 规定以 `can't be called in read-only mode` / `can be called in early-execution mode` 标注为判定依据。
- **理由**:受限成员清单随 `@minecraft/server` 版本漂移(2.1.0 是 137 个,换版本会变);而标注语义稳定,且实现者能在本地 `node_modules` 里自行核对。
- **代价**:实施者需要主动去查类型定义,不能只读 spec。
- **否决方案**:在 spec 里列全部受限成员——spec 会迅速过期,且 500 字符的描述上限放不下。

### D3: 拆成三条独立 Requirement

- **选择**:拆为「回调不得直接调用受限 API」「判定依据是类型标注」「替换封装须核对隐藏行为」三条。
- **理由**:三者是不同层面的约束(编码规则 / 判定方法 / 迁移方法论),各自的 Scenario 完全不同;合在一条会超过 500 字符描述上限,也无法分别验证。
- **代价**:条款数量增加,需要读者理解三者的分工。

### D4: 明确要求"推迟后重新校验玩家对象"

- **选择**:在第一条 Requirement 的 Scenario 中要求 `system.run` 内检测玩家是否已失效。
- **理由**:推迟一 tick 期间玩家可能离线;若直接操作失效对象,`isValid` 为 false 的调用会抛错,把"已修好的问题"以另一种形式带回来。
- **代价**:每个推迟回调多一次判空。

## Risks / Trade-offs

- **风险**:spec 条款无法自动检查,仍可能被忽略。→ **缓解**:条款给出可机械执行的判定动作("查类型定义的注释标注"),并在 `tasks.md` 中要求把该动作作为实施步骤而非事后补救;后续若同类问题再发,考虑加 ESLint 自定义规则或在 `packages/shared` 提供安全封装。
- **风险**:上游 `@yinxe/toolkit` 的行为仍是推测(该包不可读)。→ **缓解**:design 与 spec 都把它写成"推测/无法核对",并规定"封装不可读时必须列为未确认风险",不把推测当结论。
- **风险**:未来 `@minecraft/server` 可能调整标注措辞,使判定依据失效。→ **缓解**:判定依据绑定的是"是否受限"这一语义而非字面字符串;升级依赖时把"抽查标注措辞是否变化"纳入验证清单。
- **取舍**:不抽象 `defineCommand` 等价物,意味着每个新模组仍需自己写 `system.run`。→ 用 spec 条款保证写法一致,换取避免过早抽象。

## Migration Plan

纯文档变更,无部署步骤。合入后:

1. `openspec/specs/mct-toolchain-usage/spec.md` 增加三条 Requirement(归档时同步)。
2. 该 spec 的 Purpose 扩写为同时覆盖 `mct` CLI 与 Script API 运行时约束。
3. 已实现的 `mods/spectator-mode`、`mods/auto-refill` 无需改动(两者均已符合)。

回滚:删除新增的三条 Requirement 即可,无代码影响。

## Open Questions

无。`@yinxe/toolkit` 的真实实现虽不可核对,但 spec 的写法(要求"封装不可读时列为未确认风险")已不依赖该事实。
