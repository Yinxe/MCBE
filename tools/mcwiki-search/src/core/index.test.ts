import { describe, expect, it } from 'vitest';

import { createMcwikiSearch } from './index.js';
import type { WikiLanguage } from './sites.js';

const ARTICLE_HTML =
  '<div class="mw-parser-output"><p>苦力怕是一种敌对生物。</p></div>';

function payload(url: URL): unknown {
  const prop = url.searchParams.get('prop');
  const list = url.searchParams.get('list');
  const title = url.searchParams.get('titles') ?? '';

  if (prop === 'info') {
    if (title === '苦力怕' || title === 'Creeper') {
      return {
        query: {
          pages: [
            {
              title: title === 'Creeper' ? 'Creeper' : '苦力怕',
              pageid: 42,
              fullurl: 'https://example.invalid/wiki',
              length: 1000,
            },
          ],
        },
      };
    }
    return { query: { pages: [{ title, missing: true }] } };
  }
  if (prop === 'sections') {
    return {
      parse: {
        title: '苦力怕',
        pageid: 42,
        sections: [
          { index: '1', number: '1', level: '2', line: '生成', anchor: '生成' },
          { index: '2', number: '2', level: '2', line: '掉落物', anchor: '掉落物' },
        ],
      },
    };
  }
  if (prop === 'text') {
    return { parse: { title: '苦力怕', pageid: 42, text: ARTICLE_HTML } };
  }
  if (prop === 'extracts') {
    return { query: { pages: [{ title: '苦力怕', pageid: 42, extract: '苦力怕是一种敌对生物。' }] } };
  }
  if (prop === 'langlinks') {
    return { query: { pages: [{ title, langlinks: [] }] } };
  }
  if (list === 'search') {
    return {
      query: {
        searchinfo: { totalhits: 1 },
        search: [
          {
            title: '苦力怕',
            snippet: '<span class="searchmatch">苦力怕</span>是一种敌对生物。',
            redirect: false,
            pageid: 42,
            size: 12345,
            wordcount: 678,
            timestamp: '2024-01-01T00:00:00Z',
          },
        ],
      },
    };
  }
  if (url.searchParams.get('action') === 'opensearch') {
    return ['苦', ['苦力怕', '苦力怕刷怪蛋'], ['', ''], ['', '']];
  }
  return { query: { pages: [] } };
}

function makeWiki(language: WikiLanguage = 'zh') {
  return createMcwikiSearch({
    language,
    fetchImpl: async (input) =>
      new Response(JSON.stringify(payload(new URL(String(input)))), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
  });
}

describe('createMcwikiSearch（6.1 库导出与统一结果形状）', () => {
  it('默认语言为 zh、默认超时 30 秒', () => {
    const wiki = makeWiki();
    expect(wiki.language).toBe('zh');
    expect(wiki.timeoutMs).toBe(30_000);
  });

  it('search() 返回 SearchResult 字段结构', async () => {
    const result = await makeWiki().search({ query: '苦力怕' });
    expect(Object.keys(result).sort()).toEqual([
      'language',
      'query',
      'results',
      'site',
      'total',
    ]);
    expect(result.query).toBe('苦力怕');
    expect(result.total).toBe(1);
    expect(Object.keys(result.results[0] ?? {}).sort()).toEqual([
      'pageId',
      'redirect',
      'size',
      'snippet',
      'timestamp',
      'title',
      'wordCount',
    ]);
    expect(result.results[0]?.snippet).toBe('苦力怕是一种敌对生物。');
    expect(result.results[0]?.snippet).not.toContain('<');
  });

  it('sections() 返回 SectionsResult 与 SectionItem 字段结构', async () => {
    const result = await makeWiki().sections({ title: '苦力怕' });
    expect(Object.keys(result).sort()).toEqual([
      'language',
      'pageId',
      'sections',
      'site',
      'title',
      'url',
    ]);
    expect(Object.keys(result.sections[0] ?? {}).sort()).toEqual([
      'anchor',
      'index',
      'level',
      'number',
      'title',
    ]);
    expect(result.title).toBe('苦力怕');
    expect(result.sections.map((section) => section.title)).toEqual(['生成', '掉落物']);
  });

  it('page() 单节默认 markdown，返回 PageResult 字段结构', async () => {
    const result = await makeWiki().page({ title: '苦力怕', section: '掉落物' });
    expect(Object.keys(result).sort()).toEqual([
      'content',
      'format',
      'language',
      'length',
      'pageId',
      'section',
      'site',
      'title',
      'url',
    ]);
    expect(result.format).toBe('markdown');
    expect(result.section?.title).toBe('掉落物');
    expect(result.content).toContain('苦力怕是一种敌对生物。');
    expect(result.content).not.toContain('<');
  });

  it('page() 整页默认 text', async () => {
    const result = await makeWiki().page({ title: '苦力怕' });
    expect(result.format).toBe('text');
    expect(result.section).toBeNull();
    expect(result.content).toBe('苦力怕是一种敌对生物。');
  });

  it('suggest() 返回 SuggestResult 字段结构', async () => {
    const result = await makeWiki().suggest({ query: '苦' });
    expect(Object.keys(result).sort()).toEqual(['language', 'query', 'site', 'suggestions']);
    expect(result.suggestions).toEqual(['苦力怕', '苦力怕刷怪蛋']);
  });

  it('每处调用的 language 可覆盖默认语言', async () => {
    const wiki = makeWiki('zh');
    const result = await wiki.sections({ title: 'Creeper', language: 'en' });
    expect(result.language).toBe('en');
    expect(result.site).toBe('English Minecraft Wiki');
  });

  it('未知词条抛出缺失错误并带上搜索提示', async () => {
    const error = await makeWiki()
      .page({ title: '不存在的词条' })
      .catch((cause: unknown) => cause);
    expect(error).toMatchObject({ code: 'missing-title' });
    expect((error as { hint?: string }).hint).toContain('相近词条');
  });
});
