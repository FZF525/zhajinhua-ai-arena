// 唬牌 Web 会话:把纯规则模块包装成「热座 + 视角隔离 + AI 座位」的服务端状态
//
// 设计要点:
//  · 视角隔离:GET /bluff/state?seat=N 只返回 N 号座位该看到的(自己的手牌 + 公开信息)
//  · AI 座位:可为每个座位指定 human / 性格名 / random;AI 由服务端自动推进
//  · 局末展览:局末把牌堆真容 + 谎话账本一起给前端(纯展示 ✓)
//  · 踩过的坑:自适应 agent 必须**每盘新建**(跨盘复用会串数据)
import { cardText } from "../src/cards.ts";
import { BLUFF_BUST_MODES, describeExhibition, isHonestCard, publicView, rankOf, rankText } from "../src/games/bluff/state.ts";
import type { BluffBustMode, BluffState } from "../src/games/bluff/state.ts";
import { legalActions, newBluffGame, startHand, play, challenge } from "../src/games/bluff/rules.ts";
import { BLUFF_PERSONAS, DEFAULT_EXCEL, createAdaptiveAgent, createEvolvingAgent, randomDecide } from "../src/games/bluff/ai.ts";
import { makeBluffLlmAgent } from "../src/games/bluff/llm.ts";
import type { BluffAction } from "../src/games/bluff/legal.ts";
import { describeBluffLog } from "../src/games/bluff/format.ts";
import { createRng } from "../src/rng.ts";
import { createDeck } from "../src/cards.ts";

/** 用整副牌查出每张牌的完整信息(花色 emoji / 色系) */
const deckById = new Map(createDeck().map((c) => [c.id, c]));

export type SeatKind = "human" | "random" | "Lynn" | keyof typeof BLUFF_PERSONAS | "llm:glm" | "llm:ds";

/** 座位类型白名单(前端传来的东西一律过滤) */
const KINDS: string[] = ["human", "random", "Lynn", ...Object.keys(BLUFF_PERSONAS), "llm:glm", "llm:ds"];
/** 解析座位类型;未知值**不静默降级**(会被前端当成"点了没反应"),而是报出来 */
export function parseSeatKinds(raw: unknown): { kinds: SeatKind[]; bad: string[] } {
  const arr = Array.isArray(raw) ? raw : [];
  const kinds: SeatKind[] = [];
  const bad: string[] = [];
  for (let i = 0; i < 4; i++) {
    const v = String(arr[i] ?? "human");
    if (KINDS.includes(v)) kinds.push(v as SeatKind);
    else { bad.push(v); kinds.push("human"); }
  }
  return { kinds, bad };
}

export interface BluffSession {
  state: BluffState;
  kinds: SeatKind[];
  agents: Array<ReturnType<typeof createAdaptiveAgent> | ReturnType<typeof createEvolvingAgent>>;
  /** LLM 座位(用到了才创建,不浪费一次调用) */
  llm: Array<ReturnType<typeof makeBluffLlmAgent> | null>;
  rng: ReturnType<typeof createRng>;
}

export function createBluffSession(bust: BluffBustMode, kinds: SeatKind[], seed?: number, drawMode: "one" | "choose3" = "one"): BluffSession {
  const cfg = { players: 4, handSize: 26, maxPlay: 5, bustCards: BLUFF_BUST_MODES[bust], rate: 1, handsPerMatch: 4, drawMode };
  const names = ["你", "左边", "对面", "右边"];
  const s = Math.floor((seed ?? Date.now()) % 100000);
  const state = newBluffGame(cfg, names, s);
  const agents = [0, 1, 2, 3].map((seat) =>
    kinds[seat] === "Lynn"
      ? createEvolvingAgent(seat + 3)
      : createAdaptiveAgent(kinds[seat] !== "human" && kinds[seat] !== "random" && BLUFF_PERSONAS[kinds[seat] as keyof typeof BLUFF_PERSONAS] ? BLUFF_PERSONAS[kinds[seat] as keyof typeof BLUFF_PERSONAS] : DEFAULT_EXCEL));
  return { state, kinds, agents, llm: [null, null, null, null], rng: createRng(s * 7 + 1) };
}

