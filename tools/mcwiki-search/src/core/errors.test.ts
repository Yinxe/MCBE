import { describe, expect, it } from 'vitest';

import { WikiError, isWikiError, toWikiError } from './errors.js';

describe('errors', () => {
  it('缺词条错误携带分类、提示与默认退出码', () => {
    const error = new WikiError('找不到词条: 苦力怕', {
      code: 'missing-title',
      hint: '相近词条: 苦力怕（消歧义）',
    });
    expect(error.code).toBe('missing-title');
    expect(error.message).toContain('苦力怕');
    expect(error.hint).toContain('相近词条');
    expect(error.exitCode).toBe(1);
    expect(isWikiError(error)).toBe(true);
  });

  it('支持自定义退出码', () => {
    expect(new WikiError('输入无效', { code: 'invalid-input', exitCode: 2 }).exitCode).toBe(2);
  });

  it('toWikiError 归一化任意抛出物且保留已有 WikiError', () => {
    const wrapped = toWikiError(new Error('boom'));
    expect(wrapped.code).toBe('api-error');
    expect(wrapped.message).toBe('boom');

    const original = new WikiError('网络失败', { code: 'network' });
    expect(toWikiError(original)).toBe(original);
  });
});
