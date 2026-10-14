// 热座 CLI MVP(§13.1):默认交互式热座对局;--selftest 批量自动对局冒烟;--demo 打印一局事件流。
//   node src/cli.ts [--table=small|big] [--ai=human,Sam,May]  交互式热座(座位可交给 AI)
//   可用 AI:
//   node src/cli.ts --demo --seed=7     非交互演示
//   node src/cli.ts --selftest --games=100
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { makeTableConfig, makeBalancedConfig, TABLE_PRESETS } from "./config.ts";
import type { TableSize } from "./config.ts";
import { createGame, aliveSeats, isAlive, player, checkInvariants, blockadeRipe } from "./state.ts";
import type { Action, GameState } from "./state.ts";
import { apply, advance } from "./engine.ts";
import { hiddenForViewer } from "../web/view.ts";
import { legalActions } from "./validate.ts";
import { createRng } from "./rng.ts";
import { cardText, handText } from "./cards.ts";
import { evaluate, describe as describeHand } from "./evaluator.ts";
import { interceptCost } from "./costs.ts";
import { randomBot as chooseAction } from "./bot.ts";
import { makeAgent, isAgentName, AI_NAMES, AGENTS } from "./ai/index.ts";
import type { Policy } from "./env.ts";
import { describeEvent } from "./format.ts";

const argv = process.argv.slice(2);
const flag = (name: string, def: number): number => {
  const hit = argv.find((a) => a.startsWith("--" + name + "="));
  return hit ? Number(hit.split("=")[1]) : def;
};
const has = (name: string): boolean => argv.includes("--" + name);
const tableArg = (argv.find((a) => a.startsWith("--table="))?.split("=")[1] ?? "auto") as TableSize | "auto";
if (tableArg !== "auto" && !TABLE_PRESETS[tableArg]) {
  console.error("未知分场: " + tableArg + "(可选 small / big,缺省 auto 按人数自适应)");
  process.exit(1);
}
/** 分场配置:--table=small|big 固定档位;缺省 auto 时按人数自适应(2 人 k=70 … 6 人 k=10) */
const aiSpec = (argv.find((a) => a.startsWith("--ai="))?.split("=")[1] ?? "").split(",").map((s) => s.trim());
/** 按 --ai=a,b,c 给座位安排 AI;human / - / 空 = 人类 */
function agentsFor(count: number): Array<Policy | null> {
  const out: Array<Policy | null> = [];
  for (let i = 0; i < count; i++) {
    const t = aiSpec[i];
    out.push(t && isAgentName(t) ? makeAgent(t) : null);
  }
  return out;
}
const tableConfig = (playerCount: number, extra?: unknown) =>
  tableArg === "auto" ? makeBalancedConfig(playerCount, extra) : makeTableConfig(tableArg, extra);
const tableLabel = (playerCount: number): string =>
  tableArg === "auto" ? "自动(k=" + (playerCount === 2 ? 70 : playerCount === 3 ? 40 : playerCount === 4 ? 25 : playerCount === 5 ? 16 : 10) + ")" : TABLE_PRESETS[tableArg].label;

// ---------------- 渲染 ----------------

function tableText(st: GameState, viewer: number | null): string {
  const rows: string[] = [];
  const cap = st.config.endGame.maxHands;
  rows.push("局 #" + st.handNo + (cap === null ? "" : "/" + cap) + "  阶段 " + st.phase + "  M=" + st.multiplier + "  底池 " + st.pot + "  (第 " + st.betting.roundIndex + " 轮下注)");
  rows.push("费用刻度: 底注 " + st.config.ante.amount + " | 跟注 " + st.config.betting.seenRate + "(看)/" + st.config.betting.blindRate + "(闷) | 换牌 " + st.config.exchange.fees.join("-") + " | 踢牌 " + st.config.kick.fee);
  rows.push("公共池: " + st.pool.map((c) => (st.poolMeta[c.id].faceUp ? cardText(c) : "[暗牌]")).join(" "));
  for (const p of st.players) {
    const tag = p.folded ? "已弃" : p.inHand ? "在局" : "出局";
    const blind = p.blind ? "闷" : "看";
    const visible = viewer === p.seat || (st.config.fold.revealToAll && p.folded);
    const hand = visible ? handText(p.hand) : p.hand.map(() => "[?]").join(" ");
    const blks = st.blockades.filter((b) => b.kickerSeat === p.seat && !b.resolvedByKicker);
    rows.push("  " + p.seat + " " + p.name.padEnd(4) + " 积分 " + String(p.points).padStart(6) +
      " [" + tag + "/" + blind + "]" + (st.turn.seat === p.seat && st.phase === "BETTING" ? " <- 行动中" : "") +
      "  " + hand + (blks.length ? "  暗牌:" + blks.map((b) => b.cardId).join(",") : ""));
  }
  const pending = st.blockades.filter((b) => !b.resolvedByKicker);
  if (pending.length) {
    rows.push("封锁轮: " + pending.map((b) => "座位" + b.kickerSeat + " 的暗牌" + (blockadeRipe(st, b) ? "(已收束,可换走)" : "(保护中)")).join(" | "));
  }
  if (st.pendingIntercept) {
    const w = st.pendingIntercept;
    rows.push("待截胡: " + w.cardId + " 归座位 " + w.candidateSeat + " 在自己的回合内决定(n=" + w.n + ", 费 " + interceptCost(st, w.cardId, w.n).total + " 分)");
  }
  return rows.join("\n");
}

