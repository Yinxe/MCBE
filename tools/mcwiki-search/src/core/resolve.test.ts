import { describe, expect, it } from 'vitest';

import { WikiClient } from './client.js';
import { WikiError } from './errors.js';
import { resolveTitle } from './resolve.js';
import type { WikiLanguage } from './sites.js';

function makeClientFor(handlers: {
  zh: (url: URL) => unknown;
  en: (url: URL) => unknown;
}): (language: WikiLanguage) => WikiClient {
  return (language) =>
    new WikiClient({
      language,
      fetchImpl: async (input) => {
        const url = new URL(String(input));
        const payload = (language === 'zh' ? handlers.zh : handlers.en)(url);
        return new Response(JSON.stringify(payload), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      },
    });
}

describe('resolveTitle（4.3 跨语言回退）', () => {
  it('目标语言直查命中', async () => {
    const clientFor = makeClientFor({
      zh: () => ({ query: { pages: [{ title: '苦力怕', pageid: 42 }] } }),
      en: () => ({ query: { pages: [] } }),
    });

    const resolution = await resolveTitle('苦力怕', { language: 'zh', clientFor });
    expect(resolution).toEqual({ title: '苦力怕', pageId: 42, language: 'zh' });
  });

  it('中文缺词条时经英文跨语言链接回退', async () => {
    const clientFor = makeClientFor({
      zh: (url) => {
        const prop = url.searchParams.get('prop');
        const titles = url.searchParams.get('titles') ?? '';
        if (prop === 'info') {
          return titles === '苦力怕'
            ? { query: { pages: [{ title: '苦力怕', pageid: 42 }] } }
            : { query: { pages: [{ title: titles, missing: true }] } };
        }
        if (prop === 'langlinks') {
          return { query: { pages: [{ title: titles, langlinks: [] }] } };
        }
        return { query: { pages: [] } };
      },
      en: (url) =>
        url.searchParams.get('prop') === 'langlinks'
          ? {
              query: {
                pages: [
                  { title: 'Creeper', langlinks: [{ lang: 'zh', title: '苦力怕' }] },
                ],
              },
            }
          : { query: { pages: [{ title: 'Creeper', pageid: 7 }] } },
    });

    const resolution = await resolveTitle('Creeper', { language: 'zh', clientFor });
    expect(resolution.title).toBe('苦力怕');
    expect(resolution.pageId).toBe(42);
    expect(resolution.translatedFrom).toEqual({ language: 'en', title: 'Creeper' });
  });

  it('两站都缺失时抛出 missing-title 并给出联想提示', async () => {
    const clientFor = makeClientFor({
      zh: (url) => {
        if (url.searchParams.get('action') === 'opensearch') {
          return ['Nope', ['苦力怕']];
        }
        if (url.searchParams.get('prop') === 'langlinks') {
          return { query: { pages: [{ title: 'Nope', langlinks: [] }] } };
        }
        return { query: { pages: [{ title: 'Nope', missing: true }] } };
      },
      en: () => ({ query: { pages: [] } }),
    });

    await expect(resolveTitle('Nope', { language: 'zh', clientFor })).rejects.toMatchObject({
      code: 'missing-title',
    });

    const error = await resolveTitle('Nope', { language: 'zh', clientFor }).catch(
      (cause: unknown) => cause,
    );
    expect(error).toBeInstanceOf(WikiError);
    expect((error as WikiError).hint).toContain('苦力怕');
  });

  it('关闭跨语言回退时直接报错', async () => {
    const clientFor = makeClientFor({
      zh: () => ({ query: { pages: [{ title: 'Nope', missing: true }] } }),
      en: () => ({ query: { pages: [{ title: 'Creeper', pageid: 7 }] } }),
    });

    await expect(
      resolveTitle('Creeper', { language: 'zh', crossLanguage: false, clientFor }),
    ).rejects.toMatchObject({ code: 'missing-title' });
  });
});
