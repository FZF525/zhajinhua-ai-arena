// 唬牌「谁能和谁共存」:把某个性格放进四种不同的桌子,看它的得分怎么变
//
// 目的:验证"依赖猎物"这类效应 —— 例如 Caocao(曹操)是靠抓赌徒吃饭的吗?
// 用法:node examples/bluff-coexist.ts [每种桌子盘数=150]
import { BLUFF_BUST_MODES } from "../src/games/bluff/state.ts";
import { newBluffGame, startHand, play, challenge } from "../src/games/bluff/rules.ts";
import { BLUFF_PERSONAS, createAdaptiveAgent } from "../src/games/bluff/ai.ts";
import { createRng } from "../src/rng.ts";

const M = Number(process.argv[2] ?? "150");
const LEDGER = (process.argv.find((x) => x.startsWith("--ledger=")) ?? "--ledger=full").split("=")[1] === "revealed" ? "revealed" as const : "full" as const;
const CFG = { players: 4, handSize: 26, maxPlay: 5, bustCards: BLUFF_BUST_MODES.loose, rate: 1, handsPerMatch: 4, drawMode: "choose3" as const, challengeFee: 5, challengeWin: 3, challengeWinsBonus: 30, ledgerMode: LEDGER };
const ROSTER = ["Lao6", "Bajiao", "Nizi", "Nannan", "Xiaozhen", "Caocao"] as const;
// 四种桌子:P + 三个搭档
const TABLES: Array<{ tag: string; others: string[] }> = [
  { tag: "全标准", others: ["Bajiao", "Bajiao", "Bajiao"] },
  { tag: "有赌徒", others: ["Bajiao", "Bajiao", "Lao6"] },
  { tag: "有曹操", others: ["Bajiao", "Bajiao", "Caocao"] },
  { tag: "全老实人", others: ["Nannan", "Nannan", "Nannan"] },
];

function runOne(p: string, others: string[], m: number): number {
  // 座位:m 轮换,但保证 P 出现一次、others 填满其余三席
  const base = [p, ...others];
  const names: string[] = [];
  for (let i = 0; i < 4; i++) names.push(base[(i + m) % 4]);
  const st = newBluffGame(CFG, names, 500000 + m);
  const rng = createRng(31 + m);
  const agents = names.map((n) => createAdaptiveAgent({ ...BLUFF_PERSONAS[n as keyof typeof BLUFF_PERSONAS], learnAlpha: 6 }));
  while (!st.over) {
    if (st.handOver) { for (const a of agents) a.observeHand(st); if (st.over) break; startHand(st); continue; }
    const seat = st.turn;
    const act = agents[seat].decide(st, seat, rng);
    const r = act.type === "PLAY" ? play(st, act.seat, act.cardIds, act.declaredRank) : challenge(st, act.seat);
    if (!r.ok) throw new Error("非法动作:" + r.error);
  }
  let me = 0;
  st.seats.forEach((x) => { if (x.name === p) me += x.points; });
  return me;
}

console.log("=== 「谁能和谁共存」 · 账本模式 = " + LEDGER + " · 每种桌子 " + M + " 盘 ===");
console.log("  表内 = 该性格在那种桌子上的平均每盘得分");
console.log("");
const w = 13;
console.log("  性格".padEnd(w) + TABLES.map((t) => t.tag.padStart(w)).join("") + "   猎物价差");
for (const p of ROSTER) {
  const cells = TABLES.map((tb) => {
    const arr: number[] = [];
    for (let m = 0; m < M; m++) arr.push(runOne(p, tb.others, m));
    return arr.reduce((a, b) => a + b, 0) / arr.length;
  });
  const diff = cells[1] - cells[0];   // 有赌徒 vs 全标准
  console.log("  " + p.padEnd(w - 2) + cells.map((v) => ((v >= 0 ? "+" : "") + v.toFixed(1)).padStart(w)).join("") + ("  " + (diff >= 0 ? "+" : "") + diff.toFixed(1)).padStart(11));
}
console.log("");
console.log("  「猎物价差」= 有赌徒的桌子 − 全标准的桌子(正 = 它靠抓赌徒吃饭 ✓)");
