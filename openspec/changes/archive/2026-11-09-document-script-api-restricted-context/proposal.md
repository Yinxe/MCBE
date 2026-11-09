# Proposal: 记录 Script API 受限上下文约束

## Why

迁移 `spectator-mode` 时,`/sp:soul` 在生存模式下报「无法进入旁观模式(游戏模式切换被拒绝)」:自定义命令回调运行在**受限(只读)上下文**,而 `Player.setGameMode`、`teleport`、`spawnParticle` 等写操作在其中会抛错。上游代码之所以能工作,是因为它用 `@yinxe/toolkit` 的 `defineCommand` 包了一层,隐藏了 `system.run` 推迟;把它替换成原生 `registerCommand` 后,这层隐藏契约随之消失,而当时没有任何 spec 记录过它,于是同一坑在不同模组里反复踩到。

这是引擎级硬约束,不是实现细节,必须以 spec 形式固化,并在实现前就能被检查。

## What Changes

- 在 `mct-toolchain-usage` 能力下新增一条 Requirement:自定义命令回调与其它受限上下文 MUST NOT 直接调用受限 API,写操作 MUST 用 `system.run` 推迟到安全 tick。
- 明确受限 API 的判定方式(以 `@minecraft/server` 类型定义中 `can't be called in read-only mode` 标注为准),并列出本项目高频受限成员清单。
- 明确「封装替代不等于行为等价」:把第三方 `defineCommand` 一类封装换成原生 API 时,MUST 逐项确认被替换掉的隐藏行为(上下文推迟、权限校验、参数解析)。
- 要求模组在实现命令时,回调内只做参数解析与鉴权,所有状态变更走 `system.run`。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `mct-toolchain-usage`:新增一条关于 Script API 受限上下文的 Requirement,并补充对应 Scenario。该能力的 Purpose 目前只覆盖 `mct` CLI 用法,需要同时扩展到「Script API 上下文约束」,因为两者同属「本仓模组必须遵守的工具链与运行时约束」。

## Impact

- 受影响 spec:`openspec/specs/mct-toolchain-usage/spec.md`
- 受影响代码(已修复,本变更只补文档约束):`mods/spectator-mode/scripts/mc/commands.ts`
- 受影响模组:所有注册自定义命令的模组(`auto-refill`、`spectator-mode`,以及后续新增模组)
- 不影响:`mct` CLI 行为、打包逻辑、已有产物格式
