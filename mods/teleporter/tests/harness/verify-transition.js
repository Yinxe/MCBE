// ─── 转场适配层的端到端验证脚本(用 mock 的脚本 API)──────────────
//
// 为什么不放进 `npm test`:这里要用 esbuild 把适配层打成一个可 require
// 的包,并把 `@minecraft/server` 指向 mock。构建步骤与 `npm test` 的
// 纯 tsc + node --test 流程不同,混在一起会让测试变脆。
//
// 运行:`npm run verify:transition`
//
// 这一层能证明 core 单测证明不了的事:**适配层真的把相机驱动起来了**。
// 它抓到过两个真实缺陷:
//   1. finish() 用 isUsable 包住清理块,句柄瞬时失效 → 输入永久冻结
//   2. ticking area 异步创建与转场结束竞争 → 泄漏

const path = require("path");
const fs = require("fs");
const esbuild = require(
  require.resolve("esbuild", {
    paths: [path.resolve(__dirname, "../../../..")],
  }),
);

const MOD_ROOT = path.resolve(__dirname, "../..");
const HARNESS = __dirname;
const MOCK_DIR = path.join(HARNESS, "node_modules/@minecraft/server");
const BUNDLE = path.join(HARNESS, ".bundle.js");
const ENTRY = path.join(HARNESS, ".entry.ts");

/** 写出 mock 包与入口,再构建。 */
function build() {
  fs.mkdirSync(MOCK_DIR, { recursive: true });
  fs.mkdirSync(path.join(HARNESS, "node_modules/@minecraft/server-ui"), {
    recursive: true,
  });

  fs.copyFileSync(
    path.join(HARNESS, "mock-minecraft-server.js"),
    path.join(MOCK_DIR, "index.js"),
  );
  fs.writeFileSync(
    path.join(MOCK_DIR, "package.json"),
    JSON.stringify({
      name: "@minecraft/server",
      version: "2.3.0",
      main: "index.js",
    }),
  );
  fs.copyFileSync(
    path.join(HARNESS, "mock-minecraft-server.js"),
    path.join(HARNESS, "node_modules/@minecraft/server-ui/index.js"),
  );
  fs.writeFileSync(
    path.join(HARNESS, "node_modules/@minecraft/server-ui/package.json"),
    JSON.stringify({
      name: "@minecraft/server-ui",
      version: "2.0.0",
      main: "index.js",
    }),
  );

  fs.writeFileSync(
    ENTRY,
    `export { playTransition, playFadeTransition, abortTransition } from ${JSON.stringify(path.join(MOD_ROOT, "scripts/mc/transition"))};\n` +
      `export { teleportPlayerTo, teleportToSavedPoint } from ${JSON.stringify(path.join(MOD_ROOT, "scripts/mc/teleport"))};\n`,
  );

  esbuild.buildSync({
    entryPoints: [ENTRY],
    bundle: true,
    platform: "node",
    format: "cjs",
    outfile: BUNDLE,
    external: ["@minecraft/server", "@minecraft/server-ui"],
    logLevel: "error",
  });
}

// ─── 断言助手 ──────────────────────────────────────────────────

let failures = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures += 1;
  console.log(
    `  ${ok ? "✓" : "✗"} ${name}: ${JSON.stringify(actual)}${ok ? "" : ` (期望 ${JSON.stringify(expected)})`}`,
  );
}
function checkTrue(name, cond, detail) {
  if (!cond) failures += 1;
  console.log(
    `  ${cond ? "✓" : "✗"} ${name}${detail === undefined ? "" : `: ${detail}`}`,
  );
}

// ─── 时序驱动 ──────────────────────────────────────────────────