export interface BluffSeatView {
  handNo: number;
  matchNo: number;
  turn: number;
  you: number;
  wildText: string;
  roundText: string;
  candidates: Array<{ rank: number; text: string; mineHonest: number }>;
  drawMode: string;
  wildRank: number;
  roundRank: number;
  pileCount: number;
  pending: { seat: number; count: number; declaredRank: number; declaredText: string } | null;
  seats: Array<{ seat: number; name: string; cards: number; points: number; kind: SeatKind }>;
  hand: Array<{ id: string; text: string; honest: boolean; suit: string; family: string }>;
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
    candidates: (st.candidates.length ? st.candidates : [st.roundRank]).map((r) => ({ rank: r, text: rankText(r), mineHonest: st.seats[seat].hand.filter((c) => isHonestCard(c, r, st.wildRank)).length })),
    drawMode: st.cfg.drawMode ?? "one",
    wildRank: st.wildRank,
    roundRank: st.roundRank,
    pileCount: st.pile.length,
    pending: st.pending ? { seat: st.pending.seat, count: st.pending.cards.length, declaredRank: st.pending.declaredRank, declaredText: rankText(st.pending.declaredRank) } : null,
    seats: st.seats.map((p) => ({ seat: p.seat, name: p.name, cards: p.hand.length, points: p.points, kind: s.kinds[p.seat] })),
    // 牌面 = 和炸金花完全同一套(cards.ts 的 cardText:emoji 花色 + 点数)
    hand: st.seats[seat].hand.map((c) => { const full = deckById.get(c.id)!; return { id: c.id, text: cardText(full), honest: isHonestCard(c, st.roundRank, st.wildRank), suit: full.suit, family: full.family }; }),
    legal: { canChallenge, maxPlay: st.cfg.maxPlay },
    handOver: st.handOver,
    over: st.over,
    winnerSeat: st.winnerSeat,
    bustedSeat: st.bustedSeat,
    lastScores: st.lastScores,
    exhibition: ex ? { text: lines.join(String.fromCharCode(10)), lines } : null,
    log: describeBluffLog(st, st.seats.map((p) => p.name), 16),
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
  if (seat !== st.turn) return { ok: false, error: "还没轮到你:现在轮到座位 " + st.turn + "(" + st.seats[st.turn].name + ")" };
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
/** 异步推进:LLM 座位需要网络调用,所以单独一条路径(sync 版留给 CLI 与测试) */
export async function bluffRunAiAsync(s: BluffSession, maxSteps = 200): Promise<number> {
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
    const kind = s.kinds[seat];
    if (kind === "human") break;
    let action: BluffAction;
    if (kind === "llm:glm" || kind === "llm:ds") {
      const provider = kind.slice(4) as "glm" | "ds";
      s.llm[seat] = s.llm[seat] ?? makeBluffLlmAgent(provider, s.agents[seat]);
      action = await s.llm[seat]!.decide(st, seat);
    } else if (kind === "random") {
      action = randomDecide(st, seat, s.rng);
    } else {
      action = s.agents[seat].decide(st, seat, s.rng);
    }
    const r = action.type === "PLAY" ? play(st, action.seat, action.cardIds) : challenge(st, action.seat);
    if (!r.ok) break;
    acted++;
  }
  return acted;
}
/** 只推进一步(给前端做「看得清」的节奏):返回是否有人行动 + 是否轮到人类了 */
export async function bluffRunAiOne(s: BluffSession): Promise<{ acted: boolean; waitingHuman: boolean; handEnded: boolean }> {
  const st = s.state;
  if (st.over) return { acted: false, waitingHuman: false, handEnded: true };
  if (st.handOver) {
    for (const ag of s.agents) ag.observeHand(st);
    startHand(st);
    return { acted: true, waitingHuman: s.kinds[st.turn] === "human", handEnded: false };
  }
  const seat = st.turn;
  const kind = s.kinds[seat];
  if (kind === "human") return { acted: false, waitingHuman: true, handEnded: false };
  let action: BluffAction;
  if (kind === "llm:glm" || kind === "llm:ds") {
    const provider = kind.slice(4) as "glm" | "ds";
    s.llm[seat] = s.llm[seat] ?? makeBluffLlmAgent(provider, s.agents[seat]);
    action = await s.llm[seat]!.decide(st, seat);
  } else if (kind === "random") {
    action = randomDecide(st, seat, s.rng);
  } else {
    action = s.agents[seat].decide(st, seat, s.rng);
  }
  const r = action.type === "PLAY" ? play(st, action.seat, action.cardIds) : challenge(st, action.seat);
  if (!r.ok) return { acted: false, waitingHuman: false, handEnded: st.handOver };
  return { acted: true, waitingHuman: s.kinds[st.turn] === "human", handEnded: st.handOver };
}
/** 一盘结束时把得分告诉自进化的 Lynn(它据此保留/回退自己的参数变异)*/
function notifyMatchEnd(s: BluffSession): void {
  s.state.seats.forEach((p, seat) => {
    const ag = s.agents[seat] as { endMatch?: (score: number) => void };
    if (typeof ag.endMatch === "function") ag.endMatch(p.points);
  });
}