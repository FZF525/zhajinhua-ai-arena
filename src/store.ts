// 对局存档:每局只存 {种子, 配置, 玩家, 动作序列} —— 约 35 KB,重放时现算(见 examples/memory-probe.ts)
// 存放位置:<项目根>/data/replays/*.json(可用 ZHJ_REPLAY_DIR 覆盖)
import { mkdirSync, readdirSync, readFileSync, writeFileSync, unlinkSync, statSync, existsSync, renameSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve, sep } from "node:path";
import type { Recording } from "./replay.ts";

export interface ReplaySummary {
  hands: number;
  players: string[];
  actions: number;
  result?: { gameOver: boolean; reason?: string; winnerSeat?: number; points: number[] };
}

export interface ReplayFile extends Recording {
  savedAt: string;
  summary: ReplaySummary;
}

export interface ReplayListItem {
  file: string;
  savedAt: string;
  hands: number;
  players: number;
  actions: number;
  reason?: string;
  sizeBytes: number;
}

const HERE = dirname(fileURLToPath(import.meta.url));

/** 存档目录(默认 <项目根>/data/replays) */
export function replaysDir(): string {
  return process.env.ZHJ_REPLAY_DIR ?? resolve(HERE, "..", "data", "replays");
}

function ensureDir(): void {
  const dir = replaysDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return void 0;
}

/** 只允许我们自己生成的文件名,杜绝路径穿越 */
export function isValidReplayName(file: string): boolean {
  return /^[a-z0-9][a-z0-9._-]*\.json$/i.test(file) && !file.includes("..") && !file.includes("/") && !file.includes("\\");
}

function pathOf(file: string): string {
  if (!isValidReplayName(file)) throw new Error("非法存档名: " + file);
  const full = join(replaysDir(), file);
  if (!full.startsWith(replaysDir() + sep)) throw new Error("越界路径: " + file);
  return full;
}

export function makeReplayName(players: string[], hands: number, seed: number): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  const stamp = d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + "-" + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
  return stamp + "-" + players.length + "p-" + (seed >>> 0).toString(36) + "-" + hands + "h.json";
}

export function saveReplay(rec: Recording, summary: ReplaySummary, fileName?: string): { file: string; path: string; bytes: number } {
  ensureDir();
  const file = fileName && isValidReplayName(fileName) ? fileName : makeReplayName(rec.players, summary.hands, rec.seed);
  const payload: ReplayFile = { ...rec, savedAt: new Date().toISOString(), summary };
  const json = JSON.stringify(payload);
  // 原子写:先写临时文件再 rename,避免中途崩溃留下半截文件
  const tmp = pathOf(file) + ".tmp";
  writeFileSync(tmp, json, "utf8");
  renameSync(tmp, pathOf(file));
  return { file, path: pathOf(file), bytes: Buffer.byteLength(json) };
}

export function listReplays(): ReplayListItem[] {
  ensureDir();
  const dir = replaysDir();
  const out: ReplayListItem[] = [];
  for (const f of readdirSync(dir)) {
    if (!isValidReplayName(f)) continue;
    try {
      const full = join(dir, f);
      const data = JSON.parse(readFileSync(full, "utf8")) as ReplayFile;
      out.push({
        file: f,
        savedAt: data.savedAt ?? "",
        hands: data.summary?.hands ?? 0,
        players: data.summary?.players?.length ?? data.players?.length ?? 0,
        actions: data.summary?.actions ?? data.actions?.length ?? 0,
        reason: data.summary?.result?.reason,
        sizeBytes: statSync(full).size
      });
    } catch { /* 坏文件跳过 */ }
  }
  return out.sort((a, b) => (a.savedAt < b.savedAt ? 1 : -1));
}

/** 只保留最近 keep 份,防止无限堆积(默认 50,可用 ZHJ_REPLAY_KEEP 覆盖) */
export function pruneReplays(keep = Number(process.env.ZHJ_REPLAY_KEEP ?? 50)): number {
  const items = listReplays();
  let removed = 0;
  for (const it of items.slice(Math.max(0, keep))) {
    try { deleteReplay(it.file); removed++; } catch { /* ignore */ }
  }
  return removed;
}

export function loadReplay(file: string): ReplayFile {
  return JSON.parse(readFileSync(pathOf(file), "utf8")) as ReplayFile;
}

export function deleteReplay(file: string): boolean {
  const p = pathOf(file);
  if (!existsSync(p)) return false;
  unlinkSync(p);
  return true;
}
