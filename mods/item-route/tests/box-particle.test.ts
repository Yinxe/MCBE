// ─── box 粒子契约：脚本注入的变量名 与 资源包声明 必须逐项对齐 ───
// 任一侧漏写/拼错，粒子会静默使用默认值（框变成 1×1×1 之类），游戏里不报错。
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  BOX_EDGE_PARTICLE_ID,
  BOX_FACE_PARTICLE_ID,
  BOX_MOLANG_VARS,
  BOX_PARTICLE_ID,
} from "../scripts/core/model/BoxParticleVars";

function findModRoot(start: string): string {
  let dir = start;
  for (let i = 0; i < 6; i += 1) {
    if (existsSync(join(dir, "behavior_packs/item-route"))) return dir;
    dir = join(dir, "..");
  }
  throw new Error(`未能从 ${start} 上溯找到模组根目录`);
}
const MOD_ROOT = findModRoot(__dirname);
const PARTICLES = join(MOD_ROOT, "resource_packs/item-route/particles/itemroute");

function loadParticle(name: string) {
  return JSON.parse(readFileSync(join(PARTICLES, `${name}.particle.json`), "utf8")).particle_effect;
}

test("box 粒子: 三份定义的 identifier 与脚本常量一致", () => {
  assert.equal(loadParticle("box").description.identifier, BOX_PARTICLE_ID);
  assert.equal(loadParticle("box_face").description.identifier, BOX_FACE_PARTICLE_ID);
  assert.equal(loadParticle("box_edge").description.identifier, BOX_EDGE_PARTICLE_ID);
});

test("box 粒子: 驱动粒子的初始化声明了全部脚本注入变量", () => {
  const init: string = loadParticle("box").components["minecraft:emitter_initialization"].creation_expression;
  for (const name of BOX_MOLANG_VARS) {
    assert.match(init, new RegExp(`v\\.${name}\\s*=`), `驱动粒子缺少变量 v.${name}`);
  }
});

test("box 粒子: 面/棱子发射器使用 itemroute 自定义材质与纹理", () => {
  for (const name of ["box_face", "box_edge"]) {
    const params = loadParticle(name).description.basic_render_parameters;
    assert.equal(params.material, "itemroute_blend_cull", `${name} 材质未改为 itemroute`);
    assert.equal(params.texture, "textures/itemroute/particle/white", `${name} 纹理路径未改为 itemroute`);
  }
});

test("box 粒子: 驱动粒子引用的子发射器标识与常量一致", () => {
  const raw = readFileSync(join(PARTICLES, "box.particle.json"), "utf8");
  assert.ok(raw.includes(BOX_FACE_PARTICLE_ID), "驱动粒子应引用面发射器");
  assert.ok(raw.includes(BOX_EDGE_PARTICLE_ID), "驱动粒子应引用棱发射器");
  assert.ok(!raw.includes("apitest"), "不应残留 api-probe 的命名空间");
});

test("box 粒子: 材质文件声明了 itemroute_blend_cull 且关闭背面剔除", () => {
  const materialPath = join(MOD_ROOT, "resource_packs/item-route/materials/particles.material");
  const material = JSON.parse(readFileSync(materialPath, "utf8"));
  const entry = material.materials["itemroute_blend_cull:particles_blend"];
  assert.ok(entry, "材质文件缺少 itemroute_blend_cull");
  assert.deepEqual(entry["-states"], ["DisableCulling"], "必须关闭背面剔除，否则盒子内部看不到面");
});

test("box 粒子: 白色纹理为 1×1 RGBA 全白", () => {
  // icon-forge 是 CommonJS，编译产物在 .test-build/tests/ 下无法用相对路径 import，
  // 因此从模组根（MOD_ROOT）出发绝对定位。
  const forgePng = join(MOD_ROOT, "../../tools/icon-forge/src/png.js");
  const { decodePng } = require(forgePng) as {
    decodePng: (b: Buffer) => { W: number; H: number; px: Buffer };
  };
  const img = decodePng(readFileSync(join(MOD_ROOT, "resource_packs/item-route/textures/itemroute/particle/white.png")));
  assert.equal(img.W, 1);
  assert.equal(img.H, 1);
  assert.deepEqual(Array.from(img.px.slice(0, 4)), [255, 255, 255, 255]);
});
