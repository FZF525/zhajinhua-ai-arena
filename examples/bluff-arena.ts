// 唬牌擂台:精确型 AI vs 随机型(基线),输出胜负 + 节奏数据
//
// 用法:
//   node examples/bluff-arena.ts                        # 60 盘:1 个精确 + 3 个随机
//   node examples/bluff-arena.ts 60 excel4              # 60 盘:4 个精确互打(镜像局,看平衡性)
//   node examples/bluff-arena.ts 60 excel4 0.3          # 调质疑门槛
import { createRng } from "../src/rng.ts";
import { DEFAULT_BLUFF_CONFIG, isHonestCard } from "../src/games/bluff/state.ts";
import { newBluffGame, startHand, play, challenge } from "../src/games/bluff/rules.ts";
import type { BluffState } from "../src/games/bluff/state.ts";
import { excelDecide, randomDecide, DEFAULT_EXCEL } from "../src/games/bluff/ai.ts";
import type { BluffAiOptions } from "../src/games/bluff/ai.ts";

const N = Number(process.argv[2] ?? 60);
const MODE = process.argv[3] ?? "mix";
const flag = (name: string, dflt: number) => {
  const hit = process.argv.find((x) => x.startsWith("--" + name + "="));
  return hit ? Number(hit.split("=")[1]) : dflt;
};
const CHALLENGE_AT = flag("challenge", DEFAULT_EXCEL.challengeAt);
const OPTS: BluffAiOptions = { ...DEFAULT_EXCEL, challengeAt: CHALLENGE_AT };
// 可调:爆牌线 / 手牌数(手牌数 × 4 不能超过 104)
const CFG = { ...DEFAULT_BLUFF_CONFIG, bustCards: flag("bust", DEFAULT_BLUFF_CONFIG.bustCards), handSize: flag("hand", DEFAULT_BLUFF_CONFIG.handSize) };
const NAMES = MODE === "excel4" ? ["EX0", "EX1", "EX2", "EX3"] : ["EXCEL", "R1", "R2", "R3"];

function runMatch(seed: number) {
  const st: BluffState = newBluffGame(CFG, NAMES, seed);
  const rng = createRng(seed * 31 + 7);
  let actions = 0, challenges = 0, plays = 0, lieCards = 0, playedCards = 0;
  const piles: number[] = [];
  const ends: string[] = [];
  let guard = 0;
  while (!st.over && guard++ < 200000) {
    if (st.handOver) {
      piles.push(st.pile.length);
      ends.push(st.bustedSeat === null ? "empty" : "bust");
      startHand(st);
      continue;
    }
    const seat = st.turn;
    const act = MODE === "excel4" ? excelDecide(st, seat, OPTS) : (seat === 0 ? excelDecide(st, seat, OPTS) : randomDecide(st, seat, rng));
    if (act.type === "PLAY") {
      plays++;
      playedCards += act.cardIds.length;
      const R = st.roundRank, W = st.wildRank;
      for (const id of act.cardIds) {
        const c = st.seats[seat].hand.find((x) => x.id === id)!;
        if (!isHonestCard(c, R, W)) lieCards++;      // 用模块自己的判定,别再手搓一份(已因此错过一次)
      }
    }
    const res = act.type === "PLAY" ? play(st, act.seat, act.cardIds) : challenge(st, act.seat);
    if (!res.ok) throw new Error("非法动作 " + act.type + ": " + res.error);
    actions++;
    if (act.type === "CHALLENGE") challenges++;
  }
  piles.push(st.pile.length);
  ends.push(st.bustedSeat === null ? "empty" : "bust");
  return { st, actions, challenges, plays, lieCards, playedCards, piles, ends };
}

const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const wins = [0, 0, 0, 0];
const scores = [0, 0, 0, 0];
let sumActions = 0, sumChal = 0, sumPlays = 0, sumLie = 0, sumCards = 0;
const allPiles: number[] = [];
const endCount: Record<string, number> = {};
const t0 = Date.now();
for (let i = 0; i < N; i++) {
  const r = runMatch(1000 + i);
  const best = Math.max(...r.st.seats.map((p) => p.points));
  r.st.seats.forEach((p, k) => { if (p.points === best) wins[k]++; scores[k] += p.points; });
  sumActions += r.actions; sumChal += r.challenges; sumPlays += r.plays; sumLie += r.lieCards; sumCards += r.playedCards;
  allPiles.push(...r.piles);
  for (const e of r.ends) endCount[e] = (endCount[e] ?? 0) + 1;
}
console.log("=== 唬牌擂台: " + MODE + "   " + N + " 盘(每盘 4 局),质疑门槛 " + CHALLENGE_AT + ",用时 " + ((Date.now() - t0) / 1000).toFixed(1) + "s ===");
console.log("  夺冠次数: " + NAMES.map((n, k) => n + "=" + wins[k] + "(" + ((wins[k] / N) * 100).toFixed(0) + "%)").join("  "));
console.log("  平均每盘得分: " + NAMES.map((n, k) => n + "=" + (scores[k] / N).toFixed(1)).join("  ") + "   (零和)");
console.log("");
console.log("=== 节奏数据(每局)===" );
console.log("  平均动作数: " + (sumActions / (N * 4)).toFixed(1) + "   其中质疑 " + (sumChal / (N * 4)).toFixed(1) + ",出牌 " + (sumPlays / (N * 4)).toFixed(1));
console.log("  出牌总张数 " + sumCards + "  其中假牌 " + sumLie + "  →  假牌占比 " + ((sumLie / Math.max(1, sumCards)) * 100).toFixed(0) + "%");
console.log("  局末牌堆: 平均 " + avg(allPiles).toFixed(1) + " 张,最大 " + Math.max(...allPiles) + " 张");
console.log("  结束方式: " + JSON.stringify(endCount) + "   (empty = 出空手牌赢 / bust = 有人 > " + CFG.bustCards + " 张)");