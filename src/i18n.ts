// 多语言:界面/日志/牌型文案目录 + 取值函数
//
// 设计要点(见 docs/glossary.zh-en.md):
//  · 术语是地基 —— 牌型名与动作名必须按术语表翻,直译会产生系统性误导
//  · 引擎事件本身是结构化的,只有「格式化层」(format/evaluator/cards)需要目录 —— 引擎不用改
//  · 协议值(牌 id / 动作名 FOLD CALL / 配置键)一律不翻
import type { Catalog } from "./locales/types.ts";
import { zh } from "./locales/zh.ts";
import { en } from "./locales/en.ts";

export type Locale = "zh" | "en";
export const LOCALES: readonly Locale[] = ["zh", "en"];
export const DEFAULT_LOCALE: Locale = "zh";

const CATALOGS: Record<Locale, Catalog> = { zh, en };

/** 把 Accept-Language / ?lang= 归一:en-US → en;不认识 → 默认中文 */
export function resolveLocale(raw: string | null | undefined): Locale {
  if (!raw) return DEFAULT_LOCALE;
  const first = String(raw).split(",")[0].trim().toLowerCase().split("-")[0];
  return (LOCALES as readonly string[]).includes(first) ? (first as Locale) : DEFAULT_LOCALE;
}

/** 取文案并插值:t("en", "event.ANTE_PAID", { seat: 2, amount: 45 }) */
export function t(locale: Locale, key: string, params?: Record<string, string | number>): string {
  const cat = CATALOGS[locale] ?? CATALOGS[DEFAULT_LOCALE];
  const raw = cat[key] ?? CATALOGS[DEFAULT_LOCALE][key];
  if (raw === undefined) return key;                 // 缺键时返回 key 本身,便于一眼看出漏翻
  if (!params) return raw;
  return raw.replace(/\{(\w+)\}/g, (m, name) => (name in params ? String(params[name]) : m));
}

export function keysOf(locale: Locale): string[] { return Object.keys(CATALOGS[locale] ?? {}).sort(); }
export function catalogOf(locale: Locale): Catalog { return CATALOGS[locale] ?? {}; }