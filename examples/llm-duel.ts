// 让外部 AI(LLM)上场:占一个座位,和内置 AI 对打,打印决策日志与违规统计,并存成可回放的对局
// 用法:
//   node examples/mock-llm.ts                                   # 另开一个终端跑 mock(免费)
//   node examples/llm-duel.ts --vs=Sam,May --hands=6            # 默认连本地 mock
//   LLM_ENDPOINT=https://api.deepseek.com/v1/chat/completions LLM_MODEL=deepseek-chat LLM_API_KEY=sk-xxx \
//     node examples/llm-duel.ts --vs=Baozi,Brian --hands=8
import { makeConfig } from "../src/config.ts";
import { createGame, checkInvariants } from "../src/state.ts";
import { apply, advance } from "../src/engine.ts";
import { createRng } from "../src/rng.ts";
import { makeAgent } from "../src/ai/index.ts";
import { newRemoteStats, remoteDecide } from "../src/ai/remote.ts";
import type { RemoteConfig } from "../src/ai/remote.ts";
import { createRecorder, record } from "../src/replay.ts";
import { saveReplay } from "../src/store.ts";
import type { Action } from "../src/state.ts";

const args = process.argv.slice(2);
const arg = (n: string, d: string) => { const h = args.find((a) => a.startsWith("--" + n + "=")); return h ? h.split("=")[1] : d; };
const VS = arg("vs", "Sam,May").split(",").map((x) => x.trim()).filter(Boolean).slice(0, 5);
const HANDS = Number(arg("hands", "6"));
const SEED = Number(arg("seed", "20260101"));
const LOG = Number(arg("log", "12"));
const SHOW_PROMPT = arg("show-prompt", "0") === "1";

const cfg: RemoteConfig = {
  name: "LLM",
  // 命令行优先,其次环境变量,最后是本地 mock
  endpoint: arg("endpoint", process.env.LLM_ENDPOINT ?? "http://127.0.0.1:11434/v1/chat/completions"),
  model: arg("model", process.env.LLM_MODEL ?? "mock"),
  apiKeyEnv: "LLM_API_KEY",
  apiKey: process.env.LLM_API_KEY,
  temperature: Number(arg("temp", process.env.LLM_TEMP ?? "0")),
  timeoutMs: Number(arg("timeout", process.env.LLM_TIMEOUT ?? "30000")),
  maxTokens: Number(arg("max-tokens", process.env.LLM_MAX_TOKENS ?? "200")),
  jsonMode: arg("json-mode", process.env.LLM_JSON_MODE ?? "0") === "1",
  fallback: (arg("fallback", process.env.LLM_FALLBACK ?? "fold") as "fold" | "call" | "heuristic")
};

const names = ["LLM", ...VS];
const seatOfLLM = 0;
const state = createGame(makeConfig({
  players: { startPoints: 20000 },
  endGame: { maxHands: HANDS, winAtOrAbove: 1e9, bustAtOrBelow: -1, winTakesPriorityOverBust: true }
}), names, SEED);
const start = state.players.map((p) => p.points);
advance(state);
const rec = createRecorder(SEED, names, {});
const others = VS.map((n) => makeAgent(n));
const rng = createRng(SEED * 7 + 11);
const stats = newRemoteStats();
const actionCount: Record<string, number> = {};
const log: string[] = [];
let steps = 0;
const t0 = Date.now();

while (!state.gameOver && steps++ < 3000) {
  const seat = state.turn.seat;
  if (seat === null) break;
  let action: Action;
  if (seat === seatOfLLM) {
    const r = await remoteDecide(cfg, state, seat, stats);
    action = r.action;
    actionCount[action.type] = (actionCount[action.type] ?? 0) + 1;
    if (log.length < LOG) {
      log.push("第" + state.handNo + "局 座位" + seat + " 选择 " + JSON.stringify(action) +
        (r.info.violation ? "  ⚠ 违规(" + r.info.violation + (r.info.finishReason ? "/" + r.info.finishReason : "") + ")→兜底" : "") + "  " + r.info.ms + "ms" +
        (r.info.raw ? "  LLM原话:" + r.info.raw.replace(/\s+/g, " ").slice(0, 60) : ""));
    }
    if (SHOW_PROMPT && log.length === 1) console.log("\n=== 发给 LLM 的 prompt(第一次)===\n" + r.info.prompt + "\n=== end ===\n");
  } else {
    action = others[seat - 1](state, rng)!;
  }
  const res = apply(state, action, { dealNextHand: false });
  if (!res.ok) { console.log("!! 动作被拒: " + JSON.stringify(action) + " " + res.error!.code); break; }
  record(rec, action);
  if (state.phase === "HAND_START") advance(state);
}

console.log("=== 对局结束 ===");
console.log("目标:" + cfg.endpoint + "  模型:" + cfg.model + (process.env.LLM_API_KEY || process.env.LLM_API_KEY === "" ? "  (带 key)" : "  (无 key)"));
console.log("座位 LLM vs " + VS.join(",") + "  " + state.handNo + " 局  种子 " + SEED + "  用时 " + ((Date.now() - t0) / 1000).toFixed(1) + "s");
console.log("积分: " + state.players.map((p, i) => names[i] + "=" + p.points + "(" + (p.points - start[i] >= 0 ? "+" : "") + (p.points - start[i]) + ")").join("  "));
console.log("不变量: " + (checkInvariants(state).join(";") || "OK"));
console.log("LLM 决策 " + stats.decisions + " 次,违规 " + stats.violations + " 次(" + JSON.stringify(stats.byViolation) + "),平均 " + (stats.totalMs / Math.max(1, stats.decisions)).toFixed(0) + "ms/步");
const total = Object.values(actionCount).reduce((a, b) => a + b, 0) || 1;
console.log("token 用量: 输入 " + stats.inputTokens + " / 输出 " + stats.outputTokens + " (合计 " + (stats.inputTokens + stats.outputTokens) + ")");
console.log("LLM 动作分布: " + Object.entries(actionCount).sort((a, b) => b[1] - a[1])
  .map(([k, v]) => k + " " + v + "(" + Math.round((v / total) * 100) + "%)").join("  "));
if (log.length) { console.log("\n--- 前 " + log.length + " 步决策 ---"); for (const l of log) console.log("  " + l); }
try {
  const saved = saveReplay(rec, { hands: state.handNo, players: names, actions: rec.actions.length,
    result: { gameOver: state.gameOver, points: state.players.map((p) => p.points) } });
  console.log("\n对局已存档(可回放):" + saved.file);
} catch (e) { console.log("存档失败: " + (e as Error).message); }
