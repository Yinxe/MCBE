// ─── 形状探针:逐个形状、逐项参数,看「写了到底生不生效」 ──────────
//
// 这是本模组存在的核心理由:把 `@minecraft/debug-utilities` 的每个形状、
// 每个属性都改一遍,并把「写入值 / 读回值」原样报出来。
//
// 必须分清两件事:
//   · **读回一致** 只证明 JS 侧 setter 存下了值,不证明渲染器读了它;
//   · **渲染生效** 只能靠眼睛看,或靠 DebugMotionProbe 那种「改完盯着看」。
// 本文件覆盖第一层,`DebugMotionProbe.ts` 覆盖第二层。
//
// 官方文档没写清的参数(比如 DebugBox.bound 是全宽还是半宽)在这里被并排画出来:
// 一组不同 bound 的盒子挨着放,哪个尺寸对一眼就能看出来,不用猜。

import {
  DebugArrow,
  DebugBox,
  DebugCircle,
  DebugLine,
  DebugSphere,
  DebugText,
  debugDrawer,
  type DebugShape,
} from "@minecraft/debug-utilities";
import { Player, type Vector3 } from "@minecraft/server";
import { toNativeColor } from "./DebugColor";
import { DEFAULT_DURATION_SECONDS, MAX_DURATION_SECONDS } from "./DebugShapeBuilder";
import {
  attempt,
  attemptLine,
  errorText,
  heading,
  kv,
  report,
  rowPositions,
  stateLines,
  verdict,
  warning,
} from "./DebugProbeShared";
import { clearPlayerShapes } from "./DebugRenderer";

/** 把一个形状加入世界并返回它;失败返回 undefined */
function addShape(shape: DebugShape): DebugShape | undefined {
  try {
    debugDrawer.addShape(shape);
    return shape;
  } catch (error) {
    console.log(`[api-probe][shape] 加入失败:${errorText(error)}`);
    return undefined;
  }
}

/** 夹取秒数 */
function clampSeconds(input?: number): number {
  return Math.min(Math.max(input ?? DEFAULT_DURATION_SECONDS, 1), MAX_DURATION_SECONDS);
}

/**
 * `/apitest:debugshape` 的实现:逐个形状、逐项参数地探。
 *
 * 每个形状占一个「站位」,站位由 `rowPositions` 排出;
 * 同一个形状的不同参数变体在站位上横向拉开,便于并排比对。
 */