function makeDriver(mock) {
  let tick = 0;
  let intervalFn = null;
  const calls = {
    setCamera: [],
    fade: [],
    clear: [],
    teleport: [],
    perm: [],
    sound: [],
  };

  mock.system.run = (fn) => {
    fn();
    return 0;
  };
  mock.system.runTimeout = (fn) => {
    fn();
    return 0;
  };
  mock.system.runInterval = (fn) => {
    intervalFn = fn;
    return 0;
  };
  mock.system.clearRun = () => {
    intervalFn = null;
  };
  Object.defineProperty(mock.system, "currentTick", {
    get: () => tick,
    configurable: true,
  });

  function mkPlayer(id) {
    const p = new mock.Player();
    p.id = id;
    p.camera = {
      setCamera: (preset, opts) => calls.setCamera.push({ preset, opts }),
      fade: (o) => calls.fade.push(o),
      clear: () => calls.clear.push(1),
    };
    p.inputPermissions = {
      setPermissionCategory: (c, v) => calls.perm.push({ c, v }),
    };
    p.playSound = (id2, o) => calls.sound.push({ id: id2, o });
    p.teleport = (loc, opts) => {
      calls.teleport.push({ loc, opts });
      p.location = { ...loc };
      if (opts && opts.dimension) p.dimension = opts.dimension;
    };
    return p;
  }

  function reset() {
    tick = 0;
    intervalFn = null;
    for (const k of Object.keys(calls)) calls[k].length = 0;
  }

  function advance(n) {
    for (let i = 0; i < n && intervalFn; i += 1) {
      tick += 1;
      intervalFn();
    }
  }

  return {
    calls,
    mkPlayer,
    reset,
    advance,
    isRunning: () => intervalFn !== null,
  };
}

// ─── 用例 ──────────────────────────────────────────────────────

