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
    const pig = legal.find((c) => c.id === st.cfg.specials.pig.id);
    if (pig) return pig;
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

/** 记牌型:用公开信息数"外面还有没有更大的牌",再决定吃不吃 */
export function zpAiChooseCounting(st: ZhupigState, seat: number, rng: Rng): Card {
  const legal = legalZhupig(st, seat);
  const led = st.trick.ledSuit;
  const trickValue = st.trick.plays.reduce((a, p) => a + zpCardValue(st, p.card), 0);
  const asc = legal.slice().sort((a, b) => a.rank - b.rank);
  const heartsLeft = 13 - playedCards(st).filter((c) => c.suit === "HEART").length;

  if (!led) {
    // 领出:有猪先甩;否则挑"自己的最大牌在花色里没被别人压过"的花色……但为简单,仍领最小的牌
    const pig = legal.find((c) => c.id === st.cfg.specials.pig.id);
    if (pig) return pig;
    // 有羊/变压器等正分牌时,领自己"最大牌最大的花色"去收
    const bySuitMax: Record<string, Card> = {};
    for (const c of asc) bySuitMax[c.suit] = c;   // asc 升序 → 最后写入的是该花色最大
    const suits = Object.keys(bySuitMax);
    if (trickValue >= 0 && heartsLeft > 6) {
      // 试图收红桃:领红桃里自己最大的
      const heart = bySuitMax["HEART"];
      if (heart && heart.rank >= 12) return heart;
    }
    return asc[0];
  }

  const bySuit = (c: Card) => (c.suit === led ? c.rank : -1);
  const bestSoFar = st.trick.plays.reduce((m, p) => Math.max(m, bySuit(p.card)), -1);
  const winning = legal.filter((c) => c.suit === led && c.rank > bestSoFar).sort((a, b) => a.rank - b.rank);
  const last = st.trick.plays.length === 3;
  if (!winning.length) return asc[0];

  // 记牌:我出的这张会不会被更大的压掉?
  const higherUnknown = unknownHigher(st, led, winning[0].rank, seat);
  const willHold = last || higherUnknown === 0;
  if (trickValue > 0) {
    // 正分轮:能保证赢就赢(留有余地时用最小的能赢牌)
    if (willHold) return winning[0];
    if (last) return winning[0];
    return winning[winning.length - 1];
  }
  // 负分轮:能保证**不赢**(打最小的、且外面还有更大的)就出最小;否则出能赢里最小的也不划算 → 出最小
  const dodge = legal.filter((c) => !(c.suit === led && c.rank > bestSoFar));
  if (dodge.length) return dodge.slice().sort((a, b) => a.rank - b.rank)[0];
  return asc[0];
}

export function isZpSpecial(st: ZhupigState, c: Card): boolean { return isSpecialId(st.cfg, c); }
export { CLASSIC_HEARTS };
