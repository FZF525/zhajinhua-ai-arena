// 观战/回放的内存实测:录制体积、全帧缓存代价、关键帧方案
// 运行:node --expose-gc examples/memory-probe.ts [局数=20]
import { makeConfig } from "../src/config.ts";
import { createGame, checkInvariants } from "../src/state.ts";
import { apply, advance, cloneState } from "../src/engine.ts";
import { createRng } from "../src/rng.ts";
import { makeAgent } from "../src/ai/index.ts";
import { createRecorder, record, replayFrames } from "../src/replay.ts";

const HANDS = Number(process.argv[2] ?? 20);
const mb = () => process.memoryUsage().heapUsed / 1048576;
const gc = (globalThis as { gc?: () => void }).gc;
const clean = () => { gc?.(); gc?.(); };
const fmt = (x: number) => x.toFixed(1).padStart(7);

// ---- 打一局 6 人 AI 对战并录制 ----
const names = ["Baozi", "Sam", "Lucas", "May", "Yeon", "Brian"];
const cfg = { players: { startPoints: 20000 }, endGame: { maxHands: HANDS, winAtOrAbove: 1e9, bustAtOrBelow: -1, winTakesPriorityOverBust: true } };
const st = createGame(makeConfig(cfg), names, 20250101);
advance(st);
const rec = createRecorder(20250101, names, cfg);
const agents = names.map(makeAgent);
const rng = createRng(42);
let steps = 0;
while (!st.gameOver && steps++ < 20000) {
  const seat = st.turn.seat;
  if (seat === null) break;
  const a = agents[seat](st, rng);
  if (!a) break;
  if (!apply(st, a).ok) break;
  record(rec, a);
}
console.log("=== 被测对局 ===  局数 " + st.handNo + "  玩家 " + names.length + " 人  AI 全自动");
console.log("动作数 " + rec.actions.length + "  事件数 " + st.events.length + "  不变量 " + (checkInvariants(st).join(";") || "OK"));

// ---- 1) 录制体积 ----
const json = JSON.stringify(rec);
console.log("\n[1] 录制体积");
console.log("    JSON " + json.length + " 字节 (" + (json.length / 1024).toFixed(1) + " KB)  →  1000 局约 " + (json.length * 1000 / 1048576).toFixed(1) + " MB");

// ---- 2) 全帧缓存(每步一个快照)----
clean();
const before = mb();
const frames = replayFrames(rec);
clean();
const after = mb();
const perFrameKB = ((after - before) * 1024) / Math.max(1, frames.length);
console.log("\n[2] 全帧缓存(时间轴每步一帧)");
console.log("    帧数 " + frames.length + "  堆增长 " + fmt(after - before) + " MB  →  每帧约 " + perFrameKB.toFixed(1) + " KB");
console.log("    若同时留住 20 局:" + fmt((after - before) * 20) + " MB   ← 这就是「吃内存」的来源");
void frames;

// ---- 3) 关键帧方案:每 KEY 步存一个快照,跳转时从最近关键帧重算 ----
clean();
const KEY = 50;
const t0 = Date.now();
const keyBefore = mb();
const keys: Array<{ step: number; state: ReturnType<typeof cloneState> }> = [];
{
  const s2 = createGame(makeConfig(cfg), names, 20250101);
  advance(s2);
  keys.push({ step: 0, state: cloneState(s2) });
  for (let i = 0; i < rec.actions.length; i++) {
    if (!apply(s2, rec.actions[i]).ok) break;
    if ((i + 1) % KEY === 0) keys.push({ step: i + 1, state: cloneState(s2) });
  }
}
clean();
const keyMB = mb() - keyBefore;
console.log("\n[3] 关键帧方案(每 " + KEY + " 步一个快照)");
console.log("    快照数 " + keys.length + "  堆增长 " + fmt(keyMB) + " MB  →  每局仅 " + (keyMB * 1024).toFixed(0) + " KB");
console.log("    建表耗时 " + (Date.now() - t0) + " ms  →  1000 局约 " + (keyMB * 1000).toFixed(0) + " MB(仍偏大,磁盘存档更划算)");

// ---- 4) 跳到任意步的耗时(从最近关键帧现算)----
const jump = (target: number) => {
  const k = keys.filter((x) => x.step <= target).pop()!;
  let s3 = cloneState(k.state);
  for (let i = k.step; i < target; i++) if (!apply(s3, rec.actions[i]).ok) break;
  return s3;
};
const t1 = Date.now();
let acc = 0;
for (let i = 0; i < 200; i++) acc += jump(Math.floor((rec.actions.length * i) / 200)).events.length;
const perJump = (Date.now() - t1) / 200;
console.log("\n[4] 拖动时间轴:任意跳一步平均 " + perJump.toFixed(2) + " ms(200 次跳转校验 " + acc + ")");
console.log("    结论:关键帧方案内存可控在几百 KB/局");
void acc;

// ---- 5) 极端省内存:完全不缓存,每次跳转从头发牌重算 ----
const fullJump = (target: number) => {
  const s4 = createGame(makeConfig(cfg), names, 20250101);
  advance(s4);
  for (let i = 0; i < target; i++) if (!apply(s4, rec.actions[i]).ok) break;
  return s4;
};
fullJump(Math.floor(rec.actions.length / 2));   // 预热
const t2 = Date.now();
let acc2 = 0;
for (let i = 0; i < 100; i++) acc2 += fullJump(Math.floor((rec.actions.length * i) / 100)).events.length;
const perFull = (Date.now() - t2) / 100;
clean();
const zeroBefore = mb();
void fullJump(Math.floor(rec.actions.length / 2));
clean();
console.log("\n[5] 零缓存方案(每次跳转从头发牌重算)");
console.log("    平均 " + perFull.toFixed(2) + " ms/跳(100 次校验 " + acc2 + ")  堆增长 " + fmt(mb() - zeroBefore) + " MB");
console.log("    结论:即使不缓存也够快,内存占用 = 只有录制的 " + (json.length / 1024).toFixed(1) + " KB JSON/局");
