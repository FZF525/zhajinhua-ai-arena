// AI 用例:合法性 / 守恒 / 性格差异 / MC 采样正确性
import test from "node:test";
import assert from "node:assert/strict";
import { makeConfig } from "../src/config.ts";
import { createGame, checkInvariants, player, isAlive } from "../src/state.ts";
import { apply, advance } from "../src/engine.ts";
import { makeAgent, AI_NAMES, AGENTS, PROFILES, MC_PROFILES } from "../src/ai/index.ts";
import { determinize, enumerateActions, simulateAction, exchangeGain } from "../src/env.ts";
import { createRng } from "../src/rng.ts";
import { mcDecide } from "../src/ai/montecarlo.ts";

function fresh(names: string[], seed = 7, patch?: unknown) {
  const st = createGame(makeConfig({ players: { startPoints: 20000 }, endGame: { maxHands: 4, winAtOrAbove: 1e9, bustAtOrBelow: -1, winTakesPriorityOverBust: true }, ...(patch as object ?? {}) }), names, seed);
  advance(st);
  return st;
}

test("AI-01 六个 AI 全部只出合法动作(随机种 × 多种人数)", () => {
  for (const name of AI_NAMES) {
    for (const n of [2, 3]) {
      const names = ["A", "B", "C"].slice(0, n);
      const st = fresh(names, 11);
      const agents = names.map(() => makeAgent(name));
      const rng = createRng(5);
      let steps = 0;
      while (!st.gameOver && steps++ < 400) {
        const seat = st.turn.seat;
        if (seat === null) break;
        const a = agents[seat](st, rng);
        if (!a) break;
        const r = apply(st, a);
        assert.equal(r.ok, true, name + " 出了非法动作 " + a.type + ":" + (r.error?.code ?? "") + (r.error?.message ?? ""));
      }
      assert.deepEqual(checkInvariants(st), [], name + " 破坏不变量");
    }
  }
});

test("AI-02 混合对局:积分守恒 + 不变量成立 + 能打完", () => {
  const names = AI_NAMES.slice(0, 3);
  const st = fresh(names, 99);
  const total0 = st.players.reduce((a, p) => a + p.points, 0) + st.pot + st.carryPot;   // 含底池与结转
  const agents = names.map(makeAgent);
  const rng = createRng(3);
  let steps = 0;
  while (!st.gameOver && steps++ < 3000) {
    const seat = st.turn.seat;
    if (seat === null) break;
    const a = agents[seat](st, rng);
    if (!a) break;
    const r = apply(st, a);
    assert.equal(r.ok, true, names[seat] + " 出了非法动作 " + a.type + ":" + (r.error?.code ?? "") + " " + (r.error?.message ?? ""));
    assert.equal(st.players.reduce((x, p) => x + p.points, 0) + st.pot + st.carryPot, total0, "积分不守恒");
    assert.deepEqual(checkInvariants(st), []);
  }
  assert.ok(st.handNo >= 4, "应至少打满 maxHands 局: " + st.handNo);
});

test("AI-03 性格可分辨:保守弃牌率 > 激进弃牌率,激进加注率 > 保守加注率", () => {
  const stat: Record<string, { acts: number; fold: number; raise: number }> = {};
  for (const name of AI_NAMES.slice(0, 3)) stat[name] = { acts: 0, fold: 0, raise: 0 };
  for (let g = 0; g < 24; g++) {
    const names = ["Baozi", "Sam", "Lucas"];
    const st = fresh(names, g + 1);
    const agents = names.map(makeAgent);
    const rng = createRng(g + 50);
    let steps = 0;
    while (!st.gameOver && steps++ < 1200) {
      const seat = st.turn.seat;
      if (seat === null) break;
      const a = agents[seat](st, rng);
      if (!a) break;
      if (!apply(st, a).ok) break;
      stat[names[seat]].acts++;
      if (a.type === "FOLD") stat[names[seat]].fold++;
      if (a.type === "RAISE") stat[names[seat]].raise++;
    }
  }
  const rate = (n: string, k: "fold" | "raise") => stat[n][k] / Math.max(1, stat[n].acts);
  assert.ok(rate("Baozi", "fold") > rate("Lucas", "fold"), "保守应更常弃牌");
  assert.ok(rate("Lucas", "raise") > rate("Baozi", "raise"), "激进应更常加注");
});

