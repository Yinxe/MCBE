/**
 * 本工具访问的两个 Wiki 版本，以及标题 / URL 辅助函数。
 */

export type WikiLanguage = 'zh' | 'en';

export interface Site {
  language: WikiLanguage;
  /** 列表展示用的人类可读标签。 */
  label: string;
  /** MediaWiki `api.php` 端点。 */
  apiUrl: string;
  /** Wiki 根地址，用于拼接人类可读的页面 URL。 */
  baseUrl: string;
}

export const SITES: Record<WikiLanguage, Site> = {
  zh: {
    language: 'zh',
    label: '中文 Minecraft Wiki',
    apiUrl: 'https://zh.minecraft.wiki/api.php',
    baseUrl: 'https://zh.minecraft.wiki',
  },
  en: {
    language: 'en',
    label: 'English Minecraft Wiki',
    apiUrl: 'https://minecraft.wiki/api.php',
    baseUrl: 'https://minecraft.wiki',
  },
};

export const DEFAULT_LANGUAGE: WikiLanguage = 'zh';

export const SUPPORTED_LANGUAGES: readonly WikiLanguage[] = ['zh', 'en'];

export function isWikiLanguage(value: string): value is WikiLanguage {
  return (SUPPORTED_LANGUAGES as readonly string[]).includes(value);
}

export function siteFor(language: WikiLanguage): Site {
  return SITES[language];
}

/** 除 `language` 之外的所有受支持语言。 */
export function otherLanguages(language: WikiLanguage): WikiLanguage[] {
  return SUPPORTED_LANGUAGES.filter((candidate) => candidate !== language);
}

/** MediaWiki 标题在 URL 中用下划线；其余字符做百分号编码。 */
export function pageUrl(site: Site, title: string): string {
  const slug = encodeURIComponent(title.replace(/\s+/g, '_')).replace(/%2F/g, '/');
  return `${site.baseUrl}/w/${slug}`;
}

/** API 标题用空格代替下划线，并去除首尾空白。 */
export function normalizeTitle(title: string): string {
  return title.replace(/_/g, ' ').trim();
}

/** 把 `Title#Anchor` 拆成标题与锚点两部分。 */
export function splitAnchor(input: string): { title: string; anchor: string | undefined } {
  const index = input.indexOf('#');
  if (index === -1) {
    return { title: normalizeTitle(input), anchor: undefined };
  }
  const anchor = input.slice(index + 1).trim();
  return {
    title: normalizeTitle(input.slice(0, index)),
    anchor: anchor === '' ? undefined : anchor,
  };
}
