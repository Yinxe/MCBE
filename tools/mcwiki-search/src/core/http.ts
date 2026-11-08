/**
 * 基于标准 `fetch` 的 MediaWiki API 传输层。
 *
 * 只依赖标准库（`fetch` / `AbortSignal` / `URL`），不引入任何 Node 专有模块，
 * 以便库、CLI 与 pi 工具共享同一核心。
 */

import { DEFAULT_TIMEOUT_MS } from './config.js';
import { WikiError, type ErrorCode } from './errors.js';
import { asArray, asRecord, asString } from './json.js';

/** 按站点礼仪向运维方标识本工具。必须是纯 ASCII：`fetch` 会把请求头值转成 ByteString。 */
export const USER_AGENT =
  'mc-toolchain-mcwiki-search/0.1 (read-only Minecraft Wiki API client)';

export type ApiParamValue = string | number | boolean | undefined;
export type ApiParams = Record<string, ApiParamValue>;

export interface HttpClientOptions {
  /** MediaWiki `api.php` 端点。 */
  apiUrl: string;
  /** Wiki 根地址，仅用于错误提示。 */
  baseUrl: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  userAgent?: string;
  /** 首次失败后的额外尝试次数（仅对超时/网络/429/5xx）。 */
  retries?: number;
  sleep?: (ms: number) => Promise<void>;
}

function hintForStatus(status: number): string | undefined {
  if (status === 403) {
    return '被站点拒绝：可能触发了反爬限制，稍后重试或换网络出口';
  }
  if (status === 404) {
    return '接口地址不存在：检查站点域名是否变化';
  }
  if (status === 429) {
    return '请求过于频繁：稍等片刻再试';
  }
  if (status >= 500) {
    return '站点服务端错误：稍后重试';
  }
  return undefined;
}

/** 传输层失败：额外标记是否值得重试。 */
class HttpError extends WikiError {
  readonly retryable: boolean;

  constructor(
    message: string,
    options: { code: ErrorCode; retryable: boolean; hint?: string | undefined; cause?: unknown },
  ) {
    super(message, { code: options.code, hint: options.hint, cause: options.cause });
    this.name = 'HttpError';
    this.retryable = options.retryable;
  }
}

function firstApiError(
  payload: Record<string, unknown>,
): { code: string; text: string } | undefined {
  const candidates = [
    ...asArray(payload.errors),
    ...(payload.error === undefined ? [] : [payload.error]),
  ];
  for (const candidate of candidates) {
    const record = asRecord(candidate);
    if (record === undefined) {
      continue;
    }
    const text = asString(record.text) ?? asString(record.info) ?? '未知 API 错误';
    return { code: asString(record.code) ?? 'unknown', text };
  }
  return undefined;
}

export class HttpClient {
  readonly apiUrl: string;
  readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly userAgent: string;
  private readonly retries: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(options: HttpClientOptions) {
    this.apiUrl = options.apiUrl;
    this.baseUrl = options.baseUrl;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.userAgent = options.userAgent ?? USER_AGENT;
    this.retries = options.retries ?? 2;
    this.sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  }

  /** 为一次 API 调用构造请求 URL。 */
  buildUrl(action: string, params: ApiParams = {}): string {
    let url: URL;
    try {
      url = new URL(this.apiUrl);
    } catch (error) {
      throw new WikiError(`API 地址无效: ${this.apiUrl}`, {
        code: 'invalid-input',
        hint: '检查站点描述符里的 apiUrl',
        cause: error,
      });
    }
    url.searchParams.set('action', action);
    url.searchParams.set('format', 'json');
    url.searchParams.set('formatversion', '2');
    url.searchParams.set('errorformat', 'plaintext');
    url.searchParams.set('utf8', '1');
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined) {
        continue;
      }
      url.searchParams.set(key, typeof value === 'boolean' ? (value ? '1' : '0') : String(value));
    }
    return url.toString();
  }

  private async fetchOnce(url: string): Promise<unknown> {
    const signal = AbortSignal.timeout(this.timeoutMs);
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: 'GET',
        headers: { 'user-agent': this.userAgent, accept: 'application/json' },
        signal,
        redirect: 'follow',
      });
    } catch (error) {
      if (
        error instanceof Error &&
        (error.name === 'TimeoutError' || error.name === 'AbortError')
      ) {
        throw new HttpError(`请求超时（${Math.round(this.timeoutMs / 1000)}s）: ${this.apiUrl}`, {
          code: 'timeout',
          retryable: true,
          hint: '放宽超时: --timeout 60000，或检查网络',
          cause: error,
        });
      }
      throw new HttpError(`无法连接 ${this.baseUrl}`, {
        code: 'network',
        retryable: true,
        hint: '检查网络/代理',
        cause: error,
      });
    }

    const text = await response.text();
    if (!response.ok) {
      const code: ErrorCode =
        response.status === 429
          ? 'rate-limited'
          : response.status >= 500
            ? 'server-error'
            : 'http-error';
      throw new HttpError(
        `HTTP ${response.status}: ${text.trim().slice(0, 200) || response.statusText}`,
        {
          code,
          retryable: response.status === 429 || response.status >= 500,
          hint: hintForStatus(response.status),
        },
      );
    }

    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch (error) {
      throw new WikiError('响应不是合法 JSON', {
        code: 'invalid-response',
        hint: `原始响应: ${text.slice(0, 200)}`,
        cause: error,
      });
    }

    const record = asRecord(payload);
    if (record !== undefined) {
      const apiError = firstApiError(record);
      if (apiError !== undefined) {
        const missing = apiError.code === 'missingtitle';
        throw new WikiError(`Wiki API 错误（${apiError.code}）: ${apiError.text}`, {
          code: missing ? 'missing-title' : 'api-error',
          hint: missing ? '换个词条名试试: mcwiki-search suggest <关键词>' : undefined,
        });
      }
    }

    return payload;
  }

  /** 单次 API 调用，对超时/网络/429/5xx 做有限重试。 */
  async request(action: string, params: ApiParams = {}): Promise<unknown> {
    const url = this.buildUrl(action, params);
    let attempt = 0;
    for (;;) {
      attempt += 1;
      try {
        return await this.fetchOnce(url);
      } catch (error) {
        const retryable = error instanceof HttpError && error.retryable;
        if (!retryable || attempt > this.retries) {
          throw error;
        }
        await this.sleep(400 * attempt);
      }
    }
  }
}
