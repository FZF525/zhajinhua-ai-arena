// ZeroB 低噪声评估器:配对比较 + 标准误 + 显著性判断
// 用法:node examples/zerob-eval.ts <A变体> <B变体> [场次=200] [每场局数=6] [模式=multi4]
//   变体写法:  data/zerob.json#EQBfast   (表 + 兜底)
//              data/zerob.json#Sam
//              #Sam                      (不用表,纯兜底策略)
//              heuristic:Sam             (纯启发式)
// 模式:multi4 / multi6 / heads(单挑 Sam)
// 要点:两个变体跑**同一批种子**,逐场做配对差值 —— 噪声比"各跑一遍再比均值"小得多。
import { loadZeroB, zerobKey, zerobLegal, hasData, bestAction } from "../src/ai/learning.ts";
import type { ZeroBTable } from "../src/ai/learning.ts";
import { makeAgent } from "../src/ai/index.ts";
import { makeConfig } from "../src/config.ts";
import { createGame } from "../src/state.ts";
import { apply, advance } from "../src/engine.ts";
import { createRng } from "../src/rng.ts";
import { equityDecide, EQ_PROFILES } from "../src/ai/equity.ts";
import type { Policy } from "../src/env.ts";

const SPEC_A = process.argv[2] ?? "data/zerob.json#EQBfast";
const SPEC_B = process.argv[3] ?? "data/zerob.json#Sam";
const MATCHES = Number(process.argv[4] ?? 200);
const HANDS = Number(process.argv[5] ?? 6);
const MODE = process.argv[6] ?? "multi4";
const SEED0 = 30000;

function parseSpec(spec: string): { table: ZeroBTable | null; fallback: string; label: string } {
  if (spec.startsWith("heuristic:")) {
    return { table: null, fallback: spec.slice(10), label: "纯启发式 " + spec.slice(10) };
  }
  const [path, fb = "EQBfast"] = spec.split("#");
  const table = path ? loadZeroB(path) : null;
  if (path && !table) throw new Error("读不到表: " + path);
  return { table, fallback: fb, label: (path || "(无表)") + " + 兜底 " + fb };
}

function fallbackPolicy(name: string): Policy {
  if (name === "EQBfast") return (s, rng) => equityDecide(s, rng, EQ_PROFILES.EQBfast);
  const p = makeAgent(name);
  return (s, rng) => p(s, rng);
}

function makePolicy(spec: { table: ZeroBTable | null; fallback: string }): Policy {
  const fb = fallbackPolicy(spec.fallback);
  if (!spec.table) return fb;
  const table = spec.table;
  return (s, rng) => {
    const seat = s.turn.seat;
    if (seat === null) return null;
    const legal = zerobLegal(s);
    if (!legal.length) return null;
    const key = zerobKey(s, seat);
    if (!hasData(table, key)) return fb(s, rng);
    return legal[bestAction(table.q[key] ?? [], legal)].action;
  };
}

const OPPONENTS = MODE === "heads" ? ["Sam"] : MODE === "multi6" ? ["Sam", "Yeon", "Brian", "Baozi", "Lucas"] : ["Sam", "Yeon", "Brian"];
const NPLAY = OPPONENTS.length + 1;

/** 跑一场:返回 ZeroB 的净分与名次 */
function runMatch(policy: Policy, seed: number, seat: number): { net: number; rank: number } {
  const names = Array.from({ length: NPLAY }, (_, i) => (i === seat ? "ZB" : OPPONENTS[i > seat ? i - 1 : i]));
  const st = createGame(makeConfig({
    players: { startPoints: 20000 },
    endGame: { maxHands: HANDS, winAtOrAbove: 1e9, bustAtOrBelow: -1, winTakesPriorityOverBust: true }
  }), names, seed);
  const start = st.players.map((p) => p.points);
  advance(st);
  const real: Policy[] = names.map((nm, i) => (i === seat ? policy : (makeAgent(nm) as unknown as Policy)));
  const rng = createRng(seed * 31 + 7);
  let steps = 0;
  while (!st.gameOver && steps++ < 40000) {
    const who = st.turn.seat;
    if (who === null) break;
    const act = real[who](st, rng);
    if (!act || !apply(st, act).ok) break;
  }
  const rank = st.players.map((p, i) => [i, p.points] as const).sort((x, y) => y[1] - x[1]).findIndex(([i]) => i === seat) + 1;
  return { net: st.players[seat].points - start[seat], rank };
}

function evaluate(spec: { table: ZeroBTable | null; fallback: string }) {
  const policy = makePolicy(spec);
  const nets: number[] = [], ranks: number[] = [];
  for (let m = 0; m < MATCHES; m++) {
    const r = runMatch(policy, SEED0 + m, m % NPLAY);
    nets.push(r.net); ranks.push(r.rank);
  }
  return { nets, ranks };
}

const A = parseSpec(SPEC_A), B = parseSpec(SPEC_B);
console.log("=== ZeroB 配对评估 ===");
console.log("口径:" + MODE + "(" + NPLAY + " 人," + OPPONENTS.join("/") + ") " + MATCHES + " 场 × " + HANDS + " 局,座位轮换,种子 " + SEED0 + "+");
console.log("A = " + A.label);
console.log("B = " + B.label);
console.log("");
const ra = evaluate(A), rb = evaluate(B);
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const se = (xs: number[]) => { const m = mean(xs); return Math.sqrt(xs.reduce((a, b) => a + (b - m) * (b - m), 0) / (xs.length - 1)) / Math.sqrt(xs.length); };

for (const [label, r] of [["A", ra], ["B", rb]] as const) {
  const champs = r.ranks.filter((x) => x === 1).length;
  console.log("  " + label + "  净分/场 " + mean(r.nets).toFixed(0).padStart(6) + " ± " + se(r.nets).toFixed(0).padStart(4) +
    "   平均名次 " + mean(r.ranks).toFixed(2) + "   冠军率 " + (champs / MATCHES * 100).toFixed(1) + "%");
}
const deltas = ra.nets.map((x, i) => x - rb.nets[i]);
const dm = mean(deltas), ds = se(deltas);
const t = dm / (ds || 1);
console.log("");
console.log("  配对差值 A−B: " + (dm >= 0 ? "+" : "") + dm.toFixed(0) + " ± " + ds.toFixed(0) + " 分/场   t=" + t.toFixed(2) +
  "   → " + (Math.abs(t) >= 2 ? "显著(|t|≥2)" : "**不显著**(噪声范围内)"));
const rankDelta = ra.ranks.map((x, i) => x - rb.ranks[i]);
const rd = mean(rankDelta), rds = se(rankDelta);
console.log("  配对名次差 A−B: " + (rd >= 0 ? "+" : "") + rd.toFixed(3) + " ± " + rds.toFixed(3) + "   t=" + (rd / (rds || 1)).toFixed(2));
console.log("");
console.log("提示:|t| < 2 就说明这两个配置在当前样本下**分不出高下**,别急着换。");
