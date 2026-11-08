import { describe, expect, it } from 'vitest';

import { findSection, sectionNames } from './sections.js';
import type { SectionItem } from './types.js';

const SECTIONS: SectionItem[] = [
  { index: 0, number: '', level: 2, title: '', anchor: '' },
  { index: 1, number: '1', level: 2, title: '生成', anchor: '生成' },
  { index: 2, number: '2', level: 2, title: '行为', anchor: '行为' },
  { index: 3, number: '2.1', level: 3, title: '掉落物', anchor: '掉落物' },
  { index: 4, number: '3', level: 2, title: 'On death', anchor: 'On_death' },
];

describe('findSection（4.2 章节定位）', () => {
  it('按点分编号匹配', () => {
    expect(findSection(SECTIONS, '2.1')?.title).toBe('掉落物');
  });

  it('按章节序号匹配（0 为导言）', () => {
    expect(findSection(SECTIONS, '0')?.index).toBe(0);
    expect(findSection(SECTIONS, '3')?.title).toBe('On death');
  });

  it('按锚点匹配（忽略下划线差异）', () => {
    expect(findSection(SECTIONS, 'On_death')?.title).toBe('On death');
  });

  it('按标题名匹配，支持前缀与子串', () => {
    expect(findSection(SECTIONS, '掉落')?.anchor).toBe('掉落物');
    expect(findSection(SECTIONS, '行为')?.number).toBe('2');
  });

  it('空查询或无关查询返回 undefined', () => {
    expect(findSection(SECTIONS, '')).toBeUndefined();
    expect(findSection(SECTIONS, '   ')).toBeUndefined();
    expect(findSection(SECTIONS, '完全不存在')).toBeUndefined();
  });
});

describe('sectionNames', () => {
  it('跳过无语导言并限制数量', () => {
    expect(sectionNames(SECTIONS)).toEqual(['1 生成', '2 行为', '2.1 掉落物', '3 On death']);
    expect(sectionNames(SECTIONS, 2)).toEqual(['1 生成', '2 行为']);
  });
});
