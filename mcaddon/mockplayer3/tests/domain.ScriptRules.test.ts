// ─── 编程模式·脚本模型与文本规格单测 ────────────────────────────────
// 锁三件事：模块目录与解析同源、文本规格与脚本互为逆运算、存档归一化不因坏条目炸整段。
import test from "node:test";
import assert from "node:assert/strict";

import {
  MAX_ATTACK_COUNT,
  MAX_LOOP_COUNT,
  MAX_SAY_LENGTH,
  MAX_SCRIPT_STEPS,
  MAX_WAIT_TICKS,
  SCRIPT_CATEGORIES,
  SCRIPT_MODULES,
  createEmptyProgram,
  describeFailPolicy,
  describeLoopCount,
  describeStep,
  moduleArgsOf,
  moduleById,
  normalizeLoopCount,
  normalizeProgram,
  normalizeStep,
  parseFailPolicyInput,
  parseLoopCountInput,
  parseProgramSpec,
  parseStepSpec,
  programToSpecText,
  stepFromModule,
} from "../scripts/domain/ScriptRules";
import type { ScriptStep } from "../scripts/domain/ScriptRules";

test("编程·模块目录自洽：13 项、id 唯一、分类齐、关键词非空且与解析器对得上", () => {
  assert.equal(SCRIPT_MODULES.length, 13);
  assert.equal(new Set(SCRIPT_MODULES.map((m) => m.id)).size, 13, "id 唯一");
  for (const m of SCRIPT_MODULES) {
    assert.ok(SCRIPT_CATEGORIES.includes(m.cat), `${m.id} 分类在目录里`);
    assert.ok(m.kw.length > 0, `${m.id} 有关键词`);
    assert.equal(moduleById(m.id), m, "按 id 取回同一条");
  }
  assert.equal(moduleById("nope"), undefined);
  assert.deepEqual(SCRIPT_CATEGORIES, ["移动", "等待", "方块", "交互", "战斗", "姿态", "通信", "流程"]);
});

test("编程·文本解析：12 种步骤都能从文本规格解析出来（含连写与逗号坐标）", () => {
  const ok = (spec: string): ScriptStep => {
    const r = parseStepSpec(spec);
    assert.ok("step" in r, `${spec} 应解析成功：${"error" in r ? r.error : ""}`);
    return r.step;
  };
  assert.deepEqual(ok("走到 10 64 -20"), { type: "moveTo", x: 10, y: 64, z: -20 });
  assert.deepEqual(ok("走到100 64 200"), { type: "moveTo", x: 100, y: 64, z: 200 }, "关键词与参数连写");
  assert.deepEqual(ok("走到 (10,64,20)"), { type: "moveTo", x: 10, y: 64, z: 20 });
  assert.deepEqual(ok("等待 2"), { type: "wait", ticks: 40 }, "秒 → tick");
  assert.deepEqual(ok("挖掘 1 2 3"), { type: "mine", x: 1, y: 2, z: 3 });
  assert.deepEqual(ok("挖前方"), { type: "mineLook" });
  assert.deepEqual(ok("挖前方 5 6 7"), { type: "mineLook", look: { x: 5, y: 6, z: 7 } }, "可空坐标");
  assert.deepEqual(ok("放置 1 2 3"), { type: "place", x: 1, y: 2, z: 3 });
  assert.deepEqual(ok("使用物品"), { type: "useItem" });
  assert.deepEqual(ok("使用 5 6 7"), { type: "useItem", look: { x: 5, y: 6, z: 7 } });
  assert.deepEqual(ok("攻击 30"), { type: "attack", count: 30 });
  assert.deepEqual(ok("说话 你好 世界"), { type: "say", text: "你好 世界" }, "说话吃剩余整段");
  assert.deepEqual(ok("看 1 2 3"), { type: "look", x: 1, y: 2, z: 3 });
  assert.deepEqual(ok("潜行开"), { type: "sneak", on: true });
  assert.deepEqual(ok("潜行 关"), { type: "sneak", on: false });
  assert.deepEqual(ok("潜行开 1 2 3"), { type: "sneak", on: true, look: { x: 1, y: 2, z: 3 } });
  assert.deepEqual(ok("跳一下"), { type: "hop" });
  assert.deepEqual(ok("跳转 3"), { type: "jump", target: 3 });
  assert.deepEqual(ok("minelook"), { type: "mineLook" }, "英文关键词等价");
});

