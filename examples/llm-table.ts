// 多座位 LLM 同桌:每个座位可以是「内置 AI」或「远程模型@温度」,自由拼桌
//
// 用法(密钥走环境变量,不进仓库):
//   $env:GLM_API_KEY="<id.secret>"
//   node examples/llm-table.ts --seats="GLM:0.0,GLM:0.4,GLM:0.8,GLM:1.2,GLM:1.6,GLM:2.0" --hands=6
//   node examples/llm-table.ts --seats="GLM:0.2,Brian,DS:0.5,Lucas,GLM:1.0,ZeroB"
//
// 座位写法:  内置角色名(Brian/Lucas/Sam/Baozi/May/Yeon/EQB/ZeroB…) 或  <提供商>:<温度>
// 提供商预设:GLM(智谱)/ DS(DeepSeek);可用 --provider-url / --provider-model 覆盖
import { makeConfig, mergeConfig } from "../src/config.ts";
import { createGame, checkInvariants } from "../src/state.ts";
import type { Action } from "../src/state.ts";
import { apply, advance } from "../src/engine.ts";
import { makeAgent, AI_NAMES } from "../src/ai/index.ts";
import { remoteDecide, newRemoteStats } from "../src/ai/remote.ts";
import type { RemoteConfig, RemoteStats } from "../src/ai/remote.ts";
import { createRecorder, record, recordAdvance } from "../src/replay.ts";
import { saveReplay } from "../src/store.ts";
import { createRng } from "../src/rng.ts";

const arg = (name: string, dflt: string) => {
  const hit = process.argv.find((a) => a.startsWith("--" + name + "="));
  return hit ? hit.split("=").slice(1).join("=") : dflt;
};

interface Provider { url: string; keyEnv: string; models: string[]; jsonMode?: boolean }
const PROVIDERS: Record<string, Provider> = {
  GLM: { url: "https://open.bigmodel.cn/api/paas/v4/chat/completions", keyEnv: "GLM_API_KEY", models: ["GLM-4.7-Flash", "GLM-4-Flash-25", "glm-4-flash"] },
  // deepseek-flash 是"推理型":不开 json mode 时容易被推理内容吃掉额度,正文变空
  DS: { url: "https://api.deepseek.com/v1/chat/completions", keyEnv: "DS_API_KEY", models: ["deepseek-flash", "deepseek-chat"], jsonMode: true },
};

const SEATS_SPEC = arg("seats", "Brian,Lucas,GLM:0.3,GLM:1.0");
const HANDS = Number(arg("hands", "6"));
const SEED = Number(arg("seed", "20261017"));
const ANTE = Number(arg("ante", "45"));
const START = Number(arg("start", "6000"));
const WIN = Number(arg("win", "120000"));

interface Seat { label: string; provider?: string; temp?: number; local?: string }
const SEATS: Seat[] = SEATS_SPEC.split(",").map((raw) => raw.trim()).filter(Boolean).map((spec) => {
  if (spec.includes(":")) {
    const [p, t] = spec.split(":");
    const prov = p.trim().toUpperCase();
    if (!PROVIDERS[prov]) throw new Error("未知提供商 " + p + "(可用:" + Object.keys(PROVIDERS).join("/") + ")");
    return { label: prov + "@" + t, provider: prov, temp: Number(t) };
  }
  return { label: spec, local: spec };
});
if (SEATS.length < 2 || SEATS.length > 6) throw new Error("座位数需在 2~6 之间,当前 " + SEATS.length);

/** 给每个远程座位挑一个真能出内容的模型 */
async function pickModel(prov: string): Promise<{ url: string; model: string; key: string }> {
  const p = PROVIDERS[prov];
  const key = process.env[p.keyEnv] ?? "";
  if (!key) throw new Error("缺少环境变量 " + p.keyEnv);
  for (const m of p.models) {
    try {
      const r = await fetch(p.url, {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + key },
        body: JSON.stringify({ model: m, messages: [{ role: "user", content: "回复:好" }], max_tokens: 24, temperature: 0 }),
      });
      const j: any = await r.json();
      const txt = String(j?.choices?.[0]?.message?.content ?? "").trim();
      console.log("  " + prov + " 试模型 " + m.padEnd(18) + (r.ok ? "200" : String(r.status)) + "  " + JSON.stringify(txt.slice(0, 12)));
      if (r.ok && txt) return { url: p.url, model: m, key };
    } catch (e) { console.log("  " + prov + " 试模型 " + m + " ERR " + String(e).slice(0, 50)); }
  }
  throw new Error(prov + " 没有可用模型");
}

