# Design

## Context

见 `proposal.md` 的 Why。与本设计相关的现状约束：

- 三个共享包都以 TypeScript 源码直出（`main` / `types` → `src/index.ts`），无构建步骤；`packages/*` 均 `private: true`，不发布 npm，因此不存在需要保留的对外兼容面。
- 消费方目前只有 `mods/` 下的五个模组：`auto-refill`、`spectator-mode` 用 `shared`；`teleporter` 用 `ui`；`auto-refill`、`craftablerarities`、`keepinventory`、`spectator-mode`、`teleporter` 用 `packaging`（devDependency）。
- 产物目录 `lib/`、`dist/`、`.test-build/` 均在 `.gitignore` 中、未被 git 跟踪（`git ls-files` 为 0），因此改包名后这些目录由重新构建/测试生成，不手工编辑。
- 规格侧：`shared-runtime`、`shared-packaging`、`addon-packaging` 已在 `openspec/specs/`；`ui` 的能力规格 `shared-ui` **仅**存在于已完成但未归档的变更 `add-teleporter-mod`，尚未进主规格。
- 进行中的 `add-spectator-mode-mod`（26/28，仅剩实机验证）在规划文档里以文字引用旧包名。

## Goals / Non-Goals

**Goals:**

- 包名与目录名一一对应：`@mc-toolchain/mod-packaging` ↔ `packages/mod-packaging/`，`@mc-toolchain/mod-common` ↔ `packages/mod-common/`。
- 把两个「与具体模组无关的模组通用运行时/界面工具」包合并为单一包，消除跨包边界文档与重复的包脚手架。
- 仓库内所有代码、配置、当前态文档与规格中的旧包名清零，且不改变任何产物的可观察行为。

**Non-Goals:**

- 不引入兼容别名包（如保留 `@mc-toolchain/shared` 空壳转发）。
- 不改写已归档变更与进行中变更的历史规划文档（`openspec/changes/archive/**`、`add-spectator-mode-mod`、`add-teleporter-mod`）。
- 不改动共享包内部实现逻辑、HUD 跨包 `/scriptevent yinxe:hud` 协定、打包产物命名与内容。
- 不重命名 `openspec/specs/` 下已存在的能力目录（`shared-runtime` 采取「移除」而非改名，见 D5）。

## Decisions

### D1: 硬改名与合并，不留兼容别名

`@mc-toolchain/packaging` 直接改名为 `@mc-toolchain/mod-packaging`；`@mc-toolchain/shared` 与 `@mc-toolchain/ui` 合并为 `@mc-toolchain/mod-common`，旧包名不再存在。

- 理由：`packages/*` 全部是 `private` 的 workspace 包，源码由模组的 esbuild 直接内联，不存在仓库外消费方，别名只会长期制造两个名字。
- 备选：保留旧包名做转发导出。否决理由：没有受益方，且违背本次「消除命名债」的目的。
- 备选：只改 `package.json#name`、保留旧目录名。否决理由：目录名与包名脱节会让 `mod-workspace` 规范里「包目录名由包名派生」的约定在共享包上失效。

### D2: 目录名跟随包名，旧目录删除

`git mv packages/packaging packages/mod-packaging`；把 `packages/shared` 重命名为 `packages/mod-common`，再把 `packages/ui/{src,tests}` 的内容并入其中，最后删除 `packages/ui/`。

- 理由：保留 git 历史；目录与包名一致。
- 备选：新建 `packages/mod-common/` 再从零拷贝。否决理由：丢失文件历史。

### D3: 合并后单包单入口，导出面取并集

`packages/mod-common/src/index.ts` 重新导出原两包的全部导出（`color`、`style`、`HudManager`、`HUD_SLOTS`、`isStale`、`pickWinner`、`ModalFormBuilder`、`ActionFormBuilder`、`MessageFormBuilder`、`runSafe`、`runSafeDetached`、`createRunSafe`、`parseModalValues`、`isValueField`、`trySendMessage`、`notifySuccess`、`notifyError` 及类型），并去掉原来互相指认的注释。`package.json` 的 `peerDependencies` 取并集：`@minecraft/server`、`@minecraft/server-ui`。

- 理由：调用方只有一个包名；不再需要维护「界面与 HUD 仲裁必须分属两包」的边界文档。
- 备选：合并后按子路径导出（`mod-common/ui`、`mod-common/runtime`）。否决理由：仓库既有约定是单 `src/index.ts` 出口，子路径会新增一层约定而无收益。

### D4: 测试配置统一，以原 `ui` 的 `tests/tsconfig.json` 为基准

合并后的包使用一份 `tests/tsconfig.json`（`rootDir: ".."`、`outDir: "../.test-build"`、`noUncheckedIndexedAccess: true`，`include` 覆盖 `../src/**/*.ts` 与 `**/*.ts`），`package.json` 的 `test` 脚本沿用 `tsc -p tests/tsconfig.json && node --test ".test-build/tests/**/*.test.js"`。原 `shared/tsconfig.test.json` 中「只编译 `src/arbiter.ts`」的收窄不再需要（`@minecraft/server`、`@minecraft/server-ui` 均为本包 devDependency）。