test("编程·文本解析拒绝表：未知模块与越界参数都回中文原因", () => {
  const err = (spec: string): string => {
    const r = parseStepSpec(spec);
    assert.ok("error" in r, `${spec} 应报错`);
    return r.error;
  };
  assert.match(err("飞起来"), /未知模块/);
  assert.match(err(""), /缺少模块关键词/);
  assert.match(err("走到 1 2"), /需要 3 个数字参数/);
  assert.match(err("走到 1 2 99999999"), /坐标超出世界范围/);
  assert.match(err("等待 0"), /需要秒数/);
  assert.match(err(`等待 ${MAX_WAIT_TICKS / 20 + 1}`), /最长/);
  assert.match(err("攻击 0"), /需要次数/);
  assert.match(err(`攻击 ${MAX_ATTACK_COUNT + 1}`), /1-500/);
  assert.match(err("说话"), /需要文本内容/);
  assert.match(err(`说话 ${"字".repeat(MAX_SAY_LENGTH + 1)}`), /最长 200 字/);
  assert.match(err("潜行 也许"), /需要参数 开\/关/);
  assert.match(err("跳转 0"), /需要目标序号/);
  assert.match(err(`跳转 ${MAX_SCRIPT_STEPS + 1}`), /1-256/);
});

test("编程·整段文本规格：分隔符/换行都支持，一条错只丢那条并给出序号", () => {
  const r = parseProgramSpec("走到 1 2 3 | 等待 2 | 飞起来 | 挖前方");
  assert.equal(r.steps.length, 3);
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0]!, /第 3 条：未知模块/);
  const multi = parseProgramSpec("走到 1 2 3\n等待 1\n\n跳转 1");
  assert.equal(multi.steps.length, 3);
  assert.equal(multi.errors.length, 0);
});

test("编程·文本与脚本互为逆运算：写回再解析得到同一串步骤（含可空坐标）", () => {
  const steps: ScriptStep[] = [
    { type: "moveTo", x: 1, y: 64, z: -2 },
    { type: "wait", ticks: 20 },
    { type: "mine", x: 3, y: 4, z: 5 },
    { type: "mineLook", look: { x: 1, y: 2, z: 3 } },
    { type: "place", x: 6, y: 7, z: 8 },
    { type: "useItem" },
    { type: "attack", count: 3 },
    { type: "say", text: "集合" },
    { type: "look", x: 9, y: 10, z: 11 },
    { type: "sneak", on: true, look: { x: 1, y: 1, z: 1 } },
    { type: "hop" },
    { type: "jump", target: 2 },
  ];
  const program = { steps, loopCount: 3, onFail: "stop" as const };
  const text = programToSpecText(program);
  const back = parseProgramSpec(text);
  assert.deepEqual(back.errors, [], "写回的文本必须能原样解析");
  assert.deepEqual(back.steps, steps);
});

test("编程·存档归一化：坏条目丢弃、超上限截断、循环与失败策略归一", () => {
  const bad = normalizeProgram({
    steps: [
      { type: "moveTo", x: 1, y: 2, z: 3 },
      { type: "moveTo", x: 1 }, // 缺坐标 → 丢
      null,
      { type: "attack", count: 0 }, // 次数非法 → 丢
      { type: "say", text: "ok", note: "  备注  " },
      { type: "wait", ticks: -5 }, // 非法 → 丢
    ],
    loopCount: 1e9,
    onFail: "skip",
  });
  assert.equal(bad.steps.length, 2);
  assert.deepEqual(bad.steps[0], { type: "moveTo", x: 1, y: 2, z: 3 });
  assert.deepEqual(bad.steps[1], { type: "say", text: "ok", note: "备注" }, "备注去空白后保留");
  assert.equal(bad.loopCount, MAX_LOOP_COUNT, "循环次数封顶");
  assert.equal(bad.onFail, "skip");

  assert.deepEqual(normalizeProgram(undefined), createEmptyProgram());
  assert.deepEqual(
    normalizeStep({ type: "hop", look: { x: 1, y: 2 } }),
    { type: "hop" },
    "可空坐标缺轴＝按无坐标处理（不丢整条）"
  );
  assert.deepEqual(
    normalizeStep({ type: "hop", look: { x: 1.9, y: 2.1, z: 3.5 } }),
    {
      type: "hop",
      look: { x: 1, y: 2, z: 3 },
    },
    "坐标向下取整"
  );
});

