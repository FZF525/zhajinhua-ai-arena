// 分组赛:10 个 AI 分两组打组内循环,各组前二进决赛(前四),三四名打安慰赛
// 运行:node examples/grouped-cup.ts [每组对数=2] [每场局数=5] [分组数=2] [参赛者,逗号分隔]
import { makeConfig } from "../src/config.ts";
import { createGame } from "../src/state.ts";
import { apply, advance } from "../src/engine.ts";
import { createRng } from "../src/rng.ts";
import { makeAgent, AI_NAMES } from "../src/ai/index.ts";
import type { Policy } from "../src/env.ts";

const MATCHES = Number(process.argv[2] ?? 2);
const HANDS = Number(process.argv[3] ?? 5);
const GROUPS = Number(process.argv[4] ?? 2);
const ROSTER = (process.argv[5] ? process.argv[5].split(",").map((x) => x.trim()).filter(Boolean) : AI_NAMES);

function duel(a: Policy, b: Policy, seed: number, swap: boolean, hands = HANDS): number {
  const st = createGame(makeConfig({
    players: { startPoints: 20000 },
    endGame: { maxHands: hands, winAtOrAbove: 1e9, bustAtOrBelow: -1, winTakesPriorityOverBust: true }
  }), swap ? ["B", "A"] : ["A", "B"], seed);
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

/** 多人桌:一桌 N 人,返回每个人的净分与名次 */
function table(result: { net: number; rank: number }[], policies: Policy[], names: string[], seed: number, hands = HANDS) {
  const st = createGame(makeConfig({
    players: { startPoints: 20000 },
    endGame: { maxHands: hands, winAtOrAbove: 1e9, bustAtOrBelow: -1, winTakesPriorityOverBust: true }
  }), names, seed);
  const start = st.players.map((p) => p.points);
  advance(st);
  const rng = createRng(seed * 31 + 7);
  let steps = 0;
  while (!st.gameOver && steps++ < 40000) {
    const seat = st.turn.seat;
    if (seat === null) break;
    const act = policies[seat](st, rng);
    if (!act || !apply(st, act).ok) break;
  }
  const order = st.players.map((p, i) => [i, p.points] as const).sort((x, y) => y[1] - x[1]);
  st.players.forEach((p, i) => {
    result[i] = { net: p.points - start[i], rank: order.findIndex(([k]) => k === i) + 1 };
  });
}

// 洗牌分组(固定种子,可复现)
let seed = 20260101;
const rand = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const shuffled = ROSTER.slice();
for (let i = shuffled.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]; }
const groups: string[][] = Array.from({ length: GROUPS }, () => []);
shuffled.forEach((n, i) => groups[i % GROUPS].push(n));

const policies = new Map<string, Policy>(ROSTER.map((n) => [n, makeAgent(n)]));
interface Row { name: string; net: number; w: number; l: number; d: number }
const t0 = Date.now();
const groupTables: Row[][] = [];

console.log("=== 分组赛:" + ROSTER.length + " 位选手 / " + GROUPS + " 组 · 组内两两循环 " + MATCHES + " 场 × " + HANDS + " 局(轮换座位)===");
groups.forEach((g, gi) => {
  const rows = new Map<string, Row>(g.map((n) => [n, { name: n, net: 0, w: 0, l: 0, d: 0 }]));
  for (let i = 0; i < g.length; i++) {
    for (let j = i + 1; j < g.length; j++) {
      const A = g[i], B = g[j];
      let net = 0;
      for (let m = 0; m < MATCHES; m++) net += duel(policies.get(A)!, policies.get(B)!, 5000 + gi * 1000 + i * 97 + j * 13 + m, m % 2 === 1);
      net /= MATCHES;
      const ra = rows.get(A)!, rb = rows.get(B)!;
      ra.net += net; rb.net -= net;
      if (net > 0) { ra.w++; rb.l++; } else if (net < 0) { ra.l++; rb.w++; } else { ra.d++; rb.d++; }
    }
  }
  const sorted = [...rows.values()].sort((x, y) => y.net - x.net || y.w - x.w);
  groupTables.push(sorted);
  console.log("");
  console.log("--- " + String.fromCharCode(65 + gi) + " 组 ---");
  sorted.forEach((r, i) => console.log("  " + (i + 1) + ". " + r.name.padEnd(10) + " 净分 " + String(r.net).padStart(6) + "   胜/负/平 " + r.w + "/" + r.l + "/" + r.d));
});

// 决赛(各组前二)+ 安慰赛(各组三四)
const finalists = groupTables.flatMap((s) => s.slice(0, 2).map((r) => r.name));
const consolation = groupTables.flatMap((s) => s.slice(2, 4).map((r) => r.name));
console.log("");
console.log("=== 决赛(4 人):" + finalists.join(" / ") + " ===");
const fr = finalists.map(() => ({ net: 0, rank: 0 }));
table(fr, finalists.map((n) => policies.get(n)!), finalists, 90001, HANDS);
finalists.map((n, i) => [n, fr[i]] as const).sort((a, b) => a[1].rank - b[1].rank)
  .forEach(([n, r], i) => console.log("  " + (i + 1) + ". " + n.padEnd(10) + " 净分 " + String(r.net).padStart(6) + (r.rank === 1 ? "   🏆 冠军" : "")));
console.log("");
console.log("=== 安慰赛(4 人):" + consolation.join(" / ") + " ===");
const cr = consolation.map(() => ({ net: 0, rank: 0 }));
table(cr, consolation.map((n) => policies.get(n)!), consolation, 90002, HANDS);
consolation.map((n, i) => [n, cr[i]] as const).sort((a, b) => a[1].rank - b[1].rank)
  .forEach(([n, r], i) => console.log("  " + (i + 1) + ". " + n.padEnd(10) + " 净分 " + String(r.net).padStart(6)));
console.log("");
console.log("总用时 " + ((Date.now() - t0) / 1000).toFixed(1) + "s");
