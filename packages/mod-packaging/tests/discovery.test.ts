// ─── 包目录探测与类型判定的单元测试（用临时目录，不依赖真实模组） ──

import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  assertNoLegacyPackDirectories,
  collectCandidatePackDirectories,
  detectPackDirectory,
  detectPackType,
  resolvePackDirectories,
} from "../src/discovery";

/** 在临时目录中建一个模组骨架,返回根目录与清理函数 */
function createProjectFixture(): { projectRoot: string; cleanup: () => void } {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mct-packaging-"));
  return {
    projectRoot,
    cleanup: () => fs.rmSync(projectRoot, { recursive: true, force: true }),
  };
}

/** 在给定目录写入一个 manifest.json */
function writeManifest(directory: string, manifest: unknown): void {
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");
}

/** 行为包清单 */
const BEHAVIOR_MANIFEST = {
  header: { uuid: "00000000-0000-0000-0000-000000000001", version: [1, 0, 0] },
  modules: [{ type: "script", version: [1, 0, 0] }],
};

/** 资源包清单 */
const RESOURCE_MANIFEST = {
  header: { uuid: "00000000-0000-0000-0000-000000000002", version: [1, 0, 0] },
  modules: [{ type: "resources", version: [1, 0, 0] }],
};

test("detectPackType 依据 script 模块判定行为包", () => {
  const fixture = createProjectFixture();
  try {
    const directory = path.join(fixture.projectRoot, "pack");
    writeManifest(directory, BEHAVIOR_MANIFEST);
    assert.equal(detectPackType(path.join(directory, "manifest.json")), "behavior");
  } finally {
    fixture.cleanup();
  }
});

test("detectPackType 依据 data 模块判定行为包", () => {
  const fixture = createProjectFixture();
  try {
    const directory = path.join(fixture.projectRoot, "pack");
    writeManifest(directory, {
      header: { uuid: "00000000-0000-0000-0000-000000000003", version: [1, 0, 0] },
      modules: [{ type: "data", version: [1, 0, 0] }],
    });
    assert.equal(detectPackType(path.join(directory, "manifest.json")), "behavior");
  } finally {
    fixture.cleanup();
  }
});

test("detectPackType 依据 resources 模块判定资源包", () => {
  const fixture = createProjectFixture();
  try {
    const directory = path.join(fixture.projectRoot, "pack");
    writeManifest(directory, RESOURCE_MANIFEST);
    assert.equal(detectPackType(path.join(directory, "manifest.json")), "resource");
  } finally {
    fixture.cleanup();
  }
});

test("detectPackType 模块类型都不匹配时报错", () => {
  const fixture = createProjectFixture();
  try {
    const directory = path.join(fixture.projectRoot, "pack");
    writeManifest(directory, {
      header: { uuid: "00000000-0000-0000-0000-000000000004", version: [1, 0, 0] },
      modules: [{ type: "skin_pack", version: [1, 0, 0] }],
    });
    assert.throws(() => detectPackType(path.join(directory, "manifest.json")), /无法从清单判定包类型/);
  } finally {
    fixture.cleanup();
  }
});

test("detectPackType 缺少 manifest.json 时报错", () => {
  const fixture = createProjectFixture();
  try {
    assert.throws(
      () => detectPackType(path.join(fixture.projectRoot, "missing", "manifest.json")),
      /包目录缺少 manifest\.json/
    );
  } finally {
    fixture.cleanup();
  }
});

test("collectCandidatePackDirectories 只收集含 manifest.json 的子目录", () => {
  const fixture = createProjectFixture();
  try {
    writeManifest(path.join(fixture.projectRoot, "behavior_packs", "with-manifest"), BEHAVIOR_MANIFEST);
    fs.mkdirSync(path.join(fixture.projectRoot, "behavior_packs", "without-manifest"), { recursive: true });
    fs.mkdirSync(path.join(fixture.projectRoot, "behavior_packs", ".hidden"), { recursive: true });
    const candidates = collectCandidatePackDirectories(fixture.projectRoot, "behavior_packs");
    assert.equal(candidates.length, 1);
    assert.equal(path.basename(candidates[0]), "with-manifest");
  } finally {
    fixture.cleanup();
  }
});

test("collectCandidatePackDirectories 对不存在的目录返回空数组", () => {
  const fixture = createProjectFixture();
  try {
    assert.deepEqual(collectCandidatePackDirectories(fixture.projectRoot, "behavior_packs"), []);
  } finally {
    fixture.cleanup();
  }
});

test("assertNoLegacyPackDirectories 检测到 BP 时报错并提示改名", () => {
  const fixture = createProjectFixture();
  try {
    fs.mkdirSync(path.join(fixture.projectRoot, "BP"), { recursive: true });
    assert.throws(() => assertNoLegacyPackDirectories(fixture.projectRoot), /检测到 BP\/.*改名为 behavior_packs/);
  } finally {
    fixture.cleanup();
  }
});

test("assertNoLegacyPackDirectories 检测到 RP 时报错并提示改名", () => {
  const fixture = createProjectFixture();
  try {
    fs.mkdirSync(path.join(fixture.projectRoot, "RP"), { recursive: true });
    assert.throws(() => assertNoLegacyPackDirectories(fixture.projectRoot), /检测到 RP\/.*改名为 resource_packs/);
  } finally {
    fixture.cleanup();
  }
});

test("assertNoLegacyPackDirectories 使用官方全名时不报错", () => {
  const fixture = createProjectFixture();
  try {
    fs.mkdirSync(path.join(fixture.projectRoot, "behavior_packs"), { recursive: true });
    fs.mkdirSync(path.join(fixture.projectRoot, "resource_packs"), { recursive: true });
    assert.doesNotThrow(() => assertNoLegacyPackDirectories(fixture.projectRoot));
  } finally {
    fixture.cleanup();
  }
});

test("resolvePackDirectories 探测行为包与资源包", () => {
  const fixture = createProjectFixture();
  try {
    writeManifest(path.join(fixture.projectRoot, "behavior_packs", "demo"), BEHAVIOR_MANIFEST);
    writeManifest(path.join(fixture.projectRoot, "resource_packs", "demo"), RESOURCE_MANIFEST);
    const directories = resolvePackDirectories(fixture.projectRoot);
    assert.equal(path.basename(directories.behaviorPackDirectory ?? ""), "demo");
    assert.equal(path.basename(directories.resourcePackDirectory ?? ""), "demo");
  } finally {
    fixture.cleanup();
  }
});

test("resolvePackDirectories 只有行为包时资源包为 undefined", () => {
  const fixture = createProjectFixture();
  try {
    writeManifest(path.join(fixture.projectRoot, "behavior_packs", "demo"), BEHAVIOR_MANIFEST);
    const directories = resolvePackDirectories(fixture.projectRoot);
    assert.equal(path.basename(directories.behaviorPackDirectory ?? ""), "demo");
    assert.equal(directories.resourcePackDirectory, undefined);
  } finally {
    fixture.cleanup();
  }
});

test("同类型命中多个包目录时报歧义错误", () => {
  const fixture = createProjectFixture();
  try {
    writeManifest(path.join(fixture.projectRoot, "behavior_packs", "first"), BEHAVIOR_MANIFEST);
    writeManifest(path.join(fixture.projectRoot, "behavior_packs", "second"), BEHAVIOR_MANIFEST);
    assert.throws(() => detectPackDirectory(fixture.projectRoot, "behavior"), /探测到多个行为包目录/);
  } finally {
    fixture.cleanup();
  }
});
