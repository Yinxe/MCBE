/**
 * 每个失败都携带分类（code）、可操作提示（hint）与进程退出码。
 */

import type { ErrorResult } from './types.js';

/** 失败分类。调用方与 CLI 据此决定退出码与提示文案。 */
export type ErrorCode =
  | 'missing-title'
  | 'section-not-found'
  | 'invalid-input'
  | 'network'
  | 'timeout'
  | 'rate-limited'
  | 'server-error'
  | 'http-error'
  | 'invalid-response'
  | 'api-error';

export interface WikiErrorOptions {
  code: ErrorCode;
  /** 可操作的后续建议，打印在消息下方。 */
  hint?: string | undefined;
  /** 该错误到达顶层时使用的进程退出码，默认 1。 */
  exitCode?: number | undefined;
  cause?: unknown;
}

export class WikiError extends Error {
  readonly code: ErrorCode;
  readonly hint: string | undefined;
  readonly exitCode: number;

  constructor(message: string, options: WikiErrorOptions) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'WikiError';
    this.code = options.code;
    this.hint = options.hint;
    this.exitCode = options.exitCode ?? 1;
  }
}

export function isWikiError(error: unknown): error is WikiError {
  return error instanceof WikiError;
}

/** 把任意抛出物归一化为 WikiError，便于统一上报。 */
export function toWikiError(error: unknown): WikiError {
  if (isWikiError(error)) {
    return error;
  }
  if (error instanceof Error) {
    return new WikiError(error.message, { code: 'api-error', cause: error });
  }
  return new WikiError(String(error), { code: 'api-error' });
}

/**
 * 归一化为统一错误形状（`ErrorResult`）。
 * CLI 的 `--json` 与 pi 工具都复用它，保证失败形状与成功形状一样稳定。
 */
export function toErrorResult(error: unknown): ErrorResult {
  const wikiError = toWikiError(error);
  return {
    error: {
      code: wikiError.code,
      message: wikiError.message,
      ...(wikiError.hint === undefined ? {} : { hint: wikiError.hint }),
    },
  };
}
