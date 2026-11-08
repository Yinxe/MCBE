---
name: mcwiki-search
description: 查询 Minecraft Wiki 的词条、章节目录与正文。当需要 Minecraft 的方块、生物、物品、合成配方、掉落物、机制或版本历史等事实资料时使用；先用 search 定准标题，再用 sections 看目录，最后用 page 只读需要的那一节以节省 token。
---

# 查询 Minecraft Wiki

Minecraft Wiki（zh 中文站 / en 英文站）的只读查询。**不要凭记忆回答 Minecraft 事实问题**，
先查再答，并给出 `url` 作为出处。

## 怎么调用

优先用 pi 的 `mcwiki` 工具（一个工具，用 `action` 区分四类查询）：

```json
{"action": "search", "query": "苦力怕"}
{"action": "sections", "title": "苦力怕"}
{"action": "page", "title": "苦力怕", "section": "掉落物"}
{"action": "suggest", "query": "红石"}
```

没有该工具时，用等价的 CLI（输出 JSON，字段与工具 `details` 一致）：

```bash
mcwiki-search search 苦力怕 --json
mcwiki-search sections 苦力怕 --json
mcwiki-search page 苦力怕 -s 掉落物 --json
mcwiki-search suggest 红石 --json
```

## 省 token 的查询顺序

1. **先 `search` 定准标题** —— 中文站常用俗名，英文站用官方名。标题错会白读一次。
   找不到时用 `suggest` 按前缀找相近标题。
2. **再 `sections` 看目录** —— 拿到 `index` / `number` / `title`，只挑需要的那几节。
3. **最后 `page` 只读单节** —— `section` 接受序号（`2`）、点分编号（`2.1`）、
   锚点或标题名（`掉落物`）；`0` 表示导言。**整页很长，非必要不要整页读。**

单节默认 `markdown`（保留表格，适合读配方与掉落物表），整页默认 `text`（最省 token）。
需要原始标记时才用 `"format": "wikitext"`。

## 注意

- 数据是只读快照，不含教程页以外的社区讨论；版本相关结论请说明对应版本。
- 返回的 `content` 是正文；`length` 是转换前的原始字符数，可用来判断压缩效果。
- 合成网格的空间排布在 Markdown 里会退化为表格，格子位置可能需要结合原文链接确认。
- 失败时返回 `{ "error": { "code", "message", "hint" } }`；`hint` 通常直接给出下一步。
  常见 `code`：`missing-title`（标题不对，先 `search`/`suggest`）、`section-not-found`
  （章节名不对，先 `sections`）、`rate-limited`（稍后重试）。
