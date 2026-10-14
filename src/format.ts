// 把 GameEvent 渲染成人类可读文本(CLI 与 Web UI 共用)
// 多语言:所有模板来自 src/locales/*(见 docs/glossary.zh-en.md);协议值(牌 id / reason 码)不翻
import type { GameEvent } from "./state.ts";
import { t } from "./i18n.ts";
import type { Locale } from "./i18n.ts";

export interface FormatOptions {
  /** 该查看者看不到的牌 id:出现在日志里就脱敏成 [暗牌],否则等于把暗牌写进日志 */
  hideCardIds?: Set<string>;
  /** 界面语言,默认中文 */
  locale?: Locale;
}

export function describeEvent(e: GameEvent, opts: FormatOptions = {}): string {
  const L = opts.locale ?? "zh";
  const o = e as unknown as Record<string, any>;
  const show = (id: unknown): string => (typeof id === "string" && opts.hideCardIds?.has(id) ? t(L, "card.hidden") : String(id));
  const money = (c: unknown): number => Number((c as { total?: number } | undefined)?.total ?? c ?? 0);
  switch (e.kind) {
    case "HAND_STARTED": return t(L, "event.HAND_STARTED", { handNo: o.handNo, dealerSeat: o.dealerSeat });
    case "ANTE_PAID": return t(L, "event.ANTE_PAID", { seat: o.seat, amount: o.amount });
    case "CARDS_DEALT": return t(L, "event.CARDS_DEALT", { seat: o.seat, count: o.count });
    case "POOL_REVEALED": return t(L, "event.POOL_REVEALED", { count: o.cardIds.length });
    case "HAND_VIEWED": return t(L, "event.HAND_VIEWED", { seat: o.seat });
    case "EXCHANGED": return t(L, "event.EXCHANGED", { seat: o.seat, tookId: o.tookId, gaveId: o.gaveId, cost: money(o.cost) });
    case "INTERCEPTED": return t(L, "event.INTERCEPTED", { seat: o.seat, fromSeat: o.fromSeat, cardId: show(o.cardId), n: o.n, cost: money(o.cost) });
    case "INTERCEPT_DECLINED": return t(L, "event.INTERCEPT_DECLINED", { seat: o.seat, reason: o.reason });
    case "INTERCEPT_UNAVAILABLE": return t(L, "event.INTERCEPT_UNAVAILABLE", { cardId: show(o.cardId), reason: o.reason });
    case "RETAKE_SKIPPED": return t(L, "event.RETAKE_SKIPPED", { seat: o.seat });
    case "KICKED": return t(L, "event.KICKED", { seat: o.seat, removedId: show(o.removedId), drawnId: show(o.drawnId), cost: money(o.cost) });
    case "BLOCKADE_STARTED": return t(L, "event.BLOCKADE_STARTED", { kickerSeat: o.kickerSeat });
    case "BLOCKADE_ENDED": return t(L, o.revealed ? "event.BLOCKADE_ENDED_REVEALED" : "event.BLOCKADE_ENDED", { cardId: show(o.cardId), reason: o.reason });
    case "BLOCKED_TAKEN": return t(L, "event.BLOCKED_TAKEN", { seat: o.seat, cardId: show(o.cardId), cost: money(o.cost) });
    case "BET": return t(L, o.betKind === "RAISE" ? "event.BET_RAISE" : "event.BET_CALL", { seat: o.seat, amount: o.amount, multiplier: o.multiplierAfter });
    case "FOLDED": return t(L, "event.FOLDED", { seat: o.seat, reason: o.reason }) +
      (o.revealed && o.revealed.length ? t(L, "event.FOLDED_REVEAL", { cards: o.revealed.join(" ") }) : "");
    case "COMPARED": return t(L, "event.COMPARED", {
      aSeat: o.aSeat, bSeat: o.bSeat, cost: money(o.cost),
      outcome: o.tie ? t(L, "event.COMPARED_TIE") : t(L, "event.COMPARED_WIN", { winnerSeat: o.winnerSeat }),
    });
    case "TIE_RECORDED": return t(L, "event.TIE_RECORDED", { aSeat: o.aSeat, bSeat: o.bSeat });
    case "ROUND_ENDED": return t(L, "event.ROUND_ENDED", { roundIndex: o.roundIndex, multiplier: o.multiplier });
    case "SHOWDOWN": return t(L, "event.SHOWDOWN", { entries: o.entries.map((x: any) => t(L, "event.SHOWDOWN_ENTRY", { seat: x.seat, category: x.category })).join(" ") });
    case "POT_AWARDED": return t(L, "event.POT_AWARDED", { seat: o.seat, amount: o.amount });
    case "HAND_SETTLED": return t(L, "event.HAND_SETTLED", { pot: o.pot, winners: o.winners.join(","), reason: o.reason });
    case "GAME_OVER": return o.winnerSeat !== undefined
      ? t(L, "event.GAME_OVER_WINNER", { reason: o.reason, winnerSeat: o.winnerSeat })
      : t(L, "event.GAME_OVER_TIE", { reason: o.reason });
    default: return (e as { kind: string }).kind;
  }
}

/** 把事件流压成紧凑的「日志」数组 */
export function describeEvents(events: GameEvent[], opts: FormatOptions = {}): string[] {
  return events.map((e) => describeEvent(e, opts));
}