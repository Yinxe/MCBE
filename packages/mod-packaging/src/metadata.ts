// ─── 清单元信息拼接(纯逻辑,零文件系统依赖,可 node 单测) ──────
// 显示名与描述全部由 package.json 派生:本模块只处理字符串,不读写文件,
// 因此可脱离游戏与构建环境单独测试。

import type { PackageJson, PackageJsonAuthor } from "./types";

/** 描述中各联系信息行的固定前缀与顺序 */
const DESCRIPTION_LINE_PREFIX = {
  author: "作者：",
  email: "邮箱：",
  homepage: "主页：",
  qqGroup: "QQ群：",
  repository: "仓库：",
} as const;

/** 判定字符串非空(去掉首尾空白后仍有内容) */
function isNonEmptyString(value: string | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * 取必需字段:缺失或为空字符串时报错。
 *
 * 与 `parseVersion` 的失败策略一致——静默回落会让产物带上错误的显示信息,
 * 只在游戏内才暴露,属于用户侧故障,因此直接中止打包。
 */
function requireField(value: string | undefined, fieldName: string, purpose: string): string {
  if (!isNonEmptyString(value)) {
    throw new Error(
      `package.json 的 ${fieldName} 缺失或为空字符串,它是${purpose}的来源,打包中止。`
    );
  }
  return value;
}

/** 把 `author` 的两种写法归一为对象 */
function normalizeAuthor(author: PackageJson["author"]): PackageJsonAuthor {
  if (author === undefined) {
    return {};
  }
  if (typeof author === "string") {
    return { name: author };
  }
  return author;
}

/**
 * 把仓库地址规范化为 `https://<host>/<owner>/<repo>` 可读形式。
 *
 * 依次处理:`git+` 前缀、`git@<host>:<path>` 形式的 SSH 地址、`.git` 后缀、
 * 尾部斜杠。不匹配任何形式的输入原样返回,不报错也不猜测。
 *
 * 不使用 `new URL()`:`git@github.com:Yinxe/MCBE.git` 不是合法 URL
 * (`git@github.com` 会被当成 scheme)直接抛错,仍须前置改写。
 */
export function normalizeRepositoryUrl(repositoryUrl: string): string {
  let normalized = repositoryUrl.trim();

  if (normalized.startsWith("git+")) {
    normalized = normalized.slice("git+".length);
  }

  // `git@github.com:Yinxe/MCBE.git` → `https://github.com/Yinxe/MCBE.git`
  const scpLike = /^git@([^:/]+):(.+)$/.exec(normalized);
  if (scpLike) {
    normalized = `https://${scpLike[1]}/${scpLike[2]}`;
  }

  if (normalized.endsWith(".git")) {
    normalized = normalized.slice(0, -".git".length);
  }

  while (normalized.endsWith("/")) {
    normalized = normalized.slice(0, -1);
  }

  return normalized;
}

/** 从 `repository` 的两种写法中取出地址 */
function resolveRepositoryUrl(repository: PackageJson["repository"]): string | undefined {
  if (repository === undefined) {
    return undefined;
  }
  if (typeof repository === "string") {
    return repository;
  }
  return repository.url;
}

/**
 * 解析清单显示名:`<productName> v<version>`。
 *
 * `productName` 缺失或为空字符串时抛错——回落模组名会得到 `auto-refill v2.2.0`
 * 这种英文技术名,不是可接受的游戏内显示名。
 */
export function resolvePackDisplayName(packageJson: PackageJson): string {
  const productName = requireField(packageJson.productName, "productName", "清单 header.name");
  return `${productName} v${packageJson.version}`;
}

/**
 * 解析清单描述:首行为简介,其后按固定顺序追加联系信息。
 *
 * 固定顺序为简介 → 作者 → 邮箱 → 主页 → QQ群 → 仓库,使不同模组的描述在
 * 游戏内呈现一致。缺失字段整行省略(不 push 进数组),因此不会留下空行或
 * 多余换行,也不会出现「未配置」之类的占位文本。
 *
 * 含 `§` 颜色与样式符号的文本原样保留,不做转义、剥离或截断。
 */
export function resolvePackDescription(packageJson: PackageJson): string {
  const summary = requireField(packageJson.description, "description", "清单 header.description");
  const author = normalizeAuthor(packageJson.author);
  const repositoryUrl = resolveRepositoryUrl(packageJson.repository);

  const lines: string[] = [summary];

  if (isNonEmptyString(author.name)) {
    lines.push(`${DESCRIPTION_LINE_PREFIX.author}${author.name}`);
  }
  if (isNonEmptyString(author.email)) {
    lines.push(`${DESCRIPTION_LINE_PREFIX.email}${author.email}`);
  }
  if (isNonEmptyString(author.url)) {
    lines.push(`${DESCRIPTION_LINE_PREFIX.homepage}${author.url}`);
  }
  if (isNonEmptyString(packageJson.packing?.qq_group)) {
    lines.push(`${DESCRIPTION_LINE_PREFIX.qqGroup}${packageJson.packing.qq_group}`);
  }
  if (isNonEmptyString(repositoryUrl)) {
    lines.push(`${DESCRIPTION_LINE_PREFIX.repository}${normalizeRepositoryUrl(repositoryUrl)}`);
  }

  return lines.join("\n");
}
