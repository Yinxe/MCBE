import { describe, expect, it } from 'vitest';

import { DEFAULT_TIMEOUT_MS, parseLanguage, parseTimeout, resolveConfig } from './config.js';
import { WikiError } from './errors.js';

describe('config', () => {
  it('默认为中文站与 30 秒', () => {
    expect(resolveConfig()).toEqual({ language: 'zh', timeoutMs: DEFAULT_TIMEOUT_MS });
  });

  it('解析语言代码（大小写不敏感）', () => {
    expect(parseLanguage('EN')).toBe('en');
    expect(resolveConfig({ language: 'en', timeout: '1500' })).toEqual({
      language: 'en',
      timeoutMs: 1500,
    });
  });

  it('不支持的语言抛出 invalid-input', () => {
    expect(() => parseLanguage('jp')).toThrowError(WikiError);
    try {
      parseLanguage('jp');
      expect.unreachable('应当抛出');
    } catch (error) {
      expect((error as WikiError).code).toBe('invalid-input');
      expect((error as WikiError).hint).toContain('zh');
    }
  });

  it('timeout 解析、忽略空值与上限', () => {
    expect(parseTimeout('1500')).toBe(1500);
    expect(parseTimeout(undefined)).toBeUndefined();
    expect(parseTimeout('')).toBeUndefined();
    expect(() => parseTimeout('0')).toThrowError(WikiError);
    expect(() => parseTimeout('999999999')).toThrowError(WikiError);
  });
});
