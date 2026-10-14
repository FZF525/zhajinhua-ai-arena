// 观战 / 回放的最小内核。
// 引擎是确定性的(种子决定洗牌,动作决定后续),所以一局完整对局可以只存
// { seed, players, configPatch, actions } —— 通常几百字节 —— 然后精确重演。
import { createGame } from "./state.ts";
import type { Action, GameState } from "./state.ts";
import { apply, advance, cloneState } from "./engine.ts";
import type { GameConfig } from "./config.ts";
import { makeConfig } from "./config.ts";

export interface Recording {
  version: 1;
  seed: number;
  players: string[];
  /** 生成对局用的配置补丁(不含运行时状态) */
  configPatch: unknown;
  /** 按发生顺序记录的动作(含每次辅助动作) */
  actions: Action[];
  /** 可选:人类可读的标签,便于在时间轴上显示 */
  labels?: string[];
  /**
   * 与 actions 一一对应:该动作之后**是否已经进入下一局**。
   * 服务端在局间暂停时用的是 apply(..., { dealNextHand: false }) + 显式 advance(),
   * 所以回放必须知道"哪一步之后开了下一局" —— 否则每个局边界都会多付一次底注(实测每人差一个底注)。
   * 旧存档没有这个字段 → 回退到"自动开下一局"的旧行为。
   */
  /**
   * 局边界标记:在"第 N 个动作之后"发生过一次显式 advance(开下一局)。
   * 服务端在局间暂停时用的是 apply(..., { dealNextHand: false }) + 玩家点「下一局」时 advance(),
   * 回放必须复现这些边界,否则每个局边界都会多付一次底注(实测每人差 9 分 = 一个底注)。
   * 旧存档没有这个字段 → 回退到"apply 自动开下一局"的旧行为。
   */
  advances?: number[];
  /**
   * 存档那一刻进行到第几局。用于复现"列表末尾之后还开过局"的情形
   * (局间暂停时玩家点了「下一局」但还没产生新动作 —— 光靠 actions 推不出来)。
   */
  endHandNo?: number;
}

export function createRecorder(seed: number, players: string[], configPatch: unknown = {}): Recording {
  // advances 总是存在(新录制一律走"暂停语义 + 显式边界");旧存档缺这个字段时回退到自动开下一局的旧行为
  return { version: 1, seed, players, configPatch, actions: [], labels: [], advances: [] };
}

export function record(rec: Recording, action: Action, label?: string): void {
  const a: Action = { ...action };
  delete (a as { clientActionId?: string }).clientActionId;   // 回放不需要幂等标记
  rec.actions.push(a);
  if (rec.labels) rec.labels.push(label ?? a.type);
}

/** 记录一次"显式的开下一局":发生在当前已记录的动作数之后 */
export function recordAdvance(rec: Recording): void {
  (rec.advances ??= []).push(rec.actions.length);
}

/**
 * 从零开始重演:返回每一步之后的【快照】(step 0 = 发牌后那一帧)。
 * 必须 cloneState:apply 是就地修改,否则所有帧会指向同一个对象(时间轴就废了)。
 */
export function replayFrames(rec: Recording, maxFrames = 20000): GameState[] {
  const cfg: GameConfig = makeConfig(rec.configPatch);
  const st = createGame(cfg, rec.players, rec.seed);
  advance(st);
  const frames: GameState[] = [cloneState(st)];
  const advances = rec.advances;           // 有就精确复现局边界;没有就走旧行为
  const boundaries = new Set(advances ?? []);
  for (let i = 0; i < Math.min(rec.actions.length, maxFrames); i++) {
    const a = rec.actions[i];
    const r = advances ? apply(st, a, { dealNextHand: false }) : apply(st, a);
    if (!r.ok) break;                      // 动作与当前状态不匹配(录制损坏)
    frames.push(cloneState(st));
    // 帧与动作严格 1:1;局边界只影响"下一帧",不额外产帧 —— 于是 UI 上的"第 N 步"始终等于"第 N 个动作之后"
    if (boundaries.has(i + 1)) advance(st);
  }
  // 末尾:局间暂停时点过「下一局」但之后没有新动作 —— 用 endHandNo 把这一帧补出来
  if (advances && rec.endHandNo !== undefined) {
    while (!st.gameOver && st.handNo < rec.endHandNo) {
      advance(st);
      frames.push(cloneState(st));
    }
  }
  // 末尾兜底:循环里最后一次"开下一局"已经推进了状态,但那一帧还没产出(边界正好落在最后一个动作之后)
  if (advances) {
    const last = frames[frames.length - 1];
    const moved = st.handNo !== last.handNo || st.players.some((p, i) => p.points !== last.players[i].points);
    if (moved) frames.push(cloneState(st));
  }
  return frames;
}

/** 只取某一帧(回放时用;如需频繁跳转可在调用方缓存 frames) */
export function replayTo(rec: Recording, step: number): GameState {
  const frames = replayFrames(rec, Math.max(0, step));
  return frames[frames.length - 1];
}

/** 采集一局的完整动作序列(用于把"现在这局"变成可回放的记录) */
export function harvest(seed: number, players: string[], configPatch: unknown, actions: Action[], advances?: number[]): Recording {
  const rec = createRecorder(seed, players, configPatch);
  for (const a of actions) record(rec, a);
  if (advances) rec.advances = [...advances];
  return rec;
}
