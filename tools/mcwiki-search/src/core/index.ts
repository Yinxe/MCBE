/**
 * 库导出面。
 *
 * `createMcwikiSearch()` 返回一个 `McwikiSearch`，四类查询返回统一结果形状
 * （见 `types.ts`）。CLI 与 pi 工具都只经由这里访问核心，避免各自重写取数逻辑。
 *
 * 核心只依赖标准 `fetch` 与 `AbortSignal.timeout`，不含 Node 专有 API
 * （由 `portability.test.ts` 兜底校验）。
 */

import { WikiClient } from './client.js';
import { resolveConfig } from './config.js';
import { readPage } from './page.js';
import { resolveTitle } from './resolve.js';
import { pageUrl } from './sites.js';
import type { WikiLanguage } from './sites.js';
import type {
  BodyFormat,
  PageResult,
  SearchResult,
  SectionsResult,
  SuggestResult,
} from './types.js';

export * from './client.js';
export * from './config.js';
export * from './errors.js';
export * from './http.js';
export * from './markdown.js';
export * from './page.js';
export * from './resolve.js';
export * from './sections.js';
export * from './sites.js';
export * from './text.js';
export type {
  BodyFormat,
  ErrorResult,
  PageResult,
  SearchResult,
  SearchResultItem,
  SectionItem,
  SectionsResult,
  SuggestResult,
} from './types.js';

/** 构造库客户端时的选项；省略即默认 `zh` + 30 秒超时。 */
export interface McwikiSearchOptions {
  language?: WikiLanguage;
  timeoutMs?: number;
  /** 便于测试或接入自定义 HTTP 栈。 */
  fetchImpl?: typeof fetch;
  /** 首次失败后的额外尝试次数（超时/网络/429/5xx）。 */
  retries?: number;
  sleep?: (ms: number) => Promise<void>;
}

export interface SearchOptions {
  query: string;
  limit?: number;
  namespace?: number;
  language?: WikiLanguage;
}

export interface SectionsOptions {
  title: string;
  language?: WikiLanguage;
}

export interface PageOptions {
  title: string;
  /** 章节引用：序号 / 点分编号 / 锚点 / 标题名；`'0'` 即导言。省略则读整页。 */
  section?: string;
  /** 显式格式；省略时按格式阶梯（整页 `text` / 单节 `markdown`）。 */
  format?: BodyFormat;
  language?: WikiLanguage;
}

export interface SuggestOptions {
  query: string;
  limit?: number;
  language?: WikiLanguage;
}

/** 四个使用面共用的库接口。 */
export interface McwikiSearch {
  /** 默认语言（可用每处调用的 `language` 覆盖）。 */
  readonly language: WikiLanguage;
  readonly timeoutMs: number;
  search(options: SearchOptions): Promise<SearchResult>;
  sections(options: SectionsOptions): Promise<SectionsResult>;
  page(options: PageOptions): Promise<PageResult>;
  suggest(options: SuggestOptions): Promise<SuggestResult>;
}

/**
 * 创建库客户端。
 *
 * ```ts
 * const wiki = createMcwikiSearch({ language: 'zh' });
 * const page = await wiki.page({ title: '苦力怕', section: '掉落物' });
 * ```
 */
export function createMcwikiSearch(options: McwikiSearchOptions = {}): McwikiSearch {
  const config = resolveConfig({ language: options.language, timeout: options.timeoutMs });
  const clients = new Map<WikiLanguage, WikiClient>();

  const clientFor = (language: WikiLanguage): WikiClient => {
    const existing = clients.get(language);
    if (existing !== undefined) {
      return existing;
    }
    const created = new WikiClient({
      language,
      timeoutMs: config.timeoutMs,
      fetchImpl: options.fetchImpl,
      retries: options.retries,
      sleep: options.sleep,
    });
    clients.set(language, created);
    return created;
  };

  return {
    language: config.language,
    timeoutMs: config.timeoutMs,

    async search(searchOptions: SearchOptions): Promise<SearchResult> {
      const language = searchOptions.language ?? config.language;
      return clientFor(language).search(searchOptions.query, {
        limit: searchOptions.limit,
        namespace: searchOptions.namespace,
      });
    },

    async sections(sectionsOptions: SectionsOptions): Promise<SectionsResult> {
      const language = sectionsOptions.language ?? config.language;
      const client = clientFor(language);
      const resolved = await resolveTitle(sectionsOptions.title, { language, clientFor });
      return {
        title: resolved.title,
        language,
        site: client.site.label,
        pageId: resolved.pageId,
        url: pageUrl(client.site, resolved.title),
        sections: (await client.sections(resolved.title)) ?? [],
      };
    },

    async page(pageOptions: PageOptions): Promise<PageResult> {
      return readPage({
        language: pageOptions.language ?? config.language,
        title: pageOptions.title,
        section: pageOptions.section,
        format: pageOptions.format,
        clientFor,
      });
    },

    async suggest(suggestOptions: SuggestOptions): Promise<SuggestResult> {
      const language = suggestOptions.language ?? config.language;
      const client = clientFor(language);
      const suggestions = await client.suggest(suggestOptions.query, suggestOptions.limit ?? 10);
      return { query: suggestOptions.query, language, site: client.site.label, suggestions };
    },
  };
}
