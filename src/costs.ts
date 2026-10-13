// 费用计算(§8.1 / §8.3):所有费用进底池,不抽水,不允许负分。
import { poolMetaFor, player } from "./state.ts";
import type { CostBreakdown, GameState } from "./state.ts";

export function ownRate(state: GameState, seat: number): number {
  return player(state, seat).blind ? state.config.betting.blindRate : state.config.betting.seenRate;
}

export function anteCost(state: GameState): CostBreakdown {
  const amount = state.config.ante.amount;
  return { action: "ANTE", base: amount, multiplier: 1, extra: 0, total: amount, note: "底注固定 " + amount + " 分(不乘 M)" };
}

export function callCost(state: GameState, seat: number): CostBreakdown {
  const rate = ownRate(state, seat);
  const total = rate * state.multiplier;
  return {
    action: "CALL", base: rate, multiplier: state.multiplier, extra: 0, total,
    note: (player(state, seat).blind ? "闷牌" : "看牌") + " " + rate + " × M(" + state.multiplier + ") = " + total
  };
}

export function raiseCost(state: GameState, seat: number, toMultiplier: number): CostBreakdown {
  const rate = ownRate(state, seat);
  const total = rate * toMultiplier;
  return {
    action: "RAISE", base: rate, multiplier: toMultiplier, extra: 0, total,
    note: (player(state, seat).blind ? "闷牌" : "看牌") + " " + rate + " × 新 M(" + toMultiplier + ") = " + total
  };
}

export function exchangeCostAt(state: GameState, seat: number, index: number): CostBreakdown {
  const fees = state.config.exchange.fees;
  const base = fees[Math.min(index, fees.length - 1)];
  const total = base * state.multiplier;
  return {
    action: "EXCHANGE", base, multiplier: state.multiplier, extra: 0, total,
    note: "第 " + (index + 1) + " 次换牌 " + base + " × M(" + state.multiplier + ") = " + total
  };
}

export function exchangeCost(state: GameState, seat: number): CostBreakdown {
  return exchangeCostAt(state, seat, player(state, seat).exchangeCount);
}

export function kickCost(state: GameState): CostBreakdown {
  const base = state.config.kick.fee;
  const total = base * state.multiplier;
  return { action: "KICK", base, multiplier: state.multiplier, extra: 0, total, note: "踢牌 " + base + " × M(" + state.multiplier + ") = " + total };
}

/** 截胡应付 = 目标牌实际换牌费(快照) + n(n+1) × M */
export function interceptCost(state: GameState, cardId: string, n: number): CostBreakdown {
  const meta = poolMetaFor(state, cardId);
  const extra = n * (n + 1) * state.multiplier;
  const total = meta.swapFeePaid + extra;
  return {
    action: "INTERCEPT", base: meta.swapFeePaid, multiplier: state.multiplier, extra, total,
    note: "原换牌费 " + meta.swapFeePaid + " + n(n+1)M = " + n + "×" + (n + 1) + "×" + state.multiplier + " = " + total
  };
}

export function compareCost(state: GameState, seat: number): CostBreakdown {
  const rate = ownRate(state, seat);
  const base = state.config.compare.costMultiplier * rate;
  const total = base * state.multiplier;
  return {
    action: "COMPARE", base, multiplier: state.multiplier, extra: 0, total,
    note: state.config.compare.costMultiplier + " × " + (player(state, seat).blind ? "闷牌" : "看牌") + " " + rate + " × M(" + state.multiplier + ") = " + total
  };
}

/** 阶梯中当前倍数的下一档;已封顶返回 null */
export function nextLadderValue(state: GameState): number | null {
  const ladder = state.config.betting.ladder;
  const idx = ladder.indexOf(state.multiplier);
  if (idx < 0) return ladder.find((v) => v > state.multiplier) ?? null;
  return idx + 1 < ladder.length ? ladder[idx + 1] : null;
}
