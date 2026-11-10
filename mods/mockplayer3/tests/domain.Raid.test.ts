// ─── 劫掠 domain 纯逻辑单测：buff 直接覆盖的节拍/瓶费数据表、启动三道闸门成本序与保守放行、
// 胜利播报文案口径、村庄英雄叠加（总时长相加封顶/等级取高/时长下限）、开张与转移的告知口径。
import test from "node:test";
import assert from "node:assert/strict";

import {
  BAD_OMEN,
  BED_BLOCK_IDS,
  classifyRaidEffect,
  createRaidFlowState,
  diagnoseRaidGate,
  heroOwnerOfflineNotice,
  heroTransferredNotice,
  HERO_GRANT_FAILED_MESSAGE,
  isOminousBottle,
  isPeacefulDifficulty,
  judgeVillagePresence,
  mergeVillageHero,
  NO_BOTTLE_MESSAGE,
  OMINOUS_BOTTLE_ID,
  PEACEFUL_DIFFICULTY_MESSAGE,
  RAID_BOTTLE_COST,
  RAID_OMEN,
  RAID_OMEN_GRANT_AMPLIFIER,
  RAID_OMEN_GRANT_DURATION_TICKS,
  RAID_OMEN_GRANT_INTERVAL_TICKS,
  raidVictoryReport,
  VILLAGE_ABSENT_MESSAGE,
  VILLAGE_HERO,
  VILLAGER_TYPE,
  VILLAGE_HERO_MAX_DURATION,
} from "../scripts/domain/RaidRules";
import type { VillageScan } from "../scripts/domain/RaidRules";
import { modeSpec } from "../scripts/domain/Catalog";

test("isOminousBottle：命名空间全 id 精确匹配，近邻 id 不误判", () => {
  assert.equal(isOminousBottle(OMINOUS_BOTTLE_ID), true);
  assert.equal(isOminousBottle("minecraft:potion"), false);
  assert.equal(isOminousBottle("ominous_bottle"), false); // 无命名空间不匹配（typeId 恒带前缀）
});

test("classifyRaidEffect：三兆头分流；无关效果 undefined", () => {
  assert.equal(classifyRaidEffect(BAD_OMEN), "bad-omen");
  assert.equal(classifyRaidEffect(RAID_OMEN), "raid-omen");
  assert.equal(classifyRaidEffect(VILLAGE_HERO), "village-hero");
  assert.equal(classifyRaidEffect("minecraft:speed"), undefined);
  assert.equal(classifyRaidEffect(""), undefined);
});

test("持续施加节拍数据表：间隔 5 秒 > 时长 4 秒（到期窗=开袭时刻）；等级 Lv.1", () => {
  assert.equal(RAID_OMEN_GRANT_INTERVAL_TICKS, 100);
  assert.equal(RAID_OMEN_GRANT_DURATION_TICKS, 80);
  assert.ok(
    RAID_OMEN_GRANT_DURATION_TICKS < RAID_OMEN_GRANT_INTERVAL_TICKS,
    "时长必须短于间隔，否则兆头永不到期、袭击永不开始"
  );
  assert.equal(RAID_OMEN_GRANT_AMPLIFIER, 0);
  assert.equal(RAID_BOTTLE_COST, 1, "用户规格：启动一瓶、此后每胜一瓶");
});

test("mergeVillageHero：总时长相加封顶 2e7、等级取高、时长下限 1 tick", () => {
  const hero = { amplifier: 1, duration: 40000 }; // 假人 40 分钟 Lv.2
  assert.deepEqual(mergeVillageHero(hero, undefined), { amplifier: 1, duration: 40000 });
  assert.deepEqual(mergeVillageHero(hero, { amplifier: 0, duration: 20000 }), { amplifier: 1, duration: 60000 });
  // 主人等级更高 → 取高不降级
  assert.deepEqual(mergeVillageHero({ amplifier: 0, duration: 100 }, { amplifier: 3, duration: 100 }), {
    amplifier: 3,
    duration: 200,
  });
  // 封顶（引擎 addEffect 时长口径，防溢出）
  assert.equal(
    mergeVillageHero(
      { amplifier: 0, duration: VILLAGE_HERO_MAX_DURATION },
      { amplifier: 0, duration: VILLAGE_HERO_MAX_DURATION }
    ).duration,
    VILLAGE_HERO_MAX_DURATION
  );
  // 引擎 addEffect 的 duration 界为 [1, 20000000]：两侧皆 0 也必须给 1，否则抛错丢奖励
  assert.equal(mergeVillageHero({ amplifier: 0, duration: 0 }, undefined).duration, 1);
});

test("createRaidFlowState：未持续施加；tick 基准 -Infinity（首轮英雄事件必被处理）", () => {
  const s = createRaidFlowState();
  assert.equal(s.sustaining, false);
  assert.equal(s.grantAt, -Infinity);
  assert.ok(s.handledHeroTick < s.lastHeroTick || (s.handledHeroTick === -Infinity && s.lastHeroTick === -Infinity));
});

// ─── 村庄存在判定 + 启动闸门 ──

