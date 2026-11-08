/**
 * Wiki API 客户端：搜索、章节目录、正文（三种格式）、联想、页面元信息、跨语言链接。
 *
 * 移植自参考实现 `tools/packages/mcwiki/src/api.ts`，差异：
 * - 传输层（超时/重试/UA）拆到 `http.ts`，本类只负责 API 语义；
 * - 字段命名为完整单词（`language`/`pageId`/`wordCount`）；
 * - 返回统一的 JSON-first 结果形状（见 `types.ts`）。
 */

import { WikiError } from './errors.js';
import { HttpClient, type ApiParams } from './http.js';
import { asArray, asBoolean, asNumber, asRecord, asString } from './json.js';
import { normalizeTitle, pageUrl, siteFor, type Site, type WikiLanguage } from './sites.js';
import { stripHtml } from './text.js';
import type { SearchResult, SearchResultItem, SectionItem } from './types.js';

export interface WikiClientOptions {
  language: WikiLanguage;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  userAgent?: string;
  /** 首次失败后的额外尝试次数（超时/网络/429/5xx）。 */
  retries?: number;
  sleep?: (ms: number) => Promise<void>;
  /** 覆盖站点描述符（测试用）。 */
  site?: Site;
}

export interface WikiPageMeta {
  title: string;
  pageId: number;
  url: string;
  length: number;
  touched?: string;
  lastRevisionId?: number;
}

export interface WikiTextContent {
  title: string;
  pageId: number;
  content: string;
}

export interface WikiRenderedHtml {
  title: string;
  pageId: number;
  html: string;
}

export interface LanguageLink {
  language: string;
  title: string;
}

/** `formatversion=2` 下 `query.pages` 是数组。 */
function firstPage(payload: unknown): Record<string, unknown> | undefined {
  const pages = asArray(asRecord(asRecord(payload)?.query)?.pages);
  return asRecord(pages[0]);
}

export class WikiClient {
  readonly language: WikiLanguage;
  readonly site: Site;
  private readonly http: HttpClient;

  constructor(options: WikiClientOptions) {
    this.language = options.language;
    this.site = options.site ?? siteFor(options.language);
    this.http = new HttpClient({
      apiUrl: this.site.apiUrl,
      baseUrl: this.site.baseUrl,
      timeoutMs: options.timeoutMs,
      fetchImpl: options.fetchImpl,
      userAgent: options.userAgent,
      retries: options.retries,
      sleep: options.sleep,
    });
  }

  /** 便于测试与调试：构造某次调用的 URL。 */
  buildUrl(action: string, params: ApiParams = {}): string {
    return this.http.buildUrl(action, params);
  }

  /**
   * 词条搜索。无命中时 `results` 为空数组而非报错。
   */
  async search(
    query: string,
    options: { limit?: number; namespace?: number } = {},
  ): Promise<SearchResult> {
    const payload = await this.http.request('query', {
      list: 'search',
      srsearch: query,
      srlimit: options.limit ?? 10,
      srnamespace: options.namespace ?? 0,
      srprop: 'snippet|wordcount|timestamp|size',
      srinfo: 'totalhits',
    });

    const queryRecord = asRecord(asRecord(payload)?.query);
    const results: SearchResultItem[] = [];
    for (const entry of asArray(queryRecord?.search)) {
      const record = asRecord(entry);
      const title = asString(record?.title);
      if (record === undefined || title === undefined) {
        continue;
      }
      const timestamp = asString(record.timestamp);
      results.push({
        title,
        snippet: stripHtml(asString(record.snippet) ?? ''),
        redirect: asBoolean(record.redirect) ?? false,
        pageId: asNumber(record.pageid) ?? 0,
        size: asNumber(record.size) ?? 0,
        wordCount: asNumber(record.wordcount) ?? 0,
        // 不写 `timestamp: undefined`：那会产生一个自有属性，使 `Object.keys()`
        // 与 JSON 序列化后的键集合不一致（库与 CLI 两面不同构）。
        ...(timestamp === undefined ? {} : { timestamp }),
      });
    }

    return {
      query,
      language: this.language,
      site: this.site.label,
      total: asNumber(asRecord(queryRecord?.searchinfo)?.totalhits) ?? results.length,
      results,
    };
  }

  /**
   * 调用 `action=parse` 并返回 `parse` 记录；缺词条时返回 undefined。
   */
  private async parseModule(
    title: string,
    params: ApiParams,
  ): Promise<Record<string, unknown> | undefined> {
    try {
      const payload = await this.http.request('parse', {
        page: normalizeTitle(title),
        redirects: true,
        ...params,
      });
      return asRecord(asRecord(payload)?.parse);
    } catch (error) {
      if (error instanceof WikiError && error.code === 'missing-title') {
        return undefined;
      }
      throw error;
    }
  }

