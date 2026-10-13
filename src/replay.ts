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
}

export function createRecorder(seed: number, players: string[], configPatch: unknown = {}): Recording {
  return { version: 1, seed, players, configPatch, actions: [], labels: [] };
}

export function record(rec: Recording, action: Action, label?: string): void {
  const a: Action = { ...action };
  delete (a as { clientActionId?: string }).clientActionId;   // 回放不需要幂等标记
  rec.actions.push(a);
  if (rec.labels) rec.labels.push(label ?? a.type);
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
  for (const a of rec.actions.slice(0, maxFrames)) {
    const r = apply(st, a);
    if (!r.ok) break;                      // 动作与当前状态不匹配(录制损坏)
    frames.push(cloneState(st));
  }
  return frames;
}

/** 只取某一帧(回放时用;如需频繁跳转可在调用方缓存 frames) */
export function replayTo(rec: Recording, step: number): GameState {
  const frames = replayFrames(rec, Math.max(0, step));
  return frames[frames.length - 1];
}

/** 采集一局的完整动作序列(用于把"现在这局"变成可回放的记录) */
export function harvest(seed: number, players: string[], configPatch: unknown, actions: Action[]): Recording {
  const rec = createRecorder(seed, players, configPatch);
  for (const a of actions) record(rec, a);
  return rec;
}