test("judgeVillagePresence：村民/床任一命中即放行；双阴性拦截；感知失败保守放行", () => {
  assert.equal(judgeVillagePresence({ villagers: 1, beds: 0, unreadable: false }), true);
  assert.equal(judgeVillagePresence({ villagers: 0, beds: 1, unreadable: false }), true);
  assert.equal(judgeVillagePresence({ villagers: 0, beds: 0, unreadable: false }), false);
  // 未加载区块 ≠ 没有村庄——绝不因扫描瞬态拦下劫掠
  assert.equal(judgeVillagePresence({ villagers: 0, beds: 0, unreadable: true }), true);
});

test("村庄判据数据表：村民 id 带命名空间；床 16 色 + 裸 bed 全列", () => {
  assert.equal(VILLAGER_TYPE, "minecraft:villager");
  assert.ok(VILLAGE_ABSENT_MESSAGE.includes("村民") && VILLAGE_ABSENT_MESSAGE.includes("床"));
  assert.equal(BED_BLOCK_IDS.length, 17);
  assert.ok(BED_BLOCK_IDS.includes("minecraft:bed"));
  assert.ok(BED_BLOCK_IDS.includes("minecraft:red_bed"));
  assert.ok(BED_BLOCK_IDS.includes("minecraft:light_blue_bed"));
});

test("难度闸：只拦和平（简单/普通/困难放行——基岩版三者均触发袭击）", () => {
  assert.equal(isPeacefulDifficulty("Peaceful"), true);
  assert.equal(isPeacefulDifficulty("Easy"), false);
  assert.equal(isPeacefulDifficulty("Normal"), false);
  assert.equal(isPeacefulDifficulty("Hard"), false);
});

test("diagnoseRaidGate：和平 → 无瓶 → 无村庄的成本序；全合格 ok", () => {
  const inVillage = { villagers: 1, beds: 0, unreadable: false };
  const noVillage = { villagers: 0, beds: 0, unreadable: false };
  let scans = 0;
  const counted = (scan: VillageScan) => () => {
    scans++;
    return scan;
  };
  // 和平是零成本全局事实——绝不为它付一次批量探块
  assert.deepEqual(diagnoseRaidGate("Peaceful", 5, counted(noVillage)), {
    ok: false,
    fail: "peaceful",
    message: PEACEFUL_DIFFICULTY_MESSAGE,
  });
  assert.equal(scans, 0);
  // 瓶数同样短路村庄扫描（背包一次读 vs 批量探块）
  assert.deepEqual(diagnoseRaidGate("Easy", 0, counted(inVillage)), {
    ok: false,
    fail: "no-bottle",
    message: NO_BOTTLE_MESSAGE,
  });
  assert.equal(scans, 0);
  // 难度+瓶都过才看村庄
  assert.deepEqual(diagnoseRaidGate("Easy", RAID_BOTTLE_COST, counted(noVillage)), {
    ok: false,
    fail: "no-village",
    message: VILLAGE_ABSENT_MESSAGE,
  });
  assert.equal(diagnoseRaidGate("Hard", 3, counted(inVillage)).ok, true);
  assert.equal(scans, 2, "只有前两道零成本闸放行后才扫描");
  // 难度读不到（""）与村庄扫描失败都保守放行——绝不因引擎瞬态拦下劫掠
  assert.equal(diagnoseRaidGate("", 2, counted(inVillage)).ok, true);
  assert.equal(diagnoseRaidGate("Normal", 2, counted({ villagers: 0, beds: 0, unreadable: true })).ok, true);
});

// ─── 播报文案（数字由实读卡填充）+ 开张前置说明 ──

test("劫掠目录说明：在场挂机与本模式不攻击要在开张前就可见", () => {
  const help = modeSpec("raid").help;
  assert.ok(help.includes("在场挂机"), "假人必须在场是前置，命令目录与面板要带出来");
  assert.ok(help.includes("胜场不保证"), "本模式不主动攻击，不能给出会打赢的印象");
});

test("raidVictoryReport：累计胜场含本轮、村庄英雄 Lv 从 1 计、瓶数为扣后值", () => {
  const text = raidVictoryReport("sim-a", 5, 3, { amplifier: 1, duration: 48000 }, "charged");
  assert.ok(text.includes("劫掠胜利（累计 3 胜）"));
  assert.ok(text.includes("村庄英雄 Lv.2"));
  assert.ok(text.includes("剩余 5 瓶"));
});

test("raidVictoryReport：英雄读不到就不编造等级；未扣瓶两种口径都不报瓶数", () => {
  assert.ok(raidVictoryReport("sim-a", 0, 4, undefined, "absent").includes("假人不在场，本瓶未扣"));
  const noHero = raidVictoryReport("sim-a", 5, 4, undefined, "unpaid");
  assert.ok(!noHero.includes("Lv."), "读不到英雄不能报等级");
  assert.ok(!noHero.includes("剩余"), "未扣瓶不报瓶数");
});

test("英雄转移口径：成功公告、主人不在线、写入失败也照清 buff", () => {
  assert.ok(heroTransferredNotice("sim-a", "adeb", { amplifier: 0, duration: 48000 }).includes("已叠加给 adeb"));
  assert.ok(heroOwnerOfflineNotice("sim-a", "adeb").includes("不在线"));
  assert.ok(HERO_GRANT_FAILED_MESSAGE.includes("已从假人身上清除"), "叠失败也要清——留着下次胜利不再触发信号");
});
