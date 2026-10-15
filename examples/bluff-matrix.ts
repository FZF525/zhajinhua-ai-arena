// 唬牌「谁克谁」矩阵:每对性格打 2v2(两家 A、两家 B),座位轮换,配对 t 值
//
// 为什么用 2v2:游戏是四人局,没法真的单挑;两家对两家既对称又能直接算出「A 队 vs B 队」的分差 ✓
// 用法:node examples/bluff-matrix.ts 200 [--draw=choose3] [--bust=52] [--alpha=6]
import { BLUFF_BUST_MODES } from "../src/games/bluff/state.ts";
import { newBluffGame, startHand, play, challenge } from "../src/games/bluff/rules.ts";
import { BLUFF_PERSONAS, createAdaptiveAgent } from "../src/games/bluff/ai.ts";
import { createRng } from "../src/rng.ts";

const arg = (n: string, d: string) => { const h = process.argv.find((x) => x.startsWith("--" + n + "=")); return h ? h.split("=").slice(1).join("=") : d; };
const N = Number(process.argv[2] ?? "200");
const ROSTER = arg("players", "Lao6,Bajiao,Nizi,Nannan").split(",").map((s) => s.trim());
const DRAW = arg("draw", "choose3") === "one" ? "one" as const : "choose3" as const;
const BUST = arg("bust", "52") === "40" ? BLUFF_BUST_MODES.tight : BLUFF_BUST_MODES.loose;
const ALPHA = Number(arg("alpha", "6"));
const FEE = Number(arg("fee", "0"));
const WIN = Number(arg("win", "0"));
const CFG = { players: 4, handSize: 26, maxPlay: 5, bustCards: BUST, rate: 1, handsPerMatch: 4, drawMode: DRAW, challengeFee: FEE, challengeWin: WIN };

function playMatch(a: string, b: string, m: number): { aCamp: number; bCamp: number } {
  const base = [a, a, b, b];
  const names: string[] = [];
  for (let i = 0; i < 4; i++) names.push(base[(i + m) % 4]);
  const st = newBluffGame(CFG, names, 70000 + m);
  const rng = createRng(555 + m);
  const agents = names.map((n) => createAdaptiveAgent({ ...BLUFF_PERSONAS[n as keyof typeof BLUFF_PERSONAS], learnAlpha: ALPHA }));
  while (!st.over) {
    if (st.handOver) { for (const ag of agents) ag.observeHand(st); if (st.over) break; startHand(st); continue; }
    const seat = st.turn;
    const act = agents[seat].decide(st, seat, rng);
    const r = act.type === "PLAY" ? play(st, act.seat, act.cardIds, act.declaredRank) : challenge(st, act.seat);
    if (!r.ok) throw new Error("非法动作:" + r.error);
  }
  let aCamp = 0, bCamp = 0;
  st.seats.forEach((p) => { if (p.name === a) aCamp += p.points; else bCamp += p.points; });
  return { aCamp, bCamp };
}

const mean = (x: number[]) => x.reduce((s, v) => s + v, 0) / x.length;
const sd = (x: number[]) => { const mu = mean(x); return Math.sqrt(x.reduce((s, v) => s + (v - mu) * (v - mu), 0) / Math.max(1, x.length - 1)); };

const diff: Record<string, Record<string, number[]>> = {};
for (const a of ROSTER) diff[a] = {};
for (let i = 0; i < ROSTER.length; i++) {
  for (let j = i + 1; j < ROSTER.length; j++) {
    const a = ROSTER[i], b = ROSTER[j];
    const arr: number[] = [];
    for (let m = 0; m < N; m++) { const r = playMatch(a, b, m); arr.push(r.aCamp - r.bCamp); }
    diff[a][b] = arr;
    diff[b][a] = arr.map((v) => -v);
  }
}

console.log("=== 唬牌「谁克谁」矩阵 · 每对 " + N + " 盘(2v2,座位轮换)· 爆牌线 " + BUST + " · 抽 " + DRAW + " · α=" + ALPHA + " ===");
console.log("  表内数字 = 行家平均每盘净胜列家多少分(正 = 行家克列家)");
console.log("");
const w = 11;
let head = "".padEnd(w);
for (const b of ROSTER) head += b.padStart(w);
console.log("  " + head);
for (const a of ROSTER) {
  let row = a.padEnd(w);
  for (const b of ROSTER) {
    if (a === b) { row += "-".padStart(w); continue; }
    const v = mean(diff[a][b]);
    row += ((v >= 0 ? "+" : "") + v.toFixed(1)).padStart(w);
  }
  console.log("  " + row);
}
console.log("");
console.log("  t 值矩阵(|t| ≥ 2 才算显著):");
let head2 = "".padEnd(w);
for (const b of ROSTER) head2 += b.padStart(w);
console.log("  " + head2);
for (const a of ROSTER) {
  let row = a.padEnd(w);
  for (const b of ROSTER) {
    if (a === b) { row += "-".padStart(w); continue; }
    const arr = diff[a][b];
    const t = mean(arr) / (sd(arr) / Math.sqrt(arr.length));
    row += ((t >= 0 ? "+" : "") + t.toFixed(1)).padStart(w);
  }
  console.log("  " + row);
}
console.log("");
const edges: string[] = [];
for (let i = 0; i < ROSTER.length; i++) {
  for (let j = i + 1; j < ROSTER.length; j++) {
    const a = ROSTER[i], b = ROSTER[j];
    const arr = diff[a][b];
    const t = mean(arr) / (sd(arr) / Math.sqrt(arr.length));
    if (Math.abs(t) < 2) edges.push(a + " ≈ " + b + "(无显著差异)");
    else edges.push((t > 0 ? a + " 克 " + b : b + " 克 " + a) + "(净胜 " + Math.abs(mean(arr)).toFixed(0) + " 分/盘,t=" + Math.abs(t).toFixed(1) + ")");
  }
}
console.log("  结论:" + edges.join("  |  "));
