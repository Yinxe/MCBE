import * as fs from "fs";
import * as path from "path";

export interface SyncManifestOptions {
  formatName?: (name: string, version: string) => string;
  onManifest?: (manifest: any, dir: string, versionArr: number[]) => void;
  /** 是否把作者/仓库信息注入 manifest.header.description（默认 true） */
  authorInfo?: boolean;
}

/**
 * 从 monorepo 根 package.json 生成作者信息块（多行，\n 换行）。
 *
 * 根判定：从 projectDir 向上找含 `pnpm-workspace.yaml` 的目录，或第一个同时
 * 带 `author` + `repository` 字段的 package.json。顺序固定：
 * 作者/邮箱/主页/QQ群（author 全部字段）+ 仓库（repository.url），字段缺失自动跳过。
 *
 * @param projectDir - 项目根目录（向上查找 monorepo 根）
 * @returns 多行作者信息块（"标签：值" 用 \n 连接），根无作者信息时返回 undefined
 */
export function buildAuthorBlock(projectDir: string): string | undefined {
  const root = findRootPkg(projectDir);
  if (!root || !root.author || typeof root.author !== "object") return undefined;

  const lines: string[] = [];
  const fields: ReadonlyArray<[key: string, label: string]> = [
    ["name", "作者"],
    ["email", "邮箱"],
    ["url", "主页"],
    ["group", "QQ群"],
  ];
  for (const [key, label] of fields) {
    const v = root.author[key];
    if (v !== undefined && v !== null && String(v) !== "") lines.push(`${label}：${v}`);
  }
  if (root.repository && typeof root.repository === "object" && root.repository.url) {
    lines.push(`仓库：${root.repository.url}`);
  }
  return lines.length > 0 ? lines.join("\n") : undefined;
}

/** 向上查找 monorepo 根 package.json：含 pnpm-workspace.yaml 的目录，或第一个带 author+repository 的。 */
function findRootPkg(projectDir: string): any | undefined {
  let dir = path.resolve(projectDir);
  for (;;) {
    const pkgPath = path.join(dir, "package.json");
    const hasPkg = fs.existsSync(pkgPath);
    const isRoot =
      fs.existsSync(path.join(dir, "pnpm-workspace.yaml")) ||
      (hasPkg && hasAuthorAndRepo(JSON.parse(fs.readFileSync(pkgPath, "utf8"))));
    if (isRoot) return hasPkg ? JSON.parse(fs.readFileSync(pkgPath, "utf8")) : undefined;
    const parent = path.dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

function hasAuthorAndRepo(pkg: any): boolean {
  return !!pkg && !!pkg.author && !!pkg.repository;
}

/** 去掉 description 中旧的作者信息块（从第一个 "作者：" 起截断并清尾随换行），保证重复构建不叠加。 */
function stripAuthorBlock(description: string): string {
  const idx = description.indexOf("作者：");
  if (idx < 0) return description;
  return description.slice(0, idx).replace(/\n+$/, "");
}

/**
 * Sync package.json version to all BP/<proj>/manifest.json and RP/<proj>/manifest.json.
 * 默认同时把根 package.json 的作者/仓库信息注入 header.description（\n 换行，含 QQ 群）。
 *
 * @param projectDir - Project root directory
 * @param opts - Optional formatName/onManifest/authorInfo callbacks
 */
export function syncManifestVersion(projectDir: string, opts: SyncManifestOptions = {}): void {
  const pkg = JSON.parse(fs.readFileSync(path.resolve(projectDir, "package.json"), "utf8"));
  const version: string = pkg.version;
  const baseVersion = version.split(/[-+]/)[0];
  const versionArr = baseVersion.split(".").map(Number);
  const formatName = opts.formatName;
  // 作者信息块（默认注入；opts.authorInfo === false 时关闭）
  const authorBlock = opts.authorInfo === false ? undefined : buildAuthorBlock(projectDir);

  for (const dir of ["BP", "RP"]) {
    const manifestDir = path.resolve(projectDir, dir);
    if (!fs.existsSync(manifestDir)) continue;

    const items = fs.readdirSync(manifestDir);
    for (const item of items) {
      const manifestPath = path.resolve(manifestDir, item, "manifest.json");
      if (!fs.existsSync(manifestPath)) continue;

      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
      manifest.header.version = versionArr;

      if (manifest.header.name !== undefined && formatName) {
        manifest.header.name = formatName(manifest.header.name, version);
      }
      if (authorBlock) {
        const base = stripAuthorBlock(manifest.header.description ?? "");
        manifest.header.description = base ? `${base}\n${authorBlock}` : authorBlock;
      }
      if (manifest.modules) {
        manifest.modules = manifest.modules.map((m: any) =>
          Array.isArray(m.version) ? { ...m, version: versionArr } : m
        );
      }
      if (manifest.dependencies) {
        manifest.dependencies = manifest.dependencies.map((d: any) =>
          d.uuid && Array.isArray(d.version) ? { ...d, version: versionArr } : d
        );
      }

      if (opts.onManifest) {
        opts.onManifest(manifest, dir, versionArr);
      }

      fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
    }
  }
}
