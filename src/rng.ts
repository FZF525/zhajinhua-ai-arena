// 确定性 RNG(mulberry32):同种子 → 同发牌序列,支持回放(§9 E9-3)

export interface Rng {
  readonly seed: number;
  next(): number;
  int(maxExclusive: number): number;
  shuffle<T>(arr: T[]): T[];
  /** 当前位置快照(用于模拟/回放) */
  snapshot(): number;
  restore(v: number): void;
  /** 复制一份互不影响的随机源(MC 模拟必须用这个,否则会推进真实牌局的随机序列) */
  clone(): Rng;
}

export function createRng(seed: number): Rng {
  let a = seed >>> 0;
  const next = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (maxExclusive: number): number => {
    if (maxExclusive <= 0) throw new Error("int() 需要正数上界");
    return Math.floor(next() * maxExclusive);
  };
  const shuffle = <T,>(arr: T[]): T[] => {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = int(i + 1);
      const tmp = arr[i];
      arr[i] = arr[j];
      arr[j] = tmp;
    }
    return arr;
  };
  return {
    seed: seed >>> 0, next, int, shuffle,
    snapshot: () => a,
    restore: (v: number) => { a = v >>> 0; },
    clone: () => createRng(a)
  };
}
