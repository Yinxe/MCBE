/**
 * CLI 接线：`search` / `sections` / `page` / `suggest` 四个子命令。
 *
 * 输出契约（任务 7.2）：
 * - 非 TTY 或显式 `--json` → stdout 恰好一份 JSON（成功为结果，失败为 `ErrorResult`）；
 * - TTY → stdout 是人类可读文本；
 * - 人类提示与错误一律走 stderr；
 * - 失败时设置非零退出码（取 `WikiError.exitCode`）。
 *
 * IO 全部经 `CliContext` 注入，因此单测可以直接驱动，无需子进程。
 */

import { Command, CommanderError } from 'commander';

import { parseBodyFormat, parseCount, parseLanguage, parseTimeout } from '../core/config.js';
import { toErrorResult, toWikiError } from '../core/errors.js';
import { createMcwikiSearch, type McwikiSearch } from '../core/index.js';
import type { PageResult, SearchResult, SectionsResult, SuggestResult } from '../core/types.js';
import { renderPage, renderSearch, renderSections, renderSuggest } from './format.js';

const MAX_SEARCH_LIMIT = 50;
const MAX_SUGGEST_LIMIT = 50;
const MAX_NAMESPACE = 1000;

export interface CliContext {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  /** stdout 是否为交互终端；决定默认输出形态。 */
  isTTY: boolean;
  /** 失败时设置进程退出码。 */
  setExitCode: (code: number) => void;
  version: string;
  /** 便于测试注入（透传给 `createMcwikiSearch`）。 */
  fetchImpl?: typeof fetch;
}

interface GlobalOptions {
  language?: string;
  timeout?: string;
  json?: boolean;
}

/**
 * 执行一次查询并统一处理输出与错误。
 *
 * JSON 模式下失败也写 stdout，保证管道消费者总是只读一份 JSON。
 */
async function execute<T>(
  context: CliContext,
  json: boolean,
  task: () => Promise<T>,
  render: (result: T) => string,
): Promise<void> {
  try {
    const result = await task();
    context.stdout(json ? `${JSON.stringify(result, null, 2)}\n` : render(result));
  } catch (cause) {
    const error = toWikiError(cause);
    if (json) {
      context.stdout(`${JSON.stringify(toErrorResult(error), null, 2)}\n`);
    }
    context.stderr(`${error.message}\n`);
    if (error.hint !== undefined) {
      context.stderr(`提示: ${error.hint}\n`);
    }
    context.setExitCode(error.exitCode);
  }
}

/** 读取全局选项（含父命令），构造库客户端后交给 `task`。 */
async function runCommand<T>(
  context: CliContext,
  command: Command,
  task: (wiki: McwikiSearch) => Promise<T>,
  render: (result: T) => string,
): Promise<void> {
  const globals = command.optsWithGlobals<GlobalOptions>();
  const json = globals.json === true || !context.isTTY;
  await execute(
    context,
    json,
    () => {
      const wiki = createMcwikiSearch({
        language: parseLanguage(globals.language ?? 'zh'),
        timeoutMs: parseTimeout(globals.timeout),
        fetchImpl: context.fetchImpl,
      });
      return task(wiki);
    },
    render,
  );
}

/** 组装命令树。IO 与版本号都来自 `context`。 */
export function buildProgram(context: CliContext): Command {
  const program = new Command();

  program
    .name('mcwiki-search')
    .description('Minecraft Wiki 只读查询：搜索词条、章节目录、正文（Markdown）与相近词条建议')
    .version(context.version)
    .option('-l, --language <language>', 'Wiki 语言版本: zh（中文站，默认）| en（英文站）', 'zh')
    .option('--timeout <ms>', '单次请求超时（毫秒），默认 30000')
    .option('--json', '输出 JSON（非 TTY 时自动启用）')
    .showHelpAfterError()
    .showSuggestionAfterError();

  // 让 help / 版本 / 用法错误也走注入的 IO，便于测试与统一管道行为。
  program.configureOutput({
    writeOut: (text) => context.stdout(text),
    writeErr: (text) => context.stderr(text),
  });

  // 必须在添加子命令之前调用：子命令仅在创建时继承设置。
  // help / 版本 / 用法错误都抛 CommanderError，由 runCli 转成退出码。
  program.exitOverride();

  program
    .command('search')
    .description('按关键词搜索词条')
    .argument('<query>', '搜索关键词')
    .option('-n, --limit <count>', `返回条数（1-${MAX_SEARCH_LIMIT}）`, '10')
    .option('--namespace <id>', '搜索命名空间 ID', '0')
    .action(
      async (
        query: string,
        options: { limit: string; namespace: string },
        command: Command,
      ): Promise<void> => {
        await runCommand<SearchResult>(
          context,
          command,
          (wiki) =>
            wiki.search({
              query,
              limit: parseCount(options.limit, { label: '返回条数', maximum: MAX_SEARCH_LIMIT }),
              namespace: parseCount(options.namespace, {
                label: '命名空间',
                minimum: 0,
                maximum: MAX_NAMESPACE,
              }),
            }),
          renderSearch,
        );
      },
    );

  program
    .command('sections')
    .description('列出词条的章节目录')
    .argument('<title>', '词条标题')
    .action(async (title: string, _options: unknown, command: Command): Promise<void> => {
      await runCommand<SectionsResult>(context, command, (wiki) => wiki.sections({ title }), renderSections);
    });

  program
    .command('page')
    .description('读取整页或单个章节的正文')
    .argument('<title>', '词条标题')
    .option('-s, --section <section>', '章节：序号 / 点分编号 / 锚点 / 标题名（0 = 导言）')
    .option('-f, --format <format>', 'markdown（单节默认）| text（整页默认）| wikitext')
    .action(
      async (
        title: string,
        options: { section?: string; format?: string },
        command: Command,
      ): Promise<void> => {
        await runCommand<PageResult>(
          context,
          command,
          (wiki) =>
            wiki.page({
              title,
              section: options.section,
              format: options.format === undefined ? undefined : parseBodyFormat(options.format),
            }),
          renderPage,
        );
      },
    );

  program
    .command('suggest')
    .description('按前缀获取相近词条')
    .argument('<query>', '标题前缀')
    .option('-n, --limit <count>', `返回条数（1-${MAX_SUGGEST_LIMIT}）`, '10')
    .action(
      async (query: string, options: { limit: string }, command: Command): Promise<void> => {
        await runCommand<SuggestResult>(
          context,
          command,
          (wiki) =>
            wiki.suggest({
              query,
              limit: parseCount(options.limit, { label: '返回条数', maximum: MAX_SUGGEST_LIMIT }),
            }),
          renderSuggest,
        );
      },
    );

  return program;
}

/** 与 `bin` 入口共用的执行路径；`argv` 不含 node 与脚本路径。 */
export async function runCli(argv: readonly string[], context: CliContext): Promise<void> {
  const program = buildProgram(context);
  try {
    await program.parseAsync([...argv], { from: 'user' });
  } catch (error) {
    if (error instanceof CommanderError) {
      context.setExitCode(error.exitCode);
      return;
    }
    throw error;
  }
}
