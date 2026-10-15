// 唬牌事件 → 人话。铁律:**不泄露扣着的牌**(出牌只报张数与宣告点数)
import { rankText } from "./state.ts";
import type { BluffState } from "./state.ts";

type Ev = { kind: string } & Record<string, unknown>;

/** 把一条事件渲染成一句中文(座位名用桌上真名) */
export function describeBluffEvent(e: Ev, names: string[]): string {
  const nm = (s: unknown) => names[Number(s)] ?? ("座位" + String(s));
  switch (e.kind) {
    case "HAND_START":
      return "第 " + e.handNo + " 局开始 · 庄家 " + nm(e.dealer) + " · 本局癞子 " + e.wildText + " ★";
    case "PLAY":
      return nm(e.seat) + " 出了 " + e.count + " 张,报全是 " + e.declaredText;
    case "CHALLENGE": {
      const who = nm(e.by);
      const target = nm(e.against);
      if (e.honest) return who + " 质疑 " + target + ":猜错了 ✗(人家说的是真话)→ " + who + " 吃下 " + e.pot + " 张";
      return who + " 质疑 " + target + ":猜对了 ✓ → " + target + " 收回 " + e.pot + " 张牌堆";
    }
    case "EXHIBITION": {
      const seats = (e.perSeat as Array<{ name: string; lies: number; cards: number }>) ?? [];
      const total = seats.reduce((s, x) => s + x.lies, 0);
      const cards = seats.reduce((s, x) => s + x.cards, 0);
      return "本局展览:牌堆翻开 " + e.pileSize + " 张;全桌共出 " + cards + " 张,其中 " + total + " 张是假话";
    }
    case "HAND_END": {
      const scores = (e.scores as number[]) ?? [];
      const best = scores.indexOf(Math.max(...scores));
      if (e.busted !== null && e.busted !== undefined) return "第 " + e.handNo + " 局结束:" + nm(e.busted) + " 超过爆牌线 ✗ 爆掉了";
      return "第 " + e.handNo + " 局结束:" + nm(e.winnerSeat ?? best) + " 出空手牌,赢下本局 ✓";
    }
    default:
      return e.kind;
  }
}

/** 取最近 n 条,按时间顺序 */
export function describeBluffLog(st: BluffState, names: string[], n = 14): string[] {
  return st.events.slice(-n).map((e) => describeBluffEvent(e as Ev, names));
}
