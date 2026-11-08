# Tasks

## 1. GitHub 仓库与 remote

- [x] 1.1 创建 GitHub 仓库 `Yinxe/mc-toolchain`（public），添加为 `origin` 并推送当前分支；验证 `gh repo view Yinxe/mc-toolchain --json name,visibility` 返回该仓库且 `git remote -v` 含 `origin`。
- [x] 1.2 确认推送后工作区与远端一致；验证 `git status --short` 无未跟踪的构建产物（`dist/` 仍被忽略）。

## 2. 包元数据与许可证

- [x] 2.1 从 `tools/mcwiki-search/package.json` 移除 `"private": true`；验证 `python3 -c "import json;d=json.load(open('tools/mcwiki-search/package.json'));print('private' in d)"` 输出 `False`。
- [x] 2.2 在 `tools/mcwiki-search/package.json` 补 `repository`（`type: git`、`url: git+https://github.com/Yinxe/mc-toolchain.git`、`directory: tools/mcwiki-search`）、`bugs`、`homepage` 与 `publishConfig.access: "public"`；验证 JSON 可解析且四个字段齐全。
- [x] 2.3 新增 `tools/mcwiki-search/LICENSE`（MIT，版权人 `Yinx`）；验证文件存在且首行为 `MIT License`，许可类型与 `package.json` 的 `license` 一致。

## 3. 发布脚本

- [x] 3.1 在 `tools/mcwiki-search/package.json` 的 `scripts` 增加 `prepublishOnly`（依次 `npm run typecheck && npm run test && npm run build`）；验证 `npm pkg get scripts.prepublishOnly -w @mc-toolchain/mcwiki-search` 返回该命令。
- [x] 3.2 增加 `publish:dry`（`npm publish --dry-run`）与 `publish:npm`（`npm publish`）两条脚本；验证 `npm run publish:dry` 退出码为 0。
- [x] 3.3 验证 `prepublishOnly` 链路真实生效：在 `npm run publish:dry` 的输出中确认类型检查、测试与构建三个阶段都被执行（而非被跳过）。
- [x] 3.4 验证测试失败会阻止发布：临时让一条测试失败后执行 `npm run publish:dry`，确认以非零退出且未生成 tarball；随后还原该测试并确认 `npm test` 恢复通过。

## 4. 发布产物内容

- [x] 4.1 用 `npm pack --dry-run` 核对清单：确认包含 `dist/`（库与 CLI 产物）、`src/pi/extension.ts`、`skills/mcwiki-search/SKILL.md` 与 `LICENSE`；验证三者在清单中各至少出现一次。
- [x] 4.2 确认清单不含测试与夹具：验证 `npm pack --dry-run` 输出中 `.test.ts` 与 `fixtures` 的计数均为 0。
- [x] 4.3 验证 tarball 中的 `dist/` 由当前源码重建：删除 `dist/` 后执行 `npm run publish:dry`，确认清单仍含 `dist/core/index.js` 与 `dist/cli/index.js`。

## 5. 文档

- [x] 5.1 在 `tools/mcwiki-search/README.md` 新增「安装」章节，覆盖库（`npm install @mc-toolchain/mcwiki-search`）、CLI（`npx mcwiki-search`）与 pi（`pi install npm:@mc-toolchain/mcwiki-search`）三种方式，并标注 `Node >= 20`；验证三个命令片段与版本要求都在章节内。
- [x] 5.2 新建仓库根 `README.md`，含项目简介、目录结构（`mods/`、`tools/`）与指向 `tools/mcwiki-search/README.md` 的链接；验证根 README 存在且链接路径正确。
- [x] 5.3 在根 `README.md` 新增「发布」章节，说明前置条件（`npm login`、`@mc-toolchain` scope 归属）、`publish:dry` → `publish:npm` 的顺序与「发布不可撤回、出错提 patch 版本」的约定；验证该章节包含这三项。

## 6. 首次发布与安装验证

- [x] 6.1 执行 `npm run publish:dry` 复核清单与体积，确认无异常后再发布；验证退出码为 0 且清单条目数与预期一致。
- [x] 6.2 发布 `0.0.1`（`0.1.0` 因误删整包被 npm 永久占用，无法重发）。已通过 `npm stage publish` + 网页批准上线；`npm view` 返回 `0.0.1`，`latest` 指向 `0.0.1`。
- [x] 6.3 空目录 `npm install @mc-toolchain/mcwiki-search` → 库导入成功，`createMcwikiSearch({language:"zh"})` 可用。
- [x] 6.4 `npx mcwiki-search --version` → `0.0.1`；`page 苦力怕 -s 掉落物` 返回 markdown / 11111 字符 / 含「火药」。
- [x] 6.5 pi 加载验证：`discoverAndLoadExtensions` 得到 tools `["mcwiki"]`、skills `["mcwiki-search"]`，0 errors / 0 diagnostics。

## Workflow follow-up

- 评审要求满足后归档该 change，并核对归档结果。
