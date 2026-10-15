// 唬牌 LLM 对局分析:DS / Lao6 / Nizi / GLM 打一盘,逐局输出叙事 + 决策理由 + 谎话账本
//
// 用法:node examples/bluff-llm-match.ts [--draw=choose3] [--bust=52] \
//         [--seats=llm:ds,Lao6,Nizi,llm:glm] [--hands=4]
// Key 从环境变量读(GLM_API_KEY / DS_API_KEY),绝不打印。
import { BLUFF_BUST_MODES } from "../src/games/bluff/state.ts";
import { newBluffGame, startHand, play, challenge } from "../src/games/bluff/rules.ts";
import { createAdaptiveAgent, BLUFF_PERSONAS, randomDecide } from "../src/games/bluff/ai.ts";
import { makeBluffLlmAgent } from "../src/games/bluff/llm.ts";
import { describeBluffEvent, describeBluffLog } from "../src/games/bluff/format.ts";
import { rankText } from "../src/games/bluff/state.ts";
import type { BluffState } from "../src/games/bluff/state.ts";
import { createRng } from "../src/rng.ts";
import { readFileSync, existsSync } from "node:fs";

// 密钥只从文件读,**绝不写进命令行**(教训:后台任务的命令会被回显 → 密钥就泄露了)
function loadKeysFromFile(path = "D:/Desktop/测试/glm-key.txt"): void {
  if (!existsSync(path)) return;
  const txt = readFileSync(path, "utf8");
  const g = txt.match(/[0-9a-f]{32}\.[A-Za-z0-9]{16}/);
  const d = txt.match(/sk-[A-Za-z0-9]{20,}/);
  if (g && !process.env.GLM_API_KEY) process.env.GLM_API_KEY = g[0];
  if (d && !process.env.DS_API_KEY) process.env.DS_API_KEY = d[0];
}
loadKeysFromFile();

const arg = (name: string, dflt: string) => {
  const hit = process.argv.find((x) => x.startsWith("--" + name + "="));
  return hit ? hit.split("=").slice(1).join("=") : dflt;
};
const KINDS = arg("seats", "llm:ds,Lao6,Nizi,llm:glm").split(",").map((s) => s.trim());
const HANDS = Number(arg("hands", "4"));
const DRAW = arg("draw", "choose3") === "one" ? "one" as const : "choose3" as const;
const BUST = arg("bust", "52") === "loose" || arg("bust", "52") === "52" ? BLUFF_BUST_MODES.loose : BLUFF_BUST_MODES.tight;
const CFG = { players: 4, handSize: 26, maxPlay: 5, bustCards: BUST, rate: 1, handsPerMatch: HANDS, drawMode: DRAW, challengeFee: 5, challengeWin: 3, challengeWinsBonus: 30, bluffBonus: 0.5 };
// 座位名跟着 --seats 走(之前硬编码 → 换成曹操时会显示成 Lao6,把自己都骗了 ✗)
const NAMES = KINDS.map((k, i) => (k.startsWith("llm:") ? k.slice(4).toUpperCase() + i : k + i));

const st: BluffState = newBluffGame(CFG, NAMES, Number(arg("seed", "20260126")));
const rng = createRng(7);
const agents = [0, 1, 2, 3].map((seat) => createAdaptiveAgent(KINDS[seat] && BLUFF_PERSONAS[KINDS[seat]] ? BLUFF_PERSONAS[KINDS[seat]] : undefined));
const USE_ASSIST = (process.argv.find((x) => x.startsWith("--assist=")) ?? "--assist=0").split("=")[1] === "1";   // 记牌器,默认关 ✓
const USE_CORRECTION = (process.argv.find((x) => x.startsWith("--correct=")) ?? "--correct=0").split("=")[1] === "1";
const llms = [0, 1, 2, 3].map((seat) => (KINDS[seat] === "llm:ds" || KINDS[seat] === "llm:glm" ? makeBluffLlmAgent(KINDS[seat].slice(4) as "ds" | "glm", agents[seat], undefined, USE_CORRECTION, USE_ASSIST) : null));

const stat = NAMES.map(() => ({ actions: 0, plays: 0, cardsOut: 0, lies: 0, chal: 0, chalRight: 0, fallback: 0, tokensIn: 0, tokensOut: 0, ms: 0 }));
let handNo = 0;

