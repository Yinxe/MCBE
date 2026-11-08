/**
 * pi 工具扩展：把 Minecraft Wiki 查询注册为名为 `mcwiki` 的工具。
 *
 * 这里只做「参数校验 + 调用库 + 排版」；取数与 HTML 清洗全在 `core/`，
 * 文本排版复用 `cli/format.ts`，使 pi 工具与 CLI 两个使用面不会各自分叉。
 *
 * 一个工具用 `action` 区分四类查询（search / sections / page / suggest），
 * 与库的四类方法一一对应，`details` 直接回传统一结果形状。
 */

import { defineTool, type AgentToolResult, type ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { Type, type Static } from 'typebox';

import { renderPage, renderSearch, renderSections, renderSuggest } from '../cli/format.js';
import {
  DEFAULT_LANGUAGE,
  WikiError,
  createMcwikiSearch,
  parseBodyFormat,
  toErrorResult,
  toWikiError,
  type ErrorResult,
  type McwikiSearch,
  type PageResult,
  type SearchResult,
  type SectionsResult,
  type SuggestResult,
  type WikiLanguage,
} from '../core/index.js';

const ACTIONS = [
  'search',
  'sections',
  'page',
  'suggest',
] as const satisfies readonly McwikiToolParams['action'][];
type McwikiAction = McwikiToolParams['action'];

const MAX_LIMIT = 50;

/**
 * 参数 schema。
 *
 * 字面量必须逐个列出：`ACTIONS.map((a) => Type.Literal(a))` 会塌成单个
 * `TLiteral<'search' | ...>`，`Static` 退化为 `never`。
 * 与核心类型的兼容性由使用处强制（`clientFor()` 要 `WikiLanguage`，
 * `wiki.page()` 的 `format` 要 `BodyFormat`）。
 */
const actionSchema = Type.Union(
  [
    Type.Literal('search'),
    Type.Literal('sections'),
    Type.Literal('page'),
    Type.Literal('suggest'),
  ],
  {
    description:
      'Operation to perform: search finds pages by keyword, sections lists a page\'s table of contents, page reads a section or whole page body, suggest returns titles by prefix',
  },
);

const mcwikiParameters = Type.Object({
  action: actionSchema,
  query: Type.Optional(
    Type.String({ description: 'Keyword for action="search" or title prefix for action="suggest"' }),
  ),
  title: Type.Optional(
    Type.String({
      description: 'Page title for action="sections" or action="page"; zh and en titles both work',
    }),
  ),
  section: Type.Optional(
    Type.String({
      description:
        'Section for action="page": index, dotted number, anchor, or title; "0" is the lead section; omit to read the whole page',
    }),
  ),
  format: Type.Optional(
    Type.Union([Type.Literal('markdown'), Type.Literal('text'), Type.Literal('wikitext')], {
      description:
        'Body format for action="page"; defaults to "text" for a whole page and "markdown" for a single section; "wikitext" returns raw markup',
    }),
  ),
  language: Type.Optional(
    Type.Union([Type.Literal('zh'), Type.Literal('en')], {
      description: 'Wiki language site; defaults to "zh"',
    }),
  ),
  limit: Type.Optional(
    Type.Integer({
      minimum: 1,
      maximum: MAX_LIMIT,
      description: `Maximum number of results for action="search" or action="suggest" (1-${MAX_LIMIT}); defaults to 10`,
    }),
  ),
});

export type McwikiToolParams = Static<typeof mcwikiParameters>;

/** 仅用于提示文案；`satisfies` 保证不会写出 schema 之外的取值。 */
const ACTION_NAMES = ACTIONS.join(' / ');

/**
 * pi 面是英文界面，因此不复用 `parseCount()`（它的模板是中文，给 CLI 用）。
 * 边界仍由 schema 的 `minimum`/`maximum` 表达，这里只兜住绕过 schema 的直接调用。
 */
function parseLimit(value: number | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Number.isInteger(value) || value < 1 || value > MAX_LIMIT) {
    throw new WikiError(`Invalid limit: ${value}`, {
      code: 'invalid-input',
      hint: `limit must be an integer between 1 and ${MAX_LIMIT}`,
    });
  }
  return value;
}

/** 工具 `details` 与库的四类结果形状一致；失败时为 `ErrorResult`。 */
export type McwikiToolDetails = SearchResult | SectionsResult | PageResult | SuggestResult | ErrorResult;

