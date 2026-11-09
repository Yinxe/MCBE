# Tasks

## 1. 类型与配置白名单

- [x] 1.1 在 `packages/mod-packaging/src/types.ts` 的 `PackageJson` 中新增 `productName?: string`、`author?: string | { name?: string; email?: string; url?: string }`、`repository?: string | { url?: string }`,并在 `packing` 块中新增 `qq_group?: string`;运行 `npm run typecheck -w @mc-toolchain/mod-packaging` 通过
- [x] 1.2 把 `qq_group` 加入 `SUPPORTED_PACKING_KEYS`,并在 `packages/mod-packaging/tests/configuration.test.ts` 新增用例:含 `packing.qq_group` 时不报错、含其它未知字段时仍报错;运行 `npm test -w @mc-toolchain/mod-packaging` 通过

## 2. 元信息拼接纯逻辑

- [x] 2.1 新建 `packages/mod-packaging/src/metadata.ts`,实现 `resolvePackDisplayName(packageJson)` 返回 `<productName> v<version>`,`productName` 缺失或空字符串时抛出指明字段名的错误
- [x] 2.2 在同一模块实现 `resolvePackDescription(packageJson)`:行数组拼接,固定顺序为简介、作者、邮箱、主页、QQ群、仓库;缺失字段整行省略不产生空行;`description` 缺失或空字符串时抛错
- [x] 2.3 在同一模块实现仓库 URL 规范化(去 `git+`、`git@<host>:<path>` → `https://<host>/<path>`、去尾部 `.git` 与 `/`),`author` 支持字符串与对象两种形式
- [x] 2.4 新建 `packages/mod-packaging/tests/metadata.test.ts`,覆盖:显示名格式、`productName` 缺失报错、六行完整描述、部分字段缺失时无空行、`§` 颜色符号原样保留、`description` 缺失报错、SSH 与 https 两种仓库地址归一、`author` 为字符串时不产生邮箱与主页行;运行 `npm test -w @mc-toolchain/mod-packaging` 全部通过
- [x] 2.5 在 `packages/mod-packaging/src/index.ts` 导出新增函数与类型,使模组侧可引用;运行 `npm run typecheck -w @mc-toolchain/mod-packaging` 通过

## 3. 打包时写入清单

- [x] 3.1 在 `packages/mod-packaging/src/packs.ts` 的 `synchronizePackVersions` 中,对行为包与资源包各写入 `header.name = resolvePackDisplayName(...)` 与 `header.description = resolvePackDescription(...)`,与既有版本字段在同一次读改写内完成,并在日志中输出写入的显示名
- [x] 3.2 在 `packages/mod-packaging/README.md` 补充「清单元信息由 `package.json` 派生」小节:字段来源表(`productName`/`description`/`author`/`repository`/`packing.qq_group`)、描述行顺序、缺失降级规则,并验证文档中的示例与 `src/metadata.ts` 实际输出一致

## 4. 五个模组补齐元信息

- [x] 4.1 在 `mods/auto-refill/package.json`、`mods/craftablerarities/package.json`、`mods/keepinventory/package.json`、`mods/spectator-mode/package.json`、`mods/teleporter/package.json` 中各补 `author`(name/email/url)、`repository` 与 `packing.qq_group: "632178498"`
- [x] 4.2 在 `mods/README.md` 的打包约定部分补一段:显示名与描述由 `package.json` 派生,`header.name` / `header.description` 不得手工编辑;并验证该段与第 3 组 README 的表述一致
- [x] 4.3 依次执行 `npm run pack -w @mc-toolchain/<mod-name>` 打包全部五个模组,解压 `release/` 下各产物确认 `manifest.json` 的 `header.name` 为 `<productName> v<version>`、`header.description` 首行为 `package.json#description` 且联系信息齐全

## 5. 集成验证

- [x] 5.1 验证 `header.name` / `header.description` 与 `package.json` 的一致性:临时修改某模组 `package.json#description` 后重新打包,确认产物清单随之变化,随后还原该改动
- [x] 5.2 验证 `manifest.json` 中手工写入的 `header.name` 会被覆盖:临时把某清单 `header.name` 改为其它值后打包,确认产物内为派生值,随后还原该改动
- [x] 5.3 运行 `npm test -w @mc-toolchain/mod-packaging` 与 `npm run typecheck -w @mc-toolchain/mod-packaging`,确认全部通过

## Workflow follow-up

- 按项目评审要求完成 review 后归档本变更。
- 归档后确认 `openspec/specs/addon-packaging/spec.md` 与 `openspec/specs/mod-workspace/spec.md` 已包含本次新增需求。
