// 八门拱猪 —— 简单贪心 AI(够玩,不是最优)
// 思路:① 亮牌只亮"亮出会更好"的(雪花/变压器),绝不亮猪、刀刃、水滴
//       ② 出牌:算这一轮里特殊牌的净值;正分就想赢、负分就想躲
import type { Card } from "../../cards.ts";
import type { ZhupigState } from "./state.ts";
import { CLASSIC_HEARTS } from "./state.ts";
import { legalZhupig, isSpecialId } from "./rules.ts";
import type { Rng } from "../../rng.ts";

/** 单张牌对"收牌人"的大致价值(用于决定抢还是躲)*/
export function zpCardValue(st: ZhupigState, c: Card): number {
  const sp = st.cfg.specials;
  if (c.id === sp.pig.id) return sp.pig.value;          // -100
  if (c.id === sp.sheep.id) return sp.sheep.value;      // +100
  if (sp.snow.some((s) => s.id === c.id)) {
    const def = sp.snow.find((s) => s.id === c.id)!;
    return def.value;
  }
  if (c.suit === "HEART") return st.cfg.specials.hearts[c.rank] ?? 0;
  if (c.id === sp.transformer.id) return 50;            // 无红桃时给 +50,有红桃翻倍
  if (c.id === sp.water9.id) return -50;                // 减半/ -50
  if (c.id === sp.star8.id || c.id === sp.moon8.id) return -25;
  return 0;
}

/** 开局亮牌:只亮雪花门主 SNOW-K(全场雪花 ×2,自己通常也能沾到);从不亮刀刃/水滴(亮出更糟)*/
export function zpAiDeclare(st: ZhupigState, seat: number): string[] {
  return st.seats[seat].hand.filter((c) => c.id === "SNOW-K").map((c) => c.id);
}

export type ZpAiKind = "random" | "greedy" | "counting";

/** 已打出的牌(公开信息:本轮 + 各人收牌堆 + 弃牌)*/
function playedCards(st: ZhupigState): Card[] {
  return [...st.trick.plays.map((p) => p.card), ...st.seats.flatMap((s) => s.pile.map((p) => p.card)), ...st.discard];
}

/** 某花色里"点数比 r 大、且还没出现"的牌数(记牌型 AI 用,只依赖公开信息)*/
function unknownHigher(st: ZhupigState, suit: string, r: number, seat: number): number {
  const seen = new Set(playedCards(st).map((c) => c.id));
  for (const c of st.seats[seat].hand) seen.add(c.id);
  let n = 0;
  for (const c of st.seats[seat].hand) { /* 自己手里不算未知 */ }
  // 13 个点数里,比 r 大的点数各有一张(每花色 13 张)
  for (let rank = r + 1; rank <= 14; rank++) {
    if (!seen.has(suit + "-" + rankLabelNum(rank))) n += 1;
  }
  return n;
}
function rankLabelNum(r: number): string {
  return r <= 10 ? String(r) : ({ 11: "J", 12: "Q", 13: "K", 14: "A" } as Record<number, string>)[r] ?? String(r);
}

/** 三档 AI 的出牌入口 */
export function zpAiPlay(kind: ZpAiKind, st: ZhupigState, seat: number, rng: Rng): Card {
  if (kind === "random") {
    const legal = legalZhupig(st, seat);
    return legal[Math.floor(rng.next() * legal.length)];
  }
  if (kind === "greedy") return zpAiChoose(st, seat, rng);
  return zpAiChooseCounting(st, seat, rng);
}

/** 贪心(修正版):**领出不再打最大牌** —— 有猪先甩猪,否则领最小的;跟牌才抢正分轮 */
export function zpAiChoose(st: ZhupigState, seat: number, rng: Rng): Card {
  const legal = legalZhupig(st, seat);
  const led = st.trick.ledSuit;
  const trickValue = st.trick.plays.reduce((a, p) => a + zpCardValue(st, p.card), 0);
  const asc = legal.slice().sort((a, b) => a.rank - b.rank);

  if (!led) {
    // 领出:手里有猪(♠Q)就先甩掉(逼别人跟黑桃,谁大谁收);否则领**最小**的牌,把大牌留到能收好轮时用
    // 有猪先甩 —— 但如果我手里还有 ♠A(黑桃最大牌在我手上),甩出去必然被 A 赢回来 = 自己吃猪 ✗
    const pig = legal.find((c) => c.id === st.cfg.specials.pig.id);
    const mySpadeAce = legal.some((c) => c.suit === "SPADE" && c.rank === 14);
    if (pig && !mySpadeAce) return pig;
    return asc[0];
  }

  const bySuit = (c: Card) => (c.suit === led ? c.rank : -1);
  const bestSoFar = st.trick.plays.reduce((m, p) => Math.max(m, bySuit(p.card)), -1);
  const winning = legal.filter((c) => c.suit === led && c.rank > bestSoFar).sort((a, b) => a.rank - b.rank);
  const last = st.trick.plays.length === 3;

  if (trickValue > 0) {
    if (winning.length) return last ? winning[0] : winning[winning.length - 1];
    return asc[0];
  }
  // 负分轮/中性轮:尽量不吃
  const dodge = legal.filter((c) => !(c.suit === led && c.rank > bestSoFar));
  return (dodge.length ? dodge : legal).slice().sort((a, b) => a.rank - b.rank)[0];
}