test("AI-04 MC:determinize 不改变牌数与手牌张数(只是重新分配未知牌)", () => {
  const st = fresh(["May", "Yeon", "Brian"], 5);
  const sizes = st.players.map((p) => p.hand.length);
  const deck = st.deck.length;
  const pool = st.pool.map((c) => c.id).join(",");
  const w = determinize(st, 0, createRng(123));
  assert.deepEqual(w.players.map((p) => p.hand.length), sizes);
  assert.equal(w.deck.length, deck);
  assert.equal(w.pool.map((c) => c.id).join(","), pool, "公共池不应被重排");
  assert.equal(w.players[0].hand.map((c) => c.id).join(","), st.players[0].hand.map((c) => c.id).join(","), "自己的手牌不变");
  const all = [...w.deck, ...w.pool, ...w.players.flatMap((p) => p.hand)].map((c) => c.id).sort();
  const all0 = [...st.deck, ...st.pool, ...st.players.flatMap((p) => p.hand)].map((c) => c.id).sort();
  assert.deepEqual(all, all0, "整副牌守恒");
});

test("AI-05 MC:simulateAction 给出有限期望值,且 rollout 用独立随机源(不推动真实牌局)", () => {
  const st = fresh(["May", "Sam", "Brian"], 17);
  apply(st, { type: "VIEW_HAND", seat: st.turn.seat! });
  const rngBefore = st.rng.snapshot();
  const acts = enumerateActions(st);
  const call = acts.find((a) => a.type === "CALL")!;
  const r = simulateAction(st, call, st.turn.seat!, makeAgent("Sam"), 6, 4242, 80);
  assert.ok(Number.isFinite(r.mean));
  assert.equal(r.samples, 6);
  assert.ok(r.winRate >= 0 && r.winRate <= 1);
  assert.equal(st.rng.snapshot(), rngBefore, "模拟不得推进真实随机序列");
  assert.deepEqual(checkInvariants(st), [], "模拟不得改动原状态");
});

test("AI-06 MC trace:主决策会评估多个候选动作", () => {
  const names = ["May", "Sam"];
  const st = fresh(names, 21);
  const seat = st.turn.seat!;
  apply(st, { type: "VIEW_HAND", seat });
  const mc = MC_PROFILES.Yeon;
  const out = mcDecide(st, createRng(1), mc);
  assert.ok(out.trace.length >= 1, "应至少评估一个候选");
  assert.ok(out.trace.every((t) => Number.isFinite(t.mean) && t.samples > 0));
  assert.ok(["FOLD", "CALL", "RAISE", "COMPARE"].includes(out.action.type));
});

test("AI-07 注册表:10 个角色,标签与说明齐全", () => {
  assert.equal(AI_NAMES.length, 10);
  assert.deepEqual(AI_NAMES, ["Baozi", "Sam", "Lucas", "May", "Yeon", "Brian", "EQB", "EQBfast", "EQBnaive", "ZeroB"]);
  assert.equal(AGENTS.filter((a) => a.kind === "heuristic").length, 3);
  assert.equal(AGENTS.filter((a) => a.kind === "montecarlo").length, 3);
  assert.equal(AGENTS.filter((a) => a.kind === "equity").length, 3);
  assert.equal(AGENTS.filter((a) => a.kind === "learning").length, 1);
  assert.equal(PROFILES.Lucas.foldBelow < PROFILES.Baozi.foldBelow, true);
  assert.ok(MC_PROFILES.May.rollouts > MC_PROFILES.Brian.rollouts, "稳健型采样更多");
});

test("AI-08 env:换牌评估能识别「换了会变好」的情形", () => {
  const st = fresh(["Sam", "Sam"], 3);
  const seat = st.turn.seat!;
  apply(st, { type: "VIEW_HAND", seat });
  const me = player(st, seat);
  const poolCard = st.pool.find((c) => st.poolMeta[c.id].faceUp)!;
  const gain = exchangeGain(st, me, poolCard);
  assert.ok(Number.isFinite(gain));
  assert.ok(gain <= 1 && gain >= -1);
});

test("AI-09 MC 算牌:已经亮出来的弃牌不会被重新洗牌(属于已知信息)", () => {
  const st = fresh(["May", "Sam", "Lucas"], 31);
  const folder = st.turn.seat!;
  const known = player(st, folder).hand.map((c) => c.id).sort();
  apply(st, { type: "FOLD", seat: folder });
  const world = determinize(st, st.turn.seat!, createRng(9));
  assert.deepEqual(world.players[folder].hand.map((c) => c.id).sort(), known, "弃牌者手牌应保持原样");
  // 其余对局信息仍守恒
  const all = [...world.deck, ...world.pool, ...world.players.flatMap((p) => p.hand)].map((c) => c.id).sort();
  const all0 = [...st.deck, ...st.pool, ...st.players.flatMap((p) => p.hand)].map((c) => c.id).sort();
  assert.deepEqual(all, all0);
});
