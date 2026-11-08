# Tasks

## 1. 脚手架与依赖

- [x] 1.1 新建 `tools/mcwiki-search` 包骨架（`package.json` 名 `@mc-toolchain/mcwiki-search`、`type: module`、`bin`、`pi` 清单、`tsconfig.json`、`src/core`、`src/cli`、`src/pi`、`skills/mcwiki-search`），并在根 `package.json` 把 `workspaces` 改为 `["mods/*", "tools/*"]`；验证 `npm install` 成功且 `npm ls -w @mc-toolchain/mcwiki-search` 能解析出该包名。
- [x] 1.2 添加运行时依赖 `commander`、`node-html-markdown`、`node-html-parser` 与开发依赖 `typescript`、`vitest`，配置 `build`/`test`/`typecheck` 脚本；验证空测试下 `npm run -w @mc-toolchain/mcwiki-search typecheck` 与 `npm test -w @mc-toolchain/mcwiki-search` 均通过。

## 2. 核心：站点、配置与错误

- [x] 2.1 实现站点描述符（zh/en、`pageUrl`、`normalizeTitle`、`splitAnchor`）与配置（`language` 默认 `zh`、`timeout`）；验证单测覆盖两站 URL 生成与标题规范化，命令 `npm test -w @mc-toolchain/mcwiki-search` 通过。
- [x] 2.2 实现错误类型（分类 `code` + `message` + `hint` + 退出码映射）；验证单测断言各分类字段完整，且缺词条错误带可操作提示。

## 3. 核心：HTTP 客户端

- [x] 3.1 实现基于标准 `fetch` 的客户端（可识别 User-Agent、超时、瞬时失败有限重试、JSON 解析）并支持注入 `fetchImpl`；验证以桩 fetch 的单测覆盖「重试后成功」「重试耗尽报错」「超时中止」三种路径。
- [x] 3.2 确保核心不依赖 Node 专有 API；验证在无 Node 全局的环境（或源码 import 检查）下运行核心单测不触发 Node 专有模块。

## 4. 核心：搜索、标题解析与章节

- [x] 4.1 实现词条搜索，无命中返回空列表；验证桩响应单测断言命中列表字段与空列表行为。
- [x] 4.2 实现章节目录与章节定位（序号/编号/锚点/标题）；验证单测覆盖按标题定位成功与定位失败时抛出带可用章节提示的错误。
- [x] 4.3 实现跨语言标题解析回退（zh↔en）与两站皆缺的报错；验证桩响应单测覆盖回退成功（含实际语言与标题）与双站缺失报错。

## 5. 核心：正文读取与 Markdown 管线

- [x] 5.1 实现整页紧凑纯文本（TextExtracts）；验证单测断言整页默认格式为 `text` 且输出不含 HTML 标记。
- [x] 5.2 实现 DOM→Markdown 管线（清洗规则常量化 + `node-html-markdown` + Markdown 后处理）；验证以 fixture HTML 断言输出不含图片、编辑链接与仅由分隔线构成的行。
- [x] 5.3 实现格式阶梯（单节默认 `markdown`、`text` 兜底、`wikitext` 透传）；验证单测覆盖三种格式与各自默认值。
- [x] 5.4 用真实抓取的 fixture 验证表格保真（信息框含最大生命值与实体 ID；掉落表含物品、数量范围与概率）；验证对应 fixture 测试通过。
- [x] 5.5 在 README 与测试注释中记录「合成网格空间布局丢失」为已知限制；验证文件中明示该限制，且设计文档 design.md 引用一致。

## 6. 库导出

- [x] 6.1 导出 `McwikiSearch` 与 `createMcwikiSearch`，`page()` 单节默认 `format: 'markdown'`（整页默认 `text`，与规格一致），并返回统一结果形状；验证单测断言 `search`/`sections`/`page`/`suggest` 四类结果的字段结构。
- [x] 6.2 编写包 README/API 文档（简体中文），说明四个面与统一结果形状；验证 README 中每条示例可照抄运行通过。

## 7. CLI

- [x] 7.1 用 `commander` 接线 `search`/`sections`/`page`/`suggest` 四个子命令，参数语义与库选项一致；验证 `--help` 与各子命令冒烟运行通过。
- [x] 7.2 实现 TTY/非 TTY 输出切换：非 TTY 或 `--json` 输出 JSON，提示信息走 stderr，失败返回非零退出码；验证管道调用时 stdout 为 JSON 且失败用例退出码非零。
- [x] 7.3 编写 CLI 使用文档；验证 README CLI 小节中的命令可照抄运行通过。

## 8. pi 工具与 Skill

- [x] 8.1 以 `pi.registerTool` 注册名为 `mcwiki` 的工具（`action` 及相关参数，返回结构化 `details`）；验证类型检查通过并能在本地作为扩展加载。
- [x] 8.2 编写 `skills/mcwiki-search/SKILL.md`（何时使用、先搜索再按节读取的省 token 用法）；验证 frontmatter 含 `name` 与 `description` 且该 skill 可被发现。
- [x] 8.3 在 `package.json` 声明 `pi.extensions` 与 `pi.skills`；验证 pi 加载该包后工具与 skill 均出现。

## 9. 集成验证

- [x] 9.1 验证跨面一致：同一查询经库与 CLI（JSON）返回等价字段结构；集成测试断言通过。
- [x] 9.2 运行全量 `npm run -w @mc-toolchain/mcwiki-search typecheck`、`npm test -w @mc-toolchain/mcwiki-search` 与 `openspec validate add-mcwiki-search`；三者均通过。
- [x] 9.3 （可选）对 zh 与 en 各做一次真实网络冒烟并记录结果；网络不可用时跳过并在输出中明确标注跳过。
  - 实测（`createMcwikiSearch` + 线上 API）: `zh` 站点=中文 Minecraft Wiki，`苦力怕` 28 章节，搜索 821 命中，`掉落物` 节 `format=markdown`、正文 11111 字符、无残留 HTML；`en` 站点=English Minecraft Wiki，`Creeper` 35 章节，搜索 1176 命中，`Drops` 节 `format=markdown`、正文 9614 字符、无残留 HTML。

## Workflow follow-up

- 评审要求满足后归档该 change，并核对归档结果。
