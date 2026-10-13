import test from "node:test";
import assert from "node:assert/strict";
import { cardsFromIds, createDeck } from "../src/cards.ts";
import { createRng } from "../src/rng.ts";
import { evaluate, compare, CATEGORY_LABEL } from "../src/evaluator.ts";
import type { HandCategory } from "../src/evaluator.ts";

const H = (ids: string) => evaluate(cardsFromIds(ids.split(/\s+/)));

function cat(ids: string): HandCategory {
  return H(ids).category;
}

test("H-01 同花顺:同花色 + 连续 (tier 12)", () => {
  const v = H("HEART-10 HEART-J HEART-Q HEART-K HEART-A");
  assert.equal(v.category, "STRAIGHT_FLUSH");
  assert.equal(v.tier, 12);
  assert.equal(v.isRoyalFlush, true);
  assert.deepEqual(v.key, [14]);
});

test("H-02 皇家同花顺标记 / 非 A 高不算", () => {
  assert.equal(H("SNOW-9 SNOW-10 SNOW-J SNOW-Q SNOW-K").isRoyalFlush, false);
  assert.equal(H("SNOW-10 SNOW-J SNOW-Q SNOW-K SNOW-A").isRoyalFlush, true);
});

test("H-03 五条 (tier 11),必须跨 5 个花色", () => {
  const v = H("HEART-7 DIAMOND-7 SPADE-7 CLUB-7 SNOW-7");
  assert.equal(v.category, "FIVE_OF_A_KIND");
  assert.equal(v.tier, 11);
  assert.deepEqual(v.key, [7]);
});

test("H-04 同色顺:同色系 + 连续但非同花色 (tier 10)", () => {
  const v = H("HEART-5 DIAMOND-6 HEART-7 DIAMOND-8 HEART-9");
  assert.equal(v.category, "SAME_COLOR_STRAIGHT");
  assert.equal(v.tier, 10);
  assert.deepEqual(v.key, [9]);
});

test("H-05 同花:同花色、不连续 (tier 9);必须与同色区分", () => {
  const suitFlush = H("HEART-2 HEART-5 HEART-9 HEART-J HEART-K");
  assert.equal(suitFlush.category, "FLUSH");
  assert.equal(suitFlush.tier, 9);
  // 同一色系但花色不同 → 同色,不是同花
  const color = H("HEART-2 DIAMOND-5 HEART-9 DIAMOND-J HEART-K");
  assert.equal(color.category, "SAME_COLOR");
  assert.equal(color.tier, 6);
  assert.equal(compare(suitFlush, color), 1);
});

test("H-06 四条 (tier 8) 与踢脚比较", () => {
  const strong = H("HEART-9 DIAMOND-9 SPADE-9 CLUB-9 HEART-A");
  const weak = H("HEART-9 DIAMOND-9 SPADE-9 CLUB-9 HEART-2");
  assert.equal(strong.category, "FOUR_OF_A_KIND");
  assert.equal(strong.tier, 8);
  assert.deepEqual(strong.key, [9, 14]);
  assert.equal(compare(strong, weak), 1);
});

test("H-07 葫芦 (tier 7):三条在前、对子在后", () => {
  const v = H("HEART-K DIAMOND-K SPADE-K HEART-7 CLUB-7");
  assert.equal(v.category, "FULL_HOUSE");
  assert.equal(v.tier, 7);
  assert.deepEqual(v.key, [13, 7]);
  assert.equal(compare(v, H("HEART-Q DIAMOND-Q SPADE-Q HEART-A CLUB-A")), 1);
});

test("H-08 同色 (tier 6):同色系、非同花色、非连续", () => {
  const v = H("SNOW-2 SNOW-9 SNOW-J SNOW-K DROPLET-7");
  assert.equal(v.category, "SAME_COLOR");
  assert.deepEqual(v.key, [13, 11, 9, 7, 2]);
});

test("H-09 顺子 (tier 5):连续但非同色系", () => {
  const v = H("HEART-5 SPADE-6 DIAMOND-7 CLUB-8 HEART-9");
  assert.equal(v.category, "STRAIGHT");
  assert.deepEqual(v.key, [9]);
});