test("编程·循环与失败策略的文本出入口一致", () => {
  assert.equal(parseLoopCountInput("一直"), -1);
  assert.equal(parseLoopCountInput("forever"), -1);
  assert.equal(parseLoopCountInput("一次"), 1);
  assert.equal(parseLoopCountInput("关"), 1);
  assert.equal(parseLoopCountInput("5"), 5);
  assert.equal(parseLoopCountInput("0"), undefined);
  assert.equal(parseLoopCountInput("不是数字"), undefined);
  assert.equal(normalizeLoopCount(-1), -1);
  assert.equal(normalizeLoopCount("3"), 3);
  assert.equal(normalizeLoopCount(0), 1, "0 非法回落只跑一遍");
  assert.equal(describeLoopCount(-1), "一直循环");
  assert.equal(describeLoopCount(1), "只跑一遍");
  assert.equal(describeLoopCount(4), "循环 4 次");

  assert.equal(parseFailPolicyInput("跳过"), "skip");
  assert.equal(parseFailPolicyInput("stop"), "stop");
  assert.equal(parseFailPolicyInput("随便"), undefined);
  assert.equal(describeFailPolicy("skip"), "单条失败就跳过");
  assert.equal(describeFailPolicy("stop"), "单条失败就停下");
});

test("编程·中文描述：每种步骤都有人读文案，备注附在后面", () => {
  assert.equal(describeStep({ type: "moveTo", x: 1, y: 2, z: 3 }), "走到 (1,2,3)");
  assert.equal(describeStep({ type: "wait", ticks: 40 }), "等待 2 秒");
  assert.equal(describeStep({ type: "mineLook" }), "挖掘前方方块");
  assert.equal(describeStep({ type: "mineLook", look: { x: 1, y: 2, z: 3 } }), "挖掘·对准 (1,2,3)");
  assert.equal(describeStep({ type: "say", text: "你好" }), "说话「你好」");
  assert.equal(describeStep({ type: "jump", target: 2 }), "跳转到第 2 条");
  assert.equal(describeStep({ type: "hop", look: { x: 1, y: 2, z: 3 } }), "跳一下 · 对准 (1,2,3)");
  assert.equal(describeStep({ type: "attack", count: 2 }, 3), "3. 攻击 2 次");
  assert.equal(describeStep({ type: "sneak", on: false }), "潜行关");
  assert.match(describeStep({ type: "say", text: "x", note: "给主人看的" }), /\(给主人看的\)$/);
});

test("编程·面板参数与步骤互转：选模块 + 填参数 → 步骤 → 回填参数", () => {
  const cases: { id: string; args: string; step: ScriptStep }[] = [
    { id: "moveTo", args: "1 2 3", step: { type: "moveTo", x: 1, y: 2, z: 3 } },
    { id: "wait", args: "1.5", step: { type: "wait", ticks: 30 } },
    { id: "mineLook", args: "", step: { type: "mineLook" } },
    { id: "mineLook", args: "4 5 6", step: { type: "mineLook", look: { x: 4, y: 5, z: 6 } } },
    { id: "sneakOn", args: "", step: { type: "sneak", on: true } },
    { id: "sneakOff", args: "1 2 3", step: { type: "sneak", on: false, look: { x: 1, y: 2, z: 3 } } },
    { id: "say", args: "集合啦", step: { type: "say", text: "集合啦" } },
    { id: "jump", args: "2", step: { type: "jump", target: 2 } },
  ];
  for (const c of cases) {
    const def = moduleById(c.id)!;
    const r = stepFromModule(def, c.args);
    assert.ok("step" in r, `${c.id} 应成功：${"error" in r ? r.error : ""}`);
    assert.deepEqual(r.step, c.step, `${c.id} 步骤`);
    const back = moduleArgsOf(r.step);
    const again = stepFromModule(def, back);
    assert.deepEqual(again, r, `${c.id} 参数回填后仍得到同一步骤`);
  }
  const bad = stepFromModule(moduleById("mine")!, "1 2");
  assert.ok("error" in bad);
});
