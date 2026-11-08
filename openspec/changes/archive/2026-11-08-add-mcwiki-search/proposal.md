# Proposal

## Why

Minecraft 模组与数据开发过程中需要频繁查证官方 Wiki（方块、物品、实体、配方、掉落等）。参考实现 `~/coding/tools/packages/mcwiki` 是另一仓库里的私有 CLI，只面向人类终端：正文走 TextExtracts 会丢掉信息框、掉落表等表格数据，也无法被其他程序或 pi agent 直接复用。本仓库定位为 Minecraft 工具链而非仅模组集合，正缺一个「库、CLI、agent 共用」的 Wiki 取数模块。

## What Changes

- 新增 workspace 包 `tools/mcwiki-search`（包名 `@mc-toolchain/mcwiki-search`）；根 `package.json` 的 `workspaces` 由 `["mods/*"]` 扩为 `["mods/*", "tools/*"]`。
- 交付只读检索核心：全文搜索、章节目录、按节或整页读取正文、相近词条建议；中英文站切换与跨语言标题映射。
- 正文表示以 **Markdown** 为默认：由 MediaWiki 渲染 HTML 经 DOM 清洗后转换，保留信息框、掉落表、方块属性等表格数据；另提供 `text`（紧凑散文，控 token）与 `wikitext`（无损原文）两种格式。
- 同一核心暴露为四个面：库 `McwikiSearch`（供其他 JS/TS 程序 import）、CLI `mcwiki-search`（非 TTY 时自动输出 JSON）、专属 skill（指导 agent 何时用、如何按节读）、pi 工具 `mcwiki`。
- 复用参考实现中稳定的部分（站点描述符、错误类型、HTTP 客户端与重试、搜索、标题解析、章节匹配），**不移植**其自写 wikitext 压平器——改由渲染 HTML 转换。
- 运行时依赖限定为 `commander` 与 `node-html-markdown`（后者连带 `node-html-parser`），其余自实现。
- **明确不做（Out of scope）**：任何写入/编辑 Wiki 的操作；结构化实体 schema（信息框/掉落表的 typed JSON）；中英文之外的站点；离线缓存；合成网格空间布局的还原。

## Capabilities

### New Capabilities

- `wiki-query`: 面向 Minecraft Wiki 的只读查询行为——搜索、章节、正文读取与格式阶梯、相近建议、跨语言标题解析，以及请求礼仪（User-Agent、超时、重试）与错误语义。
- `wiki-integration`: 将 `wiki-query` 交付给三类消费者的外部契约——库导出对象、CLI 调用（含非 TTY 自动 JSON）、pi 工具注册与配套 skill。

### Modified Capabilities

- 无。仓库当前没有任何已归档 spec（`openspec list --specs` 为空），本次全部为新增能力。

## Impact

- 新增文件：`tools/mcwiki-search/**`（`src/core`、`src/cli`、`src/pi`、`skills/`、测试与构建配置）。
- 修改文件：根 `package.json`（`workspaces` 增加 `tools/*`）与锁文件。
- 依赖：运行时 `commander`、`node-html-markdown`；开发期 `typescript`、`vitest`。
- 数据源：`https://zh.minecraft.wiki` 与 `https://minecraft.wiki` 的 MediaWiki 只读 API；无鉴权、无写入、无状态。
- 不触碰 `mods/` 与既有进行中的 change `add-keepinventory-mod`。