  /** 章节目录；缺词条时返回 undefined，无章节时返回空数组。 */
  async sections(title: string): Promise<SectionItem[] | undefined> {
    const parse = await this.parseModule(title, { prop: 'sections' });
    if (parse === undefined) {
      return undefined;
    }
    const sections: SectionItem[] = [];
    for (const entry of asArray(parse.sections)) {
      const record = asRecord(entry);
      if (record === undefined) {
        continue;
      }
      const index = Number.parseInt(asString(record.index) ?? '', 10);
      if (!Number.isFinite(index)) {
        continue;
      }
      sections.push({
        index,
        number: asString(record.number) ?? '',
        level: Number.parseInt(asString(record.level) ?? '2', 10),
        title: asString(record.line) ?? '',
        anchor: asString(record.anchor) ?? '',
      });
    }
    return sections;
  }

  /** 紧凑纯文本正文（TextExtracts）；`intro` 只取导言。 */
  async extract(
    title: string,
    options: { intro?: boolean } = {},
  ): Promise<WikiTextContent | undefined> {
    const payload = await this.http.request('query', {
      prop: 'extracts',
      explaintext: true,
      exsectionformat: 'wiki',
      titles: normalizeTitle(title),
      redirects: true,
      ...(options.intro === true ? { exintro: true } : {}),
    });
    const page = firstPage(payload);
    if (page === undefined || page.missing === true) {
      return undefined;
    }
    return {
      title: asString(page.title) ?? normalizeTitle(title),
      pageId: asNumber(page.pageid) ?? 0,
      content: asString(page.extract) ?? '',
    };
  }

  /** 渲染后的 HTML（Markdown 转换的输入）；`section` 省略时为整页。 */
  async renderHtml(title: string, section?: number): Promise<WikiRenderedHtml | undefined> {
    const parse = await this.parseModule(title, {
      prop: 'text',
      disableeditsection: true,
      disabletoc: true,
      ...(section === undefined ? {} : { section }),
    });
    if (parse === undefined) {
      return undefined;
    }
    return {
      title: asString(parse.title) ?? normalizeTitle(title),
      pageId: asNumber(parse.pageid) ?? 0,
      html: asString(parse.text) ?? '',
    };
  }

  /** 原始 wikitext（无损逃生通道）；`section` 省略时为整页。 */
  async wikitext(
    title: string,
    options: { section?: number } = {},
  ): Promise<WikiTextContent | undefined> {
    const parse = await this.parseModule(title, {
      prop: 'wikitext',
      ...(options.section === undefined ? {} : { section: options.section }),
    });
    if (parse === undefined) {
      return undefined;
    }
    return {
      title: asString(parse.title) ?? normalizeTitle(title),
      pageId: asNumber(parse.pageid) ?? 0,
      content: asString(parse.wikitext) ?? '',
    };
  }

  /** 前缀联想，用于「你是不是想找」提示。 */
  async suggest(prefix: string, limit = 10): Promise<string[]> {
    const payload = await this.http.request('opensearch', {
      search: prefix,
      limit,
      namespace: 0,
      redirects: 'resolve',
    });
    if (!Array.isArray(payload)) {
      return [];
    }
    return asArray(payload[1])
      .map(asString)
      .filter((title): title is string => title !== undefined);
  }

  /** 页面元信息（正式标题、URL、长度）；缺词条时返回 undefined。 */
  async info(title: string): Promise<WikiPageMeta | undefined> {
    const payload = await this.http.request('query', {
      prop: 'info',
      inprop: 'url',
      titles: normalizeTitle(title),
      redirects: true,
    });
    const page = firstPage(payload);
    if (page === undefined || page.missing === true) {
      return undefined;
    }
    const resolved = asString(page.title) ?? normalizeTitle(title);
    return {
      title: resolved,
      pageId: asNumber(page.pageid) ?? 0,
      url: asString(page.fullurl) ?? pageUrl(this.site, resolved),
      length: asNumber(page.length) ?? 0,
      touched: asString(page.touched),
      lastRevisionId: asNumber(page.lastrevid),
    };
  }

  /** 跨语言链接（不止 zh/en）。 */
  async languageLinks(title: string): Promise<LanguageLink[]> {
    const payload = await this.http.request('query', {
      prop: 'langlinks',
      titles: normalizeTitle(title),
      lllimit: 500,
      redirects: true,
    });
    const page = firstPage(payload);
    const links: LanguageLink[] = [];
    for (const entry of asArray(page?.langlinks)) {
      const record = asRecord(entry);
      const language = asString(record?.lang);
      const target = asString(record?.title) ?? asString(record?.['*']);
      if (language === undefined || target === undefined) {
        continue;
      }
      links.push({ language, title: target });
    }
    return links;
  }
}
