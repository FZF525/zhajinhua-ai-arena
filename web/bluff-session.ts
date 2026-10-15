// 唬牌 Web 会话:把纯规则模块包装成「热座 + 视角隔离 + AI 座位」的服务端状态
//
// 设计要点:
//  · 视角隔离:GET /bluff/state?seat=N 只返回 N 号座位该看到的(自己的手牌 + 公开信息)
//  · AI 座位:可为每个座位指定 human / 性格名 / random;AI 由服务端自动推进
//  · 局末展览:局末把牌堆真容 + 谎话账本一起给前端(纯展示 ✓)
//  · 踩过的坑:自适应 agent 必须**每盘新建**(跨盘复用会串数据)
import { BLUFF_BUST_MODES, describeExhibition, isHonestCard, publicView, rankOf, rankText } from "../src/games/bluff/state.ts";
import type { BluffBustMode, BluffState } from "../src/games/bluff/state.ts";
import { legalActions, newBluffGame, startHand, play, challenge } from "../src/games/bluff/rules.ts";
import { BLUFF_PERSONAS, DEFAULT_EXCEL, createAdaptiveAgent, randomDecide } from "../src/games/bluff/ai.ts";
import type { BluffAction } from "../src/games/bluff/legal.ts";
import { createRng } from "../src/rng.ts";

export type SeatKind = "human" | "random" | keyof typeof BLUFF_PERSONAS;

/** 座位类型白名单(前端传来的东西一律过滤) */
const KINDS: string[] = ["human", "random", ...Object.keys(BLUFF_PERSONAS)];
export function parseSeatKinds(raw: unknown): SeatKind[] {
  const arr = Array.isArray(raw) ? raw : [];
  const out: SeatKind[] = [];
  for (let i = 0; i < 4; i++) {
    const v = String(arr[i] ?? "human");
    out.push(KINDS.includes(v) ? (v as SeatKind) : "human");
  }
  return out;
}

export interface BluffSession {
  state: BluffState;
  kinds: SeatKind[];
  agents: Array<ReturnType<typeof createAdaptiveAgent>>;
  rng: ReturnType<typeof createRng>;
}

export function createBluffSession(bust: BluffBustMode, kinds: SeatKind[], seed?: number): BluffSession {
  const cfg = { players: 4, handSize: 26, maxPlay: 5, bustCards: BLUFF_BUST_MODES[bust], rate: 1, handsPerMatch: 4 };
  const names = ["你", "左边", "对面", "右边"];
  const s = Math.floor((seed ?? Date.now()) % 100000);
  const state = newBluffGame(cfg, names, s);
  const agents = [0, 1, 2, 3].map((seat) => createAdaptiveAgent(kinds[seat] !== "human" && kinds[seat] !== "random" ? BLUFF_PERSONAS[kinds[seat] as keyof typeof BLUFF_PERSONAS] : DEFAULT_EXCEL));
  return { state, kinds, agents, rng: createRng(s * 7 + 1) };
}

export interface BluffSeatView {
  handNo: number;
  matchNo: number;
  turn: number;
  you: number;
  wildText: string;
  roundText: string;
  wildRank: number;
  roundRank: number;
  pileCount: number;
  pending: { seat: number; count: number } | null;
  seats: Array<{ seat: number; name: string; cards: number; points: number; kind: SeatKind }>;
  hand: Array<{ id: string; text: string; honest: boolean; suit: string }>;
  legal: { canChallenge: boolean; maxPlay: number };
  handOver: boolean;
  over: boolean;
  winnerSeat: number | null;
  bustedSeat: number | null;
  lastScores: number[];
  exhibition: { text: string; lines: string[] } | null;
  log: string[];
}

/** 某个座位看到的世界(视角隔离:只给自己的手牌) */
export function bluffSeatView(s: BluffSession, seat: number): BluffSeatView {
  const st = s.state;
  const cardTextOf = (c: { id: string }) => {
    const parts = c.id.split("-");
    return parts.slice(1).join("-") + parts[0].slice(0, 1);
  };
  const acts = legalActions(st);
  const canChallenge = acts.some((a) => a.type === "CHALLENGE");
  const ex = st.exhibition;
  const lines = ex ? describeExhibition(st).split(String.fromCharCode(10)) : [];
  return {
    handNo: st.handNo,
    matchNo: st.matchNo,
    turn: st.turn,
    you: seat,
    wildText: rankText(st.wildRank),
    roundText: rankText(st.roundRank),
    wildRank: st.wildRank,
    roundRank: st.roundRank,
    pileCount: st.pile.length,
    pending: st.pending ? { seat: st.pending.seat, count: st.pending.cards.length } : null,
    seats: st.seats.map((p) => ({ seat: p.seat, name: p.name, cards: p.hand.length, points: p.points, kind: s.kinds[p.seat] })),
    hand: st.seats[seat].hand.map((c) => ({ id: c.id, text: rankText(rankOf(c)), honest: isHonestCard(c, st.roundRank, st.wildRank), suit: c.id.split("-")[0] })),
    legal: { canChallenge, maxPlay: st.cfg.maxPlay },
    handOver: st.handOver,
    over: st.over,
    winnerSeat: st.winnerSeat,
    bustedSeat: st.bustedSeat,
    lastScores: st.lastScores,
    exhibition: ex ? { text: lines.join(String.fromCharCode(10)), lines } : null,
    log: st.events.slice(-12).map((e) => JSON.stringify(e)),
  };
}

/** 应用一个动作(校验座位与轮次) */
export function bluffApply(s: BluffSession, seat: number, action: BluffAction): { ok: boolean; error?: string } {
  const st = s.state;
  if (st.over) return { ok: false, error: "一盘已经结束" };
  if (st.handOver) {
    if (!st.over) {
      for (const ag of s.agents) ag.observeHand(st);   // 局末展览 → 记账(必须在 startHand 之前)
      startHand(st);
    }
    return { ok: true };
  }
  if (action.seat !== seat) return { ok: false, error: "座位不符" };
  if (seat !== st.turn) return { ok: false, error: "还没轮到你" };
  const r = action.type === "PLAY" ? play(st, seat, action.cardIds) : challenge(st, seat);
  return r.ok ? { ok: true } : { ok: false, error: r.error };
}

/** 让所有 AI 座位自动推进(人类座位停下来等输入) */
export function bluffRunAi(s: BluffSession, maxSteps = 400): number {
  const st = s.state;
  let acted = 0;
  while (acted < maxSteps) {
    if (st.over) break;
    if (st.handOver) {
      if (st.over) break;
      for (const ag of s.agents) ag.observeHand(st);
      startHand(st);
      continue;
    }
    const seat = st.turn;
    if (s.kinds[seat] === "human") break;
    const action = s.kinds[seat] === "random"
      ? randomDecide(st, seat, s.rng)
      : s.agents[seat].decide(st, seat, s.rng);
    const r = action.type === "PLAY" ? play(st, action.seat, action.cardIds) : challenge(st, action.seat);
    if (!r.ok) break;
    acted++;
  }
  return acted;
}