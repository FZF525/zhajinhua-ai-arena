// EQB / ZeroB 用例:胜率正确性、未知牌空间、合法性、训练可用性
import test from "node:test";
import assert from "node:assert/strict";
import { makeConfig } from "../src/config.ts";
import { createGame, player, checkInvariants } from "../src/state.ts";
import { apply, advance } from "../src/engine.ts";
import { createRng } from "../src/rng.ts";
import { makeAgent, AI_NAMES, zeroBStatus } from "../src/ai/index.ts";
import { estimateEquity, unknownCards, EQ_PROFILES, makeEquityBot } from "../src/ai/equity.ts";
import { zerobKey, zerobLegal, trainZeroB, emptyTable, makeZeroB, hasData, saveZeroB, loadZeroB } from "../src/ai/learning.ts";
import { cardsFromIds } from "../src/cards.ts";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function fresh(names = ["A", "B", "C"], seed = 5, patch?: unknown) {
  const st = createGame(makeConfig({ players: { startPoints: 20000 }, endGame: { maxHands: 3, winAtOrAbove: 1e9, bustAtOrBelow: -1, winTakesPriorityOverBust: true }, ...(patch as object ?? {}) }), names, seed);
  advance(st);
  return st;
}

test("EQ-01 未知牌空间:排除自己的牌、公共池明牌、弃牌者手牌", () => {
  const st = fresh();
  const seat = st.turn.seat!;
  const unknown = unknownCards(st, seat).map((c) => c.id);
  const mine = new Set(player(st, seat).hand.map((c) => c.id));
  for (const c of unknown) assert.equal(mine.has(c), false, "自己的牌不应在采样空间");
  const faceUp = st.pool.filter((c) => st.poolMeta[c.id].faceUp).map((c) => c.id);
  for (const id of faceUp) assert.equal(unknown.includes(id), false, "明牌不应在采样空间");
  // 未知 + 已知 = 全部在场牌
  const inPlay = st.players.flatMap((p) => p.hand).length + st.deck.length + st.pool.length;
  assert.ok(unknown.length > 0 && unknown.length <= inPlay, "未知牌数量应合理: " + unknown.length + "/" + inPlay);
});

test("EQ-02 胜率估计:皇家同花顺接近必胜;弱牌明显更低;结果在 [0,1]", () => {
  const st = fresh(["A", "B"]);
  const seat = st.turn.seat!;
  const rng = createRng(11);
  const royalIds = ["HEART-10", "HEART-J", "HEART-Q", "HEART-K", "HEART-A"];
  // 直接改手牌做对照(仅测试用)
  const strong = { ...st, players: st.players.map((p) => p.seat === seat ? { ...p, hand: cardsFromIds(royalIds) } : p) };
  const e1 = estimateEquity(strong as typeof st, seat, 300, rng);
  assert.ok(e1.equity > 0.98, "皇家同花顺应接近必胜: " + e1.equity);
  const weak = { ...st, players: st.players.map((p) => p.seat === seat ? { ...p, hand: cardsFromIds(["CLUB-2", "CLUB-5", "CLUB-7", "CLUB-9", "DIAMOND-J"]) } : p) };
  const e2 = estimateEquity(weak as typeof st, seat, 300, rng);
  assert.ok(e2.equity < e1.equity, "弱牌胜率应更低: " + e2.equity + " < " + e1.equity);
  assert.ok(e1.equity >= 0 && e1.equity <= 1 && e2.equity >= 0 && e2.equity <= 1);
});

test("EQ-03 EQB 只出合法动作,能打完若干手,不变量成立", () => {
  const names = ["EQB", "Sam", "EQBfast"];
  const st = fresh(names, 21);
  const agents = names.map(makeAgent);
  const rng = createRng(3);
  let steps = 0;
  while (!st.gameOver && steps++ < 600) {
    if (st.phase === "HAND_START") { advance(st); continue; }
    const seat = st.turn.seat;
    if (seat === null) break;
    const a = agents[seat](st, rng);
    if (!a) break;
    const r = apply(st, a, { dealNextHand: false });
    assert.equal(r.ok, true, names[seat] + " 非法动作 " + a.type + " " + (r.error?.code ?? ""));
    assert.deepEqual(checkInvariants(st), []);
  }
  assert.ok(st.handNo >= 2, "应至少打 2 局: " + st.handNo);
});

test("ZB-01 状态抽象与合法动作:键稳定、动作固定顺序、互不相同", () => {
  const st = fresh();
  const seat = st.turn.seat!;
  const k1 = zerobKey(st, seat);
  const k2 = zerobKey(st, seat);
  assert.equal(k1, k2);
  assert.match(k1, /^\d+\|\d\|\d\|\d\|[01]$/);
  const legal = zerobLegal(st);
  assert.ok(legal.length >= 1);
  const kinds = legal.map((l) => l.kind);
  assert.deepEqual(kinds, [...new Set(kinds)], "动作不应重复");
  for (const l of legal) assert.ok(["FOLD", "CALL", "RAISE", "COMPARE"].includes(l.kind));
});

test("ZB-02 训练:产生数据、决策合法、不破坏不变量", () => {
  const table = trainZeroB({ hands: 120, seed: 77, players: 3, epsFrom: 0.4, epsTo: 0.05 });
  assert.equal(table.trainedHands, 120);
  assert.ok(Object.keys(table.q).length > 10, "应学到若干状态: " + Object.keys(table.q).length);
  const names = ["ZeroB", "Sam", "ZeroB"];
  const st = fresh(names, 88);
  const pol = makeZeroB(table);
  const rng = createRng(4);
  let steps = 0;
  while (!st.gameOver && steps++ < 400) {
    if (st.phase === "HAND_START") { advance(st); continue; }
    const seat = st.turn.seat;
    if (seat === null) break;
    const a = pol(st, rng);
    if (!a) break;
    const r = apply(st, a, { dealNextHand: false });
    assert.equal(r.ok, true, "ZeroB 非法动作 " + a.type + " " + (r.error?.code ?? ""));
    assert.deepEqual(checkInvariants(st), []);
  }
});

test("ZB-03 未训练时退化为 EQBfast,依然能打(不会卡住)", () => {
  const table = emptyTable();
  assert.equal(hasData(table, "5|1|1|0|0"), false);
  const st = fresh(["ZeroB", "Sam"], 3);
  const pol = makeZeroB(table);
  const rng = createRng(5);
  const before = st.turn.seat;
  assert.notEqual(before, null);
  const a = pol(st, rng);
  assert.ok(a, "应给出动作");
  assert.equal(apply(st, a!).ok, true);
});

test("ZB-04 存/取往返一致", () => {
  const table = trainZeroB({ hands: 40, seed: 12, players: 2 });
  const dir = mkdtempSync(join(tmpdir(), "zhj-zerob-"));
  const file = join(dir, "zerob.json");
  saveZeroB(table, file);
  const back = loadZeroB(file);
  assert.ok(back);
  assert.equal(back!.trainedHands, table.trainedHands);
  assert.deepEqual(Object.keys(back!.q).sort(), Object.keys(table.q).sort());
  rmSync(dir, { recursive: true, force: true });
});

test("ZB-05 注册表包含全部角色(规则 3 + 蒙特卡洛 3 + 胜率 3 + 学习 1)", () => {
  assert.deepEqual(AI_NAMES, ["Baozi", "Sam", "Lucas", "May", "Yeon", "Brian", "EQB", "EQBfast", "EQBnaive", "ZeroB"]);
  void zeroBStatus();
  void EQ_PROFILES;
  void makeEquityBot;
});
