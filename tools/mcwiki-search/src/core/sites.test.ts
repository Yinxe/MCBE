import { describe, expect, it } from 'vitest';

import { SITES, normalizeTitle, otherLanguages, pageUrl, splitAnchor } from './sites.js';

describe('sites', () => {
  it('两站的 API 与 base URL 正确', () => {
    expect(SITES.zh.apiUrl).toBe('https://zh.minecraft.wiki/api.php');
    expect(SITES.zh.baseUrl).toBe('https://zh.minecraft.wiki');
    expect(SITES.en.apiUrl).toBe('https://minecraft.wiki/api.php');
    expect(SITES.en.baseUrl).toBe('https://minecraft.wiki');
  });

  it('pageUrl 生成两站标题 URL（空格转下划线并百分号编码）', () => {
    expect(pageUrl(SITES.zh, '苦力怕')).toBe(
      'https://zh.minecraft.wiki/w/%E8%8B%A6%E5%8A%9B%E6%80%95',
    );
    expect(pageUrl(SITES.en, 'Block of Diamond')).toBe(
      'https://minecraft.wiki/w/Block_of_Diamond',
    );
  });

  it('normalizeTitle 把下划线换成空格并去除首尾空白', () => {
    expect(normalizeTitle('  Block_of_Diamond ')).toBe('Block of Diamond');
  });

  it('splitAnchor 拆出标题与锚点', () => {
    expect(splitAnchor('苦力怕#行为')).toEqual({ title: '苦力怕', anchor: '行为' });
    expect(splitAnchor('苦力怕')).toEqual({ title: '苦力怕', anchor: undefined });
    expect(splitAnchor('苦力怕#')).toEqual({ title: '苦力怕', anchor: undefined });
    expect(splitAnchor('Block_of_Diamond#Usage')).toEqual({
      title: 'Block of Diamond',
      anchor: 'Usage',
    });
  });

  it('otherLanguages 返回另一种语言', () => {
    expect(otherLanguages('zh')).toEqual(['en']);
    expect(otherLanguages('en')).toEqual(['zh']);
  });
});
