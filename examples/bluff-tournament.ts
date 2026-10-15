// 唬牌锦标赛:四人互打 N 盘,座位轮换 + 配对比较 + t 值
//
// 用法:
//   node examples/bluff-tournament.ts 200 --players=Lao6,Bajiao,Nizi,Nannan
//   node examples/bluff-tournament.ts 200 --players=Lynn,Bajiao,Nizi,Nannan   # 看 Lynn 能不能赢
// 设计要点:
//   · **座位轮换**:每盘把名单整体转一格 → 消除座位/先手偏差(实测过 Nizi 曾因座位而虚高)
//   · **同一批种子**:不同配置跑同样的盘 → 可以配对比较
//   · Lynn 是自进化 AI:每盘结束调用 endMatch(得分),它据此保留/回退自己的参数变异
import { BLUFF_BUST_MODES } from "../src/games/bluff/state.ts";
import { newBluffGame, startHand, play, challenge } from "../src/games/bluff/rules.ts";
import type { BluffState } from "../src/games/bluff/state.ts";
import { BLUFF_PERSONAS, createAdaptiveAgent, createEvolvingAgent, randomDecide } from "../src/games/bluff/ai.ts";
import { isHonestCard } from "../src/games/bluff/state.ts";
import { createRng } from "../src/rng.ts";

const arg = (name: string, dflt: string) => {
  const hit = process.argv.find((x) => x.startsWith("--" + name + "="));
  return hit ? hit.split("=").slice(1).join("=") : dflt;
};
const N = Number(process.argv[2] ?? "200");
const ROSTER = arg("players", "Lao6,Bajiao,Nizi,Nannan").split(",").map((s) => s.trim());
const DRAW = arg("draw", "choose3") === "one" ? "one" as const : "choose3" as const;
const BUST = arg("bust", "52") === "40" || arg("bust", "52") === "tight" ? BLUFF_BUST_MODES.tight : BLUFF_BUST_MODES.loose;
const CFG = { players: 4, handSize: 26, maxPlay: 5, bustCards: BUST, rate: 1, handsPerMatch: 4, drawMode: DRAW };
// 学习速度:α 越大越信结构模型、越慢(实测 α 会改变排名,所以暴露出来)
const ALPHA = Number(arg("alpha", "6"));

type Kind = "Lynn" | "random" | keyof typeof BLUFF_PERSONAS;
interface SeatAgent { decide(st: BluffState, seat: number, rng: ReturnType<typeof createRng>): any; observeHand(st: BluffState): void }

const scores: Record<string, number[]> = {};
const wins: Record<string, number> = {};
const seatSum = [0, 0, 0, 0];
let lieCards = 0, playedCards = 0, challenges = 0, hands = 0, gen = 0;
const endTypes: Record<string, number> = {};

for (let m = 0; m < N; m++) {
  // 座位轮换:把名单整体转 m 格 → 每个人在四个座位上都坐同样多
  const names: string[] = [];
  for (let i = 0; i < 4; i++) names.push(ROSTER[(i + m) % ROSTER.length]);
  const st = newBluffGame(CFG, names, 90000 + m);
  const rng = createRng(1234 + m);
  const personaOpts = (n: string) => (BLUFF_PERSONAS[n as keyof typeof BLUFF_PERSONAS] ? { ...BLUFF_PERSONAS[n as keyof typeof BLUFF_PERSONAS], learnAlpha: ALPHA } : { learnAlpha: ALPHA });
  const agents: SeatAgent[] = names.map((n) => (n === "Lynn" ? createEvolvingAgent(7 + m) : createAdaptiveAgent(personaOpts(n))));
  const kindOf = (n: string): Kind => (n === "Lynn" ? "Lynn" : n === "random" ? "random" : (n as keyof typeof BLUFF_PERSONAS));
  while (!st.over) {
    if (st.handOver) {
      for (const a of agents) a.observeHand(st);
      endTypes[st.bustedSeat === null ? "出空" : "爆牌"] = (endTypes[st.bustedSeat === null ? "出空" : "爆牌"] ?? 0) + 1;
      hands += 1;
      if (st.over) break;
      startHand(st);
      continue;
    }
    const seat = st.turn;
    const k = kindOf(names[seat]);
    const act = k === "random" ? randomDecide(st, seat, rng) : agents[seat].decide(st, seat, rng);
    const before = st.claims.length;
    const r = act.type === "PLAY" ? play(st, act.seat, act.cardIds, act.declaredRank) : challenge(st, act.seat);
    if (!r.ok) throw new Error("非法动作:" + r.error);
    if (act.type === "CHALLENGE") challenges += 1;
    if (st.claims.length > before) {
      const c = st.claims[before];
      playedCards += c.count;
      lieCards += c.count - c.honest;
    }
  }
  // 结算:按"人名"记账(座位是轮换的)
  const byName: Record<string, number> = {};
  st.seats.forEach((p, i) => { byName[p.name] = (byName[p.name] ?? 0) + p.points; seatSum[i] += p.points; });
  let bestName = "", bestVal = -Infinity;
  for (const n of names) { scores[n] = scores[n] ?? []; scores[n].push(byName[n] ?? 0); if ((byName[n] ?? 0) > bestVal) { bestVal = byName[n]; bestName = n; } }
  wins[bestName] = (wins[bestName] ?? 0) + 1;
  gen += names.filter((n) => n === "Lynn").length > 0 ? 0 : 0;
}

const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
const sd = (a: number[]) => { const mu = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - mu) * (x - mu), 0) / Math.max(1, a.length - 1)); };
console.log("=== 唬牌锦标赛 " + N + " 盘 · 座位轮换 · 爆牌线 " + BUST + " · 抽点数 " + DRAW + " ===");
console.log("  名单: " + ROSTER.join(" / "));
console.log("");
console.log("  选手      平均每盘得分   标准差   标准误    t 值     夺冠率");
const list = [...ROSTER];
for (const n of list) {
  const a = scores[n] ?? [];
  const mu = mean(a), s = sd(a), se = s / Math.sqrt(a.length);
  const t = se ? mu / se : 0;
  console.log("  " + n.padEnd(8) + String(mu.toFixed(1)).padStart(10) + String(s.toFixed(1)).padStart(9) + String(se.toFixed(1)).padStart(9) + String(t.toFixed(2)).padStart(9) + String(((wins[n] ?? 0) / N * 100).toFixed(0) + "%").padStart(10));
}
console.log("");
console.log("  座位偏差检查(平均每盘得分按座位):" + seatSum.map((x, i) => "座位" + i + "=" + (x / N).toFixed(1)).join("  "));
console.log("  节奏:平均 " + (hands ? "每局" : "") + (challenges / Math.max(1, hands)).toFixed(1) + " 次质疑/局;假牌率 " + (playedCards ? ((lieCards / playedCards) * 100).toFixed(0) : "0") + "%;结束方式 " + JSON.stringify(endTypes));
