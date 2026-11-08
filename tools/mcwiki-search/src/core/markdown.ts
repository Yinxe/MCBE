/**
 * HTML → Markdown 管线。
 *
 * 三步，顺序不可调换：
 *
 * 1. `cleanHtml`：在 DOM 层移除界面外壳、图片与脚注，规则见 `REMOVAL_SELECTORS`。
 *    `node-html-markdown` 只暴露分隔符 / 缩进等选项，没有「删图片 / 删链接」开关，
 *    因此删除必须在转 Markdown 之前以确定性的 DOM 操作完成。
 * 2. `NodeHtmlMarkdown.translate`：表格结构靠它保留（信息框、掉落表）。
 * 3. `cleanMarkdown`：兜底后处理——去掉图片与链接语法、`[[…]]` 残渣、
 *    仅由分隔线构成的行，并折叠多余空行。
 *
 * 已知限制：`{{Crafting}}` 合成网格的空间布局在表格化后会丢失
 * （详见 README「已知限制」与 `markdown.test.ts`）。
 */

import { NodeHtmlMarkdown } from 'node-html-markdown';
import { parse } from 'node-html-parser';

/**
 * 必须在转 Markdown 之前从 DOM 中移除的选择器。
 *
 * 依据真实抓取样本沉淀（苦力怕导言 + 掉落物章节）。注意：
 * `.tabber` / `.tabbertab` / `.mw-collapsible` / `.mw-collapsible-content`
 * **不能**移除——它们内部是真实内容（掉落表就嵌在 tabber 里）。
 */
export const REMOVAL_SELECTORS: readonly string[] = [
  // 非内容标签
  'style',
  'script',
  'noscript',
  'link',
  'meta',
  'iframe',
  'svg',
  'audio',
  'video',
  'source',
  'picture',
  'map',
  // 图片容器：图片本身与说明文字都不要
  'img',
  'figure',
  '.thumb',
  '.thumbinner',
  '.thumbcaption',
  '.gallery',
  '.infobox-imagearea',
  '.infobox-image',
  '.infobox-invimages',
  '.magnify',
  '.mw-file-description',
  // 界面外壳
  '.mw-editsection',
  '.mw-empty-elt',
  '.mw-jump-link',
  '.printfooter',
  '.catlinks',
  '.mw-hidden-catlinks',
  '.toc',
  '.toctitle',
  '.hatnote',
  '.mw-collapsible-toggle',
  '.noprint',
  '.metadata',
  '.navbox',
  '.navbox-styles',
  '.ambox',
  '.messagebox',
  '.side-box',
  '.sistersitebox',
  '.portal',
  '.searchaux',
  '.mw-indicators',
  // 脚注与参考资料
  'sup.reference',
  '.reference',
  '.references',
  '.reflist',
  '.mw-references-wrap',
  '.droptable-references',
];

/** Markdown 图片语法，整段删除。 */
const IMAGE_PATTERN = /!\[[^\]]*\]\([^)]*\)/g;
/** Markdown 链接语法，只保留链接文字。 */
const LINK_PATTERN = /\[([^\]]*)\]\([^)]*\)/g;
/** 渲染 HTML 里残留的 `[[…]]` 语法，保留显示文字。 */
const WIKI_LINK_PATTERN = /\[\[([^\]|]*)(?:\|([^\]]*))?\]\]/g;
/** 仅由分隔线构成的行（`---` / `***` / `___` / `- - -`）。 */
const HORIZONTAL_RULE_LINE = /^\s*([-*_])\s*(?:\1\s*){2,}$/;

const converter = new NodeHtmlMarkdown({
  bulletMarker: '-',
  codeBlockStyle: 'fenced',
  maxConsecutiveNewlines: 2,
  keepDataImages: false,
});

/** 在 DOM 层移除 `REMOVAL_SELECTORS` 命中的节点。 */
export function cleanHtml(html: string): string {
  if (html.trim() === '') {
    return '';
  }
  const root = parse(html, { comment: false });
  for (const selector of REMOVAL_SELECTORS) {
    for (const node of root.querySelectorAll(selector)) {
      node.remove();
    }
  }
  return root.toString();
}

/** 后处理：去图片 / 去链接 URL / 去分隔线行 / 折叠空行。 */
export function cleanMarkdown(markdown: string): string {
  const lines = markdown
    .replace(IMAGE_PATTERN, '')
    .replace(WIKI_LINK_PATTERN, (_match, plain: string, labelled?: string) => labelled ?? plain)
    .replace(LINK_PATTERN, '$1')
    .split('\n');

  const kept: string[] = [];
  let blankRun = 0;
  for (const raw of lines) {
    const line = raw.replace(/[ \t]+$/g, '');
    if (HORIZONTAL_RULE_LINE.test(line)) {
      continue;
    }
    if (line.trim() === '') {
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

/** 渲染 HTML → 干净 Markdown（含表格）。空输入返回空串。 */
export function convertHtml(html: string): string {
  const cleaned = cleanHtml(html);
  if (cleaned === '') {
    return '';
  }
  return cleanMarkdown(converter.translate(cleaned));
}
