// H-24 / H-25:12 档分布回归。
// 默认跑固定步长抽样(快);EXHAUSTIVE=1 时穷举全部 C(104,5)=91,962,520 手牌并逐项比对 §3.1 表。
import test from "node:test";
import assert from "node:assert/strict";
import { createDeck } from "../src/cards.ts";
import { evaluate } from "../src/evaluator.ts";
import type { HandCategory } from "../src/evaluator.ts";

const EXPECTED: Array<[HandCategory, number]> = [
  ["STRAIGHT_FLUSH", 80],
  ["FIVE_OF_A_KIND", 728],
  ["SAME_COLOR_STRAIGHT", 1200],
  ["FLUSH", 10216],
  ["FOUR_OF_A_KIND", 87360],
  ["FULL_HOUSE", 244608],
  ["SAME_COLOR", 251624],
  ["STRAIGHT", 326400],
  ["THREE_OF_A_KIND", 3075072],
  ["TWO_PAIR", 5374512],
  ["ONE_PAIR", 40909440],
  ["HIGH_CARD", 41681280]
];
const TOTAL = 91962520;
const CATS = EXPECTED.map(([c]) => c);

function enumerate(stride: number, visit: (cat: HandCategory) => void): void {
  const deck = createDeck();
  const N = deck.length;
  const c: import("../src/cards.ts").Card[] = [deck[0], deck[1], deck[2], deck[3], deck[4]];
  let tick = 0;
  for (let i = 0; i < N - 4; i++) {
    c[0] = deck[i];
    for (let j = i + 1; j < N - 3; j++) {
      c[1] = deck[j];
      for (let k = j + 1; k < N - 2; k++) {
        c[2] = deck[k];
        for (let l = k + 1; l < N - 1; l++) {
          c[3] = deck[l];
          for (let m = l + 1; m < N; m++) {
            c[4] = deck[m];
            if (stride > 1) { if (tick++ % stride !== 0) continue; }
            visit(evaluate(c).category);
          }
        }
      }
    }
  }
}

test("H-25 稀有度单调(抽样校验)", () => {
  const counts = new Map<HandCategory, number>();
  for (const cat of CATS) counts.set(cat, 0);
  let n = 0;
  enumerate(1483, (cat) => { counts.set(cat, (counts.get(cat) ?? 0) + 1); n++; });
  assert.ok(n > 50000, "抽样量过小: " + n);
  for (const [cat, expected] of EXPECTED) {
    const got = counts.get(cat)!;
    const want = (expected / TOTAL) * n;
    const diff = Math.abs(got - want);
    const tol = Math.max(4, want * 0.18);   // 稀有牌型给绝对容差
    assert.ok(diff <= tol, cat + " 抽样占比偏差过大: got=" + got + " want≈" + want.toFixed(1));
  }
});

test("H-24 穷举全部 91,962,520 手牌,逐项等于 §3.1 表", { skip: process.env.EXHAUSTIVE !== "1" }, () => {
  const counts = new Map<HandCategory, number>();
  for (const cat of CATS) counts.set(cat, 0);
  let n = 0;
  const t0 = Date.now();
  enumerate(1, (cat) => { counts.set(cat, (counts.get(cat) ?? 0) + 1); n++; });
  assert.equal(n, TOTAL);
  for (const [cat, expected] of EXPECTED) assert.equal(counts.get(cat), expected, cat);
  assert.equal([...counts.values()].reduce((a, b) => a + b, 0), TOTAL);
  console.log("穷举耗时 " + ((Date.now() - t0) / 1000).toFixed(1) + "s");
});