export function runShapeProbeCommand(player: Player, secondsInput?: number): void {
  const seconds = clampSeconds(secondsInput);
  clearPlayerShapes(player.id);

  const lines: string[] = [];
  lines.push(heading("形状与属性探针"));
  lines.push(`§7各形状按站位排开,§f${seconds}§7 秒后消失`);

  // ── 1. DebugLine:location 与 endLocation 的关系 ──────────────
  {
    const [origin] = rowPositions(player, 1, 0, 5, 1);
    lines.push(heading("DebugLine"));
    const line = addShape(new DebugLine(origin, { x: origin.x + 2, y: origin.y + 1, z: origin.z }));
    if (line instanceof DebugLine) {
      lines.push(`  ${kv("location", line.location)} ${kv("endLocation", line.endLocation)}`);
      lines.push("  §7预期:从 location 到 endLocation 画一条线段");

      // 改 endLocation,看读回是否跟着变
      const changed = { x: origin.x + 3, y: origin.y - 1, z: origin.z };
      const write = attempt(() => {
        line.endLocation = changed;
        return line.endLocation;
      });
      lines.push(`  ${attemptLine("写 endLocation 后读回", write)}`);
      // scale 对线段是否有效,官方说「不适用」
      const scaleWrite = attempt(() => {
        line.scale = 3;
        return line.scale;
      });
      lines.push(`  ${attemptLine("写 scale=3 后读回(官方称对线段无效)", scaleWrite)}`);
    } else {
      lines.push(warning("DebugLine 加入失败"));
    }
  }

  // ── 2. DebugArrow:三个头部参数的实际效果 ────────────────────
  {
    const [origin] = rowPositions(player, 1, 0, 5, 2.5);
    lines.push(heading("DebugArrow"));
    const arrow = new DebugArrow(origin, { x: origin.x + 2, y: origin.y, z: origin.z });
    const reads = {
      headLength: attempt(() => arrow.headLength),
      headRadius: attempt(() => arrow.headRadius),
      headSegments: attempt(() => arrow.headSegments),
    };
    lines.push(`  ${kv("默认 headLength", reads.headLength)}`);
    lines.push(`  ${kv("默认 headRadius", reads.headRadius)}`);
    lines.push(`  ${kv("默认 headSegments", reads.headSegments)}`);

    const writes = attempt(() => {
      arrow.headLength = 0.8;
      arrow.headRadius = 0.35;
      arrow.headSegments = 12;
      return { headLength: arrow.headLength, headRadius: arrow.headRadius, headSegments: arrow.headSegments };
    });
    lines.push(`  ${attemptLine("写 0.8 / 0.35 / 12 后读回", writes)}`);
    arrow.timeLeft = seconds;
    addShape(arrow);
    lines.push("  §7预期:箭头头明显比默认大,底面 12 边形");
  }

  // ── 3. DebugBox:bound 到底是全宽还是半宽 ────────────────────
  {
    lines.push(heading("DebugBox:bound 口径"));
    lines.push("  §7并排四个 bound 不同的盒子,间距 3 格。");
    lines.push("  §7若 bound 是全宽:第一个宽 2 格,第二个宽 3 格,第三个宽 4 格,第四个宽 6 格。");
    lines.push("  §7若 bound 是半宽(即半径):实际宽度分别是上述的两倍。");
    const positions = rowPositions(player, 4, 3, 6, 1);
    const bounds = [2, 3, 4, 6];
    bounds.forEach((value, index) => {
      const box = new DebugBox(positions[index]);
      box.bound = { x: value, y: value, z: value };
      box.scale = 1;
      box.color = toNativeColor({ red: 1, green: 1, blue: 1 });
      box.timeLeft = seconds;
      const added = addShape(box);
      if (added) {
        const readback = attempt(() => added.location);
        lines.push(`  ${kv(`bound=${value} 的盒子`, readback)}`);
      }
    });
  }

  // ── 4. DebugBox:scale 是否乘在 bound 上 ────────────────────
  {
    lines.push(heading("DebugBox:scale 作用"));
    lines.push("  §7下面三个盒子 bound 都是 2,scale 分别是 1 / 2 / 0.5。");
    lines.push("  §7若 scale 乘在 bound 上:三个盒子宽度应为 2 / 4 / 1 格。");
    const positions = rowPositions(player, 3, 4, 9, 1);
    const scales = [1, 2, 0.5];
    scales.forEach((scale, index) => {
      const box = new DebugBox(positions[index]);
      box.bound = { x: 2, y: 2, z: 2 };
      box.scale = scale;
      box.color = toNativeColor({ red: 0.4, green: 0.9, blue: 1 });
      box.timeLeft = seconds;
      const added = addShape(box);
      if (added) {
        const readback = attempt(() => ({ scale: added.scale, bound: (added as DebugBox).bound }));
        lines.push(`  ${attemptLine(`scale=${scale}`, readback)}`);
      }
    });
  }

  // ── 5. DebugSphere / DebugCircle:没有半径属性,只能 scale ────
  {
    lines.push(heading("DebugSphere / DebugCircle"));
    const positions = rowPositions(player, 4, 3, 6, 3.5);
    const specs: { label: string; make: (at: Vector3) => DebugShape; scale: number }[] = [
      { label: "Sphere scale=1", make: (at) => new DebugSphere(at), scale: 1 },
      { label: "Sphere scale=2", make: (at) => new DebugSphere(at), scale: 2 },
      { label: "Circle scale=1", make: (at) => new DebugCircle(at), scale: 1 },
      { label: "Circle scale=2", make: (at) => new DebugCircle(at), scale: 2 },
    ];
    specs.forEach((spec, index) => {
      const shape = spec.make(positions[index]);
      shape.scale = spec.scale;
      shape.color = toNativeColor({ red: 0.9, green: 0.5, blue: 1 });
      shape.timeLeft = seconds;
      const added = addShape(shape);
      if (added) {
        const readback = attempt(() => added.scale);
        lines.push(`  ${kv(spec.label, readback)}`);
      }
    });
    lines.push("  §7Sphere 默认直径与 scale=1 的直径若相同,说明 scale 是半径倍数;否则是直径倍数。");
    lines.push("  §7Circle 应只在水平面内,且朝向固定;确认它是否随 rotation 倾斜。");
  }

  // ── 6. DebugText:文字、朝向、长度上限 ───────────────────────
  {
    lines.push(heading("DebugText"));
    const positions = rowPositions(player, 3, 4, 5, 5);
    const texts = ["短文本", "A".repeat(64), "带\n换行"];
    texts.forEach((text, index) => {
      const shape = new DebugText(positions[index], text);
      shape.color = toNativeColor({ red: 1, green: 1, blue: 1 });
      shape.timeLeft = seconds;
      const added = addShape(shape);
      if (added) {
        const readback = attempt(() => (added as DebugText).text);
        const length = attempt(() => (added as DebugText).text.length);
        lines.push(`  ${kv(`第 ${index + 1} 个`, readback)} ${kv("长度", length)}`);
      }
    });
    lines.push("  §7预期:文字始终朝向屏幕,不随 rotation 翻转;换行是否生效看第三个。");
  }

  // ── 7. rotation:三个分量分别是什么轴 ───────────────────────
  {
    lines.push(heading("rotation 分量含义"));
    lines.push("  §7三个盒子 bound=1×0.2×3(扁长条),rotation 分别只改一个分量 45°。");
    lines.push("  §7官方称顺序为 [Pitch, Yaw, Roll]。观察哪个分量让长条绕哪个轴转即可确认。");
    const positions = rowPositions(player, 3, 4, 9, 3.5);
    const labels = ["rotation.x=45", "rotation.y=45", "rotation.z=45"];
    positions.forEach((position, index) => {
      const box = new DebugBox(position);
      box.bound = { x: 1, y: 0.2, z: 3 };
      box.scale = 1;
      box.color = toNativeColor({ red: 1, green: 0.7, blue: 0.2 });
      const rotation: Vector3 = { x: 0, y: 0, z: 0 };
      if (index === 0) rotation.x = 45;
      if (index === 1) rotation.y = 45;
      if (index === 2) rotation.z = 45;
      const write = attempt(() => {
        box.rotation = rotation;
        return box.rotation;
      });
      box.timeLeft = seconds;
      const added = addShape(box);
      lines.push(`  ${kv(labels[index], write)}${added ? "" : " §c加入失败"}`);
    });
  }

  // ── 8. 只读属性:hasDuration / totalTimeLeft 的语义 ─────────
  {
    lines.push(heading("存活期相关属性"));
    lines.push("  §7timeLeft 可写;hasDuration 与 totalTimeLeft 只读。");
    lines.push("  §7下面先建一个不设 timeLeft 的盒子,再建一个设了 30 秒的,对比读数。");
    const positions = rowPositions(player, 2, 5, 5, 6.5);

    const forever = new DebugBox(positions[0]);
    forever.bound = { x: 1, y: 1, z: 1 };
    forever.color = toNativeColor({ red: 1, green: 0.3, blue: 0.3 });
    const foreverAdded = addShape(forever);
    if (foreverAdded) {
      lines.push(
        `  §7不设 timeLeft:${kv(
          "hasDuration",
          attempt(() => foreverAdded.hasDuration)
        )}`
      );
      lines.push(
        `    ${kv(
          "timeLeft",
          attempt(() => foreverAdded.timeLeft)
        )}`
      );
      lines.push(
        `    ${kv(
          "totalTimeLeft",
          attempt(() => foreverAdded.totalTimeLeft)
        )}`
      );
      foreverAdded.remove();
    }

    const timed = new DebugBox(positions[1]);
    timed.bound = { x: 1, y: 1, z: 1 };
    timed.color = toNativeColor({ red: 0.3, green: 1, blue: 0.3 });
    timed.timeLeft = 30;
    const timedAdded = addShape(timed);
    if (timedAdded) {
      lines.push(
        `  §7设 timeLeft=30:${kv(
          "hasDuration",
          attempt(() => timedAdded.hasDuration)
        )}`
      );
      lines.push(
        `    ${kv(
          "timeLeft",
          attempt(() => timedAdded.timeLeft)
        )}`
      );
      lines.push(
        `    ${kv(
          "totalTimeLeft",
          attempt(() => timedAdded.totalTimeLeft)
        )}`
      );
      lines.push(`    §7稍后应自行消失,无需手动 remove`);
    }
  }

  // ── 9. color:RGB 还是 RGBA ─────────────────────────────────
  //
  // 这一节是本模组最该存在的地方:它抓出了一个「类型定义与运行时不一致」的真 bug。
  //
  // 安装的类型定义(@minecraft/debug-utilities@1.0.0-beta.1.21.100-stable)说
  // `color` 是 RGB(三分量),但运行时报:
  //   native setter cannot be assigned null or undefined interface property
  //   ['alpha'] expected number
  // 说明引擎侧结构体要 alpha。根因是 manifest 写 `"version": "1.0.0-beta"`,
  // 它解析成「引擎当前携带的 beta 版」,而不是我们钉的类型定义版本。
  //
  // 所以这里分三组并排:
  //   · 三分量(旧写法)→ 预期在引擎上抛错或警告;
  //   · 四分量 alpha=1 → 新写法,应当正常;
  //   · 四分量 alpha=0.35 → 顺带验证 alpha 是否真的影响透明度。
  {
    lines.push(heading("color:RGB 还是 RGBA"));
    lines.push("  §7三个盒子分别给三分量、alpha=1、alpha=0.35。");
    lines.push("  §7若「三分量」那行抛错并提到 alpha,说明运行时结构体要 RGBA。");
    const positions = rowPositions(player, 3, 3, 5, 8);

    // 三分量:故意不补 alpha,复现旧写法
    {
      const box = new DebugBox(positions[0]);
      box.bound = { x: 1, y: 1, z: 1 };
      box.scale = 1;
      const write = attempt(() => {
        box.color = { red: 1, green: 0.2, blue: 0.2 };
        return box.color;
      });
      box.timeLeft = seconds;
      const added = addShape(box);
      lines.push(`  ${kv("三分量 rgb(1,0.2,0.2)", write)}${added ? "" : " §c加入失败"}`);
    }

    // 四分量 alpha=1
    {
      const box = new DebugBox(positions[1]);
      box.bound = { x: 1, y: 1, z: 1 };
      box.scale = 1;
      const write = attempt(() => {
        box.color = toNativeColor({ red: 0.2, green: 1, blue: 0.2 });
        return box.color;
      });
      box.timeLeft = seconds;
      const added = addShape(box);
      lines.push(`  ${kv("四分量 alpha=1", write)}${added ? "" : " §c加入失败"}`);
    }

    // 四分量 alpha=0.35:看透明度是否生效
    {
      const box = new DebugBox(positions[2]);
      box.bound = { x: 1, y: 1, z: 1 };
      box.scale = 1;
      const write = attempt(() => {
        box.color = toNativeColor({ red: 0.2, green: 0.4, blue: 1, alpha: 0.35 });
        return box.color;
      });
      box.timeLeft = seconds;
      const added = addShape(box);
      lines.push(`  ${kv("四分量 alpha=0.35", write)}${added ? "" : " §c加入失败"}`);
    }

    lines.push("  §7第三个若明显更淡,说明 alpha 生效;若与第二个一样实,说明 alpha 被忽略。");
    lines.push("  §7读回里带不带 alpha,直接说明运行时用的是 RGB 还是 RGBA 结构。");
  }

  // ── 9b. color 分量范围:是否夹取 ────────────────────────────
  {
    lines.push(heading("color 分量范围"));
    lines.push("  §7三个盒子分别给 0~1 内、超出 1、负值(都补 alpha),看引擎是否夹取。");
    const positions = rowPositions(player, 3, 3, 5, 8);
    const colors = [
      { label: "正常 (1,0.2,0.2)", color: { red: 1, green: 0.2, blue: 0.2 } },
      { label: "超范围 (5,5,5)", color: { red: 5, green: 5, blue: 5 } },
      { label: "负值 (-1,-1,-1)", color: { red: -1, green: -1, blue: -1 } },
    ];
    colors.forEach((spec, index) => {
      const box = new DebugBox(positions[index]);
      box.bound = { x: 1, y: 1, z: 1 };
      box.scale = 1;
      const write = attempt(() => {
        box.color = toNativeColor(spec.color);
        return box.color;
      });
      box.timeLeft = seconds;
      const added = addShape(box);
      lines.push(`  ${kv(spec.label, write)}${added ? "" : " §c加入失败"}`);
    });
    lines.push("  §7读回若原样返回 5 与 -1,说明 setter 不夹取;渲染时是否夹取要看颜色。");
  }

  // ── 10. remove() 之后能否重新 addShape ─────────────────────
  {
    lines.push(heading("remove 后重加"));
    const [position] = rowPositions(player, 1, 0, 5, 9.5);
    const box = new DebugBox(position);
    box.bound = { x: 1, y: 1, z: 1 };
    box.color = toNativeColor({ red: 0.6, green: 1, blue: 0.6 });
    box.timeLeft = seconds;
    const first = addShape(box);
    if (first) {
      const removed = attempt(() => {
        first.remove();
        return "已 remove";
      });
      lines.push(`  ${attemptLine("第一次 remove", removed)}`);
      // 官方说 remove 后可以重新 addShape;这一步实测它会不会崩
      const readd = attempt(() => {
        debugDrawer.addShape(box);
        return "已重新加入";
      });
      lines.push(`  ${attemptLine("重新 addShape", readd)}`);
      lines.push("  §7预期:官方称可重加。若崩溃则说明「同一实例重复 addShape」的边界比文档更严。");
    }
  }

  lines.push(heading("探针结束"));
  lines.push("§7以上每行的读回值只证明 JS 侧写入成功,渲染是否生效需看画面。");
  lines.push(verdict("探针执行完毕,详见内容日志"));

  report(player, lines);
}
