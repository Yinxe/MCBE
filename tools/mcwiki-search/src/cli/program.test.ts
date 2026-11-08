import { describe, expect, it } from 'vitest';

import { runCli, type CliContext } from './program.js';

const ARTICLE_HTML = '<div class="mw-parser-output"><p>苦力怕是一种敌对生物。</p></div>';

function payload(url: URL): unknown {
  const prop = url.searchParams.get('prop');
  const list = url.searchParams.get('list');
  const title = url.searchParams.get('titles') ?? '';

  if (prop === 'info') {
    if (title === '苦力怕') {
      return {
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

interface Harness {
  stdout: string[];
  stderr: string[];
  exitCodes: number[];
  run: (argv: string[]) => Promise<void>;
  text: (chunks: string[]) => string;
}

function makeHarness(isTTY: boolean): Harness {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const exitCodes: number[] = [];
  const context: CliContext = {
    stdout: (text) => stdout.push(text),
    stderr: (text) => stderr.push(text),
    isTTY,
    setExitCode: (code) => exitCodes.push(code),
    version: '0.1.0',
    fetchImpl: async (input) =>
      new Response(JSON.stringify(payload(new URL(String(input)))), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
  };
  return {
    stdout,
    stderr,
    exitCodes,
    run: (argv) => runCli(argv, context),
    text: (chunks) => chunks.join(''),
  };
}

describe('CLI 子命令（7.1）', () => {
  it('--help 列出四个子命令并以 0 退出', async () => {
    const harness = makeHarness(false);
    await harness.run(['--help']);
    const output = harness.text(harness.stdout);
    expect(output).toContain('Usage: mcwiki-search');
    for (const command of ['search', 'sections', 'page', 'suggest']) {
      expect(output).toContain(command);
    }
    expect(harness.exitCodes).toEqual([0]);
    expect(harness.stderr).toEqual([]);
  });

  it('四个子命令在非 TTY 下都能跑通并输出 JSON', async () => {
    const cases: Array<[string[], (result: Record<string, unknown>) => void]> = [
      [['search', '苦力怕'], (result) => expect(result.total).toBe(1)],
      [['sections', '苦力怕'], (result) => expect(result.sections).toHaveLength(2)],
      [['page', '苦力怕', '-s', '掉落物'], (result) => expect(result.format).toBe('markdown')],
      [['suggest', '苦'], (result) => expect(result.suggestions).toEqual(['苦力怕', '苦力怕刷怪蛋'])],
    ];

    for (const [argv, assert] of cases) {
      const harness = makeHarness(false);
      await harness.run(argv);
      expect(harness.exitCodes, `${argv.join(' ')} 不应失败`).toEqual([]);
      expect(harness.stderr, `${argv.join(' ')} 不应有 stderr`).toEqual([]);
      assert(JSON.parse(harness.text(harness.stdout)) as Record<string, unknown>);
    }
  });

  it('page 支持 --section 与 --format 且语义与库选项一致', async () => {
    const harness = makeHarness(false);
    await harness.run(['page', '苦力怕', '-s', '2', '-f', 'wikitext']);
    const result = JSON.parse(harness.text(harness.stdout)) as { format: string; section: unknown };
    expect(result.format).toBe('wikitext');
    expect(result.section).toMatchObject({ index: 2, title: '掉落物' });
  });
});

describe('CLI 输出与退出码（7.2）', () => {
  it('TTY 下输出人类可读文本，非 TTY 下输出 JSON', async () => {
    const tty = makeHarness(true);
    await tty.run(['search', '苦力怕']);
    expect(tty.text(tty.stdout)).toContain('命中');
    expect(() => JSON.parse(tty.text(tty.stdout))).toThrow();

    const piped = makeHarness(false);
    await piped.run(['search', '苦力怕']);
    expect(() => JSON.parse(piped.text(piped.stdout))).not.toThrow();
    expect(piped.text(piped.stdout)).not.toContain('命中');
  });

  it('TTY 下 --json 放在子命令之后也能强制 JSON', async () => {
    const harness = makeHarness(true);
    await harness.run(['search', '苦力怕', '--json']);
    expect(harness.exitCodes).toEqual([]);
    expect(JSON.parse(harness.text(harness.stdout))).toMatchObject({ query: '苦力怕' });
  });

  it('失败时 stdout 为 ErrorResult、提示走 stderr 且退出码非零', async () => {
    const harness = makeHarness(false);
    await harness.run(['page', '不存在的词条']);

    const result = JSON.parse(harness.text(harness.stdout)) as {
      error: { code: string; message: string; hint?: string };
    };
    expect(result.error.code).toBe('missing-title');
    expect(result.error.hint).toContain('相近词条');
    expect(harness.exitCodes).toEqual([1]);
    expect(harness.stderr.join('')).toContain('找不到词条');
  });

  it('非法 --format 归为 invalid-input 且退出码非零', async () => {
    const harness = makeHarness(false);
    await harness.run(['page', '苦力怕', '-f', '不合法']);
    const result = JSON.parse(harness.text(harness.stdout)) as { error: { code: string } };
    expect(result.error.code).toBe('invalid-input');
    expect(harness.exitCodes).toEqual([1]);
    expect(harness.stderr.join('')).toContain('不支持的格式');
  });

  it('超出范围的 --limit 归为 invalid-input', async () => {
    const harness = makeHarness(false);
    await harness.run(['search', '苦力怕', '--limit', '999']);
    const result = JSON.parse(harness.text(harness.stdout)) as { error: { code: string } };
    expect(result.error.code).toBe('invalid-input');
    expect(harness.exitCodes).toEqual([1]);
  });

  it('用法错误（缺少参数）由 commander 报错并以非零退出码结束', async () => {
    const harness = makeHarness(false);
    await harness.run(['page']);
    expect(harness.exitCodes).toEqual([1]);
    expect(harness.stderr.join('')).toContain('missing required argument');
  });
});

describe('CLI 人类可读渲染', () => {
  it('sections 输出序号、编号与标题', async () => {
    const harness = makeHarness(true);
    await harness.run(['sections', '苦力怕']);
    const output = harness.text(harness.stdout);
    expect(output).toContain('共 2 个章节');
    expect(output).toContain('掉落物');
    expect(output).toContain('https://zh.minecraft.wiki/w/%E8%8B%A6%E5%8A%9B%E6%80%95');
  });

  it('page 输出标题、来源与正文', async () => {
    const harness = makeHarness(true);
    await harness.run(['page', '苦力怕']);
    const output = harness.text(harness.stdout);
    expect(output).toContain('苦力怕（整页 · text）');
    expect(output).toContain('苦力怕是一种敌对生物。');
  });
});
