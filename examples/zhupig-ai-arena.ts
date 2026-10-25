// 八门拱猪 AI 擂台:随机 / 贪心 / 记牌 三档互打(座位轮换)
// 用法:node examples/zhupig-ai-arena.ts [每种对局局数=60]
import { createRng } from "../src/rng.ts";
import { CLASSIC_ZHUPIG } from "../src/games/zhupig/state.ts";
import { dealZhupig, legalZhupig, playZhupig, declareShow, checkZhupigInvariants, isRevealable } from "../src/games/zhupig/rules.ts";
import { scoreZhupig } from "../src/games/zhupig/score.ts";
import { zpAiPlay, zpAiDeclare, type ZpAiKind } from "../src/games/zhupig/ai.ts";

const N = Number(process.argv[2] ?? "60");
const KINDS: ZpAiKind[] = ["random", "greedy", "counting"];
const rng = createRng(777);
const scores: Record<string, number[]> = { random: [], greedy: [], counting: [] };
let illegal = 0;

for (let g = 0; g < N * 3; g++) {
  // 座位轮换:第 g 局,座位 i 的 AI 种类 = KINDS[(i + g) % 3]
  const kinds: ZpAiKind[] = [0, 1, 2, 3].map((i) => KINDS[(i + g) % 3]);
  const st = dealZhupig(CLASSIC_ZHUPIG, ["A", "B", "C", "D"], 900000 + g);
  for (let i = 0; i < 4; i++) declareShow(st, i, zpAiDeclare(st, i));
  let guard = 0;
  while (!st.over && guard++ < 400) {
    const seat = st.turn;
    const card = zpAiPlay(kinds[seat], st, seat, rng);
    const legal = legalZhupig(st, seat).some((c) => c.id === card.id);
    if (!legal) { illegal += 1; break; }
    const r = playZhupig(st, seat, card.id);
    if (!r.ok) { illegal += 1; break; }
  }
  if (checkZhupigInvariants(st).length) illegal += 1;
  const sc = scoreZhupig(st);
  const sum = sc.perSeat.reduce((a, p) => a + p.final, 0);
  if (Math.abs(sum) > 1e-9) illegal += 1;
  sc.perSeat.forEach((p) => scores[kinds[p.seat]].push(p.final));
}

const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
const sd = (a: number[]) => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) * (x - m), 0) / Math.max(1, a.length - 1)); };
console.log("=== 八门拱猪 AI 擂台 · 三档互打 · 每档 " + N + " 局(座位轮换)===");
console.log("  异常(非法出牌/不变量/零和): " + illegal);
console.log("  种类      局数   平均每局得分   标准差   标准误   t 值");
for (const k of KINDS) {
  const a = scores[k];
  const m = mean(a), s = sd(a), se = s / Math.sqrt(a.length);
  const label = k === "random" ? "随机" : k === "greedy" ? "贪心" : "记牌";
  console.log("  " + (label + "(" + k + ")").padEnd(16) + String(a.length).padStart(4) + String(m.toFixed(1)).padStart(13) + String(s.toFixed(1)).padStart(10) + String(se.toFixed(1)).padStart(9) + String((m / se).toFixed(2)).padStart(8));
}