const cfg = mergeConfig(makeConfig(), {
  players: { startPoints: START, allowDebt: true },
  ante: { amount: ANTE },
  endGame: { winAtOrAbove: WIN, bustAtOrBelow: -150000, maxHands: HANDS },
  compare: { minRound: 2, blindTargetProtectRounds: 1 },
});
const NAMES = SEATS.map((s) => s.label);
console.log("=== 多座位 LLM 同桌 ===");
console.log("  座位 " + NAMES.map((n, i) => i + ":" + n).join("  "));
console.log("  参数 底注 " + ANTE + "  初始 " + START + "  阈值 " + WIN + "  局数 " + HANDS + "  种子 " + SEED);
console.log("=== 解析远程座位 ===");
const remote: Record<number, { cfg: RemoteConfig; stats: RemoteStats }> = {};
const resolved: Record<string, { url: string; model: string; key: string }> = {};
for (let i = 0; i < SEATS.length; i++) {
  const s = SEATS[i];
  if (!s.provider) continue;
  resolved[s.provider] = resolved[s.provider] ?? await pickModel(s.provider);
  const r = resolved[s.provider];
  remote[i] = {
    stats: newRemoteStats(),
    cfg: { name: s.label, endpoint: r.url, model: r.model, apiKeyEnv: "unused", apiKey: r.key, temperature: s.temp ?? 0, timeoutMs: 60000, maxTokens: 400, jsonMode: PROVIDERS[s.provider!].jsonMode ?? false, fallback: "fold" } as RemoteConfig,
  };
}
const locals: Record<number, ReturnType<typeof makeAgent>> = {};
for (let i = 0; i < SEATS.length; i++) if (SEATS[i].local) {
  const nm = SEATS[i].local!;
  if (!AI_NAMES.includes(nm)) throw new Error("未知角色 " + nm + "(可用:" + AI_NAMES.join("/") + ")");
  locals[i] = makeAgent(nm);
}

const state = createGame(cfg, NAMES, SEED);
advance(state);
const rec = createRecorder(SEED, NAMES, cfg);
const rng = createRng(SEED * 13 + 3);
const dist: Array<Record<string, number>> = NAMES.map(() => ({}));
const t0 = Date.now();
let guard = 0;
while (!state.gameOver && guard++ < 6000) {
  if (state.phase !== "BETTING") break;
  const seat = state.turn.seat;
  if (seat === null) break;
  let act: Action | null = null;
  if (remote[seat]) {
    const r = await remoteDecide(remote[seat].cfg, state, seat, remote[seat].stats);
    act = r.action;
    if (arg("log", "0") === "1") console.log("  [" + NAMES[seat].padEnd(9) + "] " + String(act.type).padEnd(11) + String(r.info.raw ?? "").replace(/\s+/g, " ").slice(0, 90));
  } else {
    act = locals[seat](state, rng) as Action | null;
  }
  if (!act) break;
  dist[seat][act.type] = (dist[seat][act.type] ?? 0) + 1;
  if (!apply(state, act, { dealNextHand: false }).ok) {
    const f = apply(state, { type: "FOLD", seat }, { dealNextHand: false });
    if (!f.ok) break;
  }
  record(rec, act);
  if (state.phase === "HAND_START" && !state.gameOver) { advance(state); recordAdvance(rec); }
  if (state.handNo > HANDS) break;
}
rec.endHandNo = state.handNo;

console.log("");
console.log("=== 结果(" + ((Date.now() - t0) / 1000).toFixed(0) + " 秒," + state.handNo + " 局," + rec.actions.length + " 动作)===");
const rows = state.players.map((p) => {
  const d = p.points - START;
  const dd = dist[p.seat];
  const total = Object.values(dd).reduce((a, b) => a + b, 0);
  const folds = dd.FOLD ?? 0;
  const raises = dd.RAISE ?? 0;
  const st2 = remote[p.seat]?.stats;
  return { name: NAMES[p.seat], net: d, total, foldRate: total ? folds / total : 0, raiseRate: total ? raises / total : 0, temp: SEATS[p.seat].temp, tokens: st2 ? st2.inputTokens + st2.outputTokens : 0, guards: st2?.blindFoldGuards ?? 0, dist: dd };
});
rows.sort((a, b) => b.net - a.net);
console.log("  名次 座位        净收支   决策  弃牌率  加注率  温度  token  硬兜底");
rows.forEach((r2, i) => {
  console.log("  " + String(i + 1).padStart(2) + ".  " + r2.name.padEnd(11) + (r2.net >= 0 ? "+" : "") + String(r2.net).padStart(6) +
    String(r2.total).padStart(7) + "  " + (r2.foldRate * 100).toFixed(0).padStart(4) + "%  " + (r2.raiseRate * 100).toFixed(0).padStart(4) + "%  " +
    String(r2.temp ?? "-").padStart(4) + "  " + String(r2.tokens).padStart(6) + "  " + String(r2.guards).padStart(3));
});
console.log("  不变量: " + (checkInvariants(state).length ? checkInvariants(state).join(";") : "OK"));
try {
  const saved = saveReplay(rec, { hands: state.handNo, players: NAMES, actions: rec.actions.length, result: { gameOver: state.gameOver, reason: state.settlement?.gameOverReason, points: state.players.map((p) => p.points) } });
  console.log("  存档: " + saved.file + "(可在网页回放)");
} catch (e) { console.log("  存档失败 " + String(e).slice(0, 60)); }