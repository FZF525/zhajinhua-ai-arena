# 造一个新的 AI(或者把 Sam 改强)

> 这份文档面向想给这个项目加"选手"的人。两种玩法:**写本地 AI(本文重点)** 和 **接 LLM**(见 [llm-entry.md](llm-entry.md))。

## 1. 最小模板:20 行就是一个能上桌的 AI

```ts
// src/ai/mybot.ts
import type { Policy } from "../env.ts";
import { enumerateActions } from "../env.ts";
import { player, isAlive } from "../state.ts";
import { callCost } from "../costs.ts";

export function makeMyBot(): Policy {
  return (state, rng) => {
    const seat = state.turn.seat!;
    const me = player(state, seat);
    const acts = enumerateActions(state);          // ← 唯一合法动作来源,别自己造
    const of = (t: string) => acts.find((a) => a.type === t);

    // 例:一直跟注,直到太贵就弃
    const call = of("CALL");
    if (call && callCost(state, seat).total <= me.points * 0.05) return call;
    return of("FOLD") ?? acts[0];
  };
}
```

**接口**:`type Policy = (state: GameState, rng: Rng) => Action | null`
返回 `null` 表示"这步我不决定"(引擎会跳过你,慎用)。

### 动作字段速查(写错字段 = 直接被判非法)

| type | 必填字段 | 备注 |
| --- | --- | --- |
| `VIEW_HAND` | — | 看牌,之后跟注从半价变全价 |
| `CALL` / `FOLD` | — | |
| `RAISE` | `toMultiplier` | 只能是阶梯上的**下一档**(`nextLadderValue`) |
| `COMPARE` | `targetSeat` | 比牌,输者出局 |
| `EXCHANGE` | `takeCardId`, `giveCardId` | 从公共池换入自己一张 |
| `KICK` | `targetCardId` | 踢明牌补暗牌,进入封锁轮 |
| `INTERCEPT` | `giveCardId` | 截胡刚被换走的牌 |
| `TAKE_BLOCKED` / `PASS_BLOCKED` | `giveCardId` / — | 封锁轮收束到自己时 |
| `DECLINE_INTERCEPT` | — | 放弃截胡 |

**别猜合法性**:一律通过 `enumerateActions(state)`(返回带参数的合法动作)挑一个返回;引擎还会再校验一遍(`validate.ts`)。
唯一例外是 `enumerateActions` 不返回的类型,那就不要用。

## 2. 公平性铁律(最重要的一条)

**本地 AI 拿到的是完整 `GameState`,里面包含对手的手牌。** 也就是说:**技术上你能作弊,规矩上你不该看。**

- ✅ 可以看:自己的手牌、公共池、自己的已投注、各家积分/状态、轮次/倍数、历史事件
- ❌ 不要看:`state.players[别人].hand`、`state.deck`、别人踢出的暗牌

需要"对未知做推理"时,用现成的工具:

```ts
import { determinize, enumerateActions, rollout } from "../env.ts";
// determinize:把"未知牌"按公平随机重排,得到一手可推演的完整局面
const world = determinize(state, seat, rng);
```

参考实现:`montecarlo.ts`(采样 + rollout)、`equity.ts`(精确胜率)。**LLM 那条路不用担心这个** —— 服务端用 `buildView` 裁剪过,它物理上看不到不该看的(用例 `RM-01`/`WEB-12` 盯着),日志里的暗牌也脱敏了。

> 如果你的 AI 只用合法信息,可以在 PR 里说明;想更硬一点,可以加一个测试:把对手手牌换成随机牌后,你的决策应当**不变**(这是"没偷看"的可检验证据)。

## 3. 注册(3 处,加完自动出现在 CLI / Web / 擂台)

1. 新模块导出 `MY_NAMES` / `MY_PROFILES` / `makeMyBot`
2. `src/ai/index.ts`:加进 `AI_NAMES`、`AGENTS`(给 name/label/kind/note)、`makeAgent` 的分派
3. 完成。CLI 的 `--ai=`、Web 的座位下拉、`tournament.ts`/`grouped-cup.ts`/`six-table-league.ts` 都会自动带上它

## 4. 必须配的测试(照抄现成的)

`test/ai.test.ts` 里有现成套路,至少覆盖:

```ts
test("我的AI:只走合法动作 / 积分守恒 / 不变量成立", () => {
  const st = createGame(makeConfig({ players: { startPoints: 20000 }, endGame: { maxHands: 3, winAtOrAbove: 1e9, bustAtOrBelow: -1 } }), ["A","B","C"], 7);
  advance(st);
  const bot = makeMyBot();
  const rng = createRng(1);
  let steps = 0;
  while (!st.gameOver && steps++ < 5000) {
    const seat = st.turn.seat; if (seat === null) break;
    const legal = enumerateActions(st).map((a) => JSON.stringify(a));
    const act = bot(st, rng)!;
    assert.ok(legal.includes(JSON.stringify(act)), "返回了非法动作:" + JSON.stringify(act));
    assert.ok(apply(st, act).ok);
  }
  assert.deepEqual(checkInvariants(st), []);            // INV1~INV9
});
```

跑测试:`node --test test/*.ts`(零依赖,不用装任何东西)

## 5. 评估:三条铁律(我们用血换的)

