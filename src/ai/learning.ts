// ZeroB:自对弈学习型 AI(AlphaGo 的婴儿版 —— 没有神经网络,状态用特征抽象成有限张表)
// 学什么:主决策(FOLD/CALL/RAISE/COMPARE)的 Q 值;辅助动作(看牌/换牌/踢牌/截胡)借用启发式。
// 怎么学:自我对弈,每手结束用"本局净收益"做回报,按 Q-learning 反向更新沿途决策。
// 状态抽象:牌力档 × 跟注价 × 对手数 × 下注轮 × 是否封顶(约 1560 个状态)。
import { player, isAlive } from "../state.ts";
import type { Action, GameState } from "../state.ts";
import { evaluate } from "../evaluator.ts";
import { callCost, compareCost, raiseCost } from "../costs.ts";
import { enumerateActions } from "../env.ts";
import type { Policy } from "../env.ts";
import { createRng } from "../rng.ts";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Rng } from "../rng.ts";
import { auxDecision, PROFILES } from "./heuristic.ts";
import { equityDecide, estimateEquity, EQ_PROFILES } from "./equity.ts";
import { makeConfig } from "../config.ts";
import { createGame } from "../state.ts";
import { apply, advance } from "../engine.ts";

export const ZEROB_ACTIONS = ["FOLD", "CALL", "RAISE", "COMPARE"] as const;
export type ZeroBAction = (typeof ZEROB_ACTIONS)[number];

export interface ZeroBTable {
  version: 1;
  trainedHands: number;
  /** 状态键 → 每个动作的 Q 值 */
  q: Record<string, number[]>;
}

export function emptyTable(): ZeroBTable {
  return { version: 1, trainedHands: 0, q: {} };
}

export interface ZeroBKeyOptions {
  /** >0 时用"精确胜率分桶"替代"牌力档"作为强度特征(0 = 旧的牌力档模式) */
  equitySamples?: number;
}

