# Tasks

## 1. 集中产物输出目录

- [x] 1.1 在根 `.gitignore` 的构建产物段加入 `release/`,验证:`git check-ignore -v release/` 命中该规则
- [x] 1.2 `mods/auto-refill/package.json`:把 `packing.output` 从 `"../../dist/packages"` 改为 `"../../release/"`,保留 `mode` 与 `minimum_engine_version`,验证:`node -e "console.log(require('./mods/auto-refill/package.json').packing.output)"` 输出 `../../release/`
- [x] 1.3 `mods/craftablerarities/package.json`:把 `packing.output` 从 `"dist/packages"` 改为 `"../../release/"`,保留 `mode` 与 `minimum_engine_version`,验证:同上方式读取该字段为 `../../release/`
- [x] 1.4 `mods/keepinventory/package.json`:把 `packing.output` 从 `"dist/packages"` 改为 `"../../release/"`,保留 `mode`,验证:同上方式读取该字段为 `../../release/`
- [x] 1.5 `mods/spectator-mode/package.json`:把 `packing.output` 从 `"dist/packages"` 改为 `"../../release/"`,保留 `mode`,验证:同上方式读取该字段为 `../../release/`
- [x] 1.6 `mods/teleporter/package.json`:把 `packing.output` 从 `"dist/packages"` 改为 `"../../release/"`,保留 `mode` 与 `minimum_engine_version`,验证:同上方式读取该字段为 `../../release/`
- [x] 1.7 确认 5 个模组的 `packing.output` 完全一致,验证:`grep -h '"output"' mods/*/package.json | sort -u` 只输出一行 `"output": "../../release/",`
- [x] 1.8 确认打包库源码未被改动,验证:`git status --porcelain packages/mod-packaging/src/` 输出为空

## 2. 清理模组内的旧产物

- [x] 2.1 删除 5 个模组下已有的 `dist/packages/` 目录(其中的 `.mcpack` 未入库,重新打包可再生),验证:`ls -d mods/*/dist/packages 2>/dev/null` 无输出
- [x] 2.2 确认删除未影响构建中间产物目录,验证:`ls -d mods/*/dist` 对仍有 `dist/scripts` 等中间产物的模组正常列出

## 3. 文档同步

- [x] 3.1 `mods/README.md`:在打包小节补充「产物统一写入仓库根 `release/`,各模组 `package.json` MUST 显式声明 `"packing.output": "../../release/"`,不要在模组目录内留产物」,验证:文件内检索 `release/` 能找到该约定
- [x] 3.2 `packages/mod-packaging/README.md`:示例配置的 `output` 改为 `"../../release/"`,`packing` 字段表的默认值仍为 `dist/packages`(库语义未变),验证:示例与字段表同时存在且互不矛盾
- [x] 3.3 更新各模组 `README.md` 中描述**自身产物**的路径示例为 `<仓库根>/release/<name>-v<version>_bp.mcpack`:`auto-refill`(第 76 行附近)、`craftablerarities`(第 21 行附近)、`keepinventory`(第 104、113 行附近)、`spectator-mode`(第 81 行附近)、`teleporter`(第 81 行附近)。**例外**:`keepinventory` 第 166 行描述的是模板自带的官方 `mcaddon` 脚本,它的 `outputFile` 在 `just.config.ts` 中硬编码为 `./dist/packages/${projectName}.mcaddon`,不在 `packing.output` 管辖范围,该行 MUST 保留原样。验证:除该例外行外,`grep -rn "dist/packages" mods/*/README.md` 无输出
- [x] 3.4 全仓复核无遗漏的旧路径引用,并修正 `just.config.ts` 中已过时的注释:5 个模组的 `// 只清理构建中间产物,保留 dist/packages 里已产出的历史版本。` 中的 `dist/packages` 改为指向 `packing.output` 的泛称(产物已不落 `dist/packages`,该注释已失真)。验证:`grep -rn "dist/packages" --include="*.md" --include="*.json" . | grep -v node_modules | grep -v "openspec/"` 仅剩四处且均有正当理由 —— `packages/mod-packaging/README.md` 的默认值说明、`mods/keepinventory/README.md:166` 的官方 `mcaddon` 脚本说明、`docs/research/` 下两篇历史调研文档(不改)

## 4. 端到端验证

- [x] 4.1 依次在 5 个模组目录执行 `npm run pack`,验证:`ls release/` 列出 5 个产物 —— `auto-refill-v2.2.0_bp.mcpack`、`craftablerarities-v1.0.1_bp.mcpack`、`keepinventory-v0.0.1_bp.mcpack`、`spectator-mode-v1.0.11_bp.mcpack`、`teleporter-v0.0.6_bp.mcpack`
- [x] 4.2 抽查任一产物确认内容未受影响,验证:解包 `release/spectator-mode-v1.0.11_bp.mcpack` 后 `manifest.json` 的 `header.version` 与源清单一致,且含 `scripts/main.js`
- [x] 4.3 确认产物不入库,验证:`git status --porcelain` 中不出现 `release/` 下任何文件
- [x] 4.4 确认模组目录不再产生新产物,验证:再次执行 `ls -d mods/*/dist/packages 2>/dev/null` 无输出

## Workflow follow-up

- 全部任务完成后运行 `/opsx-archive consolidate-pack-output-to-release`,把 `addon-packaging` 的「产物命名与位置」修订同步进主 spec。
