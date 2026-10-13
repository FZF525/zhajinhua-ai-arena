// AI 与模拟环境:动作枚举、单视角确定化(determinization)、rollout 与收益评估。
// 这里也是将来接强化学习的现成环境:纯函数、确定性、可克隆、可采样。
import { createRng } from "./rng.ts";
import type { Rng } from "./rng.ts";
import { apply, cloneState } from "./engine.ts";
import { legalActions } from "./validate.ts";
import { isAlive, nextAliveSeat, player } from "./state.ts";
import type { Action, GameState, PlayerState } from "./state.ts";
import type { Card } from "./cards.ts";
import { evaluate, compare as compareHands } from "./evaluator.ts";

export type Policy = (state: GameState, rng: Rng) => Action | null;

/** 用给定手牌算牌力(缺牌时按现有张数比较,仅用于"扔哪张"的快速比较) */
function handValue(cards: readonly Card[]) {
  return evaluate(cards.slice(0, 5));
}

/** 取走 take 后,5 张里最该扔掉的那张(使剩余 4 张 + take 的牌力最高) */
export function bestDiscard(p: PlayerState, take: Card): string {
  let bestGive = p.hand[0].id;
  let bestVal = -1;
  for (const give of p.hand) {
    const rest = p.hand.filter((c) => c.id !== give.id).concat(take);
    const v = evaluate(rest);
    const score = v.tier * 1000 + (v.key[0] ?? 0);
    if (score > bestVal) { bestVal = score; bestGive = give.id; }
  }
  return bestGive;
}

/** 某个待拿走的牌是否值得换(牌力提升则值得) */
export function exchangeGain(st: GameState, p: PlayerState, take: Card | undefined): number {
  if (!take) return -Infinity;
  const cur = handValue(p.hand);
  const after = evaluate(p.hand.filter((c) => c.id !== bestDiscard(p, take)).concat(take));
  return compareHands(after, cur);
}

export interface EnumerateOptions { /** true = 含全部换牌组合(7×5=35),默认只给"每个池牌配最优弃牌" */ broad?: boolean }

/** 当前行动者的全部具体动作(含选哪张牌);供 AI 决策与 MC 评估 */
export function enumerateActions(st: GameState, opts: EnumerateOptions = {}): Action[] {
  const seat = st.turn.seat;
  if (seat === null) return [];
  const p = player(st, seat);
  const legal = legalActions(st);
  const out: Action[] = [];
  const faceUpPool = st.pool.filter((c) => st.poolMeta[c.id].faceUp);
  for (const name of legal) {
    switch (name) {
      case "VIEW_HAND": case "CALL": case "FOLD": case "PASS_BLOCKED": case "DECLINE_INTERCEPT":
        out.push({ type: name as "CALL", seat }); break;
      case "RAISE": {
        const next = st.config.betting.ladder.find((m) => m > st.multiplier);
        if (next !== undefined) out.push({ type: "RAISE", seat, toMultiplier: next });
        break;
      }
      case "COMPARE":
        for (const q of st.players) if (q.seat !== seat && isAlive(q)) out.push({ type: "COMPARE", seat, targetSeat: q.seat });
        break;
      case "EXCHANGE":
        for (const take of faceUpPool) {
          const tm = st.poolMeta[take.id];
          // 与 validateExchange 保持一致:不能立刻换回自己刚放回的牌
          if (!st.config.exchange.allowSelfReclaim && tm.origin === "DISCARDED" && tm.holderHistory[tm.holderHistory.length - 1] === p.id) continue;
          const gives = opts.broad ? p.hand.map((c) => c.id) : [bestDiscard(p, take)];
          for (const g of gives) out.push({ type: "EXCHANGE", seat, takeCardId: take.id, giveCardId: g });
        }
        break;
      case "KICK":
        for (const c of faceUpPool) {
          const m = st.poolMeta[c.id];
          if (!st.config.kick.requireNeverSelected || !m.everSelected) out.push({ type: "KICK", seat, targetCardId: c.id });
        }
        break;
      case "TAKE_BLOCKED": {
        const blk = st.blockades.find((b) => b.kickerSeat === seat && !b.resolvedByKicker);
        if (blk) {
          const card = st.pool.find((c) => c.id === blk.cardId);
          const gives = card ? [bestDiscard(p, card)] : p.hand.map((c) => c.id);
          for (const g of gives) out.push({ type: "TAKE_BLOCKED", seat, giveCardId: g });
        }
        break;
      }
      case "INTERCEPT": {
        const w = st.pendingIntercept;
        const card = w ? st.players[w.fromSeat].hand.find((c) => c.id === w.cardId) : undefined;
        const gives = card ? [bestDiscard(p, card)] : p.hand.map((c) => c.id);
        for (const g of gives) out.push({ type: "INTERCEPT", seat, giveCardId: g });
        break;
      }
    }
  }
  if (out.length === 0) out.push({ type: "FOLD", seat });
  return out;
}

