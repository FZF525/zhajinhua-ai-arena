// 八门拱猪·星月版 —— 网页会话层(包引擎,不含规则)
import { createRng } from "../src/rng.ts";
import { CLASSIC_ZHUPIG, type ZhupigState, rankLabel } from "../src/games/zhupig/state.ts";
import { SUITS } from "../src/cards.ts";
import { dealZhupig, legalZhupig, playZhupig, declareShow, isSpecialId, isRevealable } from "../src/games/zhupig/rules.ts";
import { scoreZhupig } from "../src/games/zhupig/score.ts";
import { zpAiPlay, zpAiDeclare, type ZpAiKind } from "../src/games/zhupig/ai.ts";

export type ZpPhase = "declare" | "play" | "over";

export interface ZpSession {
  st: ZhupigState;
  human: number;
  seed: number;
  phase: ZpPhase;
  rng: ReturnType<typeof createRng>;
  aiKind: ZpAiKind;
  /** 连局:累计最终分(跨局)*/
  matchTotal: number[];
  /** 第几局(从 1 开始)*/
  matchNo: number;
  /** 每局成绩(供界面显示)*/
  history: Array<{ no: number; finals: number[] }>;
  /** 有人累计 ≤ stopAt 就结束(默认 -8000)*/
  stopAt: number;
  /** 连局是否已结束*/
  matchOver: boolean;
}

const AI_NAMES = ["老六", "芭蕉", "囡囡"];

export function createZpSession(humanSeat = 0, seed = Date.now(), aiKind: ZpAiKind = "greedy", stopAt = -8000): ZpSession {
  const seat = Math.max(0, Math.min(3, humanSeat));
  const names = ["你", "你", "你", "你"];
  names[seat] = "你(你)";
  let ai = 0;
  for (let i = 0; i < 4; i++) if (i !== seat) names[i] = AI_NAMES[ai++ % AI_NAMES.length];
  const st = dealZhupig(CLASSIC_ZHUPIG, names, seed);
  return { st, human: seat, seed, phase: "declare", rng: createRng(seed * 31 + 7), aiKind,
    matchTotal: [0, 0, 0, 0], matchNo: 1, history: [], stopAt, matchOver: false };
}

/** 人类完成亮牌声明 → 开始 */
export function zpDeclareHuman(s: ZpSession, cardIds: string[]): { ok: boolean; error?: string } {
  const r = declareShow(s.st, s.human, cardIds);
  if (!r.ok) return r;
  // AI 各自声明
  for (let i = 0; i < 4; i++) if (i !== s.human) declareShow(s.st, i, zpAiDeclare(s.st, i));
  s.phase = "play";
  return { ok: true };
}

export function zpApply(s: ZpSession, seat: number, cardId: string): { ok: boolean; error?: string } {
  if (s.phase !== "play") return { ok: false, error: "还没开始" };
  const r = playZhupig(s.st, seat, cardId, false);
  if (r.ok && s.st.over && s.phase !== "over") {
    s.phase = "over";
    // 连局结算:把本局最终分累加进去
    const sc = scoreZhupig(s.st);
    const finals = sc.perSeat.map((p) => p.final);
    finals.forEach((v, i) => { s.matchTotal[i] += v; });
    s.history.push({ no: s.matchNo, finals: finals.slice() });
    if (s.matchTotal.some((v) => v <= s.stopAt)) s.matchOver = true;
  }
  return r;
}

/** AI 走一步(亮牌阶段什么都不做;出牌阶段轮到自己就出一张)*/
export function zpRunAiOne(s: ZpSession): boolean {
  if (s.phase !== "play") return false;
  const seat = s.st.turn;
  if (seat === s.human) return false;
  const card = zpAiPlay(s.aiKind, s.st, seat, s.rng, { total: s.matchTotal });
  const r = zpApply(s, seat, card.id);
  if (!r.ok) throw new Error("AI 出牌非法: " + r.error);
  return true;
}

