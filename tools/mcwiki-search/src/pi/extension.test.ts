import type { AgentToolResult, ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { describe, expect, it, vi } from 'vitest';

import {
  WikiError,
  type McwikiSearch,
  type PageResult,
  type SearchResult,
  type SectionsResult,
  type SuggestResult,
} from '../core/index.js';
import { mcwikiTool, registerMcwiki, runMcwikiAction, type McwikiToolParams } from './extension.js';

const SITE = '中文 Minecraft Wiki';
const SECTION = { index: 2, number: '2', level: 2, title: '掉落物', anchor: '掉落物' };

/** 离线桩客户端: 只回固定结果，便于断言分派与校验逻辑。 */
function stubWiki(patch: Partial<McwikiSearch> = {}): McwikiSearch {
  const base: McwikiSearch = {
    language: 'zh',
    timeoutMs: 30_000,
    async search(options): Promise<SearchResult> {
      return {
        query: options.query,
        language: 'zh',
        site: SITE,
        total: 1,
        results: [
          {
            title: '苦力怕',
            snippet: '苦力怕是一种敌对生物。',
            redirect: false,
            pageId: 42,
            size: 12345,
            wordCount: 678,
          },
        ],
      };
    },
    async sections(options): Promise<SectionsResult> {
      return {
        title: options.title,
        language: 'zh',
        site: SITE,
        pageId: 42,
        url: 'https://zh.minecraft.wiki/w/苦力怕',
        sections: [SECTION],
      };
    },
    async page(options): Promise<PageResult> {
      return {
        title: options.title,
        language: 'zh',
        site: SITE,
        pageId: 42,
        url: 'https://zh.minecraft.wiki/w/苦力怕',
        section: options.section === undefined ? null : SECTION,
        format: options.format ?? (options.section === undefined ? 'text' : 'markdown'),
        length: 1000,
        content: '| 火药 | 0–2 | 66.67% |',
      };
    },
    async suggest(options): Promise<SuggestResult> {
      return {
        query: options.query,
        language: 'zh',
        site: SITE,
        suggestions: ['苦力怕', '苦力怕刷怪蛋'],
      };
    },
  };
  return Object.assign(base, patch);
}

function textOf(result: AgentToolResult<unknown>): string {
  const first = result.content[0];
  return first !== undefined && first.type === 'text' ? first.text : '';
}

describe('mcwiki 工具定义（8.1）', () => {
  it('暴露 mcwiki 工具及其 action 枚举', () => {
    expect(mcwikiTool.name).toBe('mcwiki');
    expect(mcwikiTool.description).toContain('Minecraft Wiki');
    expect(mcwikiTool.promptSnippet).toBeDefined();

    const properties = (mcwikiTool.parameters as unknown as {
      properties: { action: { anyOf: Array<{ const: string }> } };
    }).properties;
    expect(properties.action.anyOf.map((entry) => entry.const)).toEqual([
      'search',
      'sections',
      'page',
      'suggest',
    ]);
  });

  it('模型可见的提示词为英文（description / snippet / guidelines / 参数描述）', () => {
    const properties = (mcwikiTool.parameters as unknown as {
      properties: Record<string, { description?: string; anyOf?: Array<{ description?: string }> }>;
    }).properties;

    const modelFacing = [
      mcwikiTool.description,
      mcwikiTool.promptSnippet ?? '',
      ...(mcwikiTool.promptGuidelines ?? []),
      ...Object.values(properties).flatMap((property) => [
        property.description ?? '',
        ...(property.anyOf ?? []).map((entry) => entry.description ?? ''),
      ]),
    ];

    // CJK 统一表意文字范围: 只要出现中文就说明提示词没翻译干净。
    const cjk = /[\u4e00-\u9fff]/;
    for (const text of modelFacing) {
      expect(text, `提示词含中文: ${text}`).not.toMatch(cjk);
    }

    // 标准工具提示词的形状: snippet 单行无句号，guidelines 为带句号的祈使句。
    expect(mcwikiTool.promptSnippet).not.toMatch(/[.。]$/);
    expect(mcwikiTool.description.length).toBeGreaterThan(80);
    expect(mcwikiTool.promptGuidelines?.length ?? 0).toBeGreaterThan(0);
    for (const guideline of mcwikiTool.promptGuidelines ?? []) {
      expect(guideline).toMatch(/[.]$/);
    }
  });

  it('registerMcwiki 把工具注册进 pi', () => {
    const registerTool = vi.fn();
    registerMcwiki({ registerTool } as unknown as ExtensionAPI);
    expect(registerTool).toHaveBeenCalledWith(mcwikiTool);
  });
});

describe('mcwiki 工具分派与结果形状', () => {
  it('search 回传统一结果形状与人类可读文本', async () => {
    const result = await runMcwikiAction(stubWiki(), { action: 'search', query: '苦力怕' });
    expect(result.isError).toBeUndefined();
    expect(result.details).toMatchObject({ query: '苦力怕', total: 1 });
    expect(textOf(result)).toContain('命中 1 条');
  });

  it('sections 回传章节目录', async () => {
    const result = await runMcwikiAction(stubWiki(), { action: 'sections', title: '苦力怕' });
    expect(result.details).toMatchObject({ title: '苦力怕', pageId: 42 });
    expect(textOf(result)).toContain('掉落物');
  });

  it('page 把 section 与 format 原样透传给库', async () => {
    const wiki = stubWiki();
    const page = vi.spyOn(wiki, 'page');
    const result = await runMcwikiAction(wiki, {
      action: 'page',
      title: '苦力怕',
      section: '掉落物',
      format: 'text',
    });
    expect(page.mock.calls[0]?.[0]).toMatchObject({ title: '苦力怕', section: '掉落物', format: 'text' });
    expect(result.details).toMatchObject({ format: 'text', section: SECTION });
    expect(textOf(result)).toContain('火药');
  });

  it('suggest 回传相近词条', async () => {
    const result = await runMcwikiAction(stubWiki(), { action: 'suggest', query: '苦' });
    expect(result.details).toMatchObject({ suggestions: ['苦力怕', '苦力怕刷怪蛋'] });
    expect(textOf(result)).toContain('苦力怕刷怪蛋');
  });

  it('把 limit 透传给库', async () => {
    const wiki = stubWiki();
    const search = vi.spyOn(wiki, 'search');
    await runMcwikiAction(wiki, { action: 'search', query: '红石', limit: 3 });
    expect(search.mock.calls[0]?.[0]).toMatchObject({ query: '红石', limit: 3 });
  });
});

describe('mcwiki 工具参数校验（失败也返回统一形状）', () => {
  const cases: Array<[string, McwikiToolParams, string]> = [
    ['search 缺少 query', { action: 'search' }, 'requires the "query" parameter'],
    ['sections 缺少 title', { action: 'sections' }, 'requires the "title" parameter'],
    ['page 缺少 title', { action: 'page' }, 'requires the "title" parameter'],
    ['suggest 缺少 query', { action: 'suggest' }, 'requires the "query" parameter'],
    ['search 空白 query', { action: 'search', query: '   ' }, 'requires the "query" parameter'],
  ];

  for (const [label, params, needle] of cases) {
    it(`${label} 归为 invalid-input`, async () => {
      const result = await runMcwikiAction(stubWiki(), params);
      expect(result.isError).toBe(true);
      expect(result.details).toMatchObject({ error: { code: 'invalid-input' } });
      expect(textOf(result)).toContain(needle);
    });
  }

  it('limit 超出范围归为 invalid-input', async () => {
    const result = await runMcwikiAction(stubWiki(), { action: 'search', query: '红石', limit: 999 });
    expect(result.isError).toBe(true);
    expect(result.details).toMatchObject({ error: { code: 'invalid-input' } });
    expect(textOf(result)).toContain('Invalid limit');
  });

  it('库抛出的 WikiError 保留分类并附带提示', async () => {
    const wiki = stubWiki({
      page: async () => {
        throw new WikiError('找不到词条: 不存在', {
          code: 'missing-title',
          hint: '换个关键词搜索: mcwiki-search search "不存在"',
        });
      },
    });
    const result = await runMcwikiAction(wiki, { action: 'page', title: '不存在' });
    expect(result.isError).toBe(true);
    expect(result.details).toMatchObject({ error: { code: 'missing-title' } });
    expect(textOf(result)).toContain('提示: 换个关键词搜索');
  });

  it('库抛出的非 WikiError 归一化为 api-error', async () => {
    const wiki = stubWiki({
      search: async () => {
        throw new TypeError('boom');
      },
    });
    const result = await runMcwikiAction(wiki, { action: 'search', query: '红石' });
    expect(result.isError).toBe(true);
    expect(result.details).toMatchObject({ error: { code: 'api-error', message: 'boom' } });
  });
});