async function main() {
  build();
  const mock = require(path.join(MOCK_DIR, "index.js"));
  const api = require(BUNDLE);
  const d = makeDriver(mock);

  const CONFIG = {
    maxWaypointsPerPlayer: 30,
    publicWaypointEnabled: true,
    transitionEnabled: true,
    transitionStyle: "cinematic",
    transitionZoomHeights: {
      overworld: [20, 40, 60],
      nether: [20, 40, 60],
      end: [20, 40, 60],
    },
    transitionZoomTicks: [13, 13, 13],
    transitionVolume: 0.5,
  };
  const TARGET = {
    location: { x: 0, y: 70, z: 120 },
    dimensionId: "minecraft:overworld",
  };

  console.log("\n[1] 同维度 cinematic:完整运镜");
  {
    d.reset();
    const p = d.mkPlayer("s1");
    const r = api.playTransition(p, TARGET, CONFIG);
    d.advance(200);
    const v = await r;
    // 162:最后一 tick 也写一次,但**不带 easeOptions**。
    // 带缓动的写入会被引擎排队,与随后的 clear() 竞争,
    // 导致 free 相机被重新挂上(玩家卡在相机位)。
    check("setCamera 帧数", d.calls.setCamera.length, 162);
    checkTrue(
      "末帧不带 easeOptions",
      d.calls.setCamera[d.calls.setCamera.length - 1].opts.easeOptions ===
        undefined,
    );
    checkTrue(
      "倒数第二帧带 easeOptions",
      d.calls.setCamera[d.calls.setCamera.length - 2].opts.easeOptions !==
        undefined,
    );
    check("preset", d.calls.setCamera[0].preset, "minecraft:free");
    check("位移次数", d.calls.teleport.length, 1);
    check("落点坐标", d.calls.teleport[0].loc, { x: 0, y: 70, z: 120 });
    // 2 次:立即 clear + 下一 tick 兜底 clear
    check("camera.clear", d.calls.clear.length, 2);
    check("音效数", d.calls.sound.length, 8);
    checkTrue(
      "输入冻结后恢复",
      d.calls.perm.filter((x) => x.v === true).length === 2,
    );
    check("resolve", v, true);
    const last = d.calls.setCamera[d.calls.setCamera.length - 1].opts.location;
    checkTrue(
      "末帧落在落点眼睛高度",
      Math.abs(last.y - 71.62) < 0.01,
      JSON.stringify(last),
    );
  }

  console.log("\n[2] 中途句柄失效:必须仍然清理");
  {
    d.reset();
    const p = d.mkPlayer("s2");
    const r = api.playTransition(p, TARGET, CONFIG);
    d.advance(30);
    p.isValid = false;
    d.advance(1);
    const v = await r;
    check("camera.clear", d.calls.clear.length, 2);
    checkTrue(
      "输入已恢复(玩家不会卡死)",
      d.calls.perm.filter((x) => x.v === true).length === 2,
    );
    check("resolve", v, false);
  }

  console.log("\n[3] 超时兜底");
  {
    d.reset();
    const p = d.mkPlayer("s3");
    const r = api.playTransition(p, TARGET, CONFIG);
    d.advance(162 * 2 + 30);
    const v = await r;
    check("camera.clear", d.calls.clear.length, 2);
    check("resolve", v, true);
  }

  console.log("\n[4] 被第二次传送接管");
  {
    d.reset();
    const p = d.mkPlayer("s4");
    const r1 = api.playTransition(p, TARGET, CONFIG);
    d.advance(20);
    const r2 = api.playTransition(
      p,
      { location: { x: 5, y: 70, z: 30 }, dimensionId: "minecraft:overworld" },
      CONFIG,
    );
    const v1 = await r1;
    d.advance(250);
    const v2 = await r2;
    check("第一次 resolve", v1, false);
    check("第二次 resolve", v2, true);
    checkTrue(
      "两次都清理了相机",
      d.calls.clear.length >= 2,
      String(d.calls.clear.length),
    );
  }

  console.log("\n[5] 执行方式分派");
  {
    const cases = [
      [
        "同维度 cinematic",
        "cinematic",
        "minecraft:overworld",
        { cam: true, fade: false },
      ],
      ["转场关闭", "off", "minecraft:overworld", { cam: false, fade: false }],
      ["风格 fade", "fade", "minecraft:overworld", { cam: false, fade: true }],
      [
        "跨维度降档",
        "cinematic",
        "minecraft:the_nether",
        { cam: false, fade: true },
      ],
    ];
    for (const [name, style, dim, expect] of cases) {
      d.reset();
      mock.world.getDynamicProperty = () =>
        JSON.stringify({ ...CONFIG, transitionStyle: style });
      const p = d.mkPlayer(`m-${style}-${dim}`);
      const r = api.teleportPlayerTo(p, { x: 0, y: 70, z: 500 }, dim);
      d.advance(250);
      const v = await r;
      checkTrue(
        name,
        d.calls.setCamera.length > 0 === expect.cam &&
          d.calls.fade.length > 0 === expect.fade &&
          v === true,
        `cam=${d.calls.setCamera.length} fade=${d.calls.fade.length} ok=${v}`,
      );
    }
  }

  console.log("\n[6] 死亡点回传:快速淡入");
  {
    d.reset();
    mock.world.getDynamicProperty = () =>
      JSON.stringify({ ...CONFIG, transitionStyle: "cinematic" });
    const p = d.mkPlayer("dp-quick");
    // 同维度 + deathPoint 意图:必须走 fade,不写相机
    const r = api.teleportToSavedPoint(
      p,
      "死亡点",
      { x: 0, y: 70, z: 500 },
      "minecraft:overworld",
      "deathPoint",
    );
    d.advance(250);
    const v = await r;
    check("死亡点不写相机", d.calls.setCamera.length, 0);
    check("死亡点走 fade", d.calls.fade.length, 1);
    check("死亡点位移成功", v, true);
    if (d.calls.fade.length > 0) {
      const t = d.calls.fade[0].fadeTime;
      check("fadeIn 为快速时长", t.fadeInTime, 0.15);
      check("hold 为快速时长", t.holdTime, 0.05);
      check("fadeOut 为快速时长", t.fadeOutTime, 0.15);
    }
  }

  console.log("\n[7] 死亡点回传:总开关关闭时无动画");
  {
    d.reset();
    mock.world.getDynamicProperty = () =>
      JSON.stringify({
        ...CONFIG,
        transitionEnabled: false,
        transitionStyle: "off",
      });
    const p = d.mkPlayer("dp-off");
    const r = api.teleportToSavedPoint(
      p,
      "死亡点",
      { x: 0, y: 70, z: 500 },
      "minecraft:overworld",
      "deathPoint",
    );
    d.advance(250);
    const v = await r;
    check("关闭时不写相机", d.calls.setCamera.length, 0);
    check("关闭时无 fade", d.calls.fade.length, 0);
    check("仍然位移成功", d.calls.teleport.length >= 1, true);
    check("返回成功", v, true);
  }

  console.log("\n[8] 普通传送对照:仍走运镜");
  {
    d.reset();
    mock.world.getDynamicProperty = () =>
      JSON.stringify({ ...CONFIG, transitionStyle: "cinematic" });
    const p = d.mkPlayer("normal-cam");
    const r = api.teleportToSavedPoint(
      p,
      "传送点",
      { x: 0, y: 70, z: 500 },
      "minecraft:overworld",
      "normal",
    );
    d.advance(250);
    const v = await r;
    checkTrue(
      "普通传送写相机",
      d.calls.setCamera.length > 0,
      `cam=${d.calls.setCamera.length}`,
    );
    check("普通传送无 fade", d.calls.fade.length, 0);
    check("普通传送成功", v, true);
  }

  console.log(failures === 0 ? "\n全部通过 ✓" : `\n${failures} 项失败 ✗`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
