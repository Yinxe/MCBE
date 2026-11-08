/**
 * 标题解析：先按目标语言直查，失败时经另一语言的跨语言链接回退。
 *
 * 移植自参考实现 `tools/packages/mcwiki/src/api.ts` 中的 `resolveTitle`，
 * 差异：字段命名为完整单词（`language`/`translatedFrom`）。
 */

import { WikiError } from './errors.js';
import type { WikiClient } from './client.js';
import { normalizeTitle, otherLanguages, type WikiLanguage } from './sites.js';

export interface TitleResolution {
  title: string;
  pageId: number;
  language: WikiLanguage;
  /** 当标题是经跨语言链接翻译得来时给出。 */
  translatedFrom?: { language: WikiLanguage; title: string };
}

export interface ResolveTitleOptions {
  language: WikiLanguage;
  /** 是否经另一语言的跨语言链接查找，默认开启。 */
  crossLanguage?: boolean;
  clientFor: (language: WikiLanguage) => WikiClient;
}

/**
 * 解析用户输入的标题。
 *
 * 会经另一语言版本的跨语言链接回退，因此
 * `page 苦力怕 -l en` 会打开 "Creeper" 而不是直接失败。
 */
export async function resolveTitle(
  input: string,
  options: ResolveTitleOptions,
): Promise<TitleResolution> {
  const client = options.clientFor(options.language);
  const title = normalizeTitle(input);

  const direct = await client.info(title);
  if (direct !== undefined) {
    return { title: direct.title, pageId: direct.pageId, language: options.language };
  }

  if (options.crossLanguage !== false) {
    for (const other of otherLanguages(options.language)) {
      const otherClient = options.clientFor(other);
      // 最多两个候选，顺序执行即可。
      const links = await otherClient.languageLinks(title);
      const match = links.find((link) => link.language === options.language);
      if (match === undefined) {
        continue;
      }
      const found = await client.info(match.title);
      if (found !== undefined) {
        return {
          title: found.title,
          pageId: found.pageId,
          language: options.language,
          translatedFrom: { language: other, title },
        };
      }
    }
  }

  const suggestions = await client.suggest(title, 5).catch(() => [] as string[]);
  throw new WikiError(`找不到词条: ${title}（${client.site.label}）`, {
    code: 'missing-title',
    hint:
      suggestions.length > 0
        ? `相近词条: ${suggestions.join(' / ')}`
        : `换个关键词搜索: mcwiki-search search "${title}"`,
  });
}
