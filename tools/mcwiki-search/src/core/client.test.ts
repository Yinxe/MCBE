import { describe, expect, it } from 'vitest';

import { WikiClient } from './client.js';

function jsonFetch(payloadFor: (url: URL) => unknown): typeof fetch {
  return async (input) => {
    const url = new URL(String(input));
    return new Response(JSON.stringify(payloadFor(url)), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
}

describe('WikiClient.search（4.1 词条搜索）', () => {
  it('请求带上 list/srsearch/srprop/srinfo 参数', async () => {
    let seen: URL | undefined;
    const client = new WikiClient({
      language: 'zh',
      fetchImpl: async (input) => {
        seen = new URL(String(input));
        return new Response(JSON.stringify({ query: { search: [], searchinfo: { totalhits: 0 } } }), {
          status: 200,
        });
      },
    });
    await client.search('苦力怕', { limit: 3 });
    expect(seen?.searchParams.get('list')).toBe('search');
    expect(seen?.searchParams.get('srsearch')).toBe('苦力怕');
    expect(seen?.searchParams.get('srlimit')).toBe('3');
    expect(seen?.searchParams.get('srprop')).toContain('snippet');
    expect(seen?.searchParams.get('srinfo')).toBe('totalhits');
  });

  it('把结果映射为纯文本摘要，并保留重定向标记', async () => {
    const client = new WikiClient({
      language: 'zh',
      fetchImpl: jsonFetch(() => ({
        query: {
          searchinfo: { totalhits: 2 },
          search: [
            {
              title: '苦力怕',
              pageid: 123,
              size: 4567,
              wordcount: 300,
              timestamp: '2026-01-01T00:00:00Z',
              snippet: '<span class="searchmatch">苦力怕</span>是一种&nbsp;敌对生物',
              redirect: false,
            },
            {
              title: '爬行者',
              pageid: 9,
              size: 10,
              wordcount: 1,
              timestamp: '2026-01-02T00:00:00Z',
              snippet: '重定向',
              redirect: true,
            },
          ],
        },
      })),
    });

    const result = await client.search('苦力怕');
    expect(result.query).toBe('苦力怕');
    expect(result.language).toBe('zh');
    expect(result.total).toBe(2);
    expect(result.results).toHaveLength(2);
    expect(result.results[0]?.snippet).toBe('苦力怕是一种 敌对生物');
    expect(result.results[0]?.snippet).not.toContain('<');
    expect(result.results[0]?.pageId).toBe(123);
    expect(result.results[1]?.redirect).toBe(true);
  });

  it('无命中时返回空数组而非报错', async () => {
    const client = new WikiClient({
      language: 'en',
      fetchImpl: jsonFetch(() => ({ query: { search: [], searchinfo: { totalhits: 0 } } })),
    });
    const result = await client.search('zzzz-not-a-page');
    expect(result.results).toEqual([]);
    expect(result.total).toBe(0);
  });
});

describe('WikiClient 章节与正文（4.2 章节）', () => {
  it('章节目录把 line 映射为 title，并解析 index/level 为数字', async () => {
    const client = new WikiClient({
      language: 'zh',
      fetchImpl: jsonFetch(() => ({
        parse: {
          title: '苦力怕',
          pageid: 42,
          sections: [
            { index: '1', number: '1', level: '2', line: '生成', anchor: '生成' },
            { index: '2', number: '2.1', level: '3', line: '掉落物', anchor: '掉落物' },
          ],
        },
      })),
    });

    const sections = await client.sections('苦力怕');
    expect(sections).toEqual([
      { index: 1, number: '1', level: 2, title: '生成', anchor: '生成' },
      { index: 2, number: '2.1', level: 3, title: '掉落物', anchor: '掉落物' },
    ]);
  });

  it('缺词条时章节目录返回 undefined', async () => {
    const client = new WikiClient({
      language: 'zh',
      fetchImpl: jsonFetch(() => ({ error: { code: 'missingtitle', text: '页面不存在' } })),
    });
    await expect(client.sections('不存在')).resolves.toBeUndefined();
  });

  it('renderHtml 使用 prop=text，并可在单章节时带上 section', async () => {
    let seen: URL | undefined;
    const client = new WikiClient({
      language: 'zh',
      fetchImpl: async (input) => {
        seen = new URL(String(input));
        return new Response(
          JSON.stringify({ parse: { title: '苦力怕', pageid: 42, text: '<table></table>' } }),
          { status: 200 },
        );
      },
    });

    const rendered = await client.renderHtml('苦力怕', 3);
    expect(seen?.searchParams.get('prop')).toBe('text');
    expect(seen?.searchParams.get('section')).toBe('3');
    expect(rendered?.html).toBe('<table></table>');
  });
});
