/**
 * 四个交付面（库 / CLI / skill / pi 工具）共用的结果形状。
 *
 * 命名约定：字段一律使用完整单词，避免缩写歧义（语言用 `language` 而非 `lang`）。
 */

import type { WikiLanguage } from './sites.js';

/** 支持的 Wiki 语言版本（与 `sites.ts` 共用同一联合类型）。 */
export type { WikiLanguage };

/** 正文可选格式：Markdown（默认，保留表格）/ 紧凑纯文本 / 原始 wikitext。 */
export type BodyFormat = 'markdown' | 'text' | 'wikitext';

/** 搜索结果中的单条词条。 */
export interface SearchResultItem {
  title: string;
  /** 纯文本摘要片段，不含 HTML 标记。 */
  snippet: string;
  /** 该结果是否由重定向解析而来。 */
  redirect: boolean;
  pageId: number;
  size: number;
  wordCount: number;
  timestamp?: string;
}

export interface SearchResult {
  query: string;
  language: WikiLanguage;
  site: string;
  total: number;
  results: SearchResultItem[];
}

/** 章节目录中的单项。 */
export interface SectionItem {
  /** MediaWiki 章节序号（0 为导言，可在 `section` 参数中直接使用）。 */
  index: number;
  /** 点分章节编号，例如 `2.1`。 */
  number: string;
  level: number;
  title: string;
  anchor: string;
}

export interface SectionsResult {
  title: string;
  language: WikiLanguage;
  site: string;
  pageId: number;
  url: string;
  sections: SectionItem[];
}

export interface PageResult {
  title: string;
  language: WikiLanguage;
  site: string;
  pageId: number;
  url: string;
  /** 命中的单个章节；整页读取时为 null。 */
  section: SectionItem | null;
  format: BodyFormat;
  /** 转换前的原始正文字符数（HTML / wikitext / 纯文本），用于衡量压缩比例。 */
  length: number;
  content: string;
}

export interface SuggestResult {
  query: string;
  language: WikiLanguage;
  site: string;
  suggestions: string[];
}

/** 失败时的统一返回/输出形状。 */
export interface ErrorResult {
  error: {
    code: string;
    message: string;
    hint?: string;
  };
}