/** 开下一局(保留累计分与座位)*/
export function zpNextHand(s: ZpSession): { ok: boolean; error?: string } {
  if (s.matchOver) return { ok: false, error: "连局已结束(有人到 " + s.stopAt + ")" };
  if (s.phase !== "over") return { ok: false, error: "本局还没打完" };
  s.matchNo += 1;
  s.st = dealZhupig(CLASSIC_ZHUPIG, s.st.seats.map((p) => p.name), s.seed + s.matchNo * 7919);
  s.phase = "declare";
  s.rng = createRng((s.seed + s.matchNo * 104729) ^ 0x5f3759df);
  return { ok: true };
}

/** 每位玩家的可见视图(别人的手牌不可见;牌桌出牌是公开的)*/
export function zpSeatView(s: ZpSession, seat: number) {
  const st = s.st;
  const me = st.seats[seat];
  const score = s.phase === "over" ? scoreZhupig(st) : null;
  const canDeclare = s.phase === "declare" && seat === s.human;
  const myTurn = s.phase === "play" && st.turn === seat;
  const legal = myTurn ? legalZhupig(st, seat).map((c) => c.id) : [];
  return {
    phase: s.phase,
    seat,
    human: s.human,
    myTurn,
    canDeclare,
    hand: me.hand.map((c) => cardView(st, c)),
    legalIds: legal,
    declared: [...(st.shown[seat] ?? [])],
    /** 只有这些手牌可以亮(门主 + 自身有亮出效果的牌)*/
    revealableIds: me.hand.filter((c) => isRevealable(st.cfg, c)).map((c) => c.id),
    trick: st.trick.plays.map((p) => ({ seat: p.seat, name: st.seats[p.seat].name, card: cardView(st, p.card) })),
    lastTrick: st.lastTrick ? { winner: st.lastTrick.winner, winnerName: st.seats[st.lastTrick.winner ?? 0].name, plays: st.lastTrick.plays.map((p) => ({ name: st.seats[p.seat].name, card: cardView(st, p.card) })) } : null,
    seats: st.seats.map((p) => ({
      seat: p.seat, name: p.name,
      handCount: p.hand.length,
      pileCount: p.pile.length,
      // 收牌堆是**公开信息**(每轮都明着打):四家都实时展示 ✓
      // 只列特殊牌(计分相关),普通牌只给数量,免得屏幕太长
      pile: p.pile.filter((x) => isSpecialId(st.cfg, x.card)).map((x) => cardView(st, x.card)),
      pileTotal: p.pile.length,
      isHuman: p.seat === s.human,
    })),
    trickNo: st.trickNo,
    turn: st.turn,
    // 连局信息
    match: {
      no: s.matchNo,
      total: s.matchTotal.slice(),
      history: s.history.slice(-10),
      stopAt: s.stopAt,
      over: s.matchOver,
      // 已经有人到线 → 给出最终排名
      ranking: s.matchOver
        ? st.seats.map((p) => ({ seat: p.seat, name: p.name, total: s.matchTotal[p.seat] }))
            .sort((a, b) => b.total - a.total)
        : null,
    },
    over: st.over,
    score: score ? {
      perSeat: score.perSeat.map((p) => ({ seat: p.seat, name: st.seats[p.seat].name, personal: p.personal, final: p.final, full16: p.full16, allRed: p.allRed, invalidated: p.invalidated })),
      ledger: score.ledger,
      ambiguities: score.ambiguities,
    } : null,
  };
}

function cardView(st: ZhupigState, c: { id: string; suit: string; rank: number }) {
  const def = SUITS.find((x) => x.id === c.suit);
  return {
    id: c.id, suit: c.suit, rank: c.rank,
    rankText: rankLabel(c.rank),
    text: (def ? def.symbol : "?") + rankLabel(c.rank),
    family: def ? def.family : "BLACK",
    special: isSpecialId(st.cfg, c as any),
    declared: st.seats.some((p) => (st.shown[p.seat] ?? new Set<string>()).has(c.id)),
  };
}

export const ZP_NAME = "八门拱猪·星月版";
