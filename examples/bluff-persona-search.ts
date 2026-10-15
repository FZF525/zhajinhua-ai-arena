// 唬牌「性格发现」:不用手搓,随机采样参数空间,看数据自己长出什么样的 AI
//
// 动机:之前的 Xiaozhen 是作者手拍参数(我想表达"诚实+精准质疑"),它当然容易"最强" ✗
//       —— 这等于把答案写在题目里。这个脚本改成:采样 40 组参数 → 同一对手、同一批种子 → 谁强由数据说
// 用法:node examples/bluff-persona-search.ts [样本数=40] [每组盘数=60]
import { BLUFF_BUST_MODES } from "../src/games/bluff/state.ts";
import { newBluffGame, startHand, play, challenge } from "../src/games/bluff/rules.ts";
import { BLUFF_PERSONAS, createAdaptiveAgent } from "../src/games/bluff/ai.ts";
import type { BluffAiOptions } from "../src/games/bluff/ai.ts";
import { createRng } from "../src/rng.ts";

const N = Number(process.argv[2] ?? "40");
const M = Number(process.argv[3] ?? "60");
const CFG = { players: 4, handSize: 26, maxPlay: 5, bustCards: BLUFF_BUST_MODES.loose, rate: 1, handsPerMatch: 4, drawMode: "choose3" as const, challengeFee: 5, challengeWin: 3, challengeWinsBonus: 30 };
// 固定对手场:标准型 + 老实人 + 多疑者(候选者坐第 4 席,座位轮换)
const FIELD = ["Bajiao", "Nannan", "Nizi"] as const;

function runCandidate(opts: BluffAiOptions, matches: number): { mean: number; sd: number; wins: number } {
  const scores: number[] = [];
  let wins = 0;
  for (let m = 0; m < matches; m++) {
    const rot = (i: number) => (i + m) % 4;
    const names = ["候选", "候选", "候选", "候选"];
    for (let i = 0; i < 4; i++) if (rot(i) === 0) names[i] = "候选"; else names[i] = FIELD[(rot(i) - 1 + FIELD.length) % FIELD.length];
    const st = newBluffGame(CFG, names, 300000 + m);
    const rng = createRng(77 + m);
    const agents = names.map((n) => createAdaptiveAgent(n === "候选" ? opts : { ...BLUFF_PERSONAS[n], learnAlpha: 6 }));
    while (!st.over) {
      if (st.handOver) { for (const a of agents) a.observeHand(st); if (st.over) break; startHand(st); continue; }
      const seat = st.turn;
      const act = agents[seat].decide(st, seat, rng);
      const r = act.type === "PLAY" ? play(st, act.seat, act.cardIds, act.declaredRank) : challenge(st, act.seat);
      if (!r.ok) throw new Error("非法动作:" + r.error);
    }
    let mine = 0;
    st.seats.forEach((p) => { if (p.name === "候选") mine += p.points; });
    scores.push(mine);
    const best = Math.max(...st.seats.map((p) => p.points));
    if (mine === best) wins += 1;
  }
  const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
  const sd = Math.sqrt(scores.reduce((s, x) => s + (x - mean) * (x - mean), 0) / Math.max(1, scores.length - 1));
  return { mean, sd, wins };
}

// --verify:用更大样本复核指定参数(第 1/2/3 名 + 手工小针 + 手工囡囡)
if (process.argv.includes("--verify")) {
  const M2 = Number(process.argv[process.argv.indexOf("--verify") + 1] ?? "400");
  const list: Array<{ tag: string; opts: BluffAiOptions }> = [
    { tag: "数据第1名", opts: { challengeAt: 0.38, greed: 0.16, maxLie: 2, maxHonest: 5, bustFear: 1.26, oppBluffSize: 1 } },
    { tag: "数据第2名", opts: { challengeAt: 0.35, greed: 0.02, maxLie: 4, maxHonest: 3, bustFear: 1.71, oppBluffSize: 1 } },
    { tag: "数据第3名", opts: { challengeAt: 0.56, greed: 0.41, maxLie: 1, maxHonest: 5, bustFear: 1.12, oppBluffSize: 1 } },
    { tag: "手工小针", opts: { ...BLUFF_PERSONAS.Xiaozhen } },
    { tag: "手工囡囡", opts: { ...BLUFF_PERSONAS.Nannan } },
  ];
  console.log("=== 复核:每组 " + M2 + " 盘(同一对手场,座位轮换)===");
  console.log("  标签        平均每盘   标准误   t 值    夺冠率");
  for (const c of list) {
    const res = runCandidate(c.opts, M2);
    const se = res.sd / Math.sqrt(M2);
    console.log("  " + c.tag.padEnd(10) + String(res.mean.toFixed(1)).padStart(9) + String(se.toFixed(1)).padStart(9) + String((se ? res.mean / se : 0).toFixed(2)).padStart(8) + String((res.wins / M2 * 100).toFixed(0) + "%").padStart(9));
  }
  process.exit(0);
}

const rnd = createRng(20260126);
const r = (lo: number, hi: number) => lo + rnd.next() * (hi - lo);
const cands: Array<{ opts: BluffAiOptions; tag: string }> = [
  // 手工版小针作为对照
  { opts: { ...BLUFF_PERSONAS.Xiaozhen }, tag: "手工小针(0.78/0/2/5/1.8)" },
  { opts: { ...BLUFF_PERSONAS.Nannan }, tag: "手工囡囡(0.80/0/1/3/2.0)" },
];
for (let i = 0; i < N; i++) {
  cands.push({
    opts: { challengeAt: r(0.3, 0.9), greed: r(0, 0.6), maxLie: 1 + Math.floor(rnd.next() * 5), maxHonest: 3 + Math.floor(rnd.next() * 3), bustFear: r(1.0, 1.9), oppBluffSize: 1 + Math.floor(rnd.next() * 3) },
    tag: "随机样本 " + (i + 1),
  });
}

const rows = cands.map((c) => ({ ...c, res: runCandidate(c.opts, M) }));
rows.sort((a, b) => b.res.mean - a.res.mean);
console.log("=== 性格发现:每组 " + M + " 盘,对手固定为 Bajiao/Nannan/Nizi(座位轮换)===");
console.log("  名次  参数(challengeAt/greed/maxLie/maxHonest/bustFear)         平均每盘  t 值   夺冠率  标签");
rows.forEach((row, i) => {
  const o = row.opts;
  const se = row.res.sd / Math.sqrt(M);
  const t = se ? row.res.mean / se : 0;
  const pad = (o.challengeAt.toFixed(2) + " / " + o.greed.toFixed(2) + " / " + o.maxLie + " / " + o.maxHonest + " / " + o.bustFear.toFixed(2)).padEnd(28);
  console.log("  " + String(i + 1).padStart(4) + "  " + pad + String(row.res.mean.toFixed(1)).padStart(9) + String(t.toFixed(2)).padStart(8) + String((row.res.wins / M * 100).toFixed(0) + "%").padStart(9) + "  " + row.tag);
});
const hand = rows.find((x) => x.tag.startsWith("手工小针"))!;
const best = rows[0];
console.log("");
console.log("  手工小针名次: 第 " + (rows.indexOf(hand) + 1) + " 名(" + hand.res.mean.toFixed(1) + " 分)");
console.log("  数据长出来的最好一组: " + (best.tag.startsWith("手工") ? best.tag : best.tag) + " → " + best.res.mean.toFixed(1) + " 分");