function fnv1a(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/** 用局面自身做种子,保证"同一局面 → 同一特征"(确定性,训练才稳定) */
function deterministicRng(s: GameState, seat: number): Rng {
  const me = player(s, seat);
  return createRng(fnv1a(seat + ":" + me.hand.map((c) => c.id).join(",") + ":" + s.pool.map((c) => c.id).join(",") + ":" + s.multiplier + ":" + s.betting.roundIndex));
}

/**
 * 状态抽象(信息集):
 *  - 旧模式:牌力档(12 档)/ 跟注价 / 对手数 / 轮次 / 封顶
 *  - 新模式:精确胜率分桶(5 桶,把公共池构成、对手数都算进去)/ 跟注价 / 对手数 / 轮次 / 封顶 / 是否闷牌
 */
export function zerobKey(s: GameState, seat: number, opts: ZeroBKeyOptions = {}): string {
  const me = player(s, seat);
  const call = callCost(s, seat).total;
  const price = call / (s.pot + call + 1);
  const pb = price < 0.05 ? 0 : price < 0.1 ? 1 : price < 0.2 ? 2 : price < 0.35 ? 3 : 4;
  const opp = Math.min(3, Math.max(0, s.players.filter((p) => p.seat !== seat && isAlive(p)).length - 1));
  const round = Math.min(2, s.betting.roundIndex);
  const cap = s.betting.capReached ? 1 : 0;
  const samples = opts.equitySamples ?? 0;
  if (samples > 0) {
    const blind = me.blind ? 1 : 0;
    const eb = blind ? 0 : Math.min(4, Math.floor(estimateEquity(s, seat, samples, deterministicRng(s, seat)).equity * 5));
    return eb + "|" + pb + "|" + opp + "|" + round + "|" + cap + "|" + blind;
  }
  const tier = me.blind ? 13 : evaluate(me.hand).tier;           // 13 = 还没看牌
  return tier + "|" + pb + "|" + opp + "|" + round + "|" + cap;
}

/** 当前可用的主决策(固定顺序,便于把 Q 值当作向量) */
export function zerobLegal(s: GameState): Array<{ action: Action; kind: ZeroBAction }> {
  const acts = enumerateActions(s);
  const out: Array<{ action: Action; kind: ZeroBAction }> = [];
  for (const kind of ZEROB_ACTIONS) {
    const hit = acts.find((a) => a.type === kind);
    if (!hit) continue;
    if (kind === "COMPARE") {
      const targets = acts.filter((a) => a.type === "COMPARE") as Array<Action & { targetSeat: number }>;
      const weak = targets.find((a) => player(s, a.targetSeat).blind) ?? targets[0];
      out.push({ action: weak, kind });
    } else out.push({ action: hit, kind });
  }
  return out;
}

/** 取 Q 值最高的合法动作下标(实验脚本与决策共用) */
export function bestAction(qs: number[], legal: Array<{ kind: ZeroBAction }>): number {
  let bi = 0, bv = -Infinity;
  legal.forEach((l, i) => {
    const v = qs[ZEROB_ACTIONS.indexOf(l.kind)] ?? 0;
    if (v > bv) { bv = v; bi = i; }
  });
  return bi;
}

/** 是否有该状态的训练数据 */
export function hasData(table: ZeroBTable, key: string): boolean {
  const qs = table.q[key];
  return !!qs && qs.some((v) => v !== 0);
}

/** 按 Q 表决策(表里没有该状态时,退化为精确胜率 AI,保证不会瞎打) */
export function zeroBDecide(s: GameState, rng: Rng, table: ZeroBTable, eps = 0, keyOpts: ZeroBKeyOptions = {}): Action {
  const seat = s.turn.seat!;
  const legal = zerobLegal(s);
  const key = zerobKey(s, seat, keyOpts);
  if (!hasData(table, key)) return equityDecide(s, rng, EQ_PROFILES.EQBfast);
  if (eps > 0 && rng.int(1000) < eps * 1000) return legal[rng.int(legal.length)].action;
  const qs = table.q[key] ?? [];
  return legal[bestAction(qs, legal)].action;
}

export interface TrainOptions {
  hands: number;
  seed?: number;
  alpha?: number;         // 学习率
  gamma?: number;         // 折扣
  epsFrom?: number;       // 探索率(线性衰减到 epsTo)
  epsTo?: number;
  players?: number;
  startPoints?: number;
  onProgress?: (done: number, table: ZeroBTable) => void;
  /** 在已有表上继续训练 */
  table?: ZeroBTable;
  /** 状态抽象选项(equitySamples > 0 即启用精确胜率特征) */
  keyOpts?: ZeroBKeyOptions;
}

/**
 * 自对弈训练:所有座位共用同一张表(对称自对弈),每手把净收益作为回报反向传播。
 * 为保持环境平稳,每手结束后把积分重置回初始值(训练不关心经济系统)。
 */
export function trainZeroB(opts: TrainOptions): ZeroBTable {
  const hands = opts.hands;
  const n = Math.max(2, Math.min(6, opts.players ?? 3));
  const alpha = opts.alpha ?? 0.25;
  const gamma = opts.gamma ?? 0.95;
  const epsFrom = opts.epsFrom ?? 0.6;
  const epsTo = opts.epsTo ?? 0.03;
  const base = opts.startPoints ?? 20000;
  const table = opts.table ?? emptyTable();
  const cfg = makeConfig({
    players: { startPoints: base },
    endGame: { maxHands: 1e9, winAtOrAbove: 1e18, bustAtOrBelow: -1e18, winTakesPriorityOverBust: true }
  });
  const names = Array.from({ length: n }, (_, i) => "Z" + i);
  const st = createGame(cfg, names, (opts.seed ?? 1) >>> 0);
  advance(st);
  const rng = createRng((opts.seed ?? 1) * 7 + 3);
  const aux = PROFILES.Sam;

  for (let h = 0; h < hands; h++) {
    const eps = epsFrom + (epsTo - epsFrom) * (h / Math.max(1, hands - 1));
    const trail: Array<Array<{ key: string; idx: number; kind: ZeroBAction }>> = names.map(() => []);
    let guard = 0;
    while (st.phase === "BETTING" && guard++ < 400) {
      const seat = st.turn.seat;
      if (seat === null) break;
      const a = auxDecision(st, rng, aux);
      if (a) { if (!apply(st, a, { dealNextHand: false }).ok) break; continue; }
      const key = zerobKey(st, seat, opts.keyOpts);
      const legal = zerobLegal(st);
      if (legal.length === 0) break;
      let pick: number;
      if (!hasData(table, key) || (eps > 0 && rng.int(1000) < eps * 1000)) pick = rng.int(legal.length);
      else pick = bestAction(table.q[key] ?? [], legal);
      trail[seat].push({ key, idx: ZEROB_ACTIONS.indexOf(legal[pick].kind), kind: legal[pick].kind });
      if (!apply(st, legal[pick].action, { dealNextHand: false }).ok) break;
    }
    if (st.phase !== "HAND_START") break;      // 意外状态:结束训练
    // 回报 = 本局净收益(以底注为单位做归一化)
    const unit = Math.max(1, st.config.ante.amount * 4);
    const rewards = st.players.map((p) => (p.points - p.pointsAtHandStart) / unit);
    for (let seat = 0; seat < n; seat++) {
      const tr = trail[seat];
      for (let t = 0; t < tr.length; t++) {
        const { key, idx } = tr[t];
        const arr = (table.q[key] ??= [0, 0, 0, 0]);
        const next = tr[t + 1];
        const target = rewards[seat] + (next ? gamma * Math.max(...(table.q[next.key] ?? [0, 0, 0, 0])) : 0);
        arr[idx] += alpha * (target - arr[idx]);
      }
    }
    table.trainedHands++;
    // 重置积分,保持环境平稳
    for (const p of st.players) p.points = base;
    advance(st);
    if (st.gameOver) break;
    if (opts.onProgress && (h + 1) % 50 === 0) opts.onProgress(h + 1, table);
  }
  return table;
}

/** 存/取训练结果 */
export function saveZeroB(table: ZeroBTable, file: string): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(table), "utf8");
}

export function loadZeroB(file: string): ZeroBTable | null {
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as ZeroBTable;
    if (!parsed || typeof parsed !== "object" || !parsed.q) return null;
    return parsed;
  } catch { return null; }
}

/** 训练结果默认存放位置 */
export function zeroBPath(): string {
  return process.env.ZHJ_ZEROB ?? resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "data", "zerob.json");
}

export function makeZeroB(table: ZeroBTable | null, eps = 0, keyOpts: ZeroBKeyOptions = {}): Policy {
  const t = table && table.trainedHands > 0 ? table : null;
  return (s, rng) => {
    const seat = s.turn.seat;
    if (seat === null) return null;
    const me = player(s, seat);
    if (me.blind) {
      const view = enumerateActions(s).find((a) => a.type === "VIEW_HAND");
      if (view) return view;
    }
    return auxDecision(s, rng, PROFILES.Sam) ?? (t ? zeroBDecide(s, rng, t, eps, keyOpts) : equityDecide(s, rng, EQ_PROFILES.EQBfast));
  };
}
