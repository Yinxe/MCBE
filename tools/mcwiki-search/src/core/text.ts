/**
 * 纯文本处理：HTML 实体解码、去标签、搜索摘要高亮。
 *
 * 移植自参考实现 `tools/packages/mcwiki/src/format.ts`，差异：
 * - 只保留与文本内容相关的函数；终端宽度/对齐等展示逻辑移到 CLI 层；
 * - 命名改为完整单词（`highlight` 回调由调用方注入，便于 JSON 模式关闭高亮）。
 */

const NAMED_ENTITIES: Record<string, string> = {
  nbsp: ' ',
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  ndash: '–',
  mdash: '—',
  hellip: '…',
  middot: '·',
  times: '×',
  divide: '÷',
  deg: '°',
  plusmn: '±',
  laquo: '«',
  raquo: '»',
  ldquo: '“',
  rdquo: '”',
  lsquo: '‘',
  rsquo: '’',
};

/** 解码 MediaWiki 输出的 HTML 实体（`&nbsp;`、`&#39;`、`&#x2014;` 等）。 */
export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (match, body: string) => {
    if (body.startsWith('#')) {
      const isHex = body.startsWith('#x') || body.startsWith('#X');
      const digits = isHex ? body.slice(2) : body.slice(1);
      const code = Number.parseInt(digits, isHex ? 16 : 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) {
        return match;
      }
      try {
        return String.fromCodePoint(code);
      } catch {
        return match;
      }
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? match;
  });
}

/** 去标签、解码实体并归一空白，得到单行纯文本（搜索摘要）。 */
export function stripHtml(html: string): string {
  const withoutTags = html.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]*>/g, '');
  return decodeEntities(withoutTags).replace(/\s+/g, ' ').trim();
}

/** 块级标签；转换纯文本时保留它们的换行语义。 */
const BLOCK_TAG_PATTERN =
  /<\/?(?:p|div|li|tr|td|th|h[1-6]|table|tbody|thead|ul|ol|dl|dt|dd|blockquote|section|caption)\b[^>]*>/gi;

/**
 * 带换行结构的纯文本（`format: 'text'` 兑底用）。
 * 与 `stripHtml` 的区别：保留段落/表格行的换行，而不是压成一行。
 */
export function htmlToPlainText(html: string): string {
  const withBreaks = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(BLOCK_TAG_PATTERN, '\n');
  const stripped = decodeEntities(withBreaks.replace(/<[^>]*>/g, ''));
  const kept: string[] = [];
  let blankRun = 0;
  for (const raw of stripped.split('\n')) {
    const line = raw.replace(/\s+/g, ' ').trim();
    if (line === '') {
      blankRun += 1;
      if (blankRun > 1) {
        continue;
      }
    } else {
      blankRun = 0;
    }
    kept.push(line);
  }
  return kept.join('\n').trim();
}

/**
 * 把带 `<span class="searchmatch">` 高亮的摘要转为纯文本，
 * 命中片段交给 `highlight` 处理（JSON 模式可传恒等函数）。
 */
export function renderSnippet(html: string, highlight: (text: string) => string): string {
  const marked = html.replace(
    /<span class="searchmatch">([\s\S]*?)<\/span>/gi,
    (_match, inner: string) => `\u0000${inner}\u0000`,
  );
  const plain = stripHtml(marked);
  return plain
    .split('\u0000')
    .map((part, index) => (index % 2 === 1 ? highlight(part) : part))
    .join('');
}
