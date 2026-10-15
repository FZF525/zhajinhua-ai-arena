# Zha Jin Hua (5-card) — pure-scoring rules engine + AI arena

> English overview. The full documentation is in Chinese: **[README.md](../README.md)**.
> 中文完整文档见 [README.md](../README.md)(本文只是概览)。

A **zero-dependency TypeScript engine** for a *pure-scoring* (no real money) 5-card
**Zha Jin Hua** variant: 104 cards (13 ranks × 8 suits, 4 colour families), **12 hand tiers**,
blind/open play, deferred intercepts, kick + blockade rounds, head-to-head compares —
plus a built-in **AI arena** with 10 agents and a low-noise evaluation harness.

## At a glance

| | |
| --- | --- |
| **Rules** | 104 cards / 12 tiers / blind vs open play / compare / kick + blockade round / deferred intercept |
| **Tests** | **144** (143 pass, 1 exhaustive test skipped by default), incl. **91,962,520-hand exhaustive enumeration** |
| **Dependencies** | **0** — Node ≥ 22.18 runs the `.ts` files directly; no `npm install`, no build step |
| **AI** | **10 agents**: 3 rule-based · 3 Monte-Carlo · 3 exact-equity · 1 self-play (tabular Q-learning) |
| **Arena** | round-robin · grouped cup · 6-seat cyclic league · god-view spectating · seed-based replay (~25 KB/match, 0.5 ms/frame) |
| **External AI** | any OpenAI-compatible endpoint can take a seat — **view isolation** (it cannot see other hands) + explainable violations |
| **Measured** | In heads-up play vs Sam (60 matches × 6 hands): Brian **+578** · Yeon +453 · May +328 · ZeroB +137 · Baozi +11 · EQB −75 → **accuracy alone is not enough** |

## Quick start

```bash
git clone https://github.com/FZF525/zhajinhua-ai-arena.git && cd zhajinhua-ai-arena
node src/cli.ts --ai=human,Sam,May     # terminal: you + 2 AI seats
node web/server.ts                     # browser: play / spectate / replay  (http://127.0.0.1:8787)
node examples/tournament.ts 3 5        # round-robin ranking of all 10 agents
node --test test/*.ts                  # run the test suite
```

Everything is configurable: ante, fee table, ladders, hand tiers, win/bust thresholds, round caps,
compare rules (earliest round / blind-target protection / cost multiplier) and a **debt mode**
(points may go negative, bounded by a bust threshold).

## Findings worth reading (all measured, negative results included)

- **The most accurate bots finish last.** Three exact-equity bots (up to 1200 samples/decision) and three
  Monte-Carlo bots all lose heads-up to a conservative rule-based persona. Accurate equity ≠ good play.
- **Sample size dominates conclusions.** A 20-match comparison said "swapping a fallback policy is +197
  better"; a 200-match **paired** evaluation said it is **significantly worse**. A 30-table league ranked
  ZeroB #1; 100 tables dropped it to #4. The repo ships `examples/zerob-eval.ts` (paired seeds + t-statistic)
  precisely because of this.
- **Learn-from-self-play hits a ceiling.** Adding training volume, training with 4/6-player self-play
  (state coverage 12% → 57%), swapping the fallback policy, or re-weighting the reward
  (rank 0.5 / win 0.4 / points 0.1) produced **no significant gain** under paired evaluation.
- **Early compare is a sniping meta.** The first rules only restricted *blind players* from comparing;
  the *target* was unprotected, so ~**1.4 players per hand** were eliminated before ever seeing their cards.
  A blind-target protection rule cuts that to ~0.2 (−85%) without reducing the compare rate materially —
  raising the compare *price* had **no effect** (the built-in bots ignore its cost).
- **LLM seats work, but the protocol is the hard part.** Four integration pitfalls (empty completions from
  reasoning models, extra fields breaking action matching, parameters nested inside `action`, self-contradictory
  prompts) all looked like "the model can't play" and all turned out to be interface bugs.

## Layout

```text
src/         engine (cards / rng / evaluator / costs / validate / engine / state), AI, CLI
web/         zero-dependency node:http server + static UI (hot-seat, spectating, replay bar)
examples/    benchmarks, tournaments, probes, LLM duel, self-play training, paired evaluator
test/        144 node:test cases (engine invariants, privacy contracts, AI behaviour, live-server smoke test, bluff rules)
docs/        llm-entry.md · add-an-ai.md · lessons.md (engineering pitfalls) · this file
```

## Documentation

| Doc | What |
| --- | --- |
| [README.md](../README.md) | Full docs (Chinese): rules, configuration, measured balance data, arena |
| [docs/llm-entry.md](llm-entry.md) | Put an LLM on the table: 3 steps, JSON contract, cost/speed, leaderboard |
| [docs/add-an-ai.md](add-an-ai.md) | Write a new AI (~20 lines) or improve the built-in ones; fairness rules; evaluation protocol |
| [docs/lessons.md](lessons.md) | Engineering pitfalls we actually hit, each with a regression test |

## Compliance

Pure-scoring entertainment only: no real money, no deposits/withdrawals, no cash-out, no rake,
and no real-money mode. MIT licensed.
