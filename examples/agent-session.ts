// 逐步式对局会话:让人(或 LLM)一步一步亲自打
// 原理:只存"种子 + 动作序列"(约 1 KB),每次调用重放重建局面 —— 不需要序列化游戏状态。
// 用法:
//   node examples/agent-session.ts --new --vs=Sam,May --seed=777            # 开一局,推进到轮到我
//   node examples/agent-session.ts --action='{"type":"VIEW_HAND"}'          # 我的一步,然后继续推进到轮到我
//   node examples/agent-session.ts --status                                 # 只看当前局面
import { makeConfig } from "../src/config.ts";
import { createGame, checkInvariants } from "../src/state.ts";
import { apply, advance } from "../src/engine.ts";
import { createRng } from "../src/rng.ts";
import { enumerateActions } from "../src/env.ts";
import { makeAgent } from "../src/ai/index.ts";
import { callCost, compareCost, exchangeCost, kickCost, raiseCost } from "../src/costs.ts";
import { describeEvent } from "../src/format.ts";
import { buildPrompt } from "../src/ai/remote.ts";
import type { Action, GameState } from "../src/state.ts";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";

const args = process.argv.slice(2);
const arg = (n: string, d?: string) => { const h = args.find((a) => a.startsWith("--" + n + "=")); return h ? h.split("=").slice(1).join("=") : d; };
const has = (n: string) => args.includes("--" + n);
const FILE = arg("file", "data/session-me.json")!;
const MY = Number(arg("seat", "0"));
const SHOW_PROMPT = has("prompt") || has("new-print-prompt");

interface Session { v: 1; seed: number; players: string[]; actions: Action[]; seen: number; }
function load(): Session | null {
  if (!existsSync(FILE)) return null;
  return JSON.parse(readFileSync(FILE, "utf8")) as Session;
}
function save(s: Session) { mkdirSync(dirname(FILE), { recursive: true }); writeFileSync(FILE, JSON.stringify(s), "utf8"); }

/** 重放已记录的动作,重建当前局面 */
function rebuild(s: Session): { st: GameState; events: string[] } {
  const st = createGame(makeConfig({
    players: { startPoints: 20000 },
    endGame: { maxHands: Number(arg("hands", "1")), winAtOrAbove: 1e9, bustAtOrBelow: -1, winTakesPriorityOverBust: true }
  }), s.players, s.seed);
  advance(st);
  const ev: string[] = [];
  for (const a of s.actions) {
    const before = st.events.length;
    const r = apply(st, a, { dealNextHand: false });
    if (!r.ok) throw new Error("重放失败: " + JSON.stringify(a) + " " + r.error!.code);
    for (const e of st.events.slice(before)) ev.push(describeEvent(e));
    if (st.phase === "HAND_START" && !st.gameOver) advance(st);
  }
  return { st, events: ev };
}

const agents = (players: string[]) => players.map((n, i) => (i === MY ? null : makeAgent(n)));
const rng = createRng(987654321);

function aiPlayUntilMyTurn(s: Session, st: GameState, ev: string[]): void {
  const pols = agents(s.players);
  let guard = 0;
  while (!st.gameOver && guard++ < 2000) {
    const seat = st.turn.seat;
    if (seat === null) break;
    if (seat === MY) return;                      // 轮到我,停下
    const a = pols[seat]!(st, rng);
    if (!a) break;
    const before = st.events.length;
    const r = apply(st, a, { dealNextHand: false });
    if (!r.ok) break;
    s.actions.push(a);
    for (const e of st.events.slice(before)) ev.push(describeEvent(e));
    if (st.phase === "HAND_START" && !st.gameOver) advance(st);
  }
}

