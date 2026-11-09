# Tasks

## 1. 重命名共享打包包 `@mc-toolchain/packaging` → `@mc-toolchain/mod-packaging`

- [x] 1.1 `git mv packages/packaging packages/mod-packaging`,并把 `packages/mod-packaging/package.json` 的 `name` 改为 `@mc-toolchain/mod-packaging`(其余字段不变);验证:仓库根 `npm install` 后 `npm ls -w @mc-toolchain/mod-packaging` 无 missing/peer 报错
- [x] 1.2 改 `packages/mod-packaging` 内的自引用:README 标题与路径、`src/versions.ts` 中「把版本补进…映射表」报错文案里的 `@mc-toolchain/packaging`;验证:`grep -rn "@mc-toolchain/packaging\|packages/packaging" packages/mod-packaging/` 无结果
- [x] 1.3 改 5 个模组的引用:`auto-refill`、`craftablerarities`、`keepinventory`、`spectator-mode`、`teleporter` 的 `just.config.ts` import 与 `package.json` 的 `devDependencies`;验证:`grep -rn "@mc-toolchain/packaging" mods/` 无结果,且此时 `packages/mod-packaging` 无未解析依赖
- [x] 1.4 共享打包包自带测试与打包回归:`npm run typecheck -w @mc-toolchain/mod-packaging`、`npm test -w @mc-toolchain/mod-packaging` 通过;并在 `mods/keepinventory` 执行 `npm run pack`,验证产物 `keepinventory-v0.0.1_bp.mcpack` 的文件名、解压清单与 `manifest.json` 版本与改动前一致(判据见 `docs/research/packaging-naming-and-modes.md`)

## 2. 合并共享运行时与界面包为 `@mc-toolchain/mod-common`

- [x] 2.1 `git mv packages/shared packages/mod-common`,把 `packages/ui/src/*.ts`、`packages/ui/tests/*.ts` 移入 `packages/mod-common/` 的对应目录,删除 `packages/ui/`;验证:`ls packages/` 只剩 `mod-common`、`mod-packaging`,且 `packages/mod-common/src/` 同时含 `color.ts`、`HudManager.ts`、`arbiter.ts` 与表单/执行助手/消息模块
- [x] 2.2 写合并后的 `packages/mod-common/package.json`(`name: "@mc-toolchain/mod-common"`、`private: true`、`main`/`types` 指向 `src/index.ts`、`peerDependencies` 含 `@minecraft/server` 与 `@minecraft/server-ui`、`devDependencies` 取两包并集)与 `packages/mod-common/tsconfig.json`(沿用 `target: es6`、`module: ES2020`);验证:`npm run typecheck -w @mc-toolchain/mod-common` 通过
- [x] 2.3 合并入口 `packages/mod-common/src/index.ts`:重新导出原两包全部导出并改写头部注释(去掉互相指认的「刻意不包含」);验证:导出清单等于原 `packages/mod-common/src/index.ts` 与 `packages/ui/src/index.ts` 旧内容的并集(逐项比对,无遗漏、无重复标识符)
- [x] 2.4 迁移测试配置:建 `packages/mod-common/tests/tsconfig.json`(以原 `packages/ui/tests/tsconfig.json` 为基准,`outDir` 指 `.test-build`)并更新 `package.json` 的 `test` 脚本;验证:`npm test -w @mc-toolchain/mod-common` 跑通原 `arbiter`、`run-safe`、`modal-values`、`action-buttons` 全部用例
- [x] 2.5 更新三个运行时消费方的 `package.json` 与源码导入:`auto-refill`、`spectator-mode` 的 `@mc-toolchain/shared` 与 `teleporter` 的 `@mc-toolchain/ui` 统一改为 `@mc-toolchain/mod-common`;验证:`grep -rn "@mc-toolchain/shared\|@mc-toolchain/ui" mods/ --include=*.ts --include=*.json` 无结果,且三个模组各 `npm run build` 通过
- [x] 2.6 合并 README:以原 `packages/ui/README.md` 为主体,并入 `packages/shared/README.md` 的样式码与 HUD 章节,删除因合并失效的「与 `@mc-toolchain/shared` 的分工」「刻意不包含」内容;验证:README 列出的导出与 `src/index.ts` 实际导出一致,且各表单的 ASCII 版式图与「取消返回什么」说明仍在

## 3. 更新其余文档与锁文件

- [x] 3.1 更新根 `README.md` 共享包表、`mods/README.md`、`mods/auto-refill/README.md`、`mods/keepinventory/README.md`、`mods/spectator-mode/README.md`、`mods/teleporter/README.md` 中的包名与链接;验证:表中链接指向存在的文件,`grep -rn "packages/packaging\|packages/shared\|packages/ui" README.md mods/` 无结果
- [x] 3.2 更新 `docs/research/read-only-context.md` 中两处 `@mc-toolchain/ui` / `packages/ui` 引用;验证:`grep -rn "mc-toolchain/ui\|packages/ui" docs/` 无结果
- [x] 3.3 仓库根 `npm install` 重新生成 `package-lock.json`;验证:`grep -n "@mc-toolchain/packaging\"\|@mc-toolchain/shared\"\|@mc-toolchain/ui\"" package-lock.json` 无结果

## 4. 规格收尾与全局核验

- [x] 4.1 处理 `shared-ui`:若 `openspec/specs/shared-ui/` 存在则删除该目录,否则删除 `openspec/changes/add-teleporter-mod/specs/shared-ui/spec.md`;验证:`openspec list --specs --json` 中无 `shared-ui`,且 `openspec validate add-teleporter-mod` 仍通过
- [x] 4.2 全局核验无旧包名:`grep -rn "@mc-toolchain/packaging\|@mc-toolchain/shared\|@mc-toolchain/ui"` 的命中只应出现在 `openspec/changes/archive/`、`openspec/changes/add-spectator-mode-mod/`、`openspec/changes/add-teleporter-mod/`(历史规划,Non-Goal);`openspec validate rename-and-merge-shared-packages` 通过
- [x] 4.3 集成核验:根 `npm test -w @mc-toolchain/mod-common -w @mc-toolchain/mod-packaging` 全绿,`auto-refill`、`spectator-mode`、`teleporter` 三个模组 `npm run build` 全部成功
- [ ] 4.4 实机冒烟(需 Minecraft 客户端,建议执行):同世界装载 `teleporter` + `auto-refill` + `spectator-mode`,验证传送命令、各类表单与消息提示正常,且 actionbar HUD 的高优先级让位与回归行为与改动前一致

## Workflow follow-up

- 归档前先确认 `add-teleporter-mod` 已归档,或已按 4.1 处理完其 `shared-ui` delta。
- 归档本变更后核对 `openspec/specs/`:`mod-common` 已生成,`shared-runtime` 已移除,`shared-packaging`、`addon-packaging` 引用已更新。
- `add-spectator-mode-mod` 的规划文档保留旧包名(Non-Goal);如需统一可另开文档整理变更。
