/**
 * CLI 的人类可读渲染。
 *
 * 只负责把统一结果形状排版成终端文本；JSON 输出不走这里。
 * 不引入终端宽度探测——按行输出，不换行、不截断正文。
 */

import type { PageResult, SearchResult, SectionsResult, SuggestResult } from '../core/types.js';

const INDENT = '  ';

/** 每级章节缩进两个空格。 */
function sectionIndent(level: number): string {
  return INDENT.repeat(Math.max(level - 1, 0));
}

export function renderSearch(result: SearchResult): string {
  const lines = [`「${result.query}」命中 ${result.results.length} 条（站点共 ${result.total} 条）— ${result.site}`];
  if (result.results.length === 0) {
    lines.push('', '没有命中。试试更短的关键词，或用 suggest 子命令看相近词条。');
    return `${lines.join('\n')}\n`;
  }
  lines.push('');
  result.results.forEach((item, index) => {
    lines.push(`${index + 1}. ${item.title}`);
    if (item.snippet !== '') {
      lines.push(`${INDENT}${item.snippet}`);
    }
  });
  return `${lines.join('\n')}\n`;
}

export function renderSections(result: SectionsResult): string {
  const lines = [`${result.title} — 共 ${result.sections.length} 个章节（${result.site}）`];
  for (const section of result.sections) {
    const index = String(section.index).padStart(3, ' ');
    const number = section.number.padEnd(5, ' ');
    lines.push(`${index}  ${number}${sectionIndent(section.level)}${section.title}`);
  }
  lines.push('', result.url);
  return `${lines.join('\n')}\n`;
}

export function renderPage(result: PageResult): string {
  const heading =
    result.section === null
      ? `${result.title}（整页 · ${result.format}）`
      : `${result.title} › ${result.section.title}（${result.format}）`;
  return `${heading}\n${result.url}\n\n${result.content}\n`;
}

export function renderSuggest(result: SuggestResult): string {
  if (result.suggestions.length === 0) {
    return `「${result.query}」没有相近词条。\n`;
  }
  const lines = [`「${result.query}」的相近词条:`, ...result.suggestions.map((title) => `${INDENT}${title}`)];
  return `${lines.join('\n')}\n`;
}
