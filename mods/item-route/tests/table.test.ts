import { test } from "node:test";
import assert from "node:assert/strict";
import { Table, Cell } from "../scripts/mc/ui/Table";
import { formatCount } from "../scripts/core/utils/formatCount";

test("Table: 多列对齐（left/center/right）", () => {
  const t = new Table()
    .header("名称", Cell.center("数量"), Cell.right("占比"))
    .row("a", "10", "0.5")
    .row("bb", "100", "1.0");
  const lines = t.render().split("\n");
  assert.equal(lines.length, 3);
  // 对齐由列宽统一
  assert.ok(lines[0]!.includes("名称"));
  assert.ok(lines[1]!.includes("a"));
});

test("Table: § 颜色码不计入宽度", () => {
  const t = new Table().header("A").row("§a钻石").row("铁");
  const lines = t.render().split("\n");
  // 列宽按视觉宽度计算：§a钻石（视宽 2）与铁（视宽 1）同一列，视觉内容+补白应等宽
  assert.equal(Cell.visualLen(lines[1]!), Cell.visualLen(lines[2]!));
  assert.equal(Cell.visualLen(lines[1]!), Cell.visualLen(lines[0]!)); // 与表头同列宽
});

test("Table: 空表返回空字符串", () => {
  assert.equal(new Table().render(), "");
});

test("Table: 单列正常", () => {
  const t = new Table().header("物品").row("钻石").row("石头");
  assert.equal(t.render().split("\n").length, 3);
});

test("Table: Cell.visualLen 剥离全部颜色码", () => {
  assert.equal(Cell.visualLen("§a§l钻石"), 2);
  assert.equal(Cell.visualLen("§0§1§2§3§4§5§6§7§8§9§a§b§c§d§e§f§k§l§m§n§o§r纯文本"), 3);
});

test("formatCount: 数量单位化（最多 2 位小数，整数干净）", () => {
  assert.equal(formatCount(0), "0");
  assert.equal(formatCount(234), "234");
  assert.equal(formatCount(999), "999");
  assert.equal(formatCount(1000), "1k");
  assert.equal(formatCount(4000), "4k");
  assert.equal(formatCount(5423), "5.42k");
  assert.equal(formatCount(9999), "10k"); // 9.999 → 10.00 → 精简为 10k
  assert.equal(formatCount(123000), "123k");
  assert.equal(formatCount(999900), "999.9k"); // 999.90 → 去尾零
  assert.equal(formatCount(1000000), "1M");
  assert.equal(formatCount(2300000), "2.3M"); // 2.30 → 去尾零
  assert.equal(formatCount(1234567), "1.23M");
});
