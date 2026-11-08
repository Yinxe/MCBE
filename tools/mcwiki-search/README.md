# @mc-toolchain/mcwiki-search

Minecraft Wiki 只读查询工具：搜索词条、列出章节、抓取正文（默认转成 Markdown）、获取标题建议。
支持 `zh`（zh.minecraft.wiki）与 `en`（minecraft.wiki）两个站点。

只读：不写入、不登录、不需要 API Key，只用公开的 MediaWiki Action API。

## 安装

要求 **Node.js >= 20**。三种使用面分别安装：

```bash
# 库（在自己的项目中作为依赖）
npm install @mc-toolchain/mcwiki-search

# CLI（不安装，直接用 npx）
npx mcwiki-search --help

# pi 工具与 skill
pi install npm:@mc-toolchain/mcwiki-search
```

安装后无需在本地构建：包内已包含 `dist/` 构建产物、pi 扩展入口与 skill。

## 四个使用面

| 使用面 | 入口 | 面向谁 |
| --- | --- | --- |
| 库 API | `import { createMcwikiSearch } from '@mc-toolchain/mcwiki-search'` | 其他 JS/TS 程序 |
| CLI | `mcwiki-search <子命令>` | 人与 Agent |
| pi 工具 | 名为 `mcwiki` 的 pi 工具 | pi Agent 直接调用 |
| Skill | `skills/mcwiki-search/SKILL.md` | 告诉 Agent 何时该查 Wiki |

四个面共用同一套核心（`src/core`）；核心只依赖标准 `fetch` 与 `AbortSignal.timeout`，
不使用任何 Node 专有 API，因此库与 pi 工具可在浏览器/边缘运行时中复用。

## 统一结果形状

四类查询返回同一套结构（类型定义见 `src/core/types.ts`）：

| 查询 | 结果类型 | 关键字段 |
| --- | --- | --- |
| `search()` | `SearchResult` | `query`、`results[]`（`title` / `snippet` / `redirect` / `pageId` / `size` / `wordCount`） |
| `sections()` | `SectionsResult` | `title`、`sections[]`（`index` / `number` / `level` / `title` / `anchor`） |
| `page()` | `PageResult` | `title`、`section`、`format`、`length`、`content` |
| `suggest()` | `SuggestResult` | `query`、`suggestions[]`（字符串列表） |

失败一律抛出/返回 `ErrorResult` 形状：`code`（稳定枚举）、`message`、`hint`（可执行的下一步建议）。

## 快速开始（库）

```ts
import { createMcwikiSearch } from '@mc-toolchain/mcwiki-search';

const wiki = createMcwikiSearch({ language: 'zh' });

const page = await wiki.page({ title: '苦力怕', section: '掉落物' });
console.log(page.format); // 'markdown'
console.log(page.content); // 含「火药 / 0–2 / 66.67%」的掉落表

const hits = await wiki.search({ query: '红石中继器' });
for (const item of hits.results) {
  console.log(item.title, item.snippet);
}
```

> 示例需要能访问 `zh.minecraft.wiki`；包内已含 `dist/`，无需先构建。

## 格式阶梯

`page()` 的 `format` 省略时按下面的阶梯取默认值：

| 场景 | 默认 `format` | 实现 |
| --- | --- | --- |
| 整页（未指定 `section`） | `text` | TextExtracts 紧凑纯文本 |
| 单个章节 | `markdown` | 渲染 HTML → 清洗 → Markdown（表格保留） |
| 显式 `format: 'wikitext'` | `wikitext` | 原始 wikitext 透传（无损逃生通道） |
| 显式 `format: 'text'` + 章节 | `text` | 渲染 HTML → 带换行的纯文本 |

`length` 记录转换前原始正文的字符数（HTML / wikitext / 纯文本），用于衡量压缩比例。

## 命令行（CLI）

包内自带 `mcwiki-search` 可执行文件（`bin` → `dist/cli/index.js`）。用 `npx` 直接调用，无需全局安装：

```bash
npx mcwiki-search --help
```

### 四个子命令

```bash
# 搜索词条
npx mcwiki-search search 红石中继器 --limit 3

# 章节目录（序号 / 编号 / 缩进标题）
npx mcwiki-search sections 苦力怕

# 读取正文：单节默认 markdown，整页默认 text
npx mcwiki-search page 苦力怕 -s 掉落物
npx mcwiki-search page 苦力怕 -s 0                     # 0 = 导言
npx mcwiki-search page 苦力怕 -f wikitext -s 掉落物 | head -5

# 相近词条
npx mcwiki-search suggest 红石
```

### 全局选项

`--language`（`zh` 默认 / `en`）、`--timeout`（毫秒）、`--json`；可放在子命令前后：

```bash
npx mcwiki-search --language en sections Creeper
npx mcwiki-search search 红石 --json | jq -r '.results[].title'
```

### 管道与退出码

非交互终端（管道 / 重定向）下自动输出 JSON；提示与错误走 stderr；失败时退出码非零：

```bash
npx mcwiki-search page 苦力怕 -s 掉落物 | jq -r .content
npx mcwiki-search page 不存在的词条; echo "exit=$?"
```

## pi 工具与 Skill

本包声明了 `pi.extensions` 与 `pi.skills`（见 `package.json`），装上即生效：

```bash
# 直接从本地包目录加载（不经安装）
pi -e tools/mcwiki-search --skill tools/mcwiki-search/skills/mcwiki-search
```

### `mcwiki` 工具

一个工具用 `action` 区分四类查询，`details` 回传统一结果形状：

```json
{"action": "search", "query": "苦力怕"}
{"action": "sections", "title": "苦力怕"}
{"action": "page", "title": "苦力怕", "section": "掉落物"}
{"action": "suggest", "query": "红石"}
```

可选参数：`section`（序号 / 点分编号 / 锚点 / 标题名，`0` = 导言）、
`format`（`markdown` / `text` / `wikitext`）、`language`（`zh` / `en`）、
`limit`（1–50）。失败时 `isError: true`，`details` 为 `ErrorResult`。

### Skill

`skills/mcwiki-search/SKILL.md` 告诉 Agent **何时**查 Wiki 以及**省 token 的查询顺序**
（先 `search` 定标题 → 再 `sections` 看目录 → 最后 `page` 只读单节）。

## 已知限制

- **合成网格空间布局丢失。** `{{Crafting}}` 渲染出的 2×2 / 3×3 网格转成 Markdown 表格后，
  只剩「材料 → 产物」的线性信息，无法还原「哪一格放什么」。
  这是有意接受的取舍（Markdown 表格无法表达二维槽位）：
  已在 `src/core/markdown.ts` 与 `src/core/markdown.test.ts` 的「合成网格退化为线性表格」用例中记录，
  对策是把 `format` 字段当作扩展点，日后可为 `{{Crafting}}` 渲染出的表格单独加网格识别器
  （见 `openspec/changes/add-mcwiki-search/design.md` 的 Risks / Trade-offs）。
- **信息框表格列会对齐成等宽表头。** Markdown 表格经 `node-html-markdown` 归一化后，
  合并单元格/嵌套表头会被展开成额外列，内容仍在，但列语义会变弱。
- **仅支持只读查询。** 不提供编辑、上传、登录等写操作。

## 开发

```bash
npm run typecheck   # tsc --noEmit
npm test            # vitest run
npm run build       # 产出 dist/（CLI 入口 dist/cli/index.js）
```
