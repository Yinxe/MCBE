/**
 * 验证「pi 加载该包后工具与 skill 均出现」（8.1 / 8.3）。
 *
 * 不是只读 `package.json` 断言字段存在，而是把包根目录交给 pi 自己的
 * 发现逻辑：`discoverAndLoadExtensions()` 会解析 `pi.extensions`，
 * `loadSkillsFromDir()` 会解析 `pi.skills`。这样打包入口写错（例如指向
 * `dist` 而实际未构建、或路径拼错）都会在这里暴露。
 */

import { readFile } from 'node:fs/promises';

import { discoverAndLoadExtensions, loadSkillsFromDir } from '@earendil-works/pi-coding-agent';
import { describe, expect, it } from 'vitest';

const PACKAGE_ROOT = new URL('../../', import.meta.url).pathname;
const EXTENSION_PATH = new URL('./extension.ts', import.meta.url).pathname;

interface PiManifest {
  name: string;
  keywords?: string[];
  pi?: { extensions?: string[]; skills?: string[] };
}

async function manifest(): Promise<PiManifest> {
  return JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8')) as PiManifest;
}

describe('包清单声明（8.3）', () => {
  it('声明 pi.extensions 与 pi.skills，且带 pi-package 关键词', async () => {
    const parsed = await manifest();
    expect(parsed.keywords).toContain('pi-package');
    expect(parsed.pi?.extensions).toEqual(['./src/pi/extension.ts']);
    expect(parsed.pi?.skills).toEqual(['./skills']);
  });
});

describe('pi 真实加载本包（8.1 / 8.3）', () => {
  it('经包根目录加载后出现 mcwiki 工具', async () => {
    // discoverAndLoadExtensions 会一并发现标准位置下的其他扩展（如用户全局扩展），
    // 因此按路径定位本扩展，而不是断言总数。
    const result = await discoverAndLoadExtensions([PACKAGE_ROOT], PACKAGE_ROOT);

    expect(result.errors).toEqual([]);

    const extension = result.extensions.find((entry) => entry.resolvedPath === EXTENSION_PATH);
    expect(extension, `loader 未加载 ${EXTENSION_PATH}`).toBeDefined();

    // `tools` 是 Map<string, RegisteredTool>，键为工具名。
    const tool = extension?.tools.get('mcwiki');
    expect(tool).toBeDefined();
    expect(tool?.definition.description).toContain('Minecraft Wiki');
    expect(tool?.definition.parameters).toBeDefined();
  }, 60_000);

  it('加载 skills/ 后出现 mcwiki-search skill 且描述可路由', () => {
    const result = loadSkillsFromDir({ dir: `${PACKAGE_ROOT}skills/`, source: 'test' });

    expect(result.diagnostics).toEqual([]);

    const skill = result.skills.find((entry) => entry.name === 'mcwiki-search');
    expect(skill, '未找到 mcwiki-search skill').toBeDefined();
    // 描述要说明「何时使用」，否则模型无法路由。
    expect(skill?.description.length ?? 0).toBeGreaterThan(40);
    expect(skill?.description).toContain('Minecraft Wiki');
    expect(skill?.disableModelInvocation).toBe(false);
  });
});