| 铁律 | 为什么 |
| --- | --- |
| **1. 口径必须写清楚** | 同一个 ZeroB 在 **4 人局是 −30/场**,在 **6 人桌是 +401/场**。单挑、4 人、6 人是三个不同的游戏 |
| **2. Sam 不是多人局基准** | Sam 在 6 人桌场均 **−248.8,垫底**。README 那张"vs Sam 单挑"的表**只对单挑有效** |
| **3. 少于 100 场别下结论** | 我们用 20 场算出"+197 换兜底更好",200 场配对后变成**显著更差** |

工具(都在 `examples/`):

```bash
node examples/ai-bench.ts --ai=Baozi,Sam --hands=20      # 单挑基准
node examples/tournament.ts 2 5                          # 两两循环赛
node examples/grouped-cup.ts 2 5 2                       # 分组赛(小组+决赛+安慰赛)
node examples/six-table-league.ts 3 6                    # 6 人桌循环联赛(30 桌 75 秒)
$env:LEAGUE_DETAIL="1"; node examples/six-table-league.ts 3 6   # 带每桌明细
node examples/zerob-eval.ts "data/zerob.json#EQBfast" "另一张表#EQBfast" 200 6 multi4   # 配对评估 + t 检验
```

**配对评估**是重点:两个策略跑**同一批种子**、逐场做差值,噪声比"各跑一遍比均值"小一个量级 —— 这是能分辨 ±20 分差异的唯一办法。

## 6. 把 Sam 改强:从数据出发的四个假设

**现状(Sam 在 6 人桌联赛的数据)**:

| 指标 | Sam | 对比:ZeroB |
| --- | --- | --- |
| 净分 | **−4479**(垫底) | +7223 |
| 场均净分 | **−248.8** | +401.3 |
| 盈利桌 | 5/18(28%) | **13/18(72%)** |
| 最大单桌赢 / 输 | +877 / **−1368**(全场最大亏损) | +1812 / −506 |

**画像很清楚:Sam 输的时候输得特别大,赢的时候赢得不多。** 而它的参数恰好是"中间档":

```ts
Sam:   { foldBelow: 2, raiseAt: 4, compareAt: 5, maxCostRatio: 0.05, ... }
Baozi: { foldBelow: 3, raiseAt: 6, compareAt: 7, maxCostRatio: 0.02, ... }   // 保守:−863
Lucas: { foldBelow: 1, raiseAt: 2, compareAt: 3, maxCostRatio: 0.12, ... }   // 激进:−518
```

**中间档在 6 人桌最差(−4479),比保守和激进都差** —— 这不是"参数不够好",而是暴露了三个结构问题:

### 假设 1:阈值不随桌型变化(最可能的主因)

`foldBelow: 2` 的意思是"牌力档 < 2 就弃",也就是"有一对就跟"。**这在单挑里合理,在 6 人桌里是灾难** —— 你要同时赢 5 个人。
→ 试:把阈值按存活对手数上调,例如 `foldBelow + (对手数 - 1)`,`compareAt` 同理。
(`mainDecision` 里已经算了 `opponents`,但只用在比牌分支里 —— 把它用在主阈值上是最小改动。)

### 假设 2:没有赔率纪律

`maxCostRatio 0.05` 管的是"单步能付多少",**没有任何"跟注成本 / 底池"的门槛**。
→ 试:跟注前算 `price = call / (pot + call)`,牌力隐含胜率低于 `price` 就弃(`equity.ts` 的做法可以直接借)。

### 假设 3:尾部风险没有上限

最大单桌亏 **−1368** 说明它在巨池里用中等牌跟到底。
→ 试:限制"单手累计投入 ≤ 初始积分的 X%"(比如 5%),超过就只允许比牌或弃牌。

### 假设 4:对照实验本身

改完别忘了**用同一批种子做配对评估**,并且**同时报净分、平均名次、盈利桌数** —— 只报净分会漏掉"赢大输小"这种关键性质(ZeroB 强的正是这个)。

```bash
node examples/six-table-league.ts 3 6                    # 改前
# ...改代码...
node examples/six-table-league.ts 3 6                    # 改后(同种子,直接对比)
```

> 提醒:`PROFILES` 被 `heuristic.ts`、CLI、Web、擂台共用,改 Sam 等于改了所有地方的 Sam ✓ 想保留旧版做对照,复制一份叫 `Sam2` 更安全。

## 7. 性能预算

| 参考 | 单张 6 人桌(6 局) |
| --- | --- |
| 常规 AI 阵容 | 2.5 ~ 5.1 秒 |
| 最慢的 EQBnaive(1200 次胜率采样) | 是整桌耗时的主要来源 |

建议**单步决策 < 5ms**;要大量采样就降采样数(EQBfast 用 200 次、MC 用 10~24 次 rollout 是实测过的平衡点)。

## 8. 提交清单

- [ ] 新 AI 文件 + `src/ai/index.ts` 注册
- [ ] `test/ai.test.ts` 加用例(合法性 / 守恒 / 不变量)
- [ ] 至少 **100 场配对评估**的结果(写清口径:几人桌、种子、场次)
- [ ] README 的 AI 列表加一行(名字 / 风格 / 实测战绩)
- [ ] `node --test test/*.ts` 全绿
