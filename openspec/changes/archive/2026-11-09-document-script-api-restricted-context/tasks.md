# Tasks

## 1. 补写 spec 条款

- [x] 1.1 在 `openspec/changes/document-script-api-restricted-context/specs/mct-toolchain-usage/spec.md` 中确认三条 ADDED Requirement 与 10 个 Scenario 齐备(回调不得直接调用受限 API / 判定依据为类型标注 / 替换封装须核对隐藏行为);验证方式:`openspec validate document-script-api-restricted-context --strict` 输出 `is valid`。
- [x] 1.2 归档时扩写主 spec 的 Purpose,使其同时覆盖 `mct` CLI 用法与 Script API 运行时约束(现 Purpose 只提 `mct`);验证方式:归档后 `openspec show mct-toolchain-usage --type spec` 的 Purpose 段同时出现两类约束。

## 2. 核对现有模组是否符合新条款

- [x] 2.1 核对 `mods/spectator-mode/scripts/mc/commands.ts`:命令回调内只做参数解析/鉴权,`toggle` 与 `openAdminMenu` 均在 `system.run` 内,且推迟回调检查了 `player.isValid`;验证方式:源码审查确认回调体内无 `setGameMode`/`teleport`/`spawnParticle` 同步调用。
- [x] 2.2 核对 `mods/auto-refill/scripts/AdminMenu.ts`:命令回调内只做玩家解析,`openMenu` 在 `system.run` 内;验证方式:源码审查确认同上。
- [x] 2.3 用类型定义扫描脚本对本仓全部模组的 `scripts/` 做一次受限 API 调用点排查,确认没有遗漏的同步调用;验证方式:脚本输出中,所有受限成员(如 `setGameMode`/`teleport`/`spawnParticle`/`addTag`/`runCommand`)的调用点都位于 `system.run`/`runInterval`/`runTimeout` 回调或事件订阅回调内。

## 3. 交付与后续

- [x] 3.1 归档本变更,把 delta 同步进 `openspec/specs/mct-toolchain-usage/spec.md`;验证方式:`openspec validate --specs` 全部通过,且 `mct-toolchain-usage` 含三条新 Requirement。
- [ ] 3.2 (可选,待用户决定)评估是否在 `packages/shared` 提供自动 `system.run` 推迟的命令注册封装,以替代当前"每个模组自己记得包"的做法;验证方式:给出决策结论(做/不做)与理由,不在本变更内实现。
