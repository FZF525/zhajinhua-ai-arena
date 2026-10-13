// ZeroB 的 A/B 对照:牌力档特征 vs 精确胜率特征(同样的种子、同样的场次)
// 运行:node examples/zerob-ab.ts [场次=10] [每场局数=6]
import { loadZeroB, makeZeroB, type ZeroBTable } from "../src/ai/learning.ts";
import { makeAgent } from "../src/ai/index.ts";
import { makeConfig } from "../src/config.ts";
import { createGame } from "../src/state.ts";
import { apply, advance } from "../src/engine.ts";
import { createRng } from "../src/rng.ts";
import type { Policy } from "../src/env.ts";

const MATCHES = Number(process.argv[2] ?? 10);
const HANDS = Number(process.argv[3] ?? 6);

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

const sam = makeAgent("Sam");
const variants: Array<[string, string, { equitySamples?: number }]> = [
  ["牌力档特征", "data/zerob-tier.json", {}],
  ["精确胜率特征", "data/zerob-eq.json", { equitySamples: 30 }],
  ["无训练(退化为 EQBfast)", "", {}]
];
console.log("ZeroB A/B:" + MATCHES + " 场 × " + HANDS + " 局,对手固定 Sam,同种子");
for (const [label, file, opts] of variants) {
  let table: ZeroBTable | null = file ? loadZeroB(file) : null;
  const pol = makeZeroB(table, 0, opts);
  let sum = 0;
  const t0 = Date.now();
  for (let m = 0; m < MATCHES; m++) sum += duel(pol, sam, 500 + m, m % 2 === 1);
  const states = table ? Object.keys(table.q).length : 0;
  console.log("  " + label.padEnd(22) + (sum / MATCHES >= 0 ? "+" : "") + (sum / MATCHES).toFixed(0).padStart(6) +
    " 分/场   状态数 " + String(states).padStart(4) + "   手数 " + (table?.trainedHands ?? 0) + "   (" + ((Date.now() - t0) / 1000).toFixed(1) + "s)");
}
