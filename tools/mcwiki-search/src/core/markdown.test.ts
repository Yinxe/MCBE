import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { cleanMarkdown, convertHtml } from './markdown.js';

const fixtureDirectory = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

function fixture(name: string): string {
  return readFileSync(join(fixtureDirectory, name), 'utf8');
}

const IMAGE_SYNTAX = /!\[[^\]]*\]\(/;
const LINK_SYNTAX = /\[[^\]]*\]\(/;
const WIKI_LINK_RESIDUE = /\[\[/;
const HORIZONTAL_RULE_LINE = /^\s*([-*_])\s*(?:\1\s*){2,}$/;

function hasHorizontalRuleLine(markdown: string): boolean {
  return markdown.split('\n').some((line) => HORIZONTAL_RULE_LINE.test(line));
}

describe('convertHtml（5.2 DOM→Markdown 管线）', () => {
  it('移除图片、编辑链接与仅由分隔线构成的行', () => {
    const html = `
<div class="mw-parser-output">
  <p>正文 <img src="creeper.png" alt="苦力怕"></p>
  <div class="mw-editsection"><a href="/w/苦力怕?action=edit">编辑</a></div>
  <hr>
  <p>结尾 <a href="https://example.com">外部链接</a></p>
</div>`;

    const markdown = convertHtml(html);
    expect(markdown).toContain('正文');
    expect(markdown).toContain('结尾');
    expect(markdown).toContain('外部链接');
    expect(markdown).not.toMatch(IMAGE_SYNTAX);
    expect(markdown).not.toMatch(LINK_SYNTAX);
    expect(markdown).not.toContain('creeper.png');
    expect(markdown).not.toContain('编辑');
    expect(hasHorizontalRuleLine(markdown)).toBe(false);
  });

  it('移除界面外壳与脚注文本', () => {
    const html = `
<div class="mw-parser-output">
  <div class="toc">目录占位</div>
  <div class="navbox">导航框占位</div>
  <p>实体ID<sup class="reference"><a href="#cite_note-1">[1]</a></sup></p>
  <ol class="references"><li id="cite_note-1">参考资料占位</li></ol>
  <p class="noprint">打印时隐藏</p>
</div>`;

    const markdown = convertHtml(html);
    expect(markdown).toContain('实体ID');
    for (const removed of ['目录占位', '导航框占位', '参考资料占位', '打印时隐藏']) {
      expect(markdown).not.toContain(removed);
    }
  });

  it('保留表格结构', () => {
    const html = `
<table class="wikitable">
<tr><th>物品</th><th>数量</th><th>概率</th></tr>
<tr><td>火药</td><td>0–2</td><td>66.67%</td></tr>
</table>`;

    const markdown = convertHtml(html);
    expect(markdown).toMatch(/\|\s*物品\s*\|/);
    expect(markdown).toMatch(/\|\s*火药\s*\|/);
    expect(markdown).toContain('0–2');
    expect(markdown).toContain('66.67%');
  });

  it('空输入返回空串', () => {
    expect(convertHtml('')).toBe('');
    expect(convertHtml('   ')).toBe('');
  });

  // 已知限制：{{Crafting}} 渲染成表格后，原本 2×2 / 3×3 的网格空间位置丢失，
  // 只剩「材料 → 产物」的线性表格。这是有意接受的取舍（见 README「已知限制」）。
  it('合成网格退化为线性表格（已知限制，空间布局丢失）', () => {
    const html = `
<table class="crafting-grid">
<tr><td></td><td>木板</td><td></td></tr>
<tr><td>木板</td><td>木板</td><td>木板</td></tr>
</table>
<table class="crafting-output"><tr><td>工作台</td></tr></table>`;

    const markdown = convertHtml(html);
    expect(markdown).toContain('木板');
    expect(markdown).toContain('工作台');
    // 空槽位只表现为空白单元格，无法还原「哪一格是木板」：
    const tableLine = markdown.split('\n').find((line) => line.includes('木板'));
    expect(tableLine).toBeDefined();
    expect(tableLine).toMatch(/\|\s{2,}\|/);
  });
});

describe('cleanMarkdown', () => {
  it('折叠多余空行并去掉尾随空白', () => {
    expect(cleanMarkdown('a   \n\n\n\nb\n')).toBe('a\n\nb');
  });

  it('删除仅由分隔线构成的行，但保留表格分隔行', () => {
    const table = '| a | b |\n| --- | --- |\n| 1 | 2 |';
    expect(cleanMarkdown('前\n\n---\n\n后')).toBe('前\n\n后');
    expect(cleanMarkdown(table)).toBe(table);
  });
});

describe('真实抓取 fixture（5.4 表格保真）', () => {
  it('苦力怕导言：信息框保留最大生命值与实体 ID', () => {
    const markdown = convertHtml(fixture('creeper-lead.section.html'));
    expect(markdown).toContain('最大生命值');
    expect(markdown).toContain('实体ID');
    expect(markdown).toMatch(/creeper/i);
    expect(markdown).toContain('20');
    expect(markdown).not.toMatch(IMAGE_SYNTAX);
    expect(markdown).not.toMatch(LINK_SYNTAX);
    expect(markdown).not.toMatch(WIKI_LINK_RESIDUE);
    expect(hasHorizontalRuleLine(markdown)).toBe(false);
  });

  it('苦力怕掉落物：掉落表保留物品、数量范围与概率', () => {
    const markdown = convertHtml(fixture('creeper-drops.section.html'));
    expect(markdown).toContain('火药');
    expect(markdown).toContain('音乐唱片');
    expect(markdown).toContain('苦力怕的头');
    expect(markdown).toContain('0–2');
    expect(markdown).toContain('66.67%');

    const tableLines = markdown.split('\n').filter((line) => line.trim().startsWith('|'));
    expect(tableLines.length).toBeGreaterThan(10);
    expect(markdown).not.toMatch(IMAGE_SYNTAX);
    expect(markdown).not.toMatch(LINK_SYNTAX);
  });
});
