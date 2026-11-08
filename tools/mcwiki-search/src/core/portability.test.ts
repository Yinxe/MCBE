/**
 * 可移植性守卫：核心（src/core）必须只依赖标准库，
 * 以便库、CLI 与 pi 工具三种运行环境共享同一实现。
 *
 * 本测试自身可以使用 Node API——它只负责扫描，不进入构建产物。
 */

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const coreDirectory = dirname(fileURLToPath(import.meta.url));

/** 收集核心源文件，排除测试文件。 */
function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) {
      return sourceFiles(full);
    }
    if (!entry.name.endsWith('.ts') || entry.name.endsWith('.test.ts')) {
      return [];
    }
    return [full];
  });
}

const FORBIDDEN: ReadonlyArray<{ label: string; pattern: RegExp }> = [
  { label: 'node: 内置模块导入', pattern: /from\s+['"]node:/ },
  { label: 'CommonJS require', pattern: /\brequire\s*\(/ },
  { label: 'process 全局', pattern: /\bprocess\./ },
  { label: 'Buffer 全局', pattern: /\bBuffer\b/ },
  { label: '__dirname / __filename', pattern: /__dirname|__filename/ },
];

describe('核心可移植性', () => {
  const files = sourceFiles(coreDirectory);

  it('扫描到核心源文件', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(FORBIDDEN)('不包含 $label', ({ pattern }) => {
    const offenders = files.filter((file) => pattern.test(readFileSync(file, 'utf8')));
    expect(offenders).toEqual([]);
  });
});
