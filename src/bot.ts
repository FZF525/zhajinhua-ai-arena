// 随机决策 bot:仅依赖合法动作与公共信息,可作为接入自定义 AI 的模板。
import { aliveSeats, player } from "./state.ts";
import type { Action, GameState } from "./state.ts";
import { legalActions } from "./validate.ts";
import type { Rng } from "./rng.ts";

export interface IntRng { int(n: number): number }

/** 返回一个合法动作;无动作可做时返回 null */
export function randomBot(st: GameState, rng: IntRng | Rng): Action | null {
  if (st.phase !== "BETTING") return null;
  const pick = <T,>(arr: T[]): T => arr[rng.int(arr.length)];
  const pickable = (seat: number): string[] => {
    const p = player(st, seat);
    return st.pool.filter((c) => {
      const m = st.poolMeta[c.id];
      // 不能立刻换回自己刚放回的牌(ERR_SELF_RECLAIM)
      return m.faceUp && !(m.origin === "DISCARDED" && m.holderHistory[m.holderHistory.length - 1] === p.id);
    }).map((c) => c.id);
  };
  const seat = st.turn.seat!;
  const p = player(st, seat);
  const opts = legalActions(st);
  if (opts.length === 0) return null;
  switch (pick(opts)) {
    case "VIEW_HAND": return { type: "VIEW_HAND", seat };
    case "CALL": return { type: "CALL", seat };
    case "FOLD": return { type: "FOLD", seat };
    case "RAISE": return { type: "RAISE", seat, toMultiplier: st.config.betting.ladder.find((m) => m > st.multiplier)! };
    case "COMPARE": {
      const others = aliveSeats(st).filter((s) => s !== seat);
      if (!others.length) return { type: "FOLD", seat };
      return { type: "COMPARE", seat, targetSeat: pick(others) };
    }
    case "EXCHANGE": {
      const takes = pickable(seat);
      if (!takes.length) return { type: "FOLD", seat };
      return { type: "EXCHANGE", seat, takeCardId: pick(takes), giveCardId: pick(p.hand).id };
    }
    case "KICK": {
      const targets = st.pool.filter((c) => {
        const m = st.poolMeta[c.id];
        return m.faceUp && (!st.config.kick.requireNeverSelected || !m.everSelected);
      });
      if (!targets.length) return { type: "FOLD", seat };
      return { type: "KICK", seat, targetCardId: pick(targets).id };
    }
    case "TAKE_BLOCKED": return { type: "TAKE_BLOCKED", seat, giveCardId: pick(p.hand).id };
    case "INTERCEPT": return { type: "INTERCEPT", seat, giveCardId: pick(p.hand).id };
    case "DECLINE_INTERCEPT": return { type: "DECLINE_INTERCEPT", seat };
    case "PASS_BLOCKED": return { type: "PASS_BLOCKED", seat };
    default: return { type: "FOLD", seat };
  }
}
