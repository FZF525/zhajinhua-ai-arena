// 回放用例:确定性重演 / 逐帧一致 / 与实时对局等价
import test from "node:test";
import assert from "node:assert/strict";
import { makeConfig } from "../src/config.ts";
import { createGame, checkInvariants } from "../src/state.ts";
import { apply, advance } from "../src/engine.ts";
import { createRng } from "../src/rng.ts";
import { makeAgent } from "../src/ai/index.ts";
import { createRecorder, record, replayFrames, replayTo } from "../src/replay.ts";
import type { Action } from "../src/state.ts";

function liveMatch(seed: number) {
  const cfg = { players: { startPoints: 20000 }, endGame: { maxHands: 3, winAtOrAbove: 1e9, bustAtOrBelow: -1, winTakesPriorityOverBust: true } };
  const names = ["Sam", "Lucas", "May"];
  const st = createGame(makeConfig(cfg), names, seed);
  advance(st);
  const rec = createRecorder(seed, names, cfg);
  const agents = names.map(makeAgent);
  const rng = createRng(seed * 13 + 1);
  let steps = 0;
  while (!st.gameOver && steps++ < 800) {
    const seat = st.turn.seat;
    if (seat === null) break;
    const a = agents[seat](st, rng);
    if (!a) break;
    if (!apply(st, a).ok) break;
    record(rec, a);
  }
  return { st, rec };
}

test("RP-01 录制 + 重放:最终状态与实时对局完全一致", () => {
  const { st, rec } = liveMatch(2024);
  assert.ok(rec.actions.length > 20, "应录到足够多的动作: " + rec.actions.length);
  const frames = replayFrames(rec);
  const replayed = frames[frames.length - 1];
  assert.equal(replayed.handNo, st.handNo, "局数一致");
  assert.equal(replayed.phase, st.phase);
  assert.deepEqual(replayed.players.map((p) => p.points), st.players.map((p) => p.points), "积分一致");
  assert.deepEqual(replayed.players.map((p) => p.hand.map((c) => c.id)), st.players.map((p) => p.hand.map((c) => c.id)), "手牌一致");
  assert.deepEqual(replayed.pool.map((c) => c.id), st.pool.map((c) => c.id), "公共池一致");
  assert.equal(replayed.events.length, st.events.length, "事件数一致");
  assert.deepEqual(checkInvariants(replayed), []);
});

test("RP-02 逐帧一致:第 N 帧就是当时的状态(可直接当时间轴用)", () => {
  const { st, rec } = liveMatch(77);
  const frames = replayFrames(rec);
  assert.equal(frames.length, rec.actions.length + 1, "帧数 = 动作数 + 1(含发牌后那一帧)");
  // 抽查中间若干帧:与"从头重放到该步"的结果一致
  for (const step of [1, Math.floor(rec.actions.length / 3), Math.floor(rec.actions.length / 2), rec.actions.length]) {
    const viaReplayTo = replayTo(rec, step);
    assert.equal(viaReplayTo.handNo, frames[step].handNo);
    assert.deepEqual(viaReplayTo.players.map((p) => p.points), frames[step].players.map((p) => p.points));
  }
  assert.equal(frames[frames.length - 1].events.length, st.events.length);
  // 回归:每一帧必须是独立快照(曾经的 bug:全部指向同一个可变对象,时间轴永远显示终局)
  assert.notEqual(frames[0], frames[1]);
  assert.notEqual(frames[0].events.length, frames[frames.length - 1].events.length);
  const f0 = frames[0].players.map((p) => p.points).join(",");
  frames[0].players[0].points = -12345;
  assert.equal(frames[1].players[0].points === -12345, false, "改一帧不能影响别的帧");
  assert.equal(frames[0].players.map((p) => p.points).join(","), "-12345," + f0.split(",").slice(1).join(","));
});

test("RP-03 同种子 + 同动作 = 同结果(可复现)", () => {
  const a = liveMatch(999);
  const b = liveMatch(999);
  assert.deepEqual(a.st.players.map((p) => p.points), b.st.players.map((p) => p.points));
  assert.equal(a.rec.actions.length, b.rec.actions.length);
  assert.deepEqual(a.rec.actions, b.rec.actions);
});

test("RP-04 损坏的动作序列不会崩:遇到不匹配就停在最后一帧", () => {
  const { rec } = liveMatch(5);
  const broken = { ...rec, actions: [...rec.actions.slice(0, 5), { type: "INTERCEPT", seat: 99, giveCardId: "x" } as unknown as Action] };
  const frames = replayFrames(broken);
  assert.equal(frames.length, 6, "前 5 个动作 + 初始帧");
  assert.deepEqual(checkInvariants(frames[frames.length - 1]), []);
});