function statusLine(st: GameState): string {
  return "存活: " + aliveSeats(st).join(",") + "  可用动作: " + legalActions(st).join("/");
}
// ---------------- 自测 ----------------

function selftest(games: number, maxSteps: number): void {
  const stats = { actions: 0, hands: 0, intercepts: 0, kicks: 0, compares: 0, ties: 0, showdowns: 0, maxSteps: 0, over: 0, win: 0, bust: 0, maxHands: 0 };
  for (let g = 0; g < games; g++) {
    const n = 2 + (g % 5);
    const names = Array.from({ length: n }, (_, i) => "P" + (i + 1));
    const st = createGame(tableConfig(n, { players: { min: 2, max: 6, handSize: 5, startPoints: 20000 } }), names, g + 1);
    const total0 = st.players.reduce((a, p) => a + p.points, 0);
    advance(st);
    const rng = createRng((g + 1) * 104729);
    let steps = 0;
    while (!st.gameOver && steps++ < maxSteps) {
      const a = chooseAction(st, rng);
      if (!a) break;
      const r = apply(st, a);
      if (!r.ok) throw new Error("自测失败: " + a.type + " -> " + r.error!.code + " " + r.error!.message);
      const total = st.players.reduce((x, p) => x + p.points, 0) + st.pot + st.carryPot;
      if (total !== total0) throw new Error("积分不守恒: " + total + " != " + total0);
      const bad = checkInvariants(st);
      if (bad.length) throw new Error("不变量违规: " + bad.join("; "));
      stats.actions++;
    }
    // 注:整场是否结束取决于积分总量与阈值;这里只保证有限步内不变量与守恒成立
    stats.maxSteps = Math.max(stats.maxSteps, steps);
    stats.hands += st.handNo;
    stats.intercepts += st.events.filter((e) => e.kind === "INTERCEPTED").length;
    stats.kicks += st.events.filter((e) => e.kind === "KICKED").length;
    stats.compares += st.events.filter((e) => e.kind === "COMPARED").length;
    stats.ties += st.events.filter((e) => e.kind === "TIE_RECORDED").length;
    stats.showdowns += st.events.filter((e) => e.kind === "SHOWDOWN").length;
    if (st.gameOver) {
      stats.over++;
      const reason = st.settlement?.gameOverReason;
      if (reason === "MAX_HANDS") stats.maxHands++;
      else if (reason === "BUST") stats.bust++;
      else stats.win++;
    }
  }
  console.log("自测通过: " + games + " 组自动对战(每组最多 " + maxSteps + " 步),动作 " + stats.actions + " 次,牌局 " + stats.hands + " 局,单组最多动作 " + stats.maxSteps);
  console.log("截胡 " + stats.intercepts + " | 踢牌 " + stats.kicks + " | 比牌 " + stats.compares + "(平局 " + stats.ties + ") | 摊牌 " + stats.showdowns);
  console.log("整场结束 " + stats.over + "/" + games + " 组(阈值 " + stats.win + " | 破产 " + stats.bust + " | 打满局数 " + stats.maxHands + ")");
  console.log("积分守恒 + INV1~INV9 全部通过。");
}

// ---------------- 演示 ----------------

function demo(seed: number): void {
  const n = Math.max(2, Math.min(6, flag("players", 3)));
  const names = Array.from({ length: n }, (_, i) => String.fromCharCode(65 + i));
  const st = createGame(tableConfig(n), names, seed);
  const rng = createRng(seed * 31 + 7);
  advance(st);
  console.log("=== 演示对局 seed=" + seed + "  分场=" + tableLabel(n) + "  人数=" + n + "  底注=" + st.config.ante.amount + " ===");
  let steps = 0;
  while (!st.gameOver && steps++ < 80) {
    const a = chooseAction(st, rng);
    if (!a) break;
    const r = apply(st, a);
    if (!r.ok) { console.log("拒绝 " + a.type + ": " + r.error!.message); break; }
    console.log("座位" + a.seat + " " + a.type + "  [" + r.events.map((e) => e.kind).join(",") + "]");
  }
  console.log();
  console.log(tableText(st, null));
  if (st.settlement) {
    const s = st.settlement;
    console.log("\n结算: 底池 " + s.pot + " -> 赢家 " + s.winners.join(",") + " (每人 " + s.perWinner + ", 余 " + s.remainder + "), 原因 " + s.reason);
  }
}
// ---------------- 交互式热座 ----------------