console.log("=== 唬牌 LLM 对局:" + NAMES.join(" / ") + " ===");
console.log("配置:爆牌线 " + BUST + " · 抽点数 " + DRAW + " · " + HANDS + " 局 · 座位 " + KINDS.join(",") + " · prompt纠错 " + (USE_CORRECTION ? "开" : "关"));
console.log("");

while (!st.over) {
  if (st.handOver) {
    for (const ag of agents) ag.observeHand(st);
    console.log("");
    console.log("【第 " + st.handNo + " 局展览】");
    console.log("  " + st.exhibition!.perSeat.map((p) => p.name + ":报" + p.claims + "手/出" + p.cards + "张/假" + p.lies + "张").join("  "));
    console.log("  出空:爆 = " + (st.lastScores.map((s, i) => NAMES[i] + " " + (s >= 0 ? "+" : "") + s).join("  ")));
    if (st.over) break;
    startHand(st);
    handNo = st.handNo;
    const cand = st.candidates.map((r) => rankText(r)).join("/");
    console.log("---- 第 " + handNo + " 局开始 · 庄家 " + NAMES[st.dealer] + " · 癞子 " + rankText(st.wildRank) + " · 本回合候选 " + cand + " ----");
    continue;
  }
  const seat = st.turn;
  const kind = KINDS[seat];
  let action;
  const before = st.seats[seat].hand.length;
  if (kind === "llm:ds" || kind === "llm:glm") {
    action = await llms[seat]!.decide(st, seat);
    const info = llms[seat]!.info;
    stat[seat].fallback += info.usedFallback ? 1 : 0;
    stat[seat].tokensIn += info.inputTokens;
    stat[seat].tokensOut += info.outputTokens;
    stat[seat].ms += info.ms;
    if (info.reason) stat[seat].actions += 0;
  } else if (kind === "random") {
    action = randomDecide(st, seat, rng);
  } else {
    action = agents[seat].decide(st, seat, rng);
  }
  const declaredText = action.type === "PLAY" ? rankText(action.declaredRank ?? st.roundRank) : "";
  const reason = kind === "llm:ds" || kind === "llm:glm" ? (llms[seat]!.info.reason ?? "") : "";
  const r = action.type === "PLAY" ? play(st, action.seat, action.cardIds, action.declaredRank) : challenge(st, action.seat);
  if (!r.ok) { console.log("  ✗ 非法动作(" + NAMES[seat] + "):" + r.error); break; }
  stat[seat].actions++;
  if (action.type === "PLAY") {
    const ids = action.cardIds;
    stat[seat].plays++;
    stat[seat].cardsOut += ids.length;
    // 这一手是否撒谎(用实际宣告的点数判)
    const fake = st.claims[st.claims.length - 1];
    if (fake && fake.honest < fake.count) stat[seat].lies += fake.count - fake.honest;
    console.log("  " + NAMES[seat] + " 出 " + ids.length + " 张报 " + declaredText + (reason ? "   ← " + reason : ""));
  } else {
    // 注意:直接取最后一条事件可能是 HAND_END/EXHIBITION → 要按类型找那条 CHALLENGE
    const ev = [...st.events].reverse().find((x) => x.kind === "CHALLENGE") as { honest: boolean; pot: number; against: number } | undefined;
    stat[seat].chal++;
    if (ev && !ev.honest) stat[seat].chalRight++;
    const line = ev ? NAMES[ev.against] + " → " + (ev.honest ? "猜错 ✗ 吃下 " + ev.pot + " 张" : "猜对 ✓ 对方收回 " + ev.pot + " 张") : "?";
    console.log("  " + NAMES[seat] + " 质疑 " + line + (reason ? "   ← " + reason : ""));
  }
}

console.log("");
console.log("=== 一盘结果 ===");
NAMES.forEach((n, i) => {
  const s = stat[i];
  const lieRate = s.cardsOut ? Math.round((s.lies / s.cardsOut) * 100) : 0;
  const chalAcc = s.chal ? Math.round((s.chalRight / s.chal) * 100) : 0;
  const extra = llms[i] ? " · 兜底 " + s.fallback + " · token " + s.tokensIn + "/" + s.tokensOut + " · 平均 " + (s.actions ? Math.round(s.ms / s.actions) : 0) + "ms" : "";
  console.log("  " + n.padEnd(5) + " 得分 " + String(st.seats[i].points).padStart(5) + " | 出 " + s.plays + " 手/" + s.cardsOut + " 张,假 " + s.lies + " 张(" + lieRate + "%) | 质疑 " + s.chal + " 次,猜对 " + s.chalRight + "(" + chalAcc + "%)" + extra);
});
