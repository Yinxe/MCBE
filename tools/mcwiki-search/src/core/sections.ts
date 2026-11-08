/**
 * 章节定位：把用户给的章节引用匹配到目录项。
 *
 * 移植自参考实现 `tools/packages/mcwiki/src/sections.ts`，差异：
 * 使用统一的 `SectionItem`（字段 `title` 对应参考实现的 `line`）。
 */

import type { SectionItem } from './types.js';

function normalize(value: string): string {
  return value.replace(/_/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * 在目录中匹配章节引用。
 *
 * 支持章节序号（`0` 为导言）、点分编号（`2.1`）、锚点（`On_death`）
 * 或标题名（大小写不敏感）。
 */
export function findSection(
  sections: readonly SectionItem[],
  query: string,
): SectionItem | undefined {
  const needle = normalize(query);
  if (needle === '') {
    return undefined;
  }

  if (/^\d+$/.test(needle)) {
    const asIndex = Number(needle);
    const byNumber = sections.find((section) => section.number === needle);
    if (byNumber !== undefined) {
      return byNumber;
    }
    return sections.find((section) => section.index === asIndex);
  }

  // 点分编号（"2.1"）优先于标题名匹配。
  const byNumber = sections.find((section) => section.number === needle);
  if (byNumber !== undefined) {
    return byNumber;
  }

  const exact = sections.find(
    (section) => normalize(section.anchor) === needle || normalize(section.title) === needle,
  );
  if (exact !== undefined) {
    return exact;
  }

  const prefixed = sections.find(
    (section) =>
      normalize(section.anchor).startsWith(needle) || normalize(section.title).startsWith(needle),
  );
  if (prefixed !== undefined) {
    return prefixed;
  }

  return sections.find(
    (section) =>
      normalize(section.anchor).includes(needle) || normalize(section.title).includes(needle),
  );
}

/** 用于「章节未找到」提示的最接近章节名。 */
export function sectionNames(sections: readonly SectionItem[], limit = 8): string[] {
  return sections
    .filter((section) => section.title !== '')
    .slice(0, limit)
    .map((section) => `${section.number} ${section.title}`.trim());
}
