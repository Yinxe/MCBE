# Design

## Context

- 参考实现 `~/coding/tools/packages/mcwiki`（另一仓库、私有、pnpm、运行时依赖仅 `commander`）已提供稳定的站点描述符、错误类型、HTTP 客户端与重试、搜索、标题解析与章节匹配。本设计复用这些稳定部分，替换正文提取方式。参见 proposal.md 的动机。
- 实测（隔离探针，`zh.minecraft.wiki/api.php`）：`action=parse&prop=text` 渲染 HTML 会把模板/Lua 展开，信息框与掉落表都是真实表格；`prop=wikitext` 未展开、无数据；`prop=extracts&explaintext` 会丢弃全部表格。
- 实测体积（约）：苦力怕掉落节 HTML 37.5 KB → 清理后 Markdown 5.1 KB；信息框 21.6 KB → 1.2 KB；整页 TextExtracts 5.05 KB。
- 运行时：仓库 `engines` 为 Node >= 20，本地 v24；核心仅需标准 `fetch` 与 `AbortSignal.timeout`，无 Node 专有 API。
- 项目约定：包/数据类型/配置字段使用完整单词（如 `language` 而非 `lang`），注释与文档使用简体中文。

## Goals / Non-Goals

**Goals:**

- 一个只读核心，库、CLI、skill、pi 工具四面共享。
- 正文默认 Markdown，保留信息框、掉落表等表格数据。
- 与参考实现的子命令与参数语义保持兼容，便于知识与用法迁移。

**Non-Goals:**

- 结构化实体 schema（信息框/掉落表的 typed JSON，即 L3）。
- 合成网格空间布局的还原。
- 写入/编辑、鉴权、离线缓存、中英之外的站点。
- 把参考包作为依赖（私有，必须重写而非包装）。

## Decisions

1. **位置与命名**：新建 `tools/mcwiki-search`，包名 `@mc-toolchain/mcwiki-search`，根 `package.json` 的 `workspaces` 由 `["mods/*"]` 扩为 `["mods/*", "tools/*"]`。备选：放入 `mods/`（被否，本包不是模组）；独立仓库（被否，无法共享 workspace）。
2. **目录分层**：`src/core`（运行时无关的检索与转换）、`src/cli`（commander 接线 + Node I/O）、`src/pi`（`pi.registerTool` 扩展）、`skills/mcwiki-search`（skill）。核心不得 import Node 专有模块。
3. **解析策略**：渲染 HTML → DOM 清洗（`node-html-parser`）→ `node-html-markdown` → 轻量 Markdown 后处理；**不移植**参考实现的 `wikitext.ts`。备选：`wtf_wikipedia`（词条数据在未展开的 Lua 模块中，价值低）；`html-to-text`（丢表格结构）；`turndown`（CJS 在 NodeNext 下有摩擦且带 `@mixmark-io/domino`）。
4. **格式阶梯**（对应 spec `wiki-query`）：整页/首段走 TextExtracts 紧凑纯文本以控 token；单节走渲染 HTML → Markdown（默认）；`wikitext` 走原始标记透传（无损逃生口）；`text` 走去标记兜底。
5. **清洗规则清单**：集中为常量并配 fixture 测试。DOM 阶段删除 `img`、`figure`、`style`、`script`、`.mw-editsection`、`sup.reference`、`.navbox`、`.noprint`、`.metadata`、`.mw-collapsible-toggle`、`.reference`、`.thumb`、`.gallery`、`.toc`、`.printfooter`、`.catlinks`；Markdown 后处理去图片、去链接 URL（保留链接文本）、去仅由分隔线构成的行、去残留转义括号。
6. **依赖**：运行时 `commander` + `node-html-markdown`（连带 `node-html-parser`）；开发期 `typescript` + `vitest`。其余自实现。
7. **统一结果形状（JSON-first）**：`search` → `{ query, language, results: [{ title, snippet, redirect }] }`；`sections` → `{ title, language, sections: [{ index, level, title }] }`；`page` → `{ title, language, section?, format, content }`；`suggest` → `{ query, language, suggestions: [] }`；失败 → `{ error: { code, message, hint } }`。四个面返回同一形状。
8. **CLI 非交互输出**：检测 `process.stdout.isTTY`，非 TTY 或显式 `--json` 时输出 JSON；进度/提示走 stderr。失败以非零退出码退出。
9. **pi 工具**：以 `pi.registerTool()` 注册 `mcwiki`，`action` 为 `search`/`sections`/`page`/`suggest`，结构化结果放 `details`，正文放 content。
10. **移植清单**：从参考实现移植 `sites`、`errors`、`client`（重试/超时）、`search`、`resolve`（跨语言回退）、`sections`（章节匹配）、`config`（`lang` 重命名为 `language`）；重写 `format`（CJK 宽度/截断/实体）与 `commands`。移植处保留中文注释说明来源与差异。

## Risks / Trade-offs

- [合成网格布局丢失：仅保留材料与产出数量] → 记为已知限制；`format` 预留扩展点，日后可为 `{{Crafting}}` 渲染的表格单独加网格识别器。
- [清洗规则随 wiki 模板变化而失效] → 规则集中为常量并配 fixture 快照测试；未识别元素降级为普通文本而非报错。
- [渲染 HTML 体积大，单节可达数十 KB] → 仅对单节使用；整页走 TextExtracts；CLI 与工具默认按节读取。
- [MediaWiki 要求可识别 User-Agent，否则 403] → 固定可识别 UA；依赖网络的一致性测试做容错或可选。
- [Markdown 表格列宽填充与合并表头退化] → Markdown 后处理压缩空白；合并表头接受为退化表示。
- [私有参考包不可依赖，长期可能分叉] → 只复制稳定逻辑并重写提取层，在移植处注明来源与差异。

## Migration Plan

- 纯新增：新建 `tools/mcwiki-search`，不触碰 `mods/` 与既有 change。
- 根 `workspaces` 变更后需重跑 `npm install` 以更新 `package-lock.json`。
- 回滚：删除 `tools/mcwiki-search` 并还原 `workspaces`。
- 与参考实现并存于不同仓库，无冲突。