function requireParam(value: string | undefined, name: string, action: McwikiAction): string {
  if (value === undefined || value.trim() === '') {
    throw new WikiError(`action="${action}" requires the "${name}" parameter`, {
      code: 'invalid-input',
      hint: `Example: {"action":"${action}","${name}":"Creeper"}`,
    });
  }
  return value;
}

function ok<T extends McwikiToolDetails>(details: T, text: string): AgentToolResult<McwikiToolDetails> {
  return { content: [{ type: 'text', text }], details };
}

/** 失败也返回完整结果形状，模型与 UI 都能看到分类与提示。 */
function failure(cause: unknown): AgentToolResult<McwikiToolDetails> {
  const error = toWikiError(cause);
  const text = error.hint === undefined ? error.message : `${error.message}\n提示: ${error.hint}`;
  return { content: [{ type: 'text', text }], details: toErrorResult(error), isError: true };
}

/**
 * 把一次工具调用分派到库的四类查询。
 *
 * 与 pi 解耦：只依赖 `McwikiSearch`，因此单测可注入桩客户端，无需网络。
 */
export async function runMcwikiAction(
  wiki: McwikiSearch,
  params: McwikiToolParams,
): Promise<AgentToolResult<McwikiToolDetails>> {
  try {
    const limit = parseLimit(params.limit);
    return await dispatch(wiki, params, limit);
  } catch (cause) {
    return failure(cause);
  }
}

/** 新增 action 时 `assertNever` 会在编译期报错，避免静默漏分支。 */
function assertNever(value: never): never {
  throw new WikiError(`Unknown action: ${String(value)}`, {
    code: 'invalid-input',
    hint: `Allowed actions: ${ACTION_NAMES}`,
  });
}

async function dispatch(
  wiki: McwikiSearch,
  params: McwikiToolParams,
  limit: number | undefined,
): Promise<AgentToolResult<McwikiToolDetails>> {
  switch (params.action) {
    case 'search': {
      const result = await wiki.search({
        query: requireParam(params.query, 'query', 'search'),
        limit,
      });
      return ok(result, renderSearch(result));
    }
    case 'sections': {
      const result = await wiki.sections({
        title: requireParam(params.title, 'title', 'sections'),
      });
      return ok(result, renderSections(result));
    }
    case 'page': {
      const result = await wiki.page({
        title: requireParam(params.title, 'title', 'page'),
        section: params.section,
        format: params.format === undefined ? undefined : parseBodyFormat(params.format),
      });
      return ok(result, renderPage(result));
    }
    case 'suggest': {
      const result = await wiki.suggest({
        query: requireParam(params.query, 'query', 'suggest'),
        limit,
      });
      return ok(result, renderSuggest(result));
    }
    default:
      return assertNever(params.action);
  }
}

/** 每个语言站复用一个库客户端（内部已缓存 `WikiClient`）。 */
const clients = new Map<WikiLanguage, McwikiSearch>();

function clientFor(language: WikiLanguage): McwikiSearch {
  const existing = clients.get(language);
  if (existing !== undefined) {
    return existing;
  }
  const created = createMcwikiSearch({ language });
  clients.set(language, created);
  return created;
}

export const mcwikiTool = defineTool({
  name: 'mcwiki',
  label: 'Minecraft Wiki',
  description:
    'Query the Minecraft Wiki for Minecraft data. Actions: search finds pages by keyword, sections lists a page\'s table of contents, page reads a section or whole page body, suggest returns titles by prefix. Page bodies are converted to Markdown by default, so tables such as crafting and drops are preserved. Read-only; no API key required.',
  promptSnippet: 'Query Minecraft Wiki pages, sections, and article bodies',
  promptGuidelines: [
    'Use mcwiki for Minecraft facts (blocks, mobs, items, crafting, drops, mechanics) instead of answering from memory.',
    'Save tokens: call action="search" to confirm the exact title, then action="sections" for the table of contents, then action="page" with section to read only the needed part.',
    'Cite the returned url when reporting facts from the wiki.',
  ],
  parameters: mcwikiParameters,
  async execute(_toolCallId, params) {
    return runMcwikiAction(clientFor(params.language ?? DEFAULT_LANGUAGE), params);
  },
});

/** 扩展工厂: pi 加载本扩展时注册 `mcwiki` 工具。 */
export function registerMcwiki(pi: ExtensionAPI): void {
  pi.registerTool(mcwikiTool);
}

export default registerMcwiki;