/** 记牌型(调优版)
 *  ① 领出:**不抢大红旗**,有猪甩猪,否则领最小的(和贪心一样,别把大牌白送)
 *  ② 跟牌:先看"这一轮里有什么" —— 有羊/变压器/雪花 → **必须争**;有水滴9/刀刃 → **必须躲**
 *  ③ 用公开信息数"外面还剩几张比我大的",估算能不能站住
 */
export function zpAiChooseCounting(st: ZhupigState, seat: number, rng: Rng): Card {
  const legal = legalZhupig(st, seat);
  const led = st.trick.ledSuit;
  const trickValue = st.trick.plays.reduce((a, p) => a + zpCardValue(st, p.card), 0);
  const asc = legal.slice().sort((a, b) => a.rank - b.rank);
  const sp = st.cfg.specials;

  // 这一轮里有没有"抢手货"(羊 +100 / 变压器 / 雪花正分)和"烫手山芋"(水滴9 / 刀刃)
  const hasTreat = st.trick.plays.some((p) => {
    const v = zpCardValue(st, p.card);
    return p.card.id === sp.sheep.id || p.card.id === sp.transformer.id || (v > 0 && p.card.suit !== "HEART");
  });
  const hasTrap = st.trick.plays.some((p) => {
    const v = zpCardValue(st, p.card);
    return p.card.id === sp.water9.id || p.card.id === sp.star8.id || p.card.id === sp.moon8.id || v < 0;
  });

  if (!led) {
    // 同上:手里有 ♠A 就别甩猪(会自己吃回来)
    const pig = legal.find((c) => c.id === sp.pig.id);
    const mySpadeAce = legal.some((c) => c.suit === "SPADE" && c.rank === 14);
    if (pig && !mySpadeAce) return pig;
    return asc[0];      // 领出永远领最小的:大牌留着抢抢手货
  }

  const bySuit = (c: Card) => (c.suit === led ? c.rank : -1);
  const bestSoFar = st.trick.plays.reduce((m, p) => Math.max(m, bySuit(p.card)), -1);
  const winning = legal.filter((c) => c.suit === led && c.rank > bestSoFar).sort((a, b) => a.rank - b.rank);
  const last = st.trick.plays.length === 3;
  const dodge = legal.filter((c) => !(c.suit === led && c.rank > bestSoFar));

  // 必须躲:水滴/刀刃/负分 → 出最小、且尽量不赢
  if (hasTrap && !hasTreat) return (dodge.length ? dodge : legal).slice().sort((a, b) => a.rank - b.rank)[0];

  // 必须争:羊/变压器/正分雪花 → 能赢就赢(最后一家直接赢;否则看数牌)
  if (hasTreat && winning.length) {
    if (last) return winning[0];
    const higher = unknownHigher(st, led, winning[0].rank, seat);
    // 外面还剩 0 张→必站住;还剩 1~2 张→值得冒险(抢手货值得)
    if (higher <= 2) return winning[0];
    return winning[winning.length - 1];   // 争不到就用最大的拼一下
  }

  if (trickValue > 0) {
    if (winning.length) {
      if (last) return winning[0];
      const higher = unknownHigher(st, led, winning[0].rank, seat);
      if (higher <= 1) return winning[0];
      return winning[winning.length - 1];
    }
    return asc[0];
  }
  // 中性/负分:不争
  return (dodge.length ? dodge : legal).slice().sort((a, b) => a.rank - b.rank)[0];
}

export function isZpSpecial(st: ZhupigState, c: Card): boolean { return isSpecialId(st.cfg, c); }
export { CLASSIC_HEARTS };
