// ZeroB 该不该继续训练?—— 用对照实验回答
//   A) 现状:当前表 + 兜底 EQBfast
//   B) 只换兜底:当前表 + 兜底 Sam(零训练成本)
//   C) 继续训练 N 手:表变大 + 兜底 EQBfast
// 运行:node examples/zerob-study.ts [额外训练手数=30000] [场次=20] [每场局数=6]
import { trainZeroB, loadZeroB, zeroBPath, zerobKey, zerobLegal, hasData, bestAction, emptyTable } from "../src/ai/learning.ts";
import type { ZeroBTable } from "../src/ai/learning.ts";
import { makeAgent } from "../src/ai/index.ts";
import { makeConfig } from "../src/config.ts";
import { createGame } from "../src/state.ts";
import { apply, advance } from "../src/engine.ts";
import { createRng } from "../src/rng.ts";
import { player } from "../src/state.ts";
import { enumerateActions } from "../src/env.ts";
import { equityDecide, EQ_PROFILES } from "../src/ai/equity.ts";
import { PROFILES } from "../src/ai/heuristic.ts";
import { auxDecision } from "../src/ai/heuristic.ts";
import type { Policy } from "../src/env.ts";
import { evaluate, compare } from "../src/evaluator.ts";

const EXTRA = Number(process.argv[2] ?? 30000);
const MATCHES = Number(process.argv[3] ?? 20);
const HANDS = Number(process.argv[4] ?? 6);

/** 用指定兜底策略构造 ZeroB 策略(表没数据时用兜底) */
function policy(table: ZeroBTable, fallback: Policy): Policy {
  return (s, rng) => {
    const seat = s.turn.seat;
    if (seat === null) return null;
    const legal = zerobLegal(s);
    if (!legal.length) return null;
    const key = zerobKey(s, seat);
    if (!hasData(table, key)) return fallback(s, rng);
    const qs = table.q[key] ?? [];
    return legal[bestAction(qs, legal)].action;
  };
}

function duel(a: Policy, b: Policy, seed: number, swap: boolean): number {
  const st = createGame(makeConfig({
    players: { startPoints: 20000 },
    endGame: { maxHands: HANDS, winAtOrAbove: 1e9, bustAtOrBelow: -1, winTakesPriorityOverBust: true }
  }), ["A", "B"], seed);
  const start = st.players.map((p) => p.points);
  advance(st);
  const agents: Policy[] = swap ? [b, a] : [a, b];
  const rng = createRng(seed * 31 + 7);
  let steps = 0;
  while (!st.gameOver && steps++ < 20000) {
    const seat = st.turn.seat;
    if (seat === null) break;
    const act = agents[seat](st, rng);
    if (!act || !apply(st, act).ok) break;
  }
  return st.players[swap ? 1 : 0].points - start[swap ? 1 : 0];
}

/** 与 Sam 单挑(交换座位),返回净得分 */
function evalVsSam(p: Policy): { net: number; w: number; l: number; d: number } {
  const sam = makeAgent("Sam");
  const samPolicy: Policy = (s, rng) => sam(s, rng);
  let net = 0, w = 0, l = 0, d = 0;
  for (let m = 0; m < MATCHES; m++) {
    const seed = 9000 + m;              // 评估种子与训练种子完全不重叠
    const x = duel(p, samPolicy, seed, false);
    const y = duel(p, samPolicy, seed, true);
    net += x + y;
    if (x + y > 0) w++; else if (x + y < 0) l++; else d++;
  }
  return { net, w, l, d };
}

const cur = loadZeroB(zeroBPath())!;
const fbFast: Policy = (s, rng) => equityDecide(s, rng, EQ_PROFILES.EQBfast);
const fbSam: Policy = (s, rng) => auxDecision(s, rng, PROFILES.Sam) ?? makeAgent("Sam")(s, rng);
const coverage = (t: ZeroBTable) => Object.keys(t.q).length;

