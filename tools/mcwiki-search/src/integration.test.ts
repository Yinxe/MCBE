/**
 * 跨面一致性（9.1）：同一查询经库与 CLI（JSON）返回等价字段结构。
 *
 * 这里刻意不比较文案，只比较「字段结构」与关键取值：
 * 两个使用面可以各自排版，但机器可读的部分必须同构，否则 Agent 换面就会解析失败。
 */

import { describe, expect, it } from 'vitest';

import { createMcwikiSearch, type McwikiSearch } from './core/index.js';
import { runCli, type CliContext } from './cli/program.js';

const ARTICLE_HTML =
  '<div class="mw-parser-output"><h2>掉落物</h2><table class="wikitable">' +
  '<tr><th>物品</th><th>数量</th></tr><tr><td>火药</td><td>0–2</td></tr></table></div>';

function payload(url: URL): unknown {
  const prop = url.searchParams.get('prop');
  const list = url.searchParams.get('list');
  const title = url.searchParams.get('titles') ?? '';

  if (prop === 'info') {
    if (title === '苦力怕') {
      return {
        query: {
          pages: [
            { title: '苦力怕', pageid: 42, fullurl: 'https://zh.minecraft.wiki/w/苦力怕', length: 1000 },
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
        sections: [{ index: '2', number: '2', level: '2', line: '掉落物', anchor: '掉落物' }],
      },
    };
  }
  if (prop === 'text') {
    return { parse: { title: '苦力怕', pageid: 42, text: ARTICLE_HTML } };
  }
  if (prop === 'extracts') {
    return { query: { pages: [{ title: '苦力怕', pageid: 42, extract: '苦力怕是一种敌对生物。' }] } };
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
          },
        ],
      },
    };
  }
  if (url.searchParams.get('action') === 'opensearch') {
    return ['苦', ['苦力怕'], [''], ['']];
  }
  return { query: { pages: [] } };
}

const fetchImpl: typeof fetch = async (input) =>
  new Response(JSON.stringify(payload(new URL(String(input)))), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

/** 跑一次 CLI 并解析 stdout 的 JSON（非 TTY 即 JSON 模式）。 */
async function cliJson(
  argv: string[],
  expectation: 'success' | 'failure' = 'success',
): Promise<Record<string, unknown>> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const exitCodes: number[] = [];
  const context: CliContext = {
    stdout: (text) => stdout.push(text),
    stderr: (text) => stderr.push(text),
    isTTY: false,
    setExitCode: (code) => exitCodes.push(code),
    version: '0.1.0',
    fetchImpl,
  };
  await runCli(argv, context);

  if (expectation === 'success') {
    expect(exitCodes, `CLI 失败: ${stderr.join('')}`).toEqual([]);
  } else {
    expect(exitCodes, 'CLI 应当失败').toEqual([1]);
  }
  return JSON.parse(stdout.join('')) as Record<string, unknown>;
}

function library(): McwikiSearch {
  return createMcwikiSearch({ language: 'zh', fetchImpl });
}

/** 递归取字段名集合，用于断言结构同构（忽略取值）。 */
function fieldNames(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap(fieldNames);
  }
  if (value !== null && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) => [
      key,
      ...fieldNames(child),
    ]);
  }
  return [];
}

describe('跨面一致性: 库 vs CLI（9.1）', () => {
  const cases: Array<[string, string[], () => Promise<unknown>]> = [
    ['search', ['search', '苦力怕'], () => library().search({ query: '苦力怕' })],
    ['sections', ['sections', '苦力怕'], () => library().sections({ title: '苦力怕' })],
    [
      'page（单节 markdown）',
      ['page', '苦力怕', '-s', '掉落物'],
      () => library().page({ title: '苦力怕', section: '掉落物' }),
    ],
    ['suggest', ['suggest', '苦'], () => library().suggest({ query: '苦' })],
  ];

  for (const [label, argv, viaLibrary] of cases) {
    it(`${label}: CLI JSON 与库返回同一字段结构`, async () => {
      const fromCli = await cliJson(argv);
      const fromLibrary = (await viaLibrary()) as Record<string, unknown>;

      expect(new Set(fieldNames(fromCli))).toEqual(new Set(fieldNames(fromLibrary)));
      expect(Object.keys(fromCli).sort()).toEqual(Object.keys(fromLibrary).sort());
    });
  }

  it('page 的关键取值在两面上一致', async () => {
    const fromCli = await cliJson(['page', '苦力怕', '-s', '掉落物']);
    const fromLibrary = await library().page({ title: '苦力怕', section: '掉落物' });

    for (const key of ['title', 'language', 'site', 'pageId', 'url', 'format', 'content'] as const) {
      expect(fromCli[key], `字段 ${key} 不一致`).toEqual(fromLibrary[key]);
    }
    expect(fromCli.content).toContain('火药');
  });

  it('失败时 CLI 与库给出同一错误分类', async () => {
    const fromCli = await cliJson(['page', '不存在的词条'], 'failure');
    expect(fromCli.error).toMatchObject({ code: 'missing-title' });

    await expect(library().page({ title: '不存在的词条' })).rejects.toMatchObject({
      code: 'missing-title',
    });
  });
});