async function interactive(): Promise<void> {
  const rl = readline.createInterface({ input, output });
  const preset = flag("players", 0);
  const countRaw = preset ? String(preset) : await rl.question("人数(2~6, 默认 3, 也可用 --players=N 直接指定): ");
  const count = Math.max(2, Math.min(6, Number(countRaw.trim() || 3)));
  const names = Array.from({ length: count }, (_, i) => "玩家" + (i + 1));
  const seed = Math.floor(Math.random() * 1e9);
  const st = createGame(tableConfig(count), names, seed);
  advance(st);
  console.log("\n种子: " + seed + " (记录它可完整复现本局)\n");
  console.log("命令: v=看牌 c=跟注 r=加注 f=弃牌 b<座位>=比牌 e<拿><给>=换牌 k<序号>=踢牌 t<给>=换走暗牌 p=不换 i<给>=截胡 d=放弃截胡 rt<拿>=补换 s=放弃补换 q=退出\n");

  while (!st.gameOver) {
    if (st.phase !== "BETTING") { const auto = chooseAction(st, createRng(1)); if (!auto) break; apply(st, auto); continue; }
    const actor = st.turn.seat;
    if (actor === null) break;
    console.log("\n" + "-".repeat(72));
    console.log(tableText(st, actor));
    console.log(statusLine(st));
    const agent = agentsFor(st.players.length)[actor];
    if (agent) {
      const a = agent(st, createRng((Date.now() ^ (actor * 7919)) >>> 0));
      if (a) {
        const r = apply(st, a);
        console.log(">> " + player(st, actor).name + "(AI) 出招: " + a.type);
        if (r.ok) for (const e of r.events) console.log("  · " + describeEvent(e, { hideCardIds: hiddenForViewer(st, actor) }));
      }
      continue;
    }
    const ans = (await rl.question("座位" + actor + " " + player(st, actor).name + " > ")).trim();
    const parts = ans.split(/\s+/);
    let action: Action | null = null;
    try {
      switch (parts[0]) {
        case "v": action = { type: "VIEW_HAND", seat: actor }; break;
        case "c": action = { type: "CALL", seat: actor }; break;
        case "f": action = { type: "FOLD", seat: actor }; break;
        case "r": action = { type: "RAISE", seat: actor, toMultiplier: st.config.betting.ladder.find((m) => m > st.multiplier)! }; break;
        case "b": action = { type: "COMPARE", seat: actor, targetSeat: Number(parts[1]) }; break;
        case "e": action = { type: "EXCHANGE", seat: actor, takeCardId: st.pool[Number(parts[1])].id, giveCardId: player(st, actor).hand[Number(parts[2])].id }; break;
        case "k": action = { type: "KICK", seat: actor, targetCardId: st.pool.filter((c) => st.poolMeta[c.id].faceUp)[Number(parts[1])].id }; break;
        case "t": action = { type: "TAKE_BLOCKED", seat: actor, giveCardId: player(st, actor).hand[Number(parts[1])].id }; break;
        case "p": action = { type: "PASS_BLOCKED", seat: actor }; break;
        case "i": action = { type: "INTERCEPT", seat: actor, giveCardId: player(st, actor).hand[Number(parts[1] ?? 0)].id }; break;
        case "d": action = { type: "DECLINE_INTERCEPT", seat: actor }; break;
        case "q": console.log("退出。"); rl.close(); return;
        default: console.log("未知命令。可用: " + statusLine(st)); continue;
      }
    } catch (err) { console.log("输入无法解析: " + (err as Error).message); continue; }
    const r = apply(st, action);
    if (!r.ok) { console.log("x 非法动作: " + r.error!.code + " " + r.error!.message); continue; }
    for (const e of r.events) console.log("  . " + describeEvent(e, { hideCardIds: hiddenForViewer(st, actor) }));
  }

  console.log("\n=== 整场结束 ===");
  console.log(tableText(st, null));
  if (st.settlement) {
    const s = st.settlement;
    console.log("最终排名:");
    s.ranking.forEach((x, i) => console.log("  " + (i + 1) + ". 座位" + x.seat + " " + player(st, x.seat).name + " " + x.points + " 分"));
    console.log("结束原因: " + s.gameOverReason + (s.winnerSeat !== undefined ? "  赢家: 座位" + s.winnerSeat + " " + player(st, s.winnerSeat).name : "  (平局)"));
  }
  rl.close();
}

// ---------------- 入口 ----------------

if (has("selftest")) selftest(flag("games", 100), flag("steps", 3000));
else if (has("demo")) demo(flag("seed", 7));
else await interactive();
