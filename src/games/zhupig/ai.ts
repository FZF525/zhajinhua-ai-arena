// 八门拱猪 —— 简单贪心 AI(够玩,不是最优)
// 思路:① 亮牌只亮"亮出会更好"的(雪花/变压器),绝不亮猪、刀刃、水滴
//       ② 出牌:算这一轮里特殊牌的净值;正分就想赢、负分就想躲
import type { Card } from "../../cards.ts";
import type { ZhupigState } from "./state.ts";
import { CLASSIC_HEARTS } from "./state.ts";
import { legalZhupig, isSpecialId } from "./rules.ts";
import type { Rng } from "../../rng.ts";

/** 单张牌对"收牌人"的大致价值(用于决定抢还是躲)*/
export function zpCardValue(st: ZhupigState, c: Card): number {
  const sp = st.cfg.specials;
  if (c.id === sp.pig.id) return sp.pig.value;          // -100
  if (c.id === sp.sheep.id) return sp.sheep.value;      // +100
  if (sp.snow.some((s) => s.id === c.id)) {
    const def = sp.snow.find((s) => s.id === c.id)!;
    return def.value;
  }
  if (c.suit === "HEART") return st.cfg.specials.hearts[c.rank] ?? 0;
  if (c.id === sp.transformer.id) return 50;            // 无红桃时给 +50,有红桃翻倍
  if (c.id === sp.water9.id) return -50;                // 减半/ -50
  if (c.id === sp.star8.id || c.id === sp.moon8.id) return -25;
  return 0;
}

/** 开局亮牌:只亮雪花(正分翻倍);从不亮猪/刀刃/水滴(亮出只会更糟)*/
export function zpAiDeclare(st: ZhupigState, seat: number): string[] {
  const sp = st.cfg.specials;
  return st.seats[seat].hand
    .filter((c) => sp.snow.some((s) => s.id === c.id))
    .map((c) => c.id);
}

/** 出牌:能赢就抢正分轮,负分轮就躲 */
export function zpAiChoose(st: ZhupigState, seat: number, rng: Rng): Card {
  const legal = legalZhupig(st, seat);
  const led = st.trick.ledSuit;
  const trickValue = st.trick.plays.reduce((a, p) => a + zpCardValue(st, p.card), 0);
  const bySuit = (c: Card) => (c.suit === led ? c.rank : -1);
  const bestSoFar = st.trick.plays.reduce((m, p) => Math.max(m, bySuit(p.card)), -1);

  // 我在领出:倾向打自己最大的牌(最容易收下这一轮)
  if (!led) {
    const sorted = legal.slice().sort((a, b) => b.rank - a.rank);
    // 手里有正分特殊牌且这轮还没开始 → 打最大的,争取收牌
    return trickValue >= 0 ? sorted[0] : sorted[sorted.length - 1];
  }

  const winning = legal.filter((c) => c.suit === led && c.rank > bestSoFar).sort((a, b) => a.rank - b.rank);
  const followers = legal.filter((c) => !(c.suit === led && c.rank > bestSoFar));
  const hasLastWord = st.trick.plays.length === 3;   // 我是最后一家 → 能确定赢

  if (trickValue > 0) {
    // 抢:用能赢的**最小**牌(省大牌);最后一家的把握最大
    if (winning.length) return hasLastWord ? winning[0] : winning[winning.length - 1];
    return legal.slice().sort((a, b) => a.rank - b.rank)[0];   // 赢不了就丢最小的
  }
  // 躲:出最小、且尽量不要赢
  const safe = followers.length ? followers : legal;
  return safe.slice().sort((a, b) => a.rank - b.rank)[0];
}

export function isZpSpecial(st: ZhupigState, c: Card): boolean { return isSpecialId(st.cfg, c); }
export { CLASSIC_HEARTS };