function show(s: Session, st: GameState, fresh: string[]): void {
  const me = st.players[MY];
  const myVisible = !me.blind;                    // 闷牌就该看不见(和外部 LLM 的视图保持一致)
  console.log("=== 我的牌 ===   " + (myVisible ? me.hand.map((c) => c.text ?? c.id).join(" ") : "闷牌中 —— 想看就得先花一次「看牌」(会失去半价跟注)"));
  console.log("=== 局面 ===     第 " + st.handNo + " 局  M=" + st.multiplier + "  底池=" + st.pot + "  下注轮=" + st.betting.roundIndex +
    "  我的积分=" + me.points + "  我已投=" + me.committedThisHand + "  阈值=不可达(单局赛)");
  console.log("=== 公共池 ===   " + st.pool.map((c) => (st.poolMeta[c.id].faceUp ? (c.text ?? c.id) : (st.blockades.some((b) => b.cardId === c.id && b.kickerSeat === MY) ? "[我的暗牌]" : "[暗]"))).join(" "));
  console.log("=== 各家 ===");
  for (const p of st.players) {
    console.log("   " + (p.seat === MY ? "我  " : p.name.padEnd(4)) + " 座位" + p.seat + "  " + String(p.points).padStart(6) +
      "分  " + (p.out ? "出局" : p.folded ? "已弃牌" : p.blind ? "闷牌" : "看牌") + "  已投" + p.committedThisHand +
      ((p.folded || (p.seat === MY && myVisible)) ? "  [" + p.hand.map((c) => c.text ?? c.id).join(" ") + "]" : ""));
  }
  const legal = enumerateActions(st);
  const costOf = (a: Action) => {
    switch (a.type) {
      case "CALL": return callCost(st, MY).total;
      case "RAISE": return raiseCost(st, MY, (a as Action & { toMultiplier: number }).toMultiplier).total;
      case "COMPARE": return compareCost(st, MY).total;
      case "KICK": return kickCost(st).total;
      case "EXCHANGE": return exchangeCost(st, MY).total;
      case "VIEW_HAND": case "FOLD": case "PASS_BLOCKED": case "DECLINE_INTERCEPT": return 0;
      case "TAKE_BLOCKED": return exchangeCost(st, MY).total;
      case "INTERCEPT": { const w = st.pendingIntercept!; return 0; }
      default: return 0;
    }
  };
  console.log("=== 可选动作 ===");
  legal.forEach((a, i) => {
    const clean: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(a as Record<string, unknown>)) if (k !== "seat") clean[k] = v;
    if (typeof clean.type === "string") { clean.action = clean.type; delete clean.type; }
    console.log("   " + i + ") " + JSON.stringify(clean) + "   费用 " + costOf(a));
  });
  if (fresh.length) { console.log("=== 上一段发生了什么 ==="); for (const e of fresh) console.log("   " + e); }
  if (SHOW_PROMPT) { console.log("\n=== (与外部 LLM 看到的完全一致) ===\n" + buildPrompt(st, MY, legal) + "\n=== end ==="); }
  console.log("=== 不变量 ===   " + (checkInvariants(st).join(";") || "OK"));
}

if (has("new")) {
  const vs = (arg("vs", "Sam,May")!).split(",").map((x) => x.trim());
  const players = [arg("me", "我")!, ...vs];
  const s: Session = { v: 1, seed: Number(arg("seed", "777")), players, actions: [], seen: 0 };
  const { st, events } = rebuild(s);
  aiPlayUntilMyTurn(s, st, events);
  save(s);
  console.log("新会话:" + players.join(" vs ") + "  种子 " + s.seed + "  文件 " + FILE);
  show(s, st, events);
} else {
  const s = load();
  if (!s) { console.log("没有会话,先跑 --new"); process.exit(0); }
  // 动作可以写在文件里(避免 shell 引号地狱):--action-file=data/my-action.json
  const actFile = arg("action-file");
  const actStr = actFile ? readFileSync(actFile, "utf8").trim() : arg("action");
  const { st, events } = rebuild(s);
  if (actStr) {
    let a: Action;
    try { a = JSON.parse(actStr) as Action; } catch { console.log("动作 JSON 解析失败: " + actStr); process.exit(1); }
    // 与 LLM 入口保持一致:{"action":"CALL"} 与 {"type":"CALL"} 都收
    const raw = a as unknown as Record<string, unknown>;
    if (typeof raw.action === "string" && typeof raw.type !== "string") { raw.type = raw.action; delete raw.action; }
    a = { ...(raw as unknown as Action), seat: MY } as Action;
    const legal = enumerateActions(st);
    const key = (x: Action) => JSON.stringify(Object.entries(x as Record<string, unknown>).filter(([k]) => k !== "seat").sort());
    const hit = legal.find((x) => key(x) === key(a));
    if (!hit) { console.log("!! 非法动作(引擎不接受): " + JSON.stringify(a) + "\n可选: " + legal.map((x) => JSON.stringify(x)).join("  ")); process.exit(1); }
    const before = st.events.length;
    const r = apply(st, hit, { dealNextHand: false });
    if (!r.ok) { console.log("!! 被拒: " + r.error!.code); process.exit(1); }
    for (const e of st.events.slice(before)) events.push(describeEvent(e));
    s.actions.push(hit);
    console.log("✓ 我执行了:" + JSON.stringify(hit) + "  →  " + st.events.slice(before).map(describeEvent).join(" | "));
    if (st.phase === "HAND_START" && !st.gameOver) advance(st);
    aiPlayUntilMyTurn(s, st, events);
    save(s);
  } else {
    save(s);
  }
  if (st.gameOver) {
    console.log("\n=== 对局结束 ===");
    for (const p of st.players) console.log("   " + (p.seat === MY ? "我  " : p.name.padEnd(4)) + " " + p.points + " 分");
    console.log("   原因: " + (st.settlement?.gameOverReason ?? st.settlement?.reason ?? "-"));
    console.log("   赢家座位: " + (st.settlement?.winnerSeat ?? "并列"));
  } else {
    show(s, st, events.slice(-12));
  }
}
