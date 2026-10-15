// 唬牌事件 → 人话 的测试(重点:不能泄露扣着的牌)
import test from "node:test";
import assert from "node:assert/strict";
import { describeBluffEvent, describeBluffLog } from "../src/games/bluff/format.ts";
import { BLUFF_BUST_MODES } from "../src/games/bluff/state.ts";
import { newBluffGame, play, challenge } from "../src/games/bluff/rules.ts";

const CFG = { players: 4, handSize: 26, maxPlay: 5, bustCards: BLUFF_BUST_MODES.tight, rate: 1, handsPerMatch: 4 };
const NAMES = ["Lao6", "Bajiao", "Nizi", "Nannan"];

test("BLUFF-FMT-01 出牌/质疑/开局/展览/结束 都能渲染成人话", () => {
  const names = NAMES;
  assert.equal(describeBluffEvent({ kind: "PLAY", seat: 1, count: 3, declaredText: "7" }, names), "Bajiao 出了 3 张,报全是 7");
  assert.equal(describeBluffEvent({ kind: "CHALLENGE", by: 2, against: 1, honest: false, pot: 12 }, names), "Nizi 质疑 Bajiao:猜对了 ✓ → Bajiao 收回 12 张牌堆");
  assert.equal(describeBluffEvent({ kind: "CHALLENGE", by: 2, against: 1, honest: true, pot: 9 }, names), "Nizi 质疑 Bajiao:猜错了 ✗(人家说的是真话)→ Nizi 吃下 9 张");
  assert.ok(describeBluffEvent({ kind: "HAND_START", handNo: 2, dealer: 0, wildText: "9" }, names).includes("癞子 9"));
  assert.ok(describeBluffEvent({ kind: "EXHIBITION", pileSize: 43, perSeat: [{ name: "Lao6", lies: 5, cards: 30 }] }, names).includes("43"));
  assert.ok(describeBluffEvent({ kind: "HAND_END", handNo: 2, winnerSeat: 3, busted: null, scores: [1, 2, 3, 4] }, names).includes("Nannan"));
  assert.ok(describeBluffEvent({ kind: "HAND_END", handNo: 2, winnerSeat: null, busted: 2, scores: [1, 2, 3, 4] }, names).includes("爆掉"));
});

test("BLUFF-FMT-02 铁律:日志绝不泄露扣着的牌是哪几张", () => {
  const st = newBluffGame(CFG, NAMES, 9);
  const seat = st.turn;
  const ids = st.seats[seat].hand.slice(0, 3).map((c) => c.id);
  const ranks = st.seats[seat].hand.slice(0, 3).map((c) => String(c.id.split("-")[1]));
  play(st, seat, ids);
  const log = describeBluffLog(st, NAMES, 20).join(" | ");
  // 只允许出现"张数"和"宣告的点数",不允许出现任何被扣牌的 id 或点数
  for (const id of ids) assert.ok(!log.includes(id), "日志里出现了被扣住的牌 id: " + id + " → " + log);
  for (const r of ranks) {
    // 允许出现宣告点数(本回合点数),但不允许出现"某张牌是 X"这类信息
    const leak = log.split("报全是 ").slice(1).some((seg) => seg.startsWith(r) === false && seg.slice(0, 6).includes(r));
    assert.equal(leak, false, "疑似泄露被扣牌的点数 " + r + " → " + log);
  }
  assert.ok(log.includes("出了 3 张"), "应当报张数: " + log);
});
