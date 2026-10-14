import test from "node:test";
import assert from "node:assert/strict";
import { applyNumberOverrides, makeConfig, makeTableConfig, makeBalancedConfig, suggestScale, scaleEconomy, validateConfig, DEFAULT_CONFIG, TABLE_PRESETS } from "../src/config.ts";

test("CFG-01 默认配置合法(初始 20000 / 阈值 40000 / maxHands 20)", () => {
  assert.deepEqual(validateConfig(DEFAULT_CONFIG), []);
  assert.equal(DEFAULT_CONFIG.players.startPoints, 20000);
  assert.equal(DEFAULT_CONFIG.endGame.winAtOrAbove, 40000);
  assert.equal(DEFAULT_CONFIG.endGame.maxHands, 20);
});

test("CFG-02 makeConfig 深度合并,不影响默认值", () => {
  const c = makeConfig({ endGame: { winAtOrAbove: 21000 } });
  assert.equal(c.endGame.winAtOrAbove, 21000);
  assert.equal(c.endGame.maxHands, 20, "未覆盖的字段应保留默认值");
  assert.equal(DEFAULT_CONFIG.endGame.winAtOrAbove, 40000, "默认配置不得被修改");
});

test("CFG-03 scaleEconomy 整体等比缩放费用表,内部比例不变", () => {
  const base = makeConfig({});
  const k10 = scaleEconomy(base, 10);
  assert.equal(k10.ante.amount, 10);
  assert.equal(k10.betting.seenRate, 20);
  assert.equal(k10.betting.blindRate, 10);
  assert.deepEqual(k10.exchange.fees, [10, 30, 100]);
  assert.equal(k10.kick.fee, 80);
  // 比例守恒:底注 : 看牌跟注 : 闷牌跟注 : 换牌1 : 踢牌 = 1:2:1:1:8
  assert.equal(k10.betting.seenRate / k10.ante.amount, 2);
  assert.equal(k10.betting.blindRate / k10.ante.amount, 1);
  assert.equal(k10.exchange.fees[0] / k10.ante.amount, 1);
  assert.equal(k10.kick.fee / k10.ante.amount, 8);
  // 不改变非费用项
  assert.equal(k10.players.startPoints, base.players.startPoints);
  assert.equal(k10.endGame.winAtOrAbove, base.endGame.winAtOrAbove);
  assert.deepEqual(k10.betting.ladder, base.betting.ladder);
});

test("CFG-04 scaleEconomy(k=1) 与基准等价;非法系数抛错;结果始终为整数且 >= 1", () => {
  const base = makeConfig({});
  assert.deepEqual(scaleEconomy(base, 1), base);
  assert.throws(() => scaleEconomy(base, 0), /必须为正/);
  const k = scaleEconomy(base, 0.3);
  assert.ok(Number.isInteger(k.ante.amount) && k.ante.amount >= 1);
  assert.ok(k.exchange.fees.every((f) => Number.isInteger(f) && f >= 1));
  assert.ok(k.betting.seenRate >= 1 && k.betting.blindRate >= 1);
});

test("CFG-05 端局阈值必须高于初始积分,否则配置非法", () => {
  assert.ok(validateConfig(makeConfig({ endGame: { winAtOrAbove: 10000, maxHands: 20 } })).length > 0);
  assert.ok(validateConfig(makeConfig({ endGame: { maxHands: 0 } })).length > 0);
});

test("CFG-06 分场档位:小分场 ×10 / 大分场 ×25,比例与其余配置不变", () => {
  const small = makeTableConfig("small", { players: { startPoints: 20000 } });
  const big = makeTableConfig("big", { players: { startPoints: 20000 } });
  assert.equal(small.ante.amount, 10);
  assert.equal(big.ante.amount, 25);
  assert.deepEqual(small.exchange.fees, [10, 30, 100]);
  assert.deepEqual(big.exchange.fees, [25, 75, 250]);
  assert.equal(small.kick.fee, 80);
  assert.equal(big.kick.fee, 200);
  for (const cfg of [small, big]) {
    assert.equal(cfg.betting.seenRate / cfg.ante.amount, 2, "看牌跟注 : 底注 = 2 : 1");
    assert.equal(cfg.betting.blindRate / cfg.ante.amount, 1, "闷牌跟注 : 底注 = 1 : 1");
    assert.equal(cfg.exchange.fees[0] / cfg.ante.amount, 1);
    assert.equal(cfg.kick.fee / cfg.ante.amount, 8);
    assert.equal(cfg.players.startPoints, 20000);
    assert.equal(cfg.endGame.winAtOrAbove, 40000);
    assert.equal(cfg.endGame.maxHands, 20);
    assert.deepEqual(validateConfig(cfg), []);
  }
  assert.throws(() => makeTableConfig("huge" as never), /未知分场/);
});

test("CFG-07 按人数推荐缩放系数:人数越多,所需 k 越小", () => {
  assert.equal(suggestScale(6), 10);
  assert.equal(suggestScale(4), 25);
  assert.ok(suggestScale(2) > suggestScale(3));
  assert.ok(suggestScale(3) > suggestScale(4));
  const c = makeBalancedConfig(6);
  assert.equal(c.ante.amount, 10);
  assert.equal(TABLE_PRESETS.small.scale, 10);
});

test("CFG-08 自定义底注=刻度:整张费用表等比缩放,比例保持不变", () => {
  const base = makeBalancedConfig(6);
  const half = applyNumberOverrides(base, { ante: base.ante.amount / 2 });
  assert.equal(half.ante.amount, Math.round(base.ante.amount / 2));
  assert.equal(half.betting.seenRate, Math.round(base.betting.seenRate / 2));
  assert.equal(half.betting.blindRate, Math.round(base.betting.blindRate / 2));
  assert.equal(half.kick.fee, Math.max(1, Math.round(base.kick.fee / 2)));
  assert.deepEqual(half.exchange.fees, base.exchange.fees.map((x) => Math.max(1, Math.round(x / 2))));
  // 关键:底注/跟注的比例不变(这正是"只改底注会变形"要防的)
  assert.equal(half.betting.seenRate / half.ante.amount, base.betting.seenRate / base.ante.amount);

  // 绝对值覆盖不受缩放影响
  const abs = applyNumberOverrides(base, { ante: base.ante.amount * 2, startPoints: 12345, winAtOrAbove: 20000, maxHands: 7 });
  assert.equal(abs.ante.amount, Math.round(base.ante.amount * 2));
  assert.equal(abs.players.startPoints, 12345);
  assert.equal(abs.endGame.winAtOrAbove, 20000);
  assert.equal(abs.endGame.maxHands, 7);

  // 不填底注 → 完全不缩放
  const noAnte = applyNumberOverrides(base, { startPoints: 99999 });
  assert.equal(noAnte.ante.amount, base.ante.amount);
  assert.equal(noAnte.betting.seenRate, base.betting.seenRate);
});