console.log("=== 起点:" + cur.trainedHands + " 手训练 / " + coverage(cur) + " 个状态 / 状态空间 1200 ===");
console.log("评估口径:" + MATCHES + " 场 × " + HANDS + " 局,单挑 Sam,交换座位,种子 9000+(与训练种子不重叠)");
console.log("");
const a = evalVsSam(policy(cur, fbFast));
console.log("A) 现状(兜底 EQBfast)         净 " + a.net + "   胜/负/平 " + a.w + "/" + a.l + "/" + a.d);
const b = evalVsSam(policy(cur, fbSam));
console.log("B) 只换兜底(兜底 Sam,零训练)  净 " + b.net + "   胜/负/平 " + b.w + "/" + b.l + "/" + b.d);
console.log("");
console.log("--- 继续自对弈训练 " + EXTRA + " 手(从现有表继续)---");
const t0 = Date.now();
const grown = trainZeroB({ hands: EXTRA, seed: 424242, table: cur, keyOpts: {}, players: 2, onProgress: (done, t) => { if (done % Math.max(1, Math.floor(EXTRA / 4)) === 0) console.log("   已训练 " + done + " 手 / 状态 " + coverage(t)); } });
console.log("   训练完成 " + ((Date.now() - t0) / 1000).toFixed(1) + "s → 状态 " + coverage(grown) + "(覆盖率 " + (coverage(grown) / 1200 * 100).toFixed(1) + "%)");
const c2 = evalVsSam(policy(grown, fbFast));
console.log("C) 训练更多(兜底 EQBfast)      净 " + c2.net + "   胜/负/平 " + c2.w + "/" + c2.l + "/" + c2.d);
const d2 = evalVsSam(policy(grown, fbSam));
console.log("D) 训练更多 + 兜底 Sam          净 " + d2.net + "   胜/负/平 " + d2.w + "/" + d2.l + "/" + d2.d);

// ---- 多人局评估(ZeroB 的强项口径)----
function evalMulti(p: Policy, matches: number, hands: number): { net: number; rank: number[] } {
  const others = ["Sam", "Yeon", "Brian"].map(makeAgent);
  let net = 0; const ranks: number[] = [];
  for (let m = 0; m < matches; m++) {
    const seat = m % 4;                       // 轮换 ZeroB 的座位,避免位置偏差
    const st = createGame(makeConfig({
      players: { startPoints: 20000 },
      endGame: { maxHands: hands, winAtOrAbove: 1e9, bustAtOrBelow: -1, winTakesPriorityOverBust: true }
    }), ["P0", "P1", "P2", "P3"], 7000 + m);
    const start = st.players.map((q) => q.points);
    advance(st);
    const rng = createRng((7000 + m) * 31 + 7);
    let steps = 0;
    while (!st.gameOver && steps++ < 30000) {
      const who = st.turn.seat;
      if (who === null) break;
      const act = who === seat ? p(st, rng) : others[who > seat ? who - 1 : who](st, rng);
      if (!act || !apply(st, act).ok) break;
    }
    net += st.players[seat].points - start[seat];
    const sorted = st.players.map((q, i) => [i, q.points] as const).sort((x, y) => y[1] - x[1]);
    ranks.push(sorted.findIndex(([i]) => i === seat) + 1);
  }
  return { net, rank: ranks };
}

console.log("");
console.log("=== 4 人局(ZeroB + Sam + Yeon + Brian),20 场 × 6 局,轮换座位 ===");
for (const [label, tbl, fb] of [["A 现状", cur, fbFast], ["B 换兜底", cur, fbSam], ["C 训练更多", grown, fbFast], ["D 训练+兜底", grown, fbSam]] as const) {
  const r = evalMulti(policy(tbl, fb), MATCHES, HANDS);
  const avg = (r.rank.reduce((x, y) => x + y, 0) / r.rank.length).toFixed(2);
  const firsts = r.rank.filter((x) => x === 1).length;
  console.log("  " + label.padEnd(12) + " 净 " + String(r.net).padStart(6) + "   平均名次 " + avg + "   冠军 " + firsts + "/" + MATCHES);
}
