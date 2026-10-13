// AI 强度对比:每个角色与参照物(Sam 标准规则型)对战,统计平均积分差;随机 bot 作为地板。
// 运行:node examples/ai-bench.ts [每组场次=8] [每场局数=6]
import { makeConfig } from "../src/config.ts";
import { createGame } from "../src/state.ts";
import { apply, advance } from "../src/engine.ts";
import { createRng } from "../src/rng.ts";
import { makeAgent, AI_NAMES } from "../src/ai/index.ts";
import { randomBot } from "../src/bot.ts";
import type { Policy } from "../src/env.ts";

const MATCHES = Number(process.argv[2] ?? 8);
const HANDS = Number(process.argv[3] ?? 6);
const REF = "Sam";

function duel(aName: string, a: Policy, bName: string, b: Policy, seed: number, swap: boolean): number {
  const names = swap ? [bName, aName] : [aName, bName];
  const st = createGame(makeConfig({
    players: { startPoints: 20000 },
    endGame: { maxHands: HANDS, winAtOrAbove: 1e9, bustAtOrBelow: -1, winTakesPriorityOverBust: true }
  }), names, seed);
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
  const aSeat = swap ? 1 : 0;
  return st.players[aSeat].points - start[aSeat];
}

const ref = makeAgent(REF);
const rows: Array<[string, number]> = [];
const candidates: Array<[string, Policy]> = [
  ...AI_NAMES.filter((n) => n !== REF).map((n) => [n, makeAgent(n)] as [string, Policy]),
  ["random", ((st, rng) => randomBot(st, rng)) as Policy]
];
console.log("对手固定为 " + REF + "(标准规则型);每格 " + MATCHES + " 场 × " + HANDS + " 局;正数 = 更强");
for (const [name, policy] of candidates) {
  let sum = 0;
  const t0 = Date.now();
  for (let m = 0; m < MATCHES; m++) sum += duel(name, policy, REF, ref, 500 + m, m % 2 === 1);
  const d = sum / MATCHES;
  rows.push([name, d]);
  console.log("  " + name.padEnd(7) + (d >= 0 ? "+" : "") + d.toFixed(0).padStart(6) + " 分/场   (" + ((Date.now() - t0) / 1000).toFixed(1) + "s)");
}
console.log("\n排名(相对 " + REF + "):");
for (const [n, d] of rows.slice().sort((x, y) => y[1] - x[1])) console.log("  " + n.padEnd(7) + (d >= 0 ? "+" : "") + d.toFixed(0));
