import { describe, expect, it } from 'vitest';

import { WikiClient } from './client.js';
import { defaultBodyFormat, readPage } from './page.js';
import type { WikiLanguage } from './sites.js';

const ARTICLE_HTML = [
  '<div class="mw-parser-output">',
  '<table class="infobox-rows"><tr><td>最大生命值</td><td>20</td></tr></table>',
  '<p>苦力怕是一种敌对生物。</p>',
  '<div class="mw-editsection">编辑</div>',
  '</div>',
].join('');

const PLAIN_TEXT = '苦力怕是一种敌对生物。';

function makeClientFor(collected?: URL[]): (language: WikiLanguage) => WikiClient {
  return (language) =>
    new WikiClient({
      language,
      fetchImpl: async (input) => {
        const url = new URL(String(input));
        collected?.push(url);
        const prop = url.searchParams.get('prop');
        let payload: unknown;
        if (prop === 'info') {
          payload = {
            query: {
              pages: [
                {
                  title: '苦力怕',
                  pageid: 42,
                  fullurl: 'https://zh.minecraft.wiki/w/苦力怕',
                  length: 1000,
                },
              ],
            },
          };
        } else if (prop === 'sections') {
          payload = {
            parse: {
              title: '苦力怕',
              pageid: 42,
              sections: [
                { index: '1', number: '1', level: '2', line: '生成', anchor: '生成' },
                { index: '2', number: '2', level: '2', line: '掉落物', anchor: '掉落物' },
              ],
            },
          };
        } else if (prop === 'text') {
          payload = { parse: { title: '苦力怕', pageid: 42, text: ARTICLE_HTML } };
        } else if (prop === 'wikitext') {
          payload = { parse: { title: '苦力怕', pageid: 42, wikitext: '{{Infobox|health=20}}' } };
        } else if (prop === 'extracts') {
          payload = { query: { pages: [{ title: '苦力怕', pageid: 42, extract: PLAIN_TEXT }] } };
        } else {
          payload = { query: { pages: [] } };
        }
        return new Response(JSON.stringify(payload), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      },
    });
}

describe('defaultBodyFormat（5.3 格式阶梯默认值）', () => {
  it('整页默认 text，单节默认 markdown', () => {
    expect(defaultBodyFormat(false)).toBe('text');
    expect(defaultBodyFormat(true)).toBe('markdown');
  });
});

describe('readPage（5.1 整页 / 5.3 格式阶梯）', () => {
  it('整页默认 text，走 TextExtracts 且输出不含 HTML 标记', async () => {
    const result = await readPage({ language: 'zh', title: '苦力怕', clientFor: makeClientFor() });
    expect(result.format).toBe('text');
    expect(result.section).toBeNull();
    expect(result.content).toBe(PLAIN_TEXT);
    expect(result.content).not.toContain('<');
    expect(result.title).toBe('苦力怕');
    expect(result.pageId).toBe(42);
    expect(result.language).toBe('zh');
    expect(result.url).toBe('https://zh.minecraft.wiki/w/%E8%8B%A6%E5%8A%9B%E6%80%95');
  });

  it('单节默认 markdown，保留信息框表格', async () => {
    const result = await readPage({
      language: 'zh',
      title: '苦力怕',
      section: '掉落物',
      clientFor: makeClientFor(),
    });
    expect(result.format).toBe('markdown');
    expect(result.section?.index).toBe(2);
    expect(result.section?.title).toBe('掉落物');
    expect(result.content).toContain('最大生命值');
    expect(result.content).toContain('20');
    expect(result.content).not.toContain('<');
    // length 记录的是转换前的 HTML 长度。
    expect(result.length).toBe(ARTICLE_HTML.length);
  });

  it('section: "0" 解析为导言（prop=sections 不含该条目）', async () => {
    const result = await readPage({
      language: 'zh',
      title: '苦力怕',
      section: '0',
      clientFor: makeClientFor(),
    });
    expect(result.section).toEqual({
      index: 0,
      number: '0',
      level: 2,
      title: '导言',
      anchor: '导言',
    });
    expect(result.format).toBe('markdown');
  });

  it('format: text + 单节 → 带换行的纯文本兑底', async () => {
    const result = await readPage({
      language: 'zh',
      title: '苦力怕',
      section: '2',
      format: 'text',
      clientFor: makeClientFor(),
    });
    expect(result.format).toBe('text');
    expect(result.content).not.toContain('<');
    expect(result.content).toContain('最大生命值');
    expect(result.content.split('\n').length).toBeGreaterThan(1);
  });

  it('format: wikitext → 原样透传，且单节会带上 section 参数', async () => {
    const collected: URL[] = [];
    const result = await readPage({
      language: 'zh',
      title: '苦力怕',
      section: '掉落物',
      format: 'wikitext',
      clientFor: makeClientFor(collected),
    });
    expect(result.format).toBe('wikitext');
    expect(result.content).toBe('{{Infobox|health=20}}');

    const wikitextCall = collected.find((url) => url.searchParams.get('prop') === 'wikitext');
    expect(wikitextCall?.searchParams.get('section')).toBe('2');
  });

  it('章节不存在时抛出 section-not-found 并提示可用章节', async () => {
    const error = await readPage({
      language: 'zh',
      title: '苦力怕',
      section: '不存在',
      clientFor: makeClientFor(),
    }).catch((cause: unknown) => cause);
    expect(error).toMatchObject({ code: 'section-not-found' });
    expect((error as { hint?: string }).hint).toContain('1 生成');
  });
});