- 理由：一次编译跑完原两包共 4 个测试文件；避免两套测试配置并存。
- 风险与备选见 Risks。
- `typecheck` 仍使用 `target: es6` 的 `tsconfig.json`，满足 `mod-common` 的「保守编译配置」要求。

### D5: 规格侧——新增 `mod-common`、移除 `shared-runtime`，其余只改文字

- 新增能力 `mod-common`：承载合并后 `@mc-toolchain/mod-common` 的完整契约（位置/私有/依赖约束 + 原 `shared-runtime` 的文本样式与 HUD 仲裁 + 原 `shared-ui` 的表单、执行助手、消息助手），即 `shared-runtime` 的 7 条要求重命名后与 `shared-ui` 的界面要求合并，去掉因合并而失效的「界面职责与运行时仲裁职责分离」。
- `shared-runtime`：以 `## REMOVED Requirements` 移除全部 7 条要求，`Reason`/`Migration` 指向 `mod-common`。选择移除而非改名，是因为能力目录一旦改名就要「新增能力 + 逐个移除旧要求」，与直接移除等价却更啰嗦；且 OpenSpec 指南要求修改既有能力时不重命名其目录。
- `shared-packaging`：4 条要求全部 `MODIFIED`，把 `@mc-toolchain/packaging` / `packages/packaging/` 改为新名与新路径，契约文本不变。
- `addon-packaging`：`MODIFIED` 其中的「打包入口唯一」，只改引用的包名。
- 理由：规格描述的是包/能力契约，包名与位置被写成了 MUST，改名就必须同步规格，否则规格与代码不一致。
- 备选：`skip_specs: true` 视为纯重构。否决理由：`openspec/specs/shared-runtime` 等主规格里 `@mc-toolchain/shared`、`packages/shared/` 是 normative 文本，不改会让主规格直接错误。

### D6: `ui` 的未落地能力 `shared-ui` 由本变更取代

`shared-ui` 尚未进主规格，本变更**不**为其写 delta（对不存在的能力写 `REMOVED` 在归档时不可靠）。改为在 apply 阶段按 `add-teleporter-mod` 的归档状态二选一处理：

- 尚未归档：删除 `openspec/changes/add-teleporter-mod/specs/shared-ui/spec.md`，使其归档时只落地 `teleporter` 能力，界面契约由 `mod-common` 拥有。
- 已归档：删除主规格中已被 `mod-common` 取代的 `openspec/specs/shared-ui/`。

两种情况下 `openspec list --specs` 都不应再出现 `shared-ui`。

### D7: 历史文档不改写，当前态文档更新

- 更新：根 `README.md`、`mods/README.md`、各 `mods/*/README.md`、`packages/mod-common/README.md`、`packages/mod-packaging/README.md`、`docs/research/read-only-context.md`、`package-lock.json`。
- 不改写：`openspec/changes/archive/**`、`openspec/changes/add-spectator-mode-mod/**`、`openspec/changes/add-teleporter-mod/**` 的正文（`shared-ui` 文件按 D6 单独处理）。

## Risks / Trade-offs

- [`shared-ui` 与 `add-teleporter-mod` 归档顺序] → 由 D6 的双分支处理覆盖两种顺序；验收判据是 `openspec list --specs` 无 `shared-ui`，且 `openspec validate add-teleporter-mod` 仍通过。
- [合并后统一测试配置引入 `noUncheckedIndexedAccess: true` 可能让原 `shared` 的 `arbiter` 用例编译失败] → 以 `npm test -w @mc-toolchain/mod-common` 全绿为准；若失败，回退为不启用该选项（不改变包行为，仅放宽测试编译）。
- [README 合并可能丢失原有章节] → 以「`src/index.ts` 实际导出清单」和原两份 README 的章节标题做核对，`mod-common` 的「每个表单封装须有版式与返回值文档」要求由该 README 继续满足。
- [`package-lock.json` 手工改动易错] → 只通过仓库根 `npm install` 重新生成，不手工编辑。
- [进行中的 `add-spectator-mode-mod` 规划文档仍写旧包名] → 明确列为 Non-Goal；其实机验证任务（6.4/6.5）不依赖包名，照常执行。
- [重名 `mod-` 前缀可能被误读为「只服务 mods/」] → `packages/` 本就只放模组共享包（`mod-workspace` 规范），语义一致。

## Migration Plan

1. 先做 `packaging` → `mod-packaging`（独立、低风险），各模组打包回归通过。
2. 再做 `shared` + `ui` → `mod-common`，同步改三个运行时消费方，跑通合并后的 typecheck/test 与三模组 build。
3. 更新文档与 `package-lock.json`，按 D6 处理 `shared-ui`，全局核验无旧名。
4. 回滚策略：本次改动全部在 git 内，按一个或多个 commit 提交，回滚即 `git revert`；不涉及运行时数据迁移，无需灰度。

## Open Questions

无。规格策略（D5）、目录改名与 `shared-ui` 处理（D6）已与用户确认。
