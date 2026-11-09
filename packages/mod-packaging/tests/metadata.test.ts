// ─── 清单元信息拼接的单元测试（纯逻辑，不加载游戏运行时） ──────────

import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeRepositoryUrl, resolvePackDescription, resolvePackDisplayName } from "../src/metadata";
import type { PackageJson } from "../src/types";

/** 构造一个字段齐全的模组 package.json */
function makePackageJson(overrides: Partial<PackageJson> = {}): PackageJson {
  return {
    name: "@mc-toolchain/keepinventory",
    version: "0.0.1",
    productName: "死亡不掉落",
    description: "死亡不掉落 · 无需作弊 · 保留成就",
    author: { name: "Yinx", email: "1423716216@qq.com", url: "https://github.com/Yinxe/" },
    repository: { url: "https://github.com/Yinxe/MCBE" },
    packing: { qq_group: "632178498" },
    ...overrides,
  };
}

test("显示名由产品名与版本组成", () => {
  assert.equal(resolvePackDisplayName(makePackageJson()), "死亡不掉落 v0.0.1");
  assert.equal(
    resolvePackDisplayName(makePackageJson({ productName: "自动替换", version: "2.2.0" })),
    "自动替换 v2.2.0"
  );
});

test("productName 缺失时报错并指明字段", () => {
  assert.throws(
    () => resolvePackDisplayName(makePackageJson({ productName: undefined })),
    /productName 缺失或为空字符串.*清单 header\.name/
  );
});

test("productName 为空字符串时报错", () => {
  assert.throws(() => resolvePackDisplayName(makePackageJson({ productName: "  " })), /productName 缺失/);
});

test("完整描述为简介加五行联系信息", () => {
  assert.equal(
    resolvePackDescription(makePackageJson()),
    [
      "死亡不掉落 · 无需作弊 · 保留成就",
      "作者：Yinx",
      "邮箱：1423716216@qq.com",
      "主页：https://github.com/Yinxe/",
      "QQ群：632178498",
      "仓库：https://github.com/Yinxe/MCBE",
    ].join("\n")
  );
});

test("缺失的联系信息整行省略且不产生空行", () => {
  const description = resolvePackDescription(
    makePackageJson({
      author: { name: "Yinx" },
      repository: undefined,
      packing: undefined,
    })
  );
  assert.equal(description, ["死亡不掉落 · 无需作弊 · 保留成就", "作者：Yinx"].join("\n"));
  assert.ok(!description.includes("\n\n"));
  assert.ok(!description.endsWith("\n"));
});

test("完全没有联系信息时描述只有简介一行", () => {
  const description = resolvePackDescription(
    makePackageJson({ author: undefined, repository: undefined, packing: undefined })
  );
  assert.equal(description, "死亡不掉落 · 无需作弊 · 保留成就");
});

test("description 缺失或为空字符串时报错", () => {
  assert.throws(
    () => resolvePackDescription(makePackageJson({ description: undefined })),
    /description 缺失或为空字符串.*清单 header\.description/
  );
  assert.throws(() => resolvePackDescription(makePackageJson({ description: "" })), /description 缺失/);
});

test("颜色符号原样保留", () => {
  const description = resolvePackDescription(
    makePackageJson({ description: "§e《合成配方扩展》", author: { name: "§bYinx" } })
  );
  assert.equal(description.split("\n")[0], "§e《合成配方扩展》");
  assert.equal(description.split("\n")[1], "作者：§bYinx");
});

test("author 为字符串时只产生作者行", () => {
  const description = resolvePackDescription(
    makePackageJson({ author: "Yinx", repository: undefined, packing: undefined })
  );
  assert.equal(description, ["死亡不掉落 · 无需作弊 · 保留成就", "作者：Yinx"].join("\n"));
});

test("repository 为字符串时同样被写入", () => {
  const description = resolvePackDescription(
    makePackageJson({ author: undefined, packing: undefined, repository: "https://github.com/Yinxe/MCBE.git" })
  );
  assert.equal(description.split("\n")[1], "仓库：https://github.com/Yinxe/MCBE");
});

test("仓库地址规范化为 https 可读形式", () => {
  assert.equal(normalizeRepositoryUrl("git@github.com:Yinxe/MCBE.git"), "https://github.com/Yinxe/MCBE");
  assert.equal(normalizeRepositoryUrl("git+https://github.com/Yinxe/MCBE.git"), "https://github.com/Yinxe/MCBE");
  assert.equal(normalizeRepositoryUrl("https://github.com/Yinxe/MCBE"), "https://github.com/Yinxe/MCBE");
  assert.equal(normalizeRepositoryUrl("https://github.com/Yinxe/MCBE.git"), "https://github.com/Yinxe/MCBE");
  assert.equal(normalizeRepositoryUrl("https://github.com/Yinxe/MCBE/"), "https://github.com/Yinxe/MCBE");
});

test("无法识别的仓库地址原样返回", () => {
  assert.equal(normalizeRepositoryUrl("github:Yinxe/MCBE"), "github:Yinxe/MCBE");
  assert.equal(normalizeRepositoryUrl("ssh://git@github.com/Yinxe/MCBE"), "ssh://git@github.com/Yinxe/MCBE");
});
