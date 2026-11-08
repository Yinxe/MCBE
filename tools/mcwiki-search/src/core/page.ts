/**
 * 正文读取的格式阶梯。
 *
 * 规则：
 * - 整页 + 未指定格式 → `text`（紧凑纯文本，走 TextExtracts）；
 * - 单节 + 未指定格式 → `markdown`（渲染 HTML → Markdown，保留表格）；
 * - `wikitext` → 原样透传（无损逃生通道）；
 * - `text` → 单节走「渲染 HTML → 带换行纯文本」，整页走 TextExtracts。
 *
 * 标题一律先经 `resolveTitle` 解析（含跨语言回退）。
 */

import type { WikiClient } from './client.js';
import { WikiError } from './errors.js';
import { convertHtml } from './markdown.js';
import { resolveTitle } from './resolve.js';
import { findSection, sectionNames } from './sections.js';
import { pageUrl } from './sites.js';
import { htmlToPlainText } from './text.js';
import type { BodyFormat, PageResult, SectionItem, WikiLanguage } from './types.js';

/**
 * 导言章节的别名。`prop=sections` 不返回索引 0 的条目，
 * 因此 `section: '0'` 需要在这里合成一个目录项。
 */
const LEAD_REFERENCES: readonly string[] = ['0', '导言', 'lead', 'intro'];

const LEAD_SECTION: SectionItem = {
  index: 0,
  number: '0',
  level: 2,
  title: '导言',
  anchor: '导言',
};

export interface ReadPageOptions {
  language: WikiLanguage;
  title: string;
  /** 章节引用：序号 / 点分编号 / 锚点 / 标题名。省略则读整页。 */
  section?: string;
  /** 显式指定格式；省略时按阶梯取默认值。 */
  format?: BodyFormat;
  clientFor: (language: WikiLanguage) => WikiClient;
}

/** 未显式指定格式时的默认值。 */
export function defaultBodyFormat(hasSection: boolean): BodyFormat {
  return hasSection ? 'markdown' : 'text';
}

async function locateSection(
  client: WikiClient,
  title: string,
  reference: string,
): Promise<SectionItem> {
  const sections = await client.sections(title);
  if (sections === undefined || sections.length === 0) {
    throw new WikiError(`词条「${title}」没有可定位的章节`, {
      code: 'section-not-found',
      hint: `先看整页: mcwiki-search page "${title}"`,
    });
  }

  const matched = findSection(sections, reference);
  if (matched !== undefined) {
    return matched;
  }
  if (LEAD_REFERENCES.includes(reference.toLowerCase())) {
    return LEAD_SECTION;
  }
  throw new WikiError(`在「${title}」中找不到章节: ${reference}`, {
    code: 'section-not-found',
    hint: `可用章节: ${sectionNames(sections).join(' / ')}`,
  });
}

async function readBody(
  client: WikiClient,
  title: string,
  section: SectionItem | undefined,
  format: BodyFormat,
): Promise<{ content: string; length: number }> {
  if (format === 'wikitext') {
    const wikitext = await client.wikitext(
      title,
      section === undefined ? {} : { section: section.index },
    );
    const content = wikitext?.content ?? '';
    return { content, length: content.length };
  }

  if (format === 'text') {
    if (section === undefined) {
      const extract = await client.extract(title, { intro: false });
      const content = extract?.content ?? '';
      return { content, length: content.length };
    }
    const rendered = await client.renderHtml(title, section.index);
    const html = rendered?.html ?? '';
    return { content: htmlToPlainText(html), length: html.length };
  }

  const rendered = await client.renderHtml(title, section?.index);
  const html = rendered?.html ?? '';
  return { content: convertHtml(html), length: html.length };
}

/** 读取整页或单个章节，按格式阶梯产出统一结果。 */
export async function readPage(options: ReadPageOptions): Promise<PageResult> {
  const client = options.clientFor(options.language);
  const resolution = await resolveTitle(options.title, {
    language: options.language,
    clientFor: options.clientFor,
  });

  const reference = options.section?.trim();
  const hasSection = reference !== undefined && reference !== '';
  const section = hasSection
    ? await locateSection(client, resolution.title, reference)
    : undefined;
  const format = options.format ?? defaultBodyFormat(hasSection);
  const body = await readBody(client, resolution.title, section, format);

  return {
    title: resolution.title,
    language: options.language,
    site: client.site.label,
    pageId: resolution.pageId,
    url: pageUrl(client.site, resolution.title),
    section: section ?? null,
    format,
    length: body.length,
    content: body.content,
  };
}
