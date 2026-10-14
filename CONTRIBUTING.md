# 贡献指南 / Contributing

## 最想要的贡献:一个能打的 AI

这个仓库本质上是个**不完全信息博弈擂台**。加一个 AI 只需要:

```ts
// src/ai/mybot.ts
import type { GameState } from "../state.ts";
import type { Policy } from "../env.ts";
import { enumerateActions } from "../env.ts";

export const makeMyBot = (): Policy => (state: GameState, rng) => {
  const acts = enumerateActions(state);
  return acts.find((a) => a.type === "CALL") ?? acts[0];
};
```

然后在 `src/ai/index.ts` 注册(`AI_NAMES` / `AGENTS` / `makeAgent` 三处),跑 `npm test`,
再用 `node examples/tournament.ts 5 6` 拿成绩。

### 可用的梯子

| 想做什么 | 看哪个文件 |
| --- | --- |
| 规则型 / 阈值型 | `src/ai/heuristic.ts`(性格只是一组参数) |
| 蒙特卡洛 rollout | `src/ai/montecarlo.ts` + `src/env.ts`(确定化 / rollout / 期望比较) |
| 精确胜率 | `src/ai/equity.ts`(未知牌空间 + 采样摊牌) |
| 自对弈学习 | `src/ai/learning.ts`(状态抽象 + Q 学习 + `examples/zerob-train.ts`) |
| 想接 LLM / Python / 别的模型 | 已内置:见 [docs/llm-entry.md](docs/llm-entry.md),设 3 个环境变量即可上桌 |

### 公平竞赛(硬性)

1. **不许偷看**:只能使用 `enumerateActions()` / `buildView()` 暴露的信息;不得读其他玩家的手牌、
   牌堆、未公开暗牌。
2. **不许改状态**:决策函数必须是纯的;不得在 `state` 上写字段。
3. **必须可复现**:随机数只用传入的 `rng`。
4. **必须合法**:返回的动作必须来自 `enumerateActions()`;非法动作按判负处理。

CI 会跑 `npm test`、引擎自测与 AI 冒烟;PR 里请附上擂台成绩(很容易复现)。

## 其他贡献

- 规则歧义 / 边界情况:开 issue 说清"局面 + 期望 + 实际",最好附种子和动作序列(可以直接存一份
  `data/replays/*.json` 作为证据 —— 一局只有 ~25 KB,能精确重演)。
- 文档:中英都欢迎;数字请标注样本量(本项目吃过"小样本看起来很强"的亏)。

## 开发约定

- `npm test`:98 条(穷举用例默认跳过,`EXHAUSTIVE=1` 时跑完整 92M 手牌枚举)。
- 不引入第三方依赖;Node ≥ 22.18,原生跑 `.ts`。
- 提交前请跑 `node src/cli.ts --selftest --games=8 --steps=800`(守恒 + INV1~INV9)。
