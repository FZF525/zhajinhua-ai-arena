// 唬牌 LLM 座位:prompt / 解析 / 兜底(全部离线,不花一次 API 调用)
import test from "node:test";
import assert from "node:assert/strict";
import { BLUFF_BUST_MODES, createBluffGame } from "../src/games/bluff/state.ts";
import { newBluffGame, play, challenge } from "../src/games/bluff/rules.ts";
import { createAdaptiveAgent } from "../src/games/bluff/ai.ts";
import { BLUFF_SYSTEM, buildBluffPrompt, parseBluffAction, fallbackAction, BLUFF_LLM_PROVIDERS } from "../src/games/bluff/llm.ts";

const CFG = { players: 4, handSize: 26, maxPlay: 5, bustCards: BLUFF_BUST_MODES.tight, rate: 1, handsPerMatch: 4 };
const NAMES = ["Lao6", "Bajiao", "Nizi", "Nannan"];

test("BLUFF-LLM-01 prompt 里要有规则、我的手牌、以及【对手画像】统计", () => {
  const st = newBluffGame(CFG, NAMES, 7);
  const agent = createAdaptiveAgent();
  // 造一点账本:座位 1 报了 4 手 5 张,其中 3 手是假
  for (let i = 0; i < 4; i++) st.claims.push({ seat: 1, handNo: 1, claimedRank: st.roundRank, count: 5, honest: i < 1 ? 5 : 0 });
  agent.observeHand(st);
  // 让座位 1 出牌,制造 pending
  const turn = st.turn;
  while (st.turn !== 1) { const q = st.seats[st.turn]; play(st, st.turn, [q.hand[0].id]); if (st.handOver) break; }
  if (!st.handOver && st.turn === 1) play(st, 1, st.seats[1].hand.slice(0, 5).map((c) => c.id));
  const seat = st.turn;
  const prompt = buildBluffPrompt(st, seat, agent);
  assert.ok(prompt.includes("唬牌") === false, "prompt 本身不含标题(标题在 system 里)");
  assert.ok(prompt.includes("本回合点数 R"), "要有本回合点数");
  assert.ok(prompt.includes("癞子"), "要有癞子");
  assert.ok(prompt.includes("你的手牌"), "要有自己的手牌");
  assert.ok(prompt.includes("牌堆"), "要有牌堆张数");
  if (st.pending && st.pending.seat === 1) {
    assert.ok(prompt.includes("对手画像"), "有上一手时应当给对手画像: " + prompt.slice(0, 200));
    assert.ok(prompt.includes("历史撒谎率"), "画像里要有撒谎率");
  }
  assert.ok(BLUFF_SYSTEM.includes("只输出 JSON"), "system 要约束输出格式");
  assert.ok(BLUFF_SYSTEM.includes("不能靠质疑逃避出手"), "system 要说清循环规则");
  assert.ok(BLUFF_LLM_PROVIDERS.glm.apiKeyEnv === "GLM_API_KEY");
  assert.ok(BLUFF_LLM_PROVIDERS.ds.apiKeyEnv === "DS_API_KEY");
});

test("BLUFF-LLM-02 解析:合法 JSON 通过;混杂文字能救;非法的一律拒绝或修正", () => {
  const st = newBluffGame(CFG, NAMES, 11);
  const seat = st.turn;
  const ids = st.seats[seat].hand.slice(0, 3).map((c) => c.id);
  // 正常
  const a1 = parseBluffAction(JSON.stringify({ action: "PLAY", cards: ids }), st, seat);
  assert.equal(a1?.type, "PLAY");
  assert.deepEqual(a1 && a1.type === "PLAY" ? a1.cardIds : [], ids);
  // 带前后废话(模型常见)
  const a2 = parseBluffAction("好的,我的决定是 " + JSON.stringify({ action: "PLAY", cards: [ids[0]] }) + " 完毕", st, seat);
  assert.equal(a2?.type, "PLAY");
  // 出 6 张 → 截到 5 张(而不是非法)
  const many = st.seats[seat].hand.slice(0, 6).map((c) => c.id);
  const a3 = parseBluffAction(JSON.stringify({ action: "PLAY", cards: many }), st, seat);
  assert.equal(a3?.type, "PLAY");
  assert.equal(a3 && a3.type === "PLAY" ? a3.cardIds.length : -1, 5, "超量应当截断到 maxPlay");
  // 手牌里没有的 id → 被过滤,剩下合法的仍可用
  const a4 = parseBluffAction(JSON.stringify({ action: "PLAY", cards: ["NOT-A-CARD", ids[0]] }), st, seat);
  assert.equal(a4?.type, "PLAY");
  assert.deepEqual(a4 && a4.type === "PLAY" ? a4.cardIds : [], [ids[0]]);
  // 全是假 id → 拒绝(交给兜底)
  assert.equal(parseBluffAction(JSON.stringify({ action: "PLAY", cards: ["X-1"] }), st, seat), null);
  // 没有上一手时的 CHALLENGE → 拒绝
  assert.equal(parseBluffAction(JSON.stringify({ action: "CHALLENGE" }), st, seat), null);
  // 乱码 → 拒绝
  assert.equal(parseBluffAction("我觉得我应该弃牌", st, seat), null);
});

test("BLUFF-LLM-03 兜底动作永远合法(真丢进引擎验证)", () => {
  const st = newBluffGame(CFG, NAMES, 13);
  const seat = st.turn;
  const act = fallbackAction(st, seat);
  assert.equal(act.type, "PLAY");
  const r = play(st, seat, act.type === "PLAY" ? act.cardIds : []);
  assert.equal(r.ok, true, "兜底动作必须被引擎接受: " + r.error);
});
