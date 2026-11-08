/**
 * 配置：读取哪个 Wiki 版本，以及请求超时。
 *
 * 两者都只来自调用方选项；未设置时回落到默认值。
 */

import { WikiError } from './errors.js';
import {
  DEFAULT_LANGUAGE,
  isWikiLanguage,
  SUPPORTED_LANGUAGES,
  type WikiLanguage,
} from './sites.js';
import type { BodyFormat } from './types.js';

export const DEFAULT_TIMEOUT_MS = 30_000;
export const MAX_TIMEOUT_MS = 300_000;

export interface ResolvedConfig {
  language: WikiLanguage;
  timeoutMs: number;
}

export interface ResolveConfigInput {
  language?: string | undefined;
  /** 毫秒数；字符串与数字都接受，与 CLI 的 `--timeout` 一致。 */
  timeout?: string | number | undefined;
}

export function parseLanguage(value: string): WikiLanguage {
  const normalized = value.trim().toLowerCase();
  if (isWikiLanguage(normalized)) {
    return normalized;
  }
  throw new WikiError(`不支持的语言: ${value}`, {
    code: 'invalid-input',
    hint: `可选语言: ${SUPPORTED_LANGUAGES.join(' / ')}（zh = 中文站，en = 英文站）`,
  });
}

export function parseTimeout(value: string | number | undefined): number | undefined {  if (value === undefined) {
    return undefined;
  }
  const text = String(value).trim();
  if (text === '') {
    return undefined;
  }
  const numeric = Number(text);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    throw new WikiError(`超时时间无效: ${text}`, {
      code: 'invalid-input',
      hint: '用法: --timeout 30000（毫秒）',
    });
  }
  const rounded = Math.round(numeric);
  if (rounded > MAX_TIMEOUT_MS) {
    throw new WikiError(`超时时间过大: ${rounded}ms`, {
      code: 'invalid-input',
      hint: `上限 ${MAX_TIMEOUT_MS}ms`,
    });
  }
  return rounded;
}

/** 解析 `language` 与 `timeout`，默认 `zh` 与 30 秒。 */export function resolveConfig(input: ResolveConfigInput = {}): ResolvedConfig {
  const language =
    input.language === undefined || input.language.trim() === ''
      ? DEFAULT_LANGUAGE
      : parseLanguage(input.language);
  const timeoutMs = parseTimeout(input.timeout) ?? DEFAULT_TIMEOUT_MS;
  return { language, timeoutMs };
}

/** 正文可选格式，顺序即 CLI `--help` 中的罗列顺序。 */
export const BODY_FORMATS: readonly BodyFormat[] = ['markdown', 'text', 'wikitext'];

/** 解析 `--format`；非法值给出现有选项。 */
export function parseBodyFormat(value: string): BodyFormat {
  const normalized = value.trim().toLowerCase();
  for (const format of BODY_FORMATS) {
    if (format === normalized) {
      return format;
    }
  }
  throw new WikiError(`不支持的格式: ${value}`, {
    code: 'invalid-input',
    hint: `可选格式: ${BODY_FORMATS.join(' / ')}（markdown 保留表格，text 为纯文本，wikitext 为原始标记）`,
  });
}

export interface ParseCountOptions {
  /** 出现在错误消息里的字段名，例如“返回条数”。 */
  label: string;
  minimum?: number;
  maximum: number;
}

/** 解析正整数计数选项（`--limit` / `--namespace`）；空值视为未指定。 */
export function parseCount(
  value: string | number | undefined,
  options: ParseCountOptions,
): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const text = String(value).trim();
  if (text === '') {
    return undefined;
  }
  const minimum = options.minimum ?? 1;
  const numeric = Number(text);
  if (!Number.isInteger(numeric) || numeric < minimum || numeric > options.maximum) {
    throw new WikiError(`${options.label}无效: ${text}`, {
      code: 'invalid-input',
      hint: `请输入 ${minimum} 到 ${options.maximum} 之间的整数`,
    });
  }
  return numeric;
}