test("H-10/H-11/H-12/H-13 三条 / 两对 / 一对 / 高牌", () => {
  const trips = H("HEART-4 DIAMOND-4 SPADE-4 HEART-K CLUB-Q");
  assert.equal(trips.category, "THREE_OF_A_KIND");
  assert.deepEqual(trips.key, [4, 13, 12]);

  const twoPair = H("HEART-9 DIAMOND-9 SPADE-5 CLUB-5 HEART-A");
  assert.equal(twoPair.category, "TWO_PAIR");
  assert.deepEqual(twoPair.key, [9, 5, 14]);

  const onePair = H("HEART-9 DIAMOND-9 SPADE-5 CLUB-7 HEART-A");
  assert.equal(onePair.category, "ONE_PAIR");
  assert.deepEqual(onePair.key, [9, 14, 7, 5]);

  const high = H("HEART-A SPADE-K DIAMOND-9 CLUB-5 HEART-2");
  assert.equal(high.category, "HIGH_CARD");
  assert.deepEqual(high.key, [14, 13, 9, 5, 2]);
});

test("H-14 A 低顺 = key 5;K-A-2-3-4 不是顺子", () => {
  const wheel = H("HEART-A HEART-2 SPADE-3 DIAMOND-4 CLUB-5");
  assert.equal(wheel.category, "STRAIGHT");
  assert.deepEqual(wheel.key, [5]);
  assert.equal(H("HEART-K HEART-A SPADE-2 DIAMOND-3 CLUB-4").category, "HIGH_CARD");
});

test("H-15 优先级:同花色 + 连续 → 同花顺,不得判成同花", () => {
  assert.equal(cat("MOON-3 MOON-4 MOON-5 MOON-6 MOON-7"), "STRAIGHT_FLUSH");
});

test("H-16 优先级:同色系 + 连续 + 非同花色 → 同色顺,不得判成同色", () => {
  assert.equal(cat("STAR-3 MOON-4 STAR-5 MOON-6 STAR-7"), "SAME_COLOR_STRAIGHT");
});

test("H-17/H-18/H-19 色系提升:两对 / 一对 / 高牌型落在同一色系 → 同色", () => {
  assert.equal(cat("HEART-5 DIAMOND-5 HEART-9 DIAMOND-9 HEART-3"), "SAME_COLOR");
  assert.equal(cat("HEART-5 DIAMOND-5 HEART-9 DIAMOND-J HEART-3"), "SAME_COLOR");
  assert.equal(cat("HEART-2 DIAMOND-5 HEART-9 DIAMOND-J HEART-K"), "SAME_COLOR");
});

test("H-14b 钢轮 A2345 同花色 → 同花顺", () => {
  const v = H("STAR-A STAR-2 STAR-3 STAR-4 STAR-5");
  assert.equal(v.category, "STRAIGHT_FLUSH");
  assert.deepEqual(v.key, [5]);
});

test("H-20/H-21 非法输入抛错", () => {
  assert.throws(() => evaluate(cardsFromIds(["HEART-A HEART-K HEART-Q HEART-J".split(" ")[0]])), /恰好 5 张/);
  assert.throws(() => evaluate(cardsFromIds(["HEART-A", "HEART-A", "SPADE-K", "CLUB-Q", "SNOW-J"])), /重复卡牌/);
});

test("H-22 比较器反对称性与传递性(随机对拍)", () => {
  const pool = createDeck();
  const rng = createRng(2024);
  const hands: ReturnType<typeof evaluate>[] = [];
  for (let n = 0; n < 300; n++) {
    const idx = rng.shuffle([...pool.keys()]).slice(0, 5);
    hands.push(evaluate(idx.map((i) => pool[i])));
  }
  for (let i = 0; i < hands.length; i++)
    for (let j = i + 1; j < hands.length; j++)
      assert.equal(compare(hands[i], hands[j]) + compare(hands[j], hands[i]), 0);
  for (let a = 0; a < 60; a++)
    for (let b = 0; b < 60; b += 7)
      for (let c = 0; c < 60; c += 11) {
        const ab = compare(hands[a], hands[b]);
        const bc = compare(hands[b], hands[c]);
        if (ab >= 0 && bc >= 0) assert.ok(compare(hands[a], hands[c]) >= 0);
        if (ab <= 0 && bc <= 0) assert.ok(compare(hands[a], hands[c]) <= 0);
      }
});

test("H-23 同 tier 同 key、花色不同 → 平局", () => {
  const a = H("HEART-A SPADE-K DIAMOND-9 CLUB-5 HEART-2");
  const b = H("STAR-A MOON-K SNOW-9 DROPLET-5 CLUB-2");
  assert.equal(compare(a, b), 0);
  assert.equal(a.category, b.category);
});

test("H-27 12 档标签齐全", () => {
  assert.equal(Object.keys(CATEGORY_LABEL).length, 12);
});
