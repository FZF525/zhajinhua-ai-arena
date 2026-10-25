// 八门拱猪·星月版 —— 出牌引擎(作者给的规则完整:104 张 4 人均分、♦3 先出、跟花色、贴牌算最后)
import { createDeck } from "../../cards.ts";
import type { Card } from "../../cards.ts";
import { createRng } from "../../rng.ts";
import type { ZhupigConfig, ZhupigState, ZpPlay } from "./state.ts";

export function isSpecialId(cfg: ZhupigConfig, card: Card): boolean {
  const sp = cfg.specials;
  const ids = [sp.pig.id, sp.sheep.id, sp.transformer.id, sp.water9.id, sp.star8.id, sp.moon8.id, ...sp.snow.map((s) => s.id)];
  return ids.includes(card.id) || card.suit === "HEART";
}

/** 只有配置里的"门主/亮出有效果"的牌可以亮 */
export function isRevealable(cfg: ZhupigConfig, card: Card): boolean {
  return cfg.specials.revealable.includes(card.id);
}

export function dealZhupig(cfg: ZhupigConfig, names: string[], seed = 1): ZhupigState {
  const deck = createDeck();                        // 104 张 = 8 门 × 13
  const rng = createRng(seed);
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  const per = deck.length / cfg.players;             // 26
  const seats = names.slice(0, 4).map((name, seat) => ({
    seat, name,
    hand: deck.slice(seat * per, (seat + 1) * per).slice(),
    pile: [] as ZpPlay[],
  }));
  const leader = seats.find((s) => s.hand.some((c) => c.id === "DIAMOND-3"))?.seat ?? 0;   // ♦3 先手
  return {
    cfg, seats, leader, turn: leader, trickNo: 1, over: false, ledger: [], discard: [],
    shown: seats.map(() => new Set<string>()), started: false,
    trick: { ledSuit: "", plays: [], winner: null }, lastTrick: null,
  };
}

/** 开局亮牌声明:可选地亮出自己手里的特殊牌(亮出后分值变高,但等于公开告诉别人你有) */
export function declareShow(st: ZhupigState, seat: number, cardIds: string[]): { ok: boolean; error?: string } {
  if (st.started) return { ok: false, error: "亮牌必须在开局、第一次出牌之前声明" };
  const hand = st.seats[seat].hand;
  for (const id of cardIds) {
    const c = hand.find((x) => x.id === id);
    if (!c) return { ok: false, error: "手里没有 " + id };
    if (!isRevealable(st.cfg, c)) return { ok: false, error: id + " 不能亮牌 —— 只有 ♥A / SNOW-K / 变压器 / 水滴9 / 星8 / 月8 可以亮" };
  }
  st.shown[seat] = new Set(cardIds);
  return { ok: true };
}

/** 本轮合法牌:有同花色必跟,否则任意(规则原文) */
export function legalZhupig(st: ZhupigState, seat: number): Card[] {
  const hand = st.seats[seat].hand;
  if (!st.trick.ledSuit) return hand.slice();
  const same = hand.filter((c) => c.suit === st.trick.ledSuit);
  return same.length ? same : hand.slice();
}

export function playZhupig(st: ZhupigState, seat: number, cardId: string, revealed = false): { ok: boolean; error?: string } {
  if (st.over) return { ok: false, error: "已结束" };
  if (seat !== st.turn) return { ok: false, error: "不是你的回合" };
  const card = st.seats[seat].hand.find((c) => c.id === cardId);
  if (!card) return { ok: false, error: "手里没有这张牌" };
  if (!legalZhupig(st, seat).some((c) => c.id === cardId)) return { ok: false, error: "有同花色必须跟花色" };
  if (!st.trick.ledSuit) st.trick.ledSuit = card.suit;
  st.seats[seat].hand = st.seats[seat].hand.filter((c) => c.id !== cardId);
  st.started = true;
  // 亮牌状态由**开局声明**决定(不是出牌时临时选)
  st.trick.plays.push({ seat, card, revealed: st.shown?.[seat]?.has(card.id) ?? false });
  if (st.trick.plays.length === 4) finishTrick(st);
  else st.turn = (st.turn + 1) % st.cfg.players;
  return { ok: true };
}

/** 一轮结束:牌权归**所跟花色中点数最大者**;贴牌(异花色)一律算最后,不能赢 */
function finishTrick(st: ZhupigState): void {
  const suit = st.trick.ledSuit;
  let best = st.trick.plays[0];
  for (const p of st.trick.plays) {
    const pf = p.card.suit === suit, bf = best.card.suit === suit;
    if (pf && !bf) best = p;
    else if (pf && bf && p.card.rank > best.card.rank) best = p;
  }
  st.lastTrick = { ledSuit: suit, plays: st.trick.plays.slice(), winner: best.seat };
  const winnerPile = st.seats[best.seat].pile;
  for (const p of st.trick.plays) {
    if (isSpecialId(st.cfg, p.card)) winnerPile.push(p);
    else st.discard.push(p.card);
  }
  st.ledger.push("第 " + st.trickNo + " 轮:" + suit + " 最大者 " + st.seats[best.seat].name + " 收牌");
  st.leader = best.seat; st.turn = best.seat;
  st.trick = { ledSuit: "", plays: [], winner: null };
  st.trickNo += 1;
  if (st.seats.every((s) => s.hand.length === 0)) st.over = true;
}

/** 不变量:手牌 + 收牌堆 + 弃牌 = 104,无重复 */
export function checkZhupigInvariants(st: ZhupigState): string[] {
  const errs: string[] = [];
  const ids = new Set<string>();
  const all = [...st.seats.flatMap((s) => s.hand), ...st.seats.flatMap((s) => s.pile.map((p) => p.card)), ...st.discard];
  for (const c of all) { if (ids.has(c.id)) errs.push("重复牌 " + c.id); ids.add(c.id); }
  if (all.length !== 104) errs.push("牌数不对:" + all.length + "/104");
  return errs;
}
