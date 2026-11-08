# Tasks

## 1. 打包逻辑收紧为官方全名目录

- [x] 1.1 在 `mods/keepinventory/tools/packaging.ts` 中新增常量 `BEHAVIOR_PACKS_DIRECTORY = "behavior_packs"` 与 `RESOURCE_PACKS_DIRECTORY = "resource_packs"`
- [x] 1.2 删除 `PackingConfiguration.behaviorPacks` / `resourcePacks`、`PackageJson.packing.behavior_packs` / `resource_packs`、`resolveExplicitPackDirectory`,以及 `SUPPORTED_PACKING_KEYS` 中的对应两项
- [x] 1.3 改写 `detectPackDirectory`,只在对应的官方全名目录下扫描候选,不再从模组根目录向下扫两层
- [x] 1.4 在 `resolvePackDirectories` 探测前加入缩写目录检测:模组根下存在 `BP` 或 `RP` 目录时报错,文案指明仅支持 `behavior_packs` / `resource_packs` 并给出改名指引
- [x] 1.5 确认 `collectCandidatePackDirectories` 在改造后仍被使用;若已无调用方则一并删除,避免留下死代码

## 2. 迁移模组目录

- [x] 2.1 `git mv mods/keepinventory/BP/keepinventory mods/keepinventory/behavior_packs/keepinventory`,确认 `manifest.json` 与 `pack_icon.png` 随之移动
- [x] 2.2 修改 `mods/keepinventory/tsconfig.json`:`"baseUrl"` 由 `"BP/"` 改为 `"behavior_packs/"`
- [x] 2.3 修改 `mods/keepinventory/just.config.ts`:`copyToBehaviorPacks` 的路径与 `local-deploy` 的监听 glob 均由 `BP/` 改为 `behavior_packs/`
- [x] 2.4 确认 `mods/keepinventory/.env` 的 `PROJECT_NAME` 为 `keepinventory`,与新包目录名一致(该值已对齐,记录确认结果)

## 3. 文档同步

- [x] 3.1 更新 `mods/keepinventory/README.md`:目录结构树、图标路径示例、`BP/` 与 `behavior_packs/` 的缩写/全名对照表改为单一全名约定
- [x] 3.2 在 `mods/keepinventory/README.md` 增加 `mct` 用法说明,至少覆盖:`mct validate -i .` 与 `mct validate -i mods` 的区别、`mct add -i . -o .` 的用法与省略 `-o` 的后果、禁止把 `-i`/`-o` 指向 `mods/` 父目录
- [x] 3.3 在 `mods/keepinventory/README.md` 说明新建模组时 `mct create` 后的改名步骤(包目录改为 `<name>` 并同步 `.env` 的 `PROJECT_NAME`)
- [x] 3.4 在 `docs/research/minecraft-creator-tools.md` 补充本次实测结论并附可复现命令:`getSuggestedShortName` 与 `makeNameFolderSafe` 的派生规则、改名后 `mct add` 复用既有包且 UUID 不变、命名空间恒为 `contoso_<目录名>`、`UNLINK` 警告不被计入 ERROR 计数、`mct add -i mods -o mods` 会写进所有模组

## 4. 验证

- [x] 4.1 `cd mods/keepinventory && npx tsc --noEmit` 退出码为 0
- [x] 4.2 `cd mods/keepinventory && npm run lint` 退出码为 0
- [x] 4.3 `cd mods/keepinventory && npm run pack` 成功产出 `keepinventory-v0.0.1_bp.mcpack`,且清单 `header.min_engine_version` 仍为 `[1,21,90]`
- [x] 4.4 缩写目录被拒绝:临时把 `behavior_packs` 改名为 `BP` 后执行 `npm run pack`,确认报错文案指明仅支持 `behavior_packs` / `resource_packs`;验证后改回
- [x] 4.5 配置字段被拒绝:在 `package.json` 的 `packing` 中临时加入 `"behavior_packs": "custom"`,确认报错指明该字段不受支持;验证后还原
- [x] 4.6 `cd mods/keepinventory && mct validate -i .` 确认 0 ERROR,且 `CPACKICON001` 与 `MINENGINEVER001` 通过
- [x] 4.7 校验口径含 `UNLINK`:确认 4.6 的输出中 `UNLINK` 项没有「Texture does not have any items in this pack that are using this」警告,而不只看 ERROR 计数
- [x] 4.8 `mct add` 端到端:在模组目录执行 `mct add basicUnitCubeBlock probe_block -i . -o .`,确认行为包内容落入 `behavior_packs/keepinventory/` 且 `manifest.json` 的 `header.uuid` 未变;因本模组只有行为包,会额外产生空模块伪包 `resource_packs/contoso_*`,确认清理后 `npm run pack` 恢复正常;验证后清理探针文件与清单条目
- [x] 4.9 `openspec validate standardize-pack-directories --strict` 通过
