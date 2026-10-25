// 连局长度实测:不同水平的玩家 vs 3 个记牌 AI,到 -5000 / +5000 需要多少局
// 用法:node examples/zhupig-match-length.ts [每情形场数=5] [局数上限=400]
import { createRng } from "../src/rng.ts";
import { CLASSIC_ZHUPIG } from "../src/games/zhupig/state.ts";
import { dealZhupig, legalZhupig, playZhupig, declareShow } from "../src/games/zhupig/rules.ts";
import { scoreZhupig } from "../src/games/zhupig/score.ts";
import { zpAiPlay, zpAiDeclare, type ZpAiKind } from "../src/games/zhupig/ai.ts";

const RUNS = Number(process.argv[2] ?? "5");
const CAP = Number(process.argv[3] ?? "400");
const LOW = -5000, HIGH = 5000;
const rng = createRng(20261025);

function playMatch(humanKind: ZpAiKind, runIndex: number): { games: number; hit: "low" | "high" | null; seat0: number } {
  const kinds: ZpAiKind[] = [humanKind, "counting", "counting", "counting"];
  const totals = [0, 0, 0, 0];
  for (let g = 1; g <= CAP; g++) {
    const st = dealZhupig(CLASSIC_ZHUPIG, ["你", "老六", "芭蕉", "囡囡"], 400000 + runIndex * 10007 + g * 37 + humanKind.length);
    for (let i = 0; i < 4; i++) declareShow(st, i, zpAiDeclare(st, i));
    let guard = 0;
    while (!st.over && guard++ < 400) {
      const seat = st.turn;
      const card = zpAiPlay(kinds[seat], st, seat, rng, { total: totals.slice() });
      if (!legalZhupig(st, seat).some((c) => c.id === card.id)) throw new Error("非法出牌");
      playZhupig(st, seat, card.id);
    }
    const sc = scoreZhupig(st);
    sc.perSeat.forEach((p) => { totals[p.seat] += p.final; });
    const lo = totals.findIndex((v) => v <= LOW);
    const hi = totals.findIndex((v) => v >= HIGH);
    if (lo >= 0) return { games: g, hit: "low", seat0: totals[0] };
    if (hi >= 0) return { games: g, hit: "high", seat0: totals[0] };
  }
  return { games: CAP, hit: null, seat0: totals[0] };
}

const label: Record<string, string> = { random: "随机(新手)", greedy: "贪心(普通)", counting: "记牌(最强)" };
console.log("=== 连局长度实测:到 -5000 / +5000 停 · 每情形 " + RUNS + " 场 · 上限 " + CAP + " 局 ===");
console.log("  玩家水平        场次  平均局数  最短  最长   到线分布");
for (const kind of ["random", "greedy", "counting"] as ZpAiKind[]) {
  const res = Array.from({ length: RUNS }, (_, ri) => playMatch(kind, ri));
  const gs = res.map((r) => r.games);
  const avg = gs.reduce((a, b) => a + b, 0) / gs.length;
  const hitLow = res.filter((r) => r.hit === "low").length;
  const hitHigh = res.filter((r) => r.hit === "high").length;
  const none = res.filter((r) => r.hit === null).length;
  console.log("  " + label[kind].padEnd(14) + String(RUNS).padStart(5) + String(avg.toFixed(1)).padStart(9) + String(Math.min(...gs)).padStart(6) + String(Math.max(...gs)).padStart(6) +
    "   低线 " + hitLow + " · 高线 " + hitHigh + (none ? " · 未到线 " + none : ""));
}
