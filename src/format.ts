// 把 GameEvent 渲染成人类可读文本(CLI 与 Web UI 共用)
import type { GameEvent } from "./state.ts";

export function describeEvent(e: GameEvent): string {
  const o = e as unknown as Record<string, any>;
  switch (e.kind) {
    case "HAND_STARTED": return "第 " + o.handNo + " 局开始(庄家位 座位" + o.dealerSeat + ")";
    case "ANTE_PAID": return "座位" + o.seat + " 交底注 " + o.amount;
    case "CARDS_DEALT": return "座位" + o.seat + " 发 " + o.count + " 张暗牌";
    case "POOL_REVEALED": return "公共池翻出 " + o.cardIds.length + " 张明牌";
    case "HAND_VIEWED": return "座位" + o.seat + " 看牌(失去闷牌)";
    case "EXCHANGED": return "座位" + o.seat + " 换牌: 换入 " + o.tookId + " / 放回 " + o.gaveId + ", 花费 " + o.cost.total;
    case "INTERCEPTED": return "座位" + o.seat + " 截胡座位" + o.fromSeat + " 的 " + o.cardId + " (n=" + o.n + "), 花费 " + o.cost.total;
    case "INTERCEPT_DECLINED": return "座位" + o.seat + " 放弃截胡(" + o.reason + ")";
    case "INTERCEPT_UNAVAILABLE": return "截胡窗口关闭: " + o.cardId + " —— " + o.reason;
    case "RETAKE_SKIPPED": return "座位" + o.seat + " 放弃补换, 收下放回的牌";
    case "KICKED": return "座位" + o.seat + " 踢掉 " + o.removedId + ", 补入暗牌 " + o.drawnId + ", 花费 " + o.cost.total;
    case "BLOCKADE_STARTED": return "封锁轮开始(踢牌者 座位" + o.kickerSeat + ")";
    case "BLOCKADE_ENDED": return "封锁轮结束 " + o.cardId + " (" + o.reason + (o.revealed ? ", 已公开" : "") + ")";
    case "BLOCKED_TAKEN": return "座位" + o.seat + " 换走暗牌 " + o.cardId + ", 花费 " + o.cost.total + " → 失去闷牌";
    case "BET": return "座位" + o.seat + " " + (o.betKind === "RAISE" ? "加注到 M=" + o.multiplierAfter : "跟注") + " " + o.amount + " 分";
    case "FOLDED": return "座位" + o.seat + " 弃牌(" + o.reason + ")" +
      (o.revealed && o.revealed.length ? ",亮牌 " + o.revealed.join(" ") : "");
    case "COMPARED": return "比牌 座位" + o.aSeat + " vs 座位" + o.bSeat + " → " + (o.tie ? "平局, 双方继续" : "座位" + o.winnerSeat + " 胜") + ", 花费 " + o.cost.total;
    case "TIE_RECORDED": return "记录平局边 (" + o.aSeat + "," + o.bSeat + ")";
    case "ROUND_ENDED": return "第 " + o.roundIndex + " 个下注轮结束(M=" + o.multiplier + ")";
    case "SHOWDOWN": return "摊牌: " + o.entries.map((x: any) => "座位" + x.seat + "=" + x.category).join(" ");
    case "POT_AWARDED": return "座位" + o.seat + " 获得 " + o.amount + " 分";
    case "HAND_SETTLED": return "本局结算: 底池 " + o.pot + " → 座位" + o.winners.join(",") + " (" + o.reason + ")";
    case "GAME_OVER": return "整场结束: " + o.reason + (o.winnerSeat !== undefined ? " 赢家 座位" + o.winnerSeat : " (平局)");
    default: return (e as { kind: string }).kind;
  }
}

/** 把事件流压成紧凑的"日志"数组 */
export function describeEvents(events: GameEvent[]): string[] {
  return events.map(describeEvent);
}