export function cloneForSim(state: GameState, rng: Rng): GameState {
  const c = cloneState(state);
  c.rng = rng;          // 模拟用独立随机源
  return c;
}

/**
 * 单视角确定化:把"该座位看不到的牌"(其他玩家手牌 + 牌堆)重新随机分配。
 * 这是非完全信息博弈里 MC 的标准做法 —— 每个 rollout 采样一种"世界"。
 */
export function determinize(state: GameState, seat: number, rng: Rng): GameState {
  const c = cloneForSim(state, rng);
  const hidden: Card[] = [];
  const handSlots: Array<{ seat: number; count: number }> = [];
  for (const p of c.players) {
    if (p.seat === seat) continue;
    // 已弃牌且按规则亮过牌的,牌面是已知信息 → 不参与重洗(MC 因此能真正"算牌")
    if (state.config.fold.revealToAll && p.folded) continue;
    handSlots.push({ seat: p.seat, count: p.hand.length });
    hidden.push(...p.hand);
  }
  const deckCount = c.deck.length;
  hidden.push(...c.deck);
  rng.shuffle(hidden);
  let i = 0;
  for (const s of handSlots) {
    const p = player(c, s.seat);
    p.hand = hidden.slice(i, i + s.count);
    i += s.count;
  }
  c.deck = hidden.slice(i, i + deckCount);
  return c;
}

/** 用策略把"当前这一局"打完(结算即停,便于取收益);不改动传入的 state */
export function rolloutHand(state: GameState, policy: Policy, rng: Rng, maxSteps = 400): GameState {
  const st = cloneForSim(state, rng);
  const handNo = st.handNo;
  let steps = 0;
  while (st.phase === "BETTING" && st.handNo === handNo && steps++ < maxSteps) {
    const seat = st.turn.seat;
    if (seat === null) break;
    const a = policy(st, rng);
    if (!a) break;
    const res = apply(st, a, { dealNextHand: false });
    if (!res.ok) {
      const fold = apply(st, { type: "FOLD", seat }, { dealNextHand: false });
      if (!fold.ok) break;
    }
  }
  return st;
}

export interface SimResult { mean: number; winRate: number; samples: number }

/**
 * 用 MC 评估"在当前局面下执行某个动作"的价值:
 * 对每个 rollout:确定化 → 执行动作 → 用策略打完本局 → 记录该座位净收益。
 */
export function simulateAction(
  state: GameState, action: Action, seat: number, policy: Policy, rollouts: number, seed: number, maxSteps = 400
): SimResult {
  const before = player(state, seat).points;
  let sum = 0, wins = 0, n = 0;
  for (let i = 0; i < rollouts; i++) {
    const rng = createRng((seed + i * 7919) >>> 0);
    const world = determinize(state, seat, rng);
    if (!apply(world, action, { dealNextHand: false }).ok) continue;
    const done = rolloutHand(world, policy, rng, maxSteps);
    const gain = player(done, seat).points - before;
    sum += gain;
    if (gain > 0) wins++;
    n++;
  }
  return { mean: n ? sum / n : 0, winRate: n ? wins / n : 0, samples: n };
}

/** 露在明面上的信息摘要(供日志/调试) */
export function publicSummary(st: GameState): string {
  return "M=" + st.multiplier + " pot=" + st.pot + " 存活 " + st.players.filter(isAlive).map((p) => p.seat).join(",") +
    " 下一家 " + nextAliveSeat(st, st.turn.seat ?? 0);
}
