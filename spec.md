# 五张牌炸金花变体 · 规则规格书 (spec.md)

> 版本: **v1.9.2-frozen(下注轮安全阀)**
> 说明:v1.7 新增 `fold.revealToAll`(默认 **true**):弃牌时把该玩家手牌公开给所有人,便于算牌 —— 本变体的公共池是共享信息,"哪些牌已出局"直接影响换牌/踢牌/截胡的概率判断。
> 说明:v1.6 把截胡从"立即窗口"改为"**挂起待截胡 · 下家回合内执行**",并取消补换窗口(被截者自动收下对方放回的牌)。规则动机:让第 1 轮也能截胡、热座只交接一次设备。
> 说明:v1.4 在 v1.3「费用表整体等比缩放」之上,固化两个分场档位(**小分场 ×10 / 大分场 ×25**)与「按人数自适应」助手,实测见 `9.2。
> 说明:v1.3 新增**费用表整体性约束** —— 底注 / 跟注基准 / 换牌费 / 踢牌费必须整体等比缩放(`scaleEconomy`),单独放大其中一项会破坏机制权重(实测见 `9.2)。
> 说明:v1.1 把实现中必须确定的三个口径写死(`7.4 截胡三步结算、`7.5 封锁轮收束点、`6.3 回合循环推进);v1.2 按确认把终局阈值 50000 降到 **40000**,并新增 **endGame.maxHands(默认 20 局)** —— 打满局数后按积分排名收场,优先级低于阈值与破产。
> 状态: **全部待确认问题已定案** —— Q1 数值、Q2 比牌与平局、Q4 封顶后 2 轮摊牌、Q21 方案 B 12 档;其余(Q3、Q5~Q20、Q22~Q27)一律按 `11 表中「推荐默认」执行,需要改动时改配置项即可。
>
> **变更记录**
> - **v1.9.1(擂台 + A/B)**:新增 `examples/tournament.ts` 循环赛;ZeroB 支持"精确胜率分桶"特征(`zerobKey(s, seat, { equitySamples })`)并做 A/B —— 结论:**当前瓶颈是训练量与评估精度,不是特征强度**(状态覆盖仅 ~6%,换特征无显著提升)。
> - **v1.9.2(下注轮安全阀)**:① **修挂死**:封顶依赖"加注抬到阶梯顶端",全员只跟注时 M 永远停在起点 → 封顶不成立 → 强制摊牌不触发 → 牌局可无限进行(实测 1250 轮未结束);新增 `betting.maxRounds`(**默认 16**,`null`=不限),打满即强制摊牌。② 新增用例 `E2E-22`。③ 实测:四人局平均每局 **2.13 次比牌**,**38%** 的牌局有人整局没轮到就被比掉(M=1 时比牌仅 4 分)。
> - **v1.9(EQB / ZeroB)**:① 新增 `src/ai/equity.ts`(精确胜率:未知牌空间 = 牌堆 + 存活对手手牌 + 别人踢的暗牌;采样比较摊牌 → 期望底池份额)与三档 EQB 角色;② 新增 `src/ai/learning.ts`(ZeroB:状态抽象 ≈1560 格,自对弈 Q 学习,主决策学习、辅助动作借用启发式,表存 `data/zerob.json`,未训练时退回 EQBfast);③ 新增 `examples/zerob-train.ts` 训练/评估脚本;④ 实测结论:**精确胜率算得对 ≠ 决策规则对** —— 三个 EQB 变体单挑 Sam 全为负(纯赔率会一路跟到封顶、放弃闷牌折扣、忽略换牌/踢牌、按胜率加注),而学出来的 ZeroB 为正。
> - **v1.8.2(视角座位)**:① `buildView` 新增 `viewer`(视角座位):手牌公开判定由"是否行动者"改为"是否视角座位",`server` 在**单人局**(恰好 1 个真人座位)时把视角锁死在该座位、多人同屏才跟随行动者 —— 修掉"轮到哪个 AI 就看到哪个 AI 的牌"。② 本局结算期间(`HAND_START`/`GAME_OVER`)**全部手牌摊开**,便于复盘。③ 前端操作区只在"轮到自己"时显示,避免误点 AI 的动作。④ view 新增 `viewerSeat` / `isMyTurn`。
> - **v1.8.1(局间结算)**:① **修 bug**:一局结算后未清 `turn.seat`/`pendingIntercept`,导致"局间暂停"时行动者残留在上一个人身上 —— 视图会把他当作行动者公开手牌,`/api/step` 也会误判有行动者;现在 `settle()` 收尾统一清空。② 新增局间暂停与结算展示(原因/底池/赢家/每家本局净收支/公开手牌与牌型),`view` 只在 `HAND_START` 或 `GAME_OVER` 暴露 `settlement`,新局开始自动收起。③ 玩家状态新增 `pointsAtHandStart` 作为本局净收支基准。④ 前端遮屏改为"默认关闭 + 热座开关"(单人对 AI 不再每回合弹窗)。⑤ 服务端新增 `POST /api/next-hand`。
> - **v1.8(观战 / 回放)**:① 新增对局存档(每次动作都记,一局 20~35 KB);② `GET /api/replay/frame` 现算任意一步的上帝视角(**不缓存帧**,0.48ms/步);③ 前端时间轴(播放/暂停/拖动/跳到关键事件/下载/删除);④ 上帝视角开关(观战用);⑤ 前端逐步推进 AI(`/api/step` 一次一步,速度可调)
> - **v1.7(弃牌亮牌)**:① 新增 `fold.revealToAll`(默认 true);② 弃牌事件 `FOLDED` 带上 `revealed`(5 张牌面),日志/UI 都能看到;③ 视图层对**已弃牌且开启亮牌**的玩家公开手牌;④ MC 的确定化**不再重洗已亮出的弃牌**(已知信息)→ AI 真正开始"算牌";⑤ 新增用例 E2E-21 / WEB-09 / AI-09。
> - **v1.6(截胡挂起式)**:① 换牌后只挂起 `pendingIntercept`,不打断回合;② 截胡在**紧邻下家自己的回合内**执行,允许先看牌再截(第 1 轮即可截胡);③ 取消 `RETAKE/SKIP_RETAKE` 补换窗口,被截者**立即自动收下**截胡者放回的牌(想换别的在自己回合正常换牌);④ 新增事件 `INTERCEPT_OFFERED`/`INTERCEPT_EXPIRED`,状态字段改名 `pendingIntercept`;⑤ 用例 E2E-04/05/05b/05c/14b 重写,测试 64 条。
> - **v1.4(分场档位)**:① 固化 `TABLE_PRESETS = { small: ×10, big: ×25 }` 与 `makeTableConfig(size)`;② 新增 `SCALE_BY_PLAYERS` / `suggestScale` / `makeBalancedConfig(playerCount)`(人数越多、所需 k 越小);③ CLI 新增 `--table=small|big`;④ 补实测表与 CFG-06/CFG-07 用例。
> - **v1.3(费用表刻度)**:① 新增 `8.1「费用表整体性约束」与 `scaleEconomy(cfg, k)` 工具(整表等比缩放);② 实测证实"等比放大 k 倍费用 ≡ 把初始积分缩小 k 倍",机制权重不变;③ 纠正 v1.2 期间"底注 125/250/500"那组失真的对照实验(只放大底注、比例被破坏),其结论作废;④ 新增 CFG-01~CFG-05 用例。
> - **v1.2(终局参数)**:① 阈值 50000 → **40000**;② 新增 `endGame.maxHands`(默认 **20**),整场打满即按积分排名结束,结束原因 `MAX_HANDS`,优先级 **阈值 > 破产 > 局数上限**;③ 新增 Q28/Q29 与用例 E2E-17~E2E-19 / S-13~S-15;④ 附实测数据(`9.2 脚注)。
> - **v1.0(定稿冻结)**:① Q3、Q5~Q20、Q22~Q27 全部按推荐默认值执行(用户确认"基本按你的来");② 修正内部不一致:K-05 原禁并存封锁轮,与 E2-10/Q7b 冲突 → 改为**允许多个封锁轮并存**(每张暗牌互不干扰,各自 kicker 各自收束);③ 进入实现阶段,代码以本规格为准。
> - **v0.6(Q4 摊牌定时定案)**:① **M 封顶后再打满 2 个下注轮即强制摊牌**(封顶当轮不计入,可配置);② 两人残局**不**强制自动比牌,玩家可继续下注或自选比牌;③ 封顶后不可再加注;④ 强制摊牌前若有未决封锁轮,暗牌先即时公开(E2-11);⑤ 新增 `6.4、B-12~B-15、K-14、E10-16。
> - **v0.5(Q2 比牌定案)**:① 比牌规则补全 —— 费用 2 × rate × M(看牌 4M / 闷牌 2M)、任意存活对手、**输者弃牌退场**、**平局双方均不出局并继续对局**、**仅当存活玩家全属同一平局连通分量时本局结束并瓜分底池**;② 闷牌者须走完 **3 个下注轮**后才可盲比(第 4 轮起),盲比不解除闷牌;③ 比牌占用回合主决策,每回合至多 1 次;④ 新增 `7.6 重写、`10 E10 边界 15 条、`12.9 用例 15 条、termination 证明;⑤ 校验码新增 ERR_BLIND_COMPARE_TOO_EARLY / ERR_COMPARE_ALREADY_USED,D 组重新编号。
> - **v0.4(方案 B 定案)**:① 牌型改为 **12 档** —— 同花 / 同花顺按**花色**,同色 / 同色顺按**色系**,两者并存;② 全部组合数改为**穷举 91,962,520 手牌**的精确统计(12 类合计守恒、稀有度严格单调),并修正旧表"四条 91,000"之误(应为 87,360);③ 新增 `3.5 互斥/包含关系与 `3.7 比牌速查;④ 取消 ui.naming 别名开关;⑤ 用例 H-01~H-27 按 12 档重写。
> - **v0.3**:排序表新增「别名(传统扑克)」列,同花 / 同花顺 作为**显示别名**回归界面(不新增牌型、不改逻辑);新增 `3.7 别名策略 + 可选「12 牌型豪华模式」的稀有度重排表;新增配置 ui.naming 与用例 H-27/H-28;新增 Q21。
> - **v0.2**:① Q1 定案 —— 初始 20000 / 阈值 50000(8000/16000 系未改全的旧稿残留,废弃);② **术语修正** —— 原稿把「同花(花色)」与「同色(色系)」混用,现统一为 **同色(同色系五张)** 与 **同色顺**,并补充"按花色判定会崩坏排序"的证明(`3.6);③ 新增回归用例 H-24 ~ H-26。
> - v0.1:首版设计稿。
> 性质: **纯积分制娱乐游戏,不涉及真钱、不支持真钱玩法、不提供充值/提现入口。**
> 技术栈建议: TypeScript + Node.js,核心引擎与 UI 分离,所有参数可配置。

---

## 0. 文档目的与范围

本文档只做设计交付,不写实现。包含:

1. 规则规格书(本文档主体)
2. 数据结构定义(`5)
3. 状态机流转(`6)
4. 操作校验条件与费用计算(`8)
5. 边界情况清单(`10)
6. 待确认问题(`11)
7. 单元测试清单(`12)
8. 模块划分与里程碑(`13)

设计原则:

- **引擎纯函数化**:核心引擎 `reduce(state, action) -> {state, events}`,不依赖 IO / 时钟 / UI。
- **一切可配置**:费用、上限、阈值、牌型排序、倍数阶梯全部走 Config,引擎内不出现魔法数字。
- **确定性**:所有随机走可注入的 RNG(种子化),保证回放与测试可复现。
- **可审计**:每一笔积分流动都产生 Event,便于回放与守恒校验。

---

## 1. 术语表

| 术语 | 英文/ID | 含义 |
| --- | --- | --- |
| 色系 | ColorFamily | 红/黑/蓝/金 四组「颜色家族」,**牌型同色判定以它为唯一依据** |
| 花色 | Suit | 8 种符号(♥ ♦ ♠ ♣ ❄ 💧 ⭐ 🌙),隶属色系,**只用于牌面身份,不参与比大小** |
| 同花 | FLUSH | 5 张牌同一**花色**(suit) |
| 同花顺 | STRAIGHT_FLUSH | 5 张牌同一**花色**且点数连续;A-K-Q-J-10 称皇家同花顺 |
| 同色 | SAME_COLOR | 5 张牌同一**色系**(family) |
| 同色顺 | SAME_COLOR_STRAIGHT | 5 张牌同一**色系**且点数连续,但非同花色 |
| 明牌 | OpenCard | 公共池正面朝上的牌 |
| 暗牌 | BlockedCard | 踢牌补入的、仅踢牌者可见的公共池牌 |
| 闷牌 | Blind | 玩家未查看自己 5 张手牌的状态 |
| 看牌 | Seen | 已查看(或换走暗牌/查看手牌后失去闷牌) |
| M | Multiplier | 当前倍数,初始 1,可升为 2/4/8/16/32 |
| 底池 | Pot | 所有底注与操作费的聚合,不抽水 |
| 换牌 | EXCHANGE | 用公共池 1 张明牌替换手牌 1 张 |
| 截胡 | INTERCEPT | 紧邻下家抢走别人刚换走的牌 |
| 踢牌 | KICK | 踢走一张"未被选取"的公共明牌,系统补 1 张暗置牌 |
| 封锁轮 | BLOCKADE | 踢牌补入暗牌的禁选保护期 |
| 比牌 | COMPARE | 指定一名对手暗比,输者出局 |
| 比牌 | COMPARE | 指定一名存活对手暗比,输者弃牌退场;平局继续(`7.6) |
| 盲比 | Blind Compare | 闷牌者在走完 3 个下注轮后发起的比牌,双方均不看牌 |
| 平局分量 | Tie Component | 由本局平局对构成的连通分量,用于判定"是否只剩平局者" |
| 经手人 | HolderHistory | 一张牌历史上到过手的所有玩家集合 |

> **术语与口径(v0.4)**:原需求的"8 花色、4 色系"与"同花按色系判定"互相打架——"花"指花色、"色"指色系。v0.2~v0.3 曾把两者合并成单一「同色」;v0.4 按确认改为**方案 B:两个概念都保留为独立牌型**——按**花色**判者为「同花 / 同花顺」,按**色系**判者为「同色 / 同色顺」,共 12 档,详见 `3。

---

## 2. 牌堆与花色

### 2.1 结构

- 点数 13 种:2,3,4,5,6,7,8,9,10,J,Q,K,A(A 记为 14,可作 1 用于低顺)
- 花色 8 种,分 4 色系,每色系 2 个花色
- 每点数 8 张(每花色 1 张),总计 **13 × 8 = 104 张**,无大小王

| 色系 | ID | 花色 | 符号 | 主色 | 建议底色(小尺寸区分) |
| --- | --- | --- | --- | --- | --- |
| 红 | RED | HEART | ♥ | #FF0000 | — |
| 红 | RED | DIAMOND | ♦ | #FF0000 | — |
| 黑 | BLACK | SPADE | ♠ | #000000 | — |
| 黑 | BLACK | CLUB | ♣ | #000000 | — |
| 蓝 | BLUE | SNOW | ❄ | #0077FF | 深蓝底 |
| 蓝 | BLUE | DROPLET | 💧 | #0077FF | 浅蓝底 |
| 金 | GOLD | STAR | ⭐ | #FFB300 | 金色底 |
| 金 | GOLD | MOON | 🌙 | #FFB300 | 银灰底 |

### 2.2 判定约定(双基准:同花看花色,同色看色系)

- **同花 / 同花顺**:判定只读 Card.suit,要求 5 张牌同属一个花色。
- **同色 / 同色顺**:判定只读 Card.family,要求 5 张牌同属一个色系。
- 两者是独立牌型(12 档排序见 `3.1),不得互相替代,也不互为别名。
- 同色系内两个花色**不比大小**(红花 ♥ 与 ♦ 完全等价,黑 ♠ 与 ♣ 等价)。
- 因此不存在"同牌型同点数,再比花色"的情况;一律平局(`9.4)。
- CardId 建议编码:`{SUIT}-{RANK}`,例如 `HEART-A`、`SNOW-10`、`MOON-7`。

### 2.3 容量约束

- 发牌约束:players × handSize + poolSize ≤ 104,默认 5/7 → **单局最多 19 人**,建议 MVP 支持 2~6 人。
- 踢牌补牌从剩余牌堆取;若牌堆耗尽(理论不可达)按边界 E9-2 处理。

---

## 3. 牌型判定与排序(方案 B:双基准 12 档)

> 本版采用**方案 B**:「同花」按**花色(suit)**、「同色」按**色系(family)** 作为两个独立牌型并存,共 **12 档**。
> 下表全部组合数由**穷举全部 91,962,520 手牌**精确统计得出,12 类合计严格等于 C(104,5),且组合数**严格单调递增** —— 排序 = 稀有度,无并列档。

### 3.1 排序(从大到小)

| 序 | tier | 牌型 | 判定 | 英文 / ID | 组合数 | 概率 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 12 | 同花顺 | 5 张同一**花色**且连续 | STRAIGHT_FLUSH | 80 | 0.000087% |
| 2 | 11 | 五条 | 5 张同点数 | FIVE_OF_A_KIND | 728 | 0.000792% |
| 3 | 10 | 同色顺 | 5 张同一**色系**且连续,但非同花色 | SAME_COLOR_STRAIGHT | 1,200 | 0.001305% |
| 4 | 9 | 同花 | 5 张同一**花色**,非连续 | FLUSH | 10,216 | 0.011109% |
| 5 | 8 | 四条 | 4 张同点数 + 1 张散 | FOUR_OF_A_KIND | 87,360 | 0.094995% |
| 6 | 7 | 葫芦 | 3 张同点数 + 1 对 | FULL_HOUSE | 244,608 | 0.265987% |
| 7 | 6 | 同色 | 5 张同一**色系**,非同花色、非连续 | SAME_COLOR | 251,624 | 0.273616% |
| 8 | 5 | 顺子 | 点数连续,但非同色系 | STRAIGHT | 326,400 | 0.354927% |
| 9 | 4 | 三条 | 3 张同点数 + 2 张散 | THREE_OF_A_KIND | 3,075,072 | 3.343832% |
| 10 | 3 | 两对 | 2 对 + 1 张散 | TWO_PAIR | 5,374,512 | 5.844242% |
| 11 | 2 | 一对 | 1 对 + 3 张散 | ONE_PAIR | 40,909,440 | 44.484905% |
| 12 | 1 | 高牌 | 以上皆非 | HIGH_CARD | 41,681,280 | 45.324204% |
| — | — | **合计** | — | — | **91,962,520** | 100% |

- A-K-Q-J-10 **同花色** = **皇家同花顺**;引擎打 isRoyalFlush 标记,仅用于播报,不影响比较。
- 与旧版(10 档)相比的关键变化:**同花顺升为第一大牌(超过五条)**;**同花从第 5 位升到第 4 位(超过四条)**;新增「同色顺」「同色」两档。

### 3.2 判定流程(按顺序检查,第一个命中即为最终牌型)

1. **同花顺** —— 5 张同一花色 且 连续
2. **五条** —— 5 张同点数
3. **同色顺** —— 5 张同一色系 且 连续
4. **同花** —— 5 张同一花色
5. **四条** —— 4 张同点数
6. **葫芦** —— 3 张同点数 + 1 对
7. **同色** —— 5 张同一色系
8. **顺子** —— 5 张点数连续
9. **三条** —— 3 张同点数 + 2 张散
10. **两对** —— 2 对 + 1 张散
11. **一对** —— 1 对 + 3 张散
12. **高牌** —— 以上皆非

顺序本身即保证互斥:走到第 3 步时同花顺已被取走,第 4 步的"同花"必然不连续,第 7 步的"同色"必然非同花色且不连续(`3.5 给出等值判定式)。

顺子口径:A 可最大(A-K-Q-J-10),也可最小(A-2-3-4-5,最大牌记 5);**不允许 K-A-2-3-4 之类环绕顺**。

### 3.3 踢脚比较键(compare key)

比较时先比 tier,再按 key 从左到右字典序比较,全等则平局。

| 牌型 | key 组成(降序) |
| --- | --- |
| 同花顺 | [最大牌(低顺记 5)] |
| 五条 | [点数] |
| 同色顺 | [最大牌(低顺记 5)] |
| 同花 | [5 张降序] |
| 四条 | [四条点数, 踢脚] |
| 葫芦 | [三条点数, 对子点数] |
| 同色 | [5 张降序] |
| 顺子 | [最大牌(低顺记 5)] |
| 三条 | [三条点数, 踢脚降序(2 张)] |
| 两对 | [大对, 小对, 踢脚] |
| 一对 | [对子, 踢脚降序(3 张)] |
| 高牌 | [5 张降序] |

tier 与牌型一一对应,因此同一 tier 内 key 长度恒等,字典序比较无需长度特判。

### 3.4 概率校验(穷举验证,不是估算)

用一个穷举程序遍历全部 C(104,5) = 91,962,520 手牌,按 `3.2 顺序分类:

- 12 类合计 **恰好等于** 91,962,520(守恒校验通过);
- 12 类组合数**严格单调递增**,与 tier 降序完全一致;
- 交叉校验全部吻合:
  - 同花顺 80 = 8 花色 × 10 个连续序列
  - 同色顺 1,200 + 同花顺 80 = 1,280 = 4 色系 × 10 序列 × 2⁵ 花色组合
  - 同花 10,216 + 同花顺 80 = 10,296 = 8 × C(13,5)
  - 四条 87,360 = 13 × C(8,4) × 96(踢脚必须取自另外 12 个点数)

> **修正记录**:旧版表格中的 四条 = 91,000 是错的 —— 13 × C(8,4) × 100 会把 3,640 手五条重复计入。本版一律以穷举结果为准;穷举耗时约 1 秒,已列为常规回归用例 H-24。

关键结构性事实:**8 花色、每花色 13 张** 这个设定让"同花色"极其稀有(同花顺仅 80 手、同花 10,216 手),这正是方案 B 下排序大幅变化的原因。

### 3.5 互斥与包含关系(为什么"取最稀有"与"首个命中"等价)

- **包含关系**:同花 ⊂ 同色、同花顺 ⊂ 同色顺(每个花色只属于一个色系)。因此同花 / 同花顺**必须排在**同色 / 同色顺之前判定,否则会被吃掉。
- **不可能共存(数学保证)**:
  - 同花 / 同花顺 ✗ 任何含对子的牌型:同一花色下每个点数只有 1 张;
  - 同色 / 同色顺 ✗ 三条 / 葫芦 / 四条 / 五条:同一色系下每个点数只有 2 张;
  - 五条必然是 5 个不同花色(每花色每点数 1 张)。
- **唯一真正会发生的"升级"是色系**:两对 / 一对 / 高牌若 5 张恰好落在同一色系,按顺序判为「同色」。
  - 「同色」251,624 手的构成:含对子 98,384(其中两对 6,864、一对 91,520)+ 五张不同点数 153,240
  - 反推验证:两对 5,374,512 = 5,381,376 − 6,864;一对 40,909,440 = 41,000,960 − 91,520

结论:"复合牌型按最稀有牌型算"与"从高到低第一个命中"在本牌堆下等价,引擎只需实现 `3.2 的顺序判定,并保证同花先于同色。

### 3.6 术语口径(两个概念都是真牌型)

- **同花 / 同花顺 = 花色(suit)**,8 种符号之一(♥ ♦ ♠ ♣ ❄ 💧 ⭐ 🌙)。
- **同色 / 同色顺 = 色系(family)**,红 / 黑 / 蓝 / 金。
- 二者在本版是**两个独立牌型**,不再互为别名,原 `ui.naming` 别名开关取消。
- 工程硬约束:同花 / 同花顺判定**只读 Card.suit**;同色 / 同色顺判定**只读 Card.family**;两者不得互相替代。

### 3.7 比牌速查(方案 B 的直接收益)

比牌逻辑只有两步:

1. 比 **tier**(12 → 1),大者胜;
2. tier 相同,按 **key** 从左到右字典序比较;完全相同即**平局,平分底池**(不分花色)。

代码骨架:

    evaluate(cards) -> { category, tier, key, isRoyalFlush }
    compare(a, b)   -> a.tier !== b.tier
                         ? Math.sign(a.tier - b.tier)
                         : lexCompare(a.key, b.key)          // 0 = 平局
    settle: 平局者平分底池(余数按 Q10)

因为 12 档**互不重叠且不嵌套**(`3.5),比牌不需要任何"同牌型内再分支"的特殊逻辑,统一走 (tier, key) 即可。这也是选方案 B 的直接收益:

- 每个牌型都是一条**自洽的单词谓词**,好实现、好单测;
- 玩家一句话能说清自己是什么牌("我同花""我同色顺"),播报不需要别名;
- 强弱差异更大(同花顺 80 手 vs 高牌 4,168 万手),比牌的悬殊感更强。

---

## 4. 配置体系(Config)

设计目标:引擎内零魔法数字。以下为字段草案(值取自题目,冲突项见 Q1)。

    interface GameConfig {
      version: string;

      deck: {
        ranks: number[];                 // 13 个点数
        suits: SuitDef[];                // 8 花色 + 色系映射
        perRankCopies: number;           // 8
        jokers: 0;                       // 固定无王
      };

      players: {
        min: 2; max: 6;                  // 建议 MVP 范围
        handSize: 5;                     // 每人手牌数
        startPoints: number;             // 初始积分,默认 20000(旧稿 8000 未改全,已废弃)
      };

      pool: { openCards: number };       // 公共池固定 7 张明牌

      ante: { amount: number; scaledByMultiplier: false };   // 1 分,不乘 M

      betting: {
        baseMultiplier: 1;
        ladder: number[];                // [2,4,8,16,32]
        seenRate: number;                // 2
        blindRate: number;               // 1(即闷牌下注比例 0.5)
        postCapRoundsToShowdown: number; // 2 → M 封顶后再打满 2 个下注轮即强制摊牌(封顶当轮不计,`6.4)
        maxRounds: number | null;        // v1.9.2 安全阀:打满这么多下注轮直接摊牌(默认 16,null = 不限)
                                         //   定 16 的依据(120 局四人实测):设 8 会提前打断 22.5% 的牌局,设 16 一刀不砍
                                         //   动机:封顶靠"加注抬到阶梯顶端",全员只跟注时 M 恒为 1 → 永不摊牌 → 实测可打 1250 轮
        autoCompareWhenTwoLeft: false;   // 两人残局不强制比牌,玩家自选
      };

      exchange: {
        maxPerHand: number;              // 3
        fees: number[];                  // [1, 3, 10]
        scaledByMultiplier: true;        // 实际费用 = base × M
        allowSelfReclaim: boolean;       // 是否允许换回自己刚放回的牌(Q12)
      };

      intercept: {
        maxPerCard: number;              // 3
        maxPerHand: number;              // 5(整局总量)
        adjacentOnly: true;              // 只能紧邻下家
        formula: "swapFeePaid + n*(n+1)*M";
        swapFeePaidIsSnapshot: boolean;  // true=保持原换牌费(Q5)
        allowRetakeByIntercepted: true;  // 被截者可补换(Q6)
        cascadeDepthLimit: number;       // 单条链最大深度,防死循环
      };

      kick: {
        maxPerHand: number;              // 1
        fee: number;                     // 8
        scaledByMultiplier: true;
        requireNeverSelected: boolean;   // 踢牌目标须"从未被选取"(Q7)
        blockadedCardFaceDown: true;
      };

      fold: { revealToAll: boolean };    // 弃牌后是否公开手牌(默认 true,便于算牌;关掉则视为盖牌)

      compare: {                         // Q2 已定案,细则见 `7.6
        enabled: true;
        costMultiplier: number;            // 2 → 实际 = 2 × 自身 rate × M(看牌 4M / 闷牌 2M)
        anyOpponent: true;                 // 可指定任意存活对手(含闷牌者)
        oncePerTurn: true;                 // 占用本回合主决策,每回合至多 1 次
        blindMinBettingRounds: number;     // 3 → 闷牌者须走完 3 个下注轮(第 4 轮起)才可盲比
        blindCompareBreaksBlind: false;    // 盲比不解除闷牌
        loserFolds: true;                  // 输者弃牌退场,已投入不退
        tieBehavior: "CONTINUE";           // 平局:双方均不出局,继续对局
        tieEndWhenAllTied: true;           // 存活玩家全在同一平局分量 → 本局结束
        tieEndSplitsPot: true;             // 结束时均分(瓜分)全部底池
        revealToOutsiders: false;          // 比牌只对双方可见,不向第三方亮牌
        maxPerHand: number | null;         // null = 每人不限次数(受费用与 oncePerTurn 约束)
      };

      showdown: { tieRemainderTo: "FIRST_SEAT" | "CARRY_TO_NEXT_POT" };

      endGame: {
        bustAtOrBelow: number;           // 0(含)
        winAtOrAbove: number;            // 终局阈值,默认 40000(v1.2 由 50000 下调)
        maxHands: number | null;         // 整场局数上限,默认 20;null = 不限(优先级低于阈值/破产)
        winTakesPriorityOverBust: true;
      };

      handRanking: HandCategory[];       // 12 档可配置排序,默认见 `3.1
      rng: { algorithm: "xorshift128"; seed?: number };
      ui: {
        familyColors: Record<ColorFamily,string>;
        suitBackground: Record<SuitId,string>;   // 蓝/金两组同色系内的底色区分
      };
    }

**分场档位(v1.4)**:同一套规则、不同货币刻度,按整表等比缩放实现(`8.1)。

| 档位 | k | 底注 | 跟注(看·闷) | 换牌 | 踢牌 | 适用人数(实测平均局数) |
| --- | --- | --- | --- | --- | --- | --- |
| 小分场 small | ×10 | 10 | 20·10 | 10-30-100 | 80 | 4~6 人(248 / 105 / 47 局) |
| 大分场 big | ×25 | 25 | 50·25 | 25-75-250 | 200 | 4~5 人(47 / 15 局);6 人仅 9 局 |
| 自适应 balanced | 按人数 | — | — | — | — | 2 人 70 / 3 人 40 / 4 人 25 / 5 人 16 / 6 人 10 |

> 人数敏感度极大:同一档位下 6 人与 2 人的整场局数差 8 倍以上(小分场 6 人 47 局 vs 2 人打不满 400 局)。**人数不固定时用 `makeBalancedConfig(playerCount)`**;2 人局建议 k ≥ 70 或单独调小阈值差。

**预设(Q1 已定案):**

| 预设 | 初始积分 | 终局阈值 | 状态 |
| --- | --- | --- | --- |
| PRESET_DEFAULT | 20000 | 40000 | **正式默认值**(v1.2 下调阈值),maxHands = 20 |
| LEGACY_8000_16000 | 8000 | 16000 | 旧稿残留值(改动未覆盖全),**不采用**,仅存档对照 |

> 定案依据:"游戏概述"章节的 8000/16000 是改动未覆盖全的旧值;20000/50000 为 v1.0 口径,v1.2 起阈值下调为 **40000**,并加 **20 局**上限。

---

## 5. 数据结构定义

### 5.1 牌与牌堆

    type Rank = 2|3|4|5|6|7|8|9|10|11|12|13|14;   // 11=J 12=Q 13=K 14=A
    type ColorFamily = "RED" | "BLACK" | "BLUE" | "GOLD";
    type SuitId = "HEART"|"DIAMOND"|"SPADE"|"CLUB"|"SNOW"|"DROPLET"|"STAR"|"MOON";

    interface SuitDef { id: SuitId; family: ColorFamily; symbol: string; color: string; bg: string }

    interface Card {
      id: string;            // "HEART-A",全局唯一,= suit + rank
      rank: Rank;
      suit: SuitId;
      family: ColorFamily;   // 冗余字段,便于同色判定,构造时派生
    }

    interface Deck {
      cards: Card[];         // 104 张
      draw(n: number): Card[];
      remaining(): number;
      reset(rng: Rng): void; // 洗牌(确定性种子)
    }

    type Rng = { next(): number; int(maxExclusive: number): number; shuffle<T>(a: T[]): T[] };

### 5.2 牌型评估器

    // 12 档,按强度降序(`3.1)
    type HandCategory =
      | "STRAIGHT_FLUSH"       // 同花顺:同花色 + 连续
      | "FIVE_OF_A_KIND"       // 五条
      | "SAME_COLOR_STRAIGHT"  // 同色顺:同色系 + 连续,非同花色
      | "FLUSH"                // 同花:同花色,非连续
      | "FOUR_OF_A_KIND"       // 四条
      | "FULL_HOUSE"           // 葫芦
      | "SAME_COLOR"           // 同色:同色系,非同花色、非连续
      | "STRAIGHT"             // 顺子:连续,非同色系
      | "THREE_OF_A_KIND" | "TWO_PAIR" | "ONE_PAIR" | "HIGH_CARD";

    interface HandValue {
      category: HandCategory;
      tier: number;          // 12..1,来自 config.handRanking(`3.1)
      key: number[];         // 踢脚比较键(降序语义,`3.3)
      isRoyalFlush: boolean; // A-K-Q-J-10 同一花色,仅用于播报
    }

    interface HandEvaluator {
      evaluate(cards: Card[], cfg: GameConfig): HandValue;         // 5 张,不足/超出抛错
      compare(a: HandValue, b: HandValue): -1 | 0 | 1;             // 0 = 平局
      describe(v: HandValue): string;                              // "葫芦 (K 带 7)"、"同花 K 高"
    }

### 5.3 玩家与公共池

    interface PlayerState {
      id: string;
      seat: number;                 // 0..n-1,固定座位
      name: string;
      points: number;               // 场外积分,永不为负
      hand: Card[];                 // 5 张暗牌
      blind: boolean;               // true = 闷牌(未看过手牌)
      handViewed: boolean;          // 是否看过手牌(观看动作不可逆)
      inHand: boolean;              // 本局是否仍在牌局中
      folded: boolean;
      exchangeCount: number;        // 已换牌次数(含换走暗牌)
      kickUsed: boolean;            // 本局是否已踢牌
      kickBlockadeSeat?: number;    // 若为踢牌者,记录其封锁轮归属
      committedThisHand: number;    // 本局累计投入(审计/展示用)
      lastActionAt?: number;        // 事件序号
    }

    interface PoolCardMeta {
      cardId: string;
      faceUp: boolean;              // false = 封锁轮暗牌
      origin: "DECK" | "DISCARDED" | "KICK_DRAW";
      holderHistory: string[];      // 经手人(顺序记录),禁止回流
      selectedBy?: string;          // 当前是否正被某人持有(换出后清空)
      everSelected: boolean;        // 是否曾被任何人选取(踢牌目标判定)
      swapFeePaid: number;          // 上一次实际换牌费快照(截胡公式用)
      interceptCount: number;       // 已被截次数(0..maxPerCard)
      uninterceptable: boolean;     // 换走暗牌获得的牌 = true
    }

    interface BlockadeState {
      kickerSeat: number;
      cardId: string;               // 位于 pool 中,faceUp = false
      startSeat: number;            // kicker 的下家在位座位
      actedSinceStart: string[];    // 已在该封锁轮行动过的玩家
      resolvedByKicker: boolean;    // 踢牌者是否已做出 换走/不换 抉择
    }

### 5.4 对局状态

    type Phase =
      | "GAME_INIT" | "HAND_START" | "ANTE" | "DEAL"
      | "BETTING" | "AUX_WINDOW" | "BLOCKADE"
      | "SHOWDOWN" | "SETTLE" | "END_CHECK" | "GAME_OVER";

    interface BettingState {
      roundIndex: number;                // 本局第几个下注轮,从 1 开始(盲比门槛按它判断)
      actedThisRound: string[];          // 本轮已行动玩家
      currentStake: number;              // 当前应跟注额(按看牌 rate 计)
      lastRaiserId?: string;
      openingSeat: number;               // 本轮首先行动者(庄家位轮转)
      capReached: boolean;               // M 是否已达阶梯上限(封顶)
      postCapRoundsPlayed: number;       // 封顶后已完成的下注轮数,达阈值即强制摊牌
    }

    interface InterceptWindow {
      cardId: string;
      fromSeat: number;                  // 刚换走该牌的玩家
      candidateSeat: number;             // 唯一合法截胡者(紧邻下家)
      n: number;                         // 该次截胡的 n(第几次被截)
      expiresOn: "NEXT_ACTION" | "TURN_END";
      reason?: string;                   // 若窗口自动关闭的原因
    }

    interface GameState {
      config: GameConfig;
      phase: Phase;
      handNo: number;                    // 第几局
      dealerSeat: number;                // 庄家位,每局轮转
      players: PlayerState[];
      deck: Deck;
      pool: Card[];                      // 恒为 7 张
      poolMeta: Record<string, PoolCardMeta>;
      pot: number;
      multiplier: number;                // M,每局重置为 1
      betting: BettingState;
      blockade: BlockadeState | null;
      interceptWindow: InterceptWindow | null;
      interceptTotalThisHand: number;    // 全局截胡计数(上限 5)
      compareTies: [number, number][];   // 本局比牌平局对(无向边),用于"只剩平局者"判定
      turn: { seat: number | null; pendingBet: boolean };
      events: GameEvent[];
      settlement?: SettlementResult;
      rngState: string;                  // 可序列化种子状态,支持快照回放
    }

### 5.5 动作与事件

    type ActionType =
      | "START_HAND" | "VIEW_HAND"
      | "EXCHANGE" | "INTERCEPT" | "DECLINE_INTERCEPT" | "RETAKE_AFTER_INTERCEPT"
      | "KICK" | "TAKE_BLOCKED" | "PASS_BLOCKED"
      | "CALL" | "RAISE" | "FOLD" | "COMPARE";

    interface ActionBase { type: ActionType; seat: number; clientActionId: string }

    type Action =
      | ActionBase & { type: "VIEW_HAND" }
      | ActionBase & { type: "EXCHANGE"; takeCardId: string; giveCardId: string }
      | ActionBase & { type: "INTERCEPT" }
      | ActionBase & { type: "DECLINE_INTERCEPT" }
      | ActionBase & { type: "RETAKE_AFTER_INTERCEPT"; takeCardId: string; giveCardId: string }
      | ActionBase & { type: "KICK"; targetCardId: string }
      | ActionBase & { type: "TAKE_BLOCKED"; giveCardId: string }
      | ActionBase & { type: "PASS_BLOCKED" }
      | ActionBase & { type: "CALL" }
      | ActionBase & { type: "RAISE"; toMultiplier: number }
      | ActionBase & { type: "FOLD" }
      | ActionBase & { type: "COMPARE"; targetSeat: number };

    interface CostBreakdown {
      action: ActionType;
      base: number;            // 基础费用
      multiplier: number;      // 计算时采用的 M
      extra: number;           // 截胡的 n(n+1)M、比牌的附加等
      total: number;           // base × M + extra
      note: string;            // 人类可读公式,如 "3 × M(4) = 12"
    }

    type GameEvent =
      | { kind: "ANTE_PAID"; seat: number; amount: number }
      | { kind: "CARDS_DEALT"; seat: number; count: number }
      | { kind: "POOL_REVEALED"; cardIds: string[] }
      | { kind: "EXCHANGED"; seat: number; tookId: string; gaveId: string; cost: CostBreakdown; exchangeIndex: number }
      | { kind: "INTERCEPTED"; seat: number; fromSeat: number; cardId: string; n: number; cost: CostBreakdown }
      | { kind: "INTERCEPT_DECLINED"; seat: number; reason: string }
      | { kind: "KICKED"; seat: number; removedId: string; drawnId: string; cost: CostBreakdown }
      | { kind: "BLOCKADE_STARTED"; kickerSeat: number; cardId: string }
      | { kind: "BLOCKADE_ENDED"; cardId: string; revealed: boolean }
      | { kind: "BLOCKED_TAKEN"; seat: number; cardId: string; cost: CostBreakdown }
      | { kind: "HAND_VIEWED"; seat: number }
      | { kind: "BET"; seat: number; kind: "CALL"|"RAISE"; amount: number; multiplierAfter: number }
      | { kind: "FOLDED"; seat: number }
      | { kind: "COMPARED"; aSeat: number; bSeat: number; winnerSeat: number; tie: boolean; cost: CostBreakdown }
      | { kind: "SHOWDOWN"; entries: { seat: number; category: HandCategory }[] }
      | { kind: "POT_AWARDED"; seat: number; amount: number }
      | { kind: "HAND_SETTLED"; pot: number; winners: number[] }
      | { kind: "GAME_OVER"; reason: "WIN_THRESHOLD"|"BUST"|"BOTH"; winnerSeat?: number };

    interface SettlementResult {
      pot: number; winners: number[]; perWinner: number; remainder: number;
      showdown: boolean; ranking: { seat: number; points: number }[];
      gameOver: boolean; gameOverReason?: string;
    }

    interface ValidationResult {
      ok: boolean;
      code?: string;              // 如 "ERR_INTERCEPT_NOT_ADJACENT"
      message?: string;
      cost?: CostBreakdown;
    }

### 5.6 管理器接口

    interface RoundManager {
      legalActions(state: GameState): ActionType[];               // 当前座位可用动作集合
      validate(state: GameState, action: Action): ValidationResult;
      reduce(state: GameState, action: Action): { state: GameState; events: GameEvent[] };
      applyAutomatic(state: GameState): { state: GameState; events: GameEvent[] };  // 推进无输入阶段
    }

    interface CostCalculator {
      ante(cfg: GameConfig): CostBreakdown;
      call(state: GameState, seat: number): CostBreakdown;
      raise(state: GameState, seat: number, toMultiplier: number): CostBreakdown;
      exchange(state: GameState, seat: number): CostBreakdown;
      intercept(state: GameState, seat: number, cardId: string): CostBreakdown;
      kick(state: GameState, seat: number): CostBreakdown;
      compare(state: GameState, seat: number): CostBreakdown;
    }

---

## 6. 状态机

### 6.1 主流程

    [GAME_INIT]
        | 初始化 Config / 座位 / 积分 / RNG
        v
    [HAND_START] --- 庄家位右移,重置 handNo+1, M=1, 每人计数清零
        | 每人交纳底注 1 分(不乘 M) -> pot
        v
    [ANTE] --> [DEAL]   每人 5 张暗牌;公共池翻 7 张明牌
        |
        v
    [BETTING] <-----------------------------+
        |  轮到某座位:                     |
        |    1) 可选辅助动作:              |
        |       VIEW_HAND / EXCHANGE / KICK|
        |       (换牌后打开截胡窗口)       |
        |    2) 主决策: CALL/RAISE/FOLD/   |
        |       COMPARE                    |
        |                                  |
        |-- 发生换牌 --> [AUX_WINDOW] -----+  截胡/放弃/补换
        |-- 发生踢牌 --> [BLOCKADE] -------+  封锁轮结束后回到同一座位
        |
        |-- 存活人数 == 1 ------------> [SETTLE]
        |-- 封顶后再打满 2 个下注轮 ---> [SHOWDOWN] --> [SETTLE]
        |-- 比牌:输者弃牌 ------------+ 继续 [BETTING]
        |-- 全部存活者同属一个平局分量 --> [SETTLE](均分底池)
        |-- 封顶轮+2 轮到点且无人出局 ---> [SHOWDOWN] --> [SETTLE]
        v
    [SETTLE]  底池分配(平局均分,余数按配置处理)
        |
        v
    [END_CHECK]  阈值 >= 40000 / 破产 <= 0 / 打满 maxHands ?
        |-- 否 --> [HAND_START]
        |-- 是 --> [GAME_OVER]

### 6.2 单回合子状态机

    [TURN_ENTER(seat)]
        |
        +-- 若 seat 是封锁轮踢牌者 且 封锁轮未决 --> 必须 TAKE_BLOCKED / PASS_BLOCKED(可选要求)
        |
        +-- 辅助动作循环(可多次,受次数/费用/合法性限制)
        |     VIEW_HAND -> blind = false
        |     EXCHANGE  -> 支付 fees[exchangeCount] × M,打开截胡窗口
        |     KICK      -> 支付 8 × M,进入封锁轮(暗牌入池)
        |
        +-- [INTERCEPT_WINDOW] 若上一动作是换牌
        |     候选 = 换牌者的紧邻下家(存活且非闷牌且不在 holderHistory)
        |       接受 -> 支付 swapFeePaid + n(n+1)M,打开"被截者补换"选项
        |       拒绝/非法 -> 窗口关闭
        |
        +-- [BET_DECISION] 至少完成一次 CALL / RAISE / FOLD / COMPARE
        |     COMPARE -> 立即评估双方手牌
        |        分出胜负 -> 输者 folded = true,退出本局
        |        平局     -> 双方均不出局,记录平局边 (a, b)
        |        存活者全在同一平局分量 -> 本局结束,均分底池
        |
        v
    [TURN_EXIT] -> 下一存活座位 / 结束下注轮

### 6.3 下注轮结束条件

一个下注轮结束需同时满足:

1. 所有存活玩家本轮的 `actedThisRound` 均至少行动一次;
2. 所有存活玩家的本轮投入与 `currentStake` 一致(无人欠注);
3. 无未决的截胡窗口 / 封锁轮隶属于本轮。

下一轮:`actedThisRound` 清空,`roundIndex++`,行动指针按**顺时针循环**继续 —— 即"本轮最后一个行动者的下一个存活座位"就是下一轮的首家(openingSeat 同步为它)。2 人局下这保证两家交替、不会跳位。
**M 在轮间不重置,仅在本局开始时重置为 1。**

### 6.4 强制摊牌(M 封顶后最多 2 轮)

- M 升到阶梯上限(`ladder` 末项,默认 **32**)即视为**封顶**,令 `betting.capReached = true`;
- **封顶所在的那一轮不计入**;`postCapRoundsPlayed` 从封顶轮结束后开始计数;
- 之后每完成 1 个下注轮,`postCapRoundsPlayed++`;
- 累计达到 `betting.postCapRoundsToShowdown`(默认 **2**)时,**该轮一结束立即强制摊牌**(BETTING → SHOWDOWN → SETTLE);
- 封顶后**不允许再加注**(M 已到顶,D-03);
- 强制摊牌时所有存活玩家正常比较手牌;**摊牌平局仍按平分底池**,不适用比牌平局的"继续比赛"(`7.6 / Q22);
- 若强制摊牌前仍有未决**封锁轮** → 暗牌先立即公开(`faceUp = true`),踢牌者丧失换走机会(E2-11);
- 若该轮结束时**恰好只剩 1 人** → 按"只剩 1 人"结算(独得底池),不必摊牌(终态以先发生者为准,E10-16)。

### 6.5 状态不变量(每次 reduce 后必须成立,直接用于测试断言)

- INV1:`pool.length === config.pool.openCards`(恒 7)
- INV2:每名存活玩家 `hand.length === handSize`(恒 5)
- INV3:`deck.length + Σ hand.length + pool.length === 104`
- INV4:所有玩家 `points >= 0`
- INV5:积分守恒:局内任意时刻 `Σ points + pot === Σ startPoints - Σ(已结算局的净转移 0)` → 等价于"局开始前 Σpoints + pot_before 恒定"
- INV6:`multiplier ∈ {1} ∪ ladder`,且局内单调不减
- INV7:任一 cardId 全局唯一出现(手牌、公共池、牌堆三者互斥)
- INV8:`poolMeta[cardId].holderHistory` 中的人不再持有该牌
- INV9:`interceptTotalThisHand <= config.intercept.maxPerHand`

---

## 7. 流程细则

### 7.1 开局

1. 校验人数、积分(不足底注者见 E4-3)、牌堆容量。
2. 庄家位轮转,首行动者 = 庄家下家(可配置)。
3. 每人交底注 1 分(不乘 M),进入 pot。
4. 每人发 5 张暗牌(暗牌对本人可见性由 UI 层控制;引擎不区分"引擎可见/玩家可见")。
5. 从剩余牌堆翻 7 张至公共池,全部明置。
6. 全员初始 `blind = true`(未看过手牌)。

### 7.2 下注轮

- 每名玩家回合可选动作集合由 `legalActions` 给出。
- 下注额:`看牌 = 2 × M`,`闷牌 = 1 × M`(即闷牌下注比例 0.5,可配置)。
- 加注:把 M 提升为阶梯中的下一档(2/4/8/16/32)。加注者支付 `自身 rate × M_new`(推荐语义,Q3)。
- 弃牌:免费,立即 `folded = true`,退出本局。
- 比牌:见 `7.6。

### 7.3 换牌

- 时机:自己回合内;闷牌者禁止。
- 次数:每人每局最多 3 次(含"换走暗牌")。
- 费用:`fees[exchangeCount] × M`,fees = [1, 3, 10]。
- 操作:从公共池取 1 张**明置**牌 → 放入自己手牌;把手中 1 张放回公共池(明置)。
- 放回的牌写入 `origin = "DISCARDED"`,清空 `selectedBy`,保留 holderHistory;他人可正常换走。
- 换牌后打开截胡窗口(`7.4)。
- 被换走的公共牌 `swapFeePaid` 更新为本次实际支付额,`everSelected = true`,`holderHistory += 玩家`。

### 7.4 截胡

- 触发:某玩家完成换牌后,**挂起**一条"待截胡"记录 —— **不打断当前回合**,真正的执行时机是**紧邻下家的回合内**(v1.6,见下)。
- 合法截胡者:**唯一** = 换牌者的紧邻下家(顺时针下一个存活座位)。
- 费用:`截胡应付 = 目标牌 swapFeePaid 快照 + n × (n+1) × M`,n = 该牌第几次被截(从 1 开始)。
  - n=1 → +2M;n=2 → +6M;n=3 → +12M
- 限制:
  - 同一张牌最多被截 3 次;
  - 整局总截胡次数 ≤ 5;
  - 不能回到任何经手过该牌的人手里(含原换牌者与既有截胡者);
  - 只能紧邻下家,不越位;
  - 闷牌者不能截胡(**但可以先看牌再截** —— v1.6 起允许);
  - 暗置(封锁轮)牌不可被截;
  - 通过"换走暗牌"获得的牌 `uninterceptable = true`,不可被截。
- 被截者已付费用不退;被截时会**立即收下截胡者放回的那张牌**(手牌当场回 5 张);想换成别的,可在自己的回合照常换牌(照常付费、占换牌次数)。

**时序(v1.6 定案:挂起式,不再打断回合)**

| 环节 | 行为 |
| --- | --- |
| 换牌当时 | 只记录一条**待截胡**(事件 `INTERCEPT_OFFERED`):`{cardId, fromSeat, candidateSeat = 紧邻下家, n}`;**不打断**换牌者的回合,他继续做 CALL/RAISE/FOLD/比牌 |
| 紧邻下家的回合内 | 获得 `INTERCEPT` / `DECLINE_INTERCEPT` 两个选项;**可以先用 VIEW_HAND 看牌再决定**(因此第 1 轮也能截) |
| 不做选择 | 该回合结束即**作废**(事件 `INTERCEPT_EXPIRED`);候选者出局或本局结束同样作废 |
| 换牌者再次换牌 | 新的待截胡**顶掉**旧的(只有最近一次换走的牌可被截) |
| 连续截胡 | 每次截胡都会给"截胡者的紧邻下家"再挂一条,受**单牌 3 次 / 本局 5 次**限制 |

**截胡结算步骤**

设 A 刚把 X 从公共池换入自己手中,紧邻下家 B 在其回合内发起截胡:

1. B 支付 `swapFeePaid + n(n+1)M`;
2. B 从 **A 的手中**取走 X(X 不回到公共池);
3. B 从自己手牌放回 1 张 Z 到公共池(**明置**);
4. **A 立即自动收下 Z**(同一步内完成)→ 手牌 5、公共池 7 当场恢复,不存在"手牌 4 张"的中间态;
5. 若 X 的截胡次数 < 3 且本局总截胡 < 5,则为 B 的紧邻下家再挂一条待截胡(链深 +1)。

守恒:A 手牌 5 → 5(Z 补上),B 手牌 5 → 5(拿 X 放 Z),公共池恒 7。

**为什么这样更好**:① 第 1 轮也能截(下家可以先看牌);② 热座只需交接一次设备(轮到谁谁决定),不再"换牌者→下家→换牌者"来回传;③ 资格判定推迟到行动时,规则表述更直白。

**资格不满足时**:紧邻下家的回合里不会出现 `INTERCEPT`(原因见 `8.2 的 `ERR_*`),他可以直接做别的事,待截胡随回合结束作废。

### 7.5 踢牌与封锁轮

- 次数:每人每局 1 次;闷牌者可踢牌,且踢后仍保持闷牌(只看补牌不算看手牌)。
- 费用:`8 × M`。
- 目标:公共池中**未被任何人选取**的明置牌(判定口径见 Q7)。
- 流程:踢走目标 → 从牌堆补 1 张,该补牌**暗置**入池(公共池仍 7 张),仅踢牌者可见,进入封锁轮。
- 封锁轮:
  - 从踢牌者下家开始,所有存活玩家各行动一次,直到再次轮到踢牌者行动时结束;
  - 期间其他玩家不能选取该暗牌(换牌目标、截胡目标均排除);
  - 踢牌者在自己回合二选一:
    1. **换走暗牌**:支付本次换牌费(= fees[exchangeCount] × M),占用一次换牌次数,放回 1 张手牌公开,暗牌归其所有,不可被截胡;若原为闷牌,立即失去闷牌。
    2. **不换**:暗牌锁定,本轮谁都不能选;封锁轮结束立即公开(faceUp = true),此后可正常换、可截胡。
  - 踢牌者若中途弃牌/出局,暗牌立即公开,封锁轮终止。
- 结束判定:当行动指针回到 kickerSeat 且 kicker 已做出抉择(或无需抉择)。

**收束点(实现口径)**:踢牌后暗牌处于"保护期";只有当**行动指针再次回到踢牌者**(即踢牌者的下一次行动)时封锁轮才算收束,此刻他才能 `TAKE_BLOCKED` / `PASS_BLOCKED`。若他在该回合直接做了其它主决策,视为"不换",暗牌立即公开(自动 PASS)。
实现:行动指针每转移一次令 `turnSeq++`,暗牌记录创建时的 `createdTurn`;仅当 `turnSeq > createdTurn` 时可收束。**同一回合内踢出后不能立刻换走自己的暗牌**(封锁轮必须先绕过其他存活玩家一轮)。

### 7.6 比牌(Q2 已定案)

**费用**:`2 × 自身 rate × M` —— 看牌者 4M、闷牌者 2M;费用进底池,不退。

**对象**:任意一名存活对手(含闷牌者),不能选自己。

**回合占用**:比牌是本回合的**主决策**(与 CALL / RAISE / FOLD 同级),每回合至多 1 次,执行后回合结束。

**结果**:

| 情形 | 处理 |
| --- | --- |
| 分出胜负 | 输者立即 `folded = true` **弃牌退场**(已投入不退,不额外扣分);赢者留在局中 |
| 平局 | **双方都不出局**,本局继续;记录一条平局边到 `compareTies` |
| 比牌后只剩 1 人 | 立即结算,该玩家独得底池 |
| 比牌后存活玩家**全部落在同一平局连通分量**内 | 本局**立即结束**,存活者**均分(瓜分)全部底池** |

**"只剩下平局者"的判定口径**:把本局的平局对当作无向边取**连通分量**;若所有**存活**玩家属于同一个分量,即视为场上只剩平局者 → 结束并瓜分底池。

- 两人比牌平局且场上只剩这两人 → 立刻成立 → 本局结束、平分底池(这条同时杜绝了"两人无休止互比");
- 三人场景:A-B 平、B-C 平、C 弃牌 → 存活者 A、B 同属一个分量 → 结束、A/B 均分;
- 若仍有分量外的第三方存活 → 正常继续下注 / 比牌;
- 分量只统计**存活**玩家,已弃牌者不参与连通性判断。

**闷牌与盲比**:

- 闷牌者**只能走完 3 个下注轮之后**发起盲比,即第 4 轮起(`betting.roundIndex > compare.blindMinBettingRounds`);前 3 轮发起 → `ERR_BLIND_COMPARE_TOO_EARLY`;
- 盲比由引擎直接比较双方手牌,**双方都不看自己的牌**;闷牌者**保持闷牌状态**(费率与下注额不变);
- 看牌者之间、看牌者对闷牌者均无轮次限制。

**可见性**:比牌结果只通知参与的两人(胜 / 负 / 平),不向第三方亮牌(`revealToOutsiders = false`)。

**不可比牌**:目标已弃牌或出局、目标是自己、费用不足、`compare.enabled = false`、闷牌者未过 3 轮、本回合已比过。

**终止性证明(与平局规则配套)**:局内玩家积分**只减不增**(所有费用进底池,不抽水、不回补),因此每人可支付次数有限;付不起跟注或比牌费时按 D-10 只能弃牌。故即便平局不断续局,本局也必在有限步内收敛到"只剩 1 人"或"只剩平局者"两种终态之一。

**与终局摊牌的区别**:`7.7 的**摊牌平局**仍按平分底池处理,**不适用"继续比赛"**;"继续比赛"只针对**比牌平局**。

### 7.7 结算

本局在三种情形下结束:① 只剩 1 人;② 存活者全在同一平局分量(`7.6);③ M 封顶后打满 2 轮强制摊牌(`6.4)。

1. 若因比牌/弃牌只剩 1 人 → 直接拿底池。
2. 否则摊牌:比较全部存活玩家 HandValue。
3. 最高者独得;并列则均分。
4. 均分余数(整数不能整除时)按 `showdown.tieRemainderTo` 处理(见 Q10)。

### 7.8 终局检查

在每局结算后执行:

    if any(points >= winAtOrAbove)  -> 结束;最高分者胜,并列则平局
    else if any(points <= bustAtOrBelow) -> 结束;有赢家则赢家胜,否则按积分排名
    else -> 下一局

---

## 8. 操作校验与费用计算

### 8.1 费用总表

| 操作 | 基础费用 | 实际费用公式 | M 影响 | 备注 |
| --- | --- | --- | --- | --- |
| 底注 ANTE | 1 | 1 | 否 | 固定,不乘 M |
| 看牌下注 CALL | 2 | 2 × M | 是 | 与"下注/跟注"同额 |
| 闷牌下注 CALL | 1 | 1 × M | 是 | 闷牌比例 0.5 |
| 加注 RAISE | 2 / 1 | rate × M_new | 是 | 同时 M ← M_new(阶梯下一档) |
| 换牌 EXCHANGE | 1 / 3 / 10 | fees[count] × M | 是 | count 为该玩家第几次(0-based: fees[0]=1) |
| 踢牌 KICK | 8 | 8 × M | 是 | 每人 1 次 |
| 换走暗牌 TAKE_BLOCKED | 1 / 3 / 10 | fees[count] × M | 是 | 占换牌次数 |
| 截胡 INTERCEPT | — | swapFeePaid + n(n+1) × M | 部分 | swapFeePaid 为快照(绝对值) |
| 比牌 COMPARE | 2 × rate | 2 × rate × M(看牌 4M / 闷牌 2M) | 是 | 输者弃牌;平局继续,见 `7.6 |
| 看牌 VIEW_HAND | 0 | 0 | 否 | 失去闷牌 |
| 弃牌 FOLD | 0 | 0 | 否 | |

> **费用表整体性约束(v1.3)**:底注 / 跟注基准(看牌·闷牌)/ 换牌费 / 踢牌费共享同一"货币刻度",必须**整体等比缩放**(工具:`scaleEconomy(cfg, k)`)。只改其中一项会改变机制之间的权重 —— 实测把底注单独放大到 125~500 分(其余不动)时,底注会吃掉底池的 69%~93%,单次跟注(2~64 分)沦为零头,**下注 / 换牌 / 截胡 / 踢牌全部退化为装饰**。
> 反之,**整体等比缩放 k 倍 ≡ 把初始积分缩小 k 倍**(机制权重完全不变)。实测 ×10 ↔ 初始 2000 / 阈值 4000、×25 ↔ 初始 800 / 阈值 1600,收场局数与底池结构几乎重合,下注占比稳定在 94%~98%。

示例(M = 4):

- 看牌者第 2 次换牌 = fees[1]=3 → 3 × 4 = **12**
- 闷牌者跟注 = 1 × 4 = **4**
- 踢牌 = 8 × 4 = **32**
- 截胡(n=2,该牌原换牌费 3)= 3 + 2×3×4 = **27**

### 8.2 校验表

记 `P = state.players[action.seat]`,`A = action`。

**通用**

| 编号 | 条件 | 失败码 |
| --- | --- | --- |
| C-00 | phase 允许该动作 | ERR_PHASE |
| C-01 | `action.seat === state.turn.seat`(窗口类动作除外) | ERR_NOT_YOUR_TURN |
| C-02 | `P.inHand && !P.folded` | ERR_NOT_IN_HAND |
| C-03 | `P.points >= cost.total` | ERR_INSUFFICIENT_POINTS |
| C-04 | 玩家未破产(`points > 0`) | ERR_BUSTED |
| C-05 | 费用计算后 pot 与 points 事务原子性(一次性扣减) | ERR_ATOMICITY |

**VIEW_HAND**

| 编号 | 条件 |
| --- | --- |
| V-01 | 在自己回合内(或配置允许的任意时刻) |
| V-02 | 免费;不消耗主决策 |
| V-03 | 幂等:已看过则 no-op |

**EXCHANGE / RETAKE_AFTER_INTERCEPT**

| 编号 | 条件 | 失败码 |
| --- | --- | --- |
| X-01 | `P.blind === false`(闷牌禁止换牌) | ERR_BLIND_CANNOT_EXCHANGE |
| X-02 | `P.exchangeCount < config.exchange.maxPerHand` | ERR_EXCHANGE_LIMIT |
| X-03 | `takeCardId ∈ pool` 且 `faceUp === true` | ERR_CARD_NOT_SELECTABLE |
| X-04 | 若该牌为封锁轮暗牌 → 禁止(非踢牌者) | ERR_CARD_BLOCKADED |
| X-05 | `giveCardId ∈ P.hand` | ERR_CARD_NOT_OWNED |
| X-06 | 若 `allowSelfReclaim === false`:`giveCardId` 不得是本回合刚放入池中的同一张 | ERR_SELF_RECLAIM |
| X-07 | 换入换出后手牌恒 5 张、池恒 7 张 | ERR_CARD_CONSERVATION |
| X-08 | 被截者补换时,链路深度 < cascadeDepthLimit | ERR_CASCADE_LIMIT |

**INTERCEPT**

| 编号 | 条件 | 失败码 |
| --- | --- | --- |
| I-01 | `state.interceptWindow != null` 且未过期 | ERR_NO_INTERCEPT_WINDOW |
| I-02 | `action.seat === window.candidateSeat`(紧邻下家) | ERR_INTERCEPT_NOT_ADJACENT |
| I-03 | `P.blind === false` | ERR_BLIND_CANNOT_INTERCEPT |
| I-04 | `P.id ∉ poolMeta[cardId].holderHistory` | ERR_INTERCEPT_RETURN_TO_HOLDER |
| I-05 | `poolMeta[cardId].interceptCount < maxPerCard` | ERR_CARD_INTERCEPT_LIMIT |
| I-06 | `interceptTotalThisHand < maxPerHand` | ERR_HAND_INTERCEPT_LIMIT |
| I-07 | `poolMeta[cardId].faceUp === true` | ERR_CARD_BLOCKADED |
| I-08 | `poolMeta[cardId].uninterceptable === false` | ERR_UNINTERCEPTABLE |
| I-09 | `P.points >= swapFeePaid + n(n+1)M` | ERR_INSUFFICIENT_POINTS |

**KICK**

| 编号 | 条件 | 失败码 |
| --- | --- | --- |
| K-01 | `P.kickUsed === false` | ERR_KICK_LIMIT |
| K-02 | 目标牌在池中、明置 | ERR_CARD_NOT_SELECTABLE |
| K-03 | 目标牌未被任何人选取(`everSelected === false`,按 Q7 口径) | ERR_CARD_ALREADY_SELECTED |
| K-04 | 牌堆剩余 ≥ 1(补牌) | ERR_DECK_EXHAUSTED |
| K-05 | **允许同时存在多个封锁轮**(不同暗牌互不干扰,Q7b):每张暗牌有独立 kicker 与独立收束点;同一人受 K-01 限制仍只能踢 1 次 | — |
| K-06 | 闷牌可踢(允许),踢后保持 blind | — |

**TAKE_BLOCKED / PASS_BLOCKED**

| 编号 | 条件 | 失败码 |
| --- | --- | --- |
| B-01 | `state.blockade != null && blockade.kickerSeat === action.seat` | ERR_NOT_BLOCKADE_KICKER |
| B-02 | 已轮到 kicker 行动(封锁轮收束点) | ERR_BLOCKADE_NOT_ENDED |
| B-03 | TAKE 时 `P.exchangeCount < maxPerHand` 且支付对应费用 | ERR_EXCHANGE_LIMIT |
| B-04 | TAKE 时 `giveCardId ∈ P.hand` | ERR_CARD_NOT_OWNED |
| B-05 | TAKE 后该牌 `uninterceptable = true`、`holderHistory += P` | — |
| B-06 | PASS 后立即 `faceUp = true`、封锁轮结束 | — |
| B-07 | 若 kicker 已弃牌/出局 → 自动立即公开 | ERR_KICKER_OUT |

**CALL / RAISE / COMPARE / FOLD**

| 编号 | 条件 | 失败码 |
| --- | --- | --- |
| D-01 | CALL:`P.points >= ownRate × M` | ERR_INSUFFICIENT_POINTS |
| D-02 | RAISE:`toMultiplier === ladder[nextIndex]`(只允许下一档) | ERR_INVALID_RAISE_STEP |
| D-03 | RAISE:`toMultiplier > multiplier` 且 ≤ 阶梯上限 | ERR_RAISE_OVER_CAP |
| D-04 | RAISE:`P.points >= ownRate × toMultiplier` | ERR_INSUFFICIENT_POINTS |
| D-05 | COMPARE:`compare.enabled` 且目标存活、未弃牌、≠ 自己 | ERR_COMPARE_INVALID_TARGET |
| D-06 | COMPARE:闷牌者须 `betting.roundIndex > compare.blindMinBettingRounds`(默认第 4 轮起) | ERR_BLIND_COMPARE_TOO_EARLY |
| D-07 | COMPARE:`P.points >= compare.costMultiplier × ownRate × M` | ERR_INSUFFICIENT_POINTS |
| D-08 | COMPARE:本回合尚未比过牌(`oncePerTurn`) | ERR_COMPARE_ALREADY_USED |
| D-09 | FOLD:永远合法(无费用) | — |
| D-10 | 无法支付 CALL 时,回合内唯一合法主决策 = FOLD | ERR_MUST_FOLD |

### 8.3 费用计算伪代码

    callCost(P, M)      = (P.blind ? blindRate : seenRate) * M
    raiseCost(P, Mnew)  = (P.blind ? blindRate : seenRate) * Mnew
    exchangeCost(P, M)  = exchange.fees[P.exchangeCount] * M
    kickCost(M)         = kick.fee * M
    interceptCost(card, n, M) = card.swapFeePaid + n * (n + 1) * M
    compareCost(P, M)   = compare.costMultiplier * (P.blind ? blindRate : seenRate) * M

    所有费用:players[seat].points -= total; state.pot += total; 产生 Event;不允许负分。

---

## 9. 结算与终局

### 9.1 底池分配

- 只剩一人:该玩家独得全部底池(不摊牌时按配置可选是否亮牌)。
- 多人摊牌:HandValue 比较,最高者独得。
- 并列:均分,余数按 Q10。

### 9.2 终局条件(每局结算后检查)

按**固定优先级**逐条判断,命中即结束(同一局可能同时满足多条,取优先级最高者):

| 优先级 | 条件 | 结果 | 结束原因 |
| --- | --- | --- | --- |
| 1 | 存在玩家 points ≥ winAtOrAbove | 整场结束,最高分者胜(并列则整场平局) | `WIN_THRESHOLD` |
| 2 | 存在玩家 points ≤ 0 | 整场结束;若仅剩一名未破产者则由其获胜 | `BUST` |
| 3 | 已打满 maxHands | 按积分排名收场,最高分且唯一者胜(并列则整场平局) | `MAX_HANDS` |
| — | 以上皆不满足 | 进入下一局 | — |
| 1 + 2 | 同局既有人达阈值又有人破产 | 取优先级 1(阈值者赢) | `BOTH` |

> **实测脚注(v1.2,随机策略,默认数值,每格 80 场)**:
>
> | 人数 | 阈值胜 | 破产 | 未能收场 | 平均局数 | 结束时最高积分 | 每局平均底池 |
> | --- | --- | --- | --- | --- | --- | --- |
> | 2 | 3% | 0% | 97% | 49,313 | 26,807 | 24 分 |
> | 3 | 13% | 6% | 81% | 23,797 | 30,863 | 67 分 |
> | 4 | 44% | 20% | 36% | 11,939 | 35,734 | 133 分 |
> | 6 | 55% | 39% | 6% | 3,886 | 37,276 | 340 分 |
>
> **旋钮有效性实测(v1.2/v1.3,随机策略,每格 20 场,上限 400 局)**:
>
> **A. 费用表整体等比缩放**(初始 20000 / 阈值 40000):
>
> | 缩放 | 底注 | 跟注(看·闷) | 换牌 | 踢牌 | 6 人收场 | 3 人收场 | 6人每局底池 | 下注占比 |
> | --- | --- | --- | --- | --- | --- | --- | --- | --- |
> | ×1 | 1 | 2·1 | 1-3-10 | 8 | 0%(打满) | 0%(打满) | 334 | 98% |
> | ×2 | 2 | 4·2 | 2-6-20 | 16 | 5%(378 局) | 0%(打满) | 660 | 98% |
> | ×5 | 5 | 10·5 | 5-15-50 | 40 | 100%(174 局) | 5%(351 局) | 1,590 | 98% |
> | ×10 | 10 | 20·10 | 10-30-100 | 80 | 100%(47 局) | 45%(299 局) | 3,257 | 98% |
> | ×25 | 25 | 50·25 | 25-75-250 | 200 | 100%(9 局) | 90%(78 局) | 8,785 | 98% |
>
> **B. 等价性对照**(原费用表 + 缩小筹码):初始 2000/4000 → 6 人 42 局 / 3 人 261 局;初始 800/1600 → 6 人 8 局 / 3 人 73 局。与 A 表的 ×10 / ×25 行几乎重合,证实 **"等比放大费用 ≡ 等比缩小筹码"**。
>
> **C. 错误示范**(只放大底注,其余不动):底注 125 / 250 / 500 时 6 人局收场率 3% / 63% / 97%,看似有效,但底注已占底池 69% / 84% / 93%,单次跟注(2~64 分)相对底注(750~3,000 分)成为零头 —— **机制被吞掉,不能作为调参手段**。
>
> **结论**:调"整场快慢"只有两个正确旋钮 —— ① **整体等比缩放费用表**(推荐,机制权重不变,等价于缩放初始积分);② **调整阈值差**(收场局数约与阈值差成平方关系)。单独调底注是错的。
>
> 另:**单挑需单独配**(2 人筹码总量 = 2 × 初始积分,阈值须严格小于它;2 人底池最小,收敛最慢)。

> **分场档位实测(v1.4,初始 20000 / 阈值 40000 / maxHands 20,每格 20 场)**:
>
> | 人数 | 小分场 ×10 | 大分场 ×25 |
> | --- | --- | --- |
> | 2 | 0%(打满 400 局) | 45%(均 326 局) |
> | 3 | 40%(均 355 局) | 85%(均 111 局) |
> | 4 | 90%(均 248 局) | 100%(均 47 局) |
> | 5 | 85%(均 105 局) | 95%(均 15 局) |
> | 6 | 90%(均 47 局) | 90%(均 9 局) |
>
> 按人数自适应(目标 40~80 局):2 人 k=70 → 81 局、3 人 k=40 → 48 局、4 人 k=25 → 58 局、5 人 k=16 → 33 局、6 人 k=10 → 47 局。
> 两档的下注占比全程 91%~98%,机制权重未被破坏。

### 9.3 终局排名

1. 达到阈值者:积分最高者为最终赢家;并列 → 平局(结束原因为 `MAX_HANDS` 时同样按积分排名取最高且唯一者)。
2. 破产者(≤0):标记为破产。
3. 其余:按积分降序排名。

### 9.4 平局规则

- **摊牌平局**:同 tier 同 key(踢脚键完全相同)→ 平局,不分花色;平局者平分底池。若同时触发终局阈值且并列 → 整场平局。
- **比牌平局**:按 `7.6 —— 双方都不出局,本局继续;仅当**存活玩家全部落在同一平局连通分量**内时,本局立即结束,平局者**瓜分(均分)全部底池**。
- 均分余数按 `showdown.tieRemainderTo` 处理(见 Q10)。
- 花色永不参与比较(同色系内 ♥/♦ 等价、♠/♣ 等价)。

---

## 10. 边界情况清单

### E1 截胡链

| 编号 | 情况 | 期望行为 |
| --- | --- | --- |
| E1-1 | 紧邻下家已持有过该牌 | 窗口直接关闭,不越位给再下一家 |
| E1-2 | 紧邻下家是闷牌者 | 不可截胡,窗口关闭 |
| E1-3 | 紧邻下家积分不足 | 不可截胡,窗口关闭 |
| E1-4 | 紧邻下家已弃牌/出局 | 候选座位顺延到"下一个存活座位"还是直接关闭?(Q13,建议顺延=仍为"紧邻的存活下家") |
| E1-5 | 被截者立即补换新牌 | 新牌开启新的截胡窗口,其 n 从 1 重新计;原牌 n 已 +1 |
| E1-6 | A↔B 互相截胡形成循环 | `cascadeDepthLimit` 熔断;同时受"总 5 次""单牌 3 次"双重约束 |
| E1-7 | 同一张牌第 4 次被截 | 拒绝(ERR_CARD_INTERCEPT_LIMIT) |
| E1-8 | 本局总截胡已达 5 次 | 后续窗口一律关闭 |
| E1-9 | swapFeePaid 快照语义 | 固定为"首次换走该牌者所付实际费用",不随后续截胡金额变化(Q5) |
| E1-10 | 被截者放弃补换 | 其换牌次数不返还,费用不退;回合继续 |
| E1-11 | 截胡发生在公共池牌位 | 截入 1 张 + 放回 1 张,池恒 7 张(INV1) |
| E1-12 | 截胡目标为暗牌 | 禁止 |

### E2 封锁轮

| 编号 | 情况 | 期望行为 |
| --- | --- | --- |
| E2-1 | 封锁轮内踢牌者未到自己回合 | 暗牌不可被任何人选取 |
| E2-2 | 其他玩家换牌时选中暗牌 | 拒绝(ERR_CARD_BLOCKADED) |
| E2-3 | 踢牌者换走暗牌 | 付费、占换牌次数、放回手牌公开、uninterceptable=true、立刻失去闷牌 |
| E2-4 | 踢牌者选择不换 | 封锁轮结束即公开;之后可被换、可被截 |
| E2-5 | 踢牌者中途弃牌 | 暗牌立即公开,封锁轮终止 |
| E2-6 | 封锁轮中其他人相继弃牌,只剩踢牌者 | 封锁轮立即收束到 kicker 自身回合 |
| E2-7 | 封锁轮未结束而有人比牌导致只剩 1 人 | 立即公开暗牌,进入结算 |
| E2-8 | 封锁期间 M 被加注提升 | 换走暗牌的费用按"换走时"的 M 计算 |
| E2-9 | 踢牌后牌堆耗尽 | 理论不可达;防御性抛 ERR_DECK_EXHAUSTED,不破坏 INV3 |
| E2-10 | 一局内多人依次踢牌 | 允许(每人 1 次);**多个封锁轮可并存**,他人封锁轮进行中第三人可踢,各暗牌互不干扰、各自到自己的 kicker 回合收束(Q7b / K-05) |
| E2-11 | 封锁轮未决时 M 封顶打满 2 轮触发强制摊牌 | 暗牌立即公开,踢牌者丧失换走机会,随后正常摊牌 |

### E3 闷牌

| 编号 | 情况 | 期望行为 |
| --- | --- | --- |
| E3-1 | 闷牌者试图换牌/截胡 | 拒绝 |
| E3-2 | 闷牌者踢牌 | 允许,且保持 blind |
| E3-3 | 闷牌者查看手牌 | blind=false,不可逆;此后按看牌费下注 |
| E3-4 | 闷牌者换走暗牌 | 立即失去闷牌(规则明确) |
| E3-5 | 闷牌者盲比 | 须走完 3 个下注轮(第 4 轮起)才可发起;盲比由引擎直比,双方均不看牌,闷牌状态保持(`7.6) |
| E3-6 | 摊牌时仍闷牌 | 正常评估手牌,无额外加成/惩罚 |
| E3-7 | 全员闷牌到底 | 合法,按闷牌费率结算 |

### E4 积分不足

| 编号 | 情况 | 期望行为 |
| --- | --- | --- |
| E4-1 | 支付某动作后 points < 0 | 拒绝该动作(ERR_INSUFFICIENT_POINTS),不允许负分 |
| E4-2 | 无法跟注 | 回合内唯一合法选择为 FOLD(D-10) |
| E4-3 | 开局连 1 分底注都付不起 | 该玩家本局不参与(标记出局),并按终局检查处理;若只剩 1 人可参与则该局跳过 |
| E4-4 | 付完费用后 points 恰好 = 0 | 允许,结算后触发终局 |
| E4-5 | 付完费用后 points ≥ 阈值 | 允许(可能直接结束整场) |
| E4-6 | 所有人都无法跟注 | 行动为顺序执行,无法跟注者逐个弃牌,底池归最后未弃牌者;若仅剩 1 人行动前已无需下注则直接结算 |

### E5 终局检查

| 编号 | 情况 | 期望行为 |
| --- | --- | --- |
| E5-1 | 同一结算使多人 ≥ 阈值 | 积分最高者胜;并列 → 平局 |
| E5-2 | 同时有人 ≤0 且有人 ≥ 阈值 | 阈值者赢(题目明确) |
| E5-3 | 平局均分导致两人同时 ≥ 阈值 | 按 E5-1 处理 |
| E5-4 | 结算前一局已有人破产 | 破产者不再参与后续局 |
| E5-5 | 剩余可参与玩家 < 2 | 整场结束,按积分排名 |
| E5-6 | 阈值在结算后恰好等于 | 使用 `>=` 判定(含等于) |

### E6 平局

| 编号 | 情况 | 期望行为 |
| --- | --- | --- |
| E6-1 | 底池为奇数、两人平分 | 余数 1 分按 Q10(建议给座位序最靠前者) |
| E6-2 | 三人以上平局 | 均分;余数分配规则同上 |
| E6-3 | 比牌平局 | 默认双方都不弃牌 |
| E6-4 | 平局时正好触发终局且并列 | 整场平局 |

### E7 复合牌型与包含关系(12 档)

> 判定顺序见 `3.2;下表的"同色"=色系口径、"同花"=花色口径。

| 编号 | 情况 | 判定 |
| --- | --- | --- |
| E7-1 | 5 张同花色 + 连续 | 同花顺(第 1 位) |
| E7-2 | 5 张同花色 + 连续 + A 最大 | 同花顺,isRoyalFlush = true |
| E7-3 | 5 张同色系 + 连续,但花色不全相同 | 同色顺 |
| E7-4 | 5 张同花色,不连续 | 同花 |
| E7-5 | 5 张同色系、花色不全相同、不连续、无对子 | 同色(高牌型被提升) |
| E7-6 | 两对且 5 张同色系(如红系 5♥5♦9♥9♦3♥) | 同色(顺序早于两对) |
| E7-7 | 一对且 5 张同色系 | 同色 |
| E7-8 | 5 张同花色且含对子 | 数学上不可能(同花色每点数 1 张) |
| E7-9 | 三条 / 葫芦 / 四条 / 五条 且 同色系 | 数学上不可能(同色系每点数 2 张) |
| E7-10 | 五条 | 必然跨 5 个不同花色 |
| E7-11 | A-2-3-4-5 同花色 | 同花顺,key = 5(低) |
| E7-12 | A-2-3-4-5 同色系但非同花色 | 同色顺,key = 5(低) |
| E7-13 | A-2-3-4-5 混合色系 | 顺子,key = 5(低) |
| E7-14 | K-A-2-3-4 | 不是顺子 |
| E7-15 | 同 tier 同 key、花色不同 | 平局,平分底池 |
| E7-16 | 构造出 E7-8 / E7-9 类非法手牌 | 视为实现 bug,应断言失败 |

### E8 时序与原子性

| 编号 | 情况 | 期望行为 |
| --- | --- | --- |
| E8-1 | 截胡窗口内下家选择"放弃"后,是否还能改主意 | 否,窗口关闭 |
| E8-2 | 换牌 + 截胡 + 补换 连续发生 | 逐个 resolve,每步产生 Event,中间状态可快照 |
| E8-3 | 同一玩家同一回合多次换牌 | 允许(受 3 次上限),每次独立开窗 |
| E8-4 | 客户端重复提交同一 clientActionId | 幂等丢弃(ERR_DUPLICATE_ACTION) |
| E8-5 | 非法动作 | 状态不变,返回 ValidationResult 而非抛异常 |

### E9 牌堆

| 编号 | 情况 | 期望行为 |
| --- | --- | --- |
| E9-1 | 人数 × 5 + 7 > 104 | 开局拒绝(最多 19 人) |
| E9-2 | 踢牌补牌时牌堆空 | 拒绝踢牌或按配置改从弃牌堆重洗 |
| E9-3 | 确定性 | 同种子 → 同发牌序列(可复现回放) |

---

### E10 比牌与平局(P2P)

| 编号 | 情况 | 期望行为 |
| --- | --- | --- |
| E10-1 | 比牌分出胜负 | 输者 `folded = true` 弃牌退场,已投入不退,不额外扣分 |
| E10-2 | 平局且仍有第三方存活 | 双方均不出局,费用已付;记录平局边,对局继续 |
| E10-3 | 两人比牌平局,场上只剩这两人 | 立即结束,均分(瓜分)全部底池 |
| E10-4 | A-B 平、B-C 平、C 弃牌 | 存活者 A、B 同属一个平局分量 → 结束、均分 |
| E10-5 | 三人两两平局(单一连通分量) | 结束,三人均分底池 |
| E10-6 | A-B 平局后,A 与 C 比牌落败 | A 弃牌;存活 B、C 无平局边 → 不触发结束,继续对局 |
| E10-7 | 闷牌者在第 1~3 轮发起比牌 | 拒绝(ERR_BLIND_COMPARE_TOO_EARLY) |
| E10-8 | 闷牌者第 4 轮起盲比 | 允许;引擎直接比较,双方均未看牌,闷牌状态保持 |
| E10-9 | 盲比后闷牌者获胜 | 仍为 blind,后续继续按闷牌费率下注 |
| E10-10 | 比牌费用不足 | 拒绝(ERR_INSUFFICIENT_POINTS),本回合只能 FOLD |
| E10-11 | 同一回合连续两次比牌 | 拒绝(ERR_COMPARE_ALREADY_USED) |
| E10-12 | 比牌令其他玩家全部出局 | 立即结算,比牌胜者独得底池 |
| E10-13 | 平局反复续局 | 由终止性证明收敛(局内积分只减不增,付不起即弃牌) |
| E10-14 | 摊牌平局 | 仍按平分底池结算,**不**"继续比赛" |
| E10-15 | 比牌信息的可见范围 | 第三方不可见(revealToOutsiders = false) |
| E10-16 | 封顶后第 2 轮结束时恰好只剩 1 人 | 按"只剩 1 人"独得底池,不进入摊牌(先发生的终态优先) |
| E10-17 | 两人残局(M 未封顶) | 不强制自动比牌;双方可继续下注/加注,或任一方发起比牌 |

## 11. 待确认问题

> 按重要性排序;每项给出**推荐默认值**,未确认前按推荐值实现并保留配置开关。
> **v1.0 冻结口径**:Q1、Q2、Q4、Q21 为显式定案;下表其余各项(Q3、Q5~Q20、Q22~Q27)**全部按「推荐默认」执行**。
> 实现若与本文档冲突,以本文档为准并回改代码;若需改规则,优先通过 Config 开关调整。

| 编号 | 问题 | 推荐默认 | 影响 |
| --- | --- | --- | --- |
| ~~Q1~~ **已确认** | **数值冲突**:游戏概述写"初始 8000、阈值 16000",终局与结算写"初始 20000、阈值 50000" | **定案:初始 20000**;阈值经 Q28 二次下调为 **40000**(v1.2) | 全部默认配置与测试期望值 |
| ~~Q2~~ **已确认** | **比牌规则**:费用 / 可比对象 / 输者下场 / 闷牌盲比 / 平局 | **定案**:费用 2 × rate × M;任选存活对手;输者弃牌退场;闷牌须过 3 个下注轮后盲比;平局继续,只剩平局者则结束并瓜分底池(`7.6) | 核心玩法闭环 |
| Q22 | 比牌平局的"继续比赛"是否也适用于**摊牌平局**? | 不适用:摊牌平局仍按平分底池结算 | 结算分支 |
| Q23 | "只剩下平局者"的判定口径 | 平局对取无向边,存活玩家全在同一连通分量即结束;已弃牌者不参与 | 终局判定 |
| Q24 | "3 轮"的单位是回合还是下注轮? | 下注轮(全员各行动一次为一轮),即**第 4 轮起**可盲比;可配置 | 闷牌策略 |
| Q25 | 比牌是否向第三方亮牌? | 否,只有比牌双方知道结果 | 信息 / UI |
| Q26 | 同一玩家一局内的比牌次数 | 不限次,但每回合至多 1 次且每次付费 | 平衡 |
| Q27 | 盲比是否解除闷牌? | 否,保持闷牌,费率不变 | 闷牌收益 |
| ~~Q31~~ **已确认** | 弃牌后压牌,别人无法算牌 | **定案:v1.7 起弃牌即亮牌**(`fold.revealToAll` 默认 true,可关) | 信息量 / 算牌 |
| ~~Q28~~ **已确认** | 阈值是否过高? | **定案:v1.2 起 winAtOrAbove = 40000**(初始 20000 不变) | 整场时长 |
| ~~Q29~~ **已确认** | 是否需要局数上限兜底? | **定案:新增 `endGame.maxHands`,默认 20 局**;打满按积分排名收场 | 整场必然有终局 |
| ~~Q30~~ **已确认** | 截胡在实战中几乎触发不了(第 1 轮下家必然闷牌 → 立即窗口自动关闭) | **定案:v1.6 改成挂起式** —— 换牌只挂起,截胡在紧邻下家自己的回合内执行,允许先看牌再截;取消补换窗口 | 截胡从"基本做不到"变成常见动作 |
| Q3 | **加注语义**:M 是"全局倍数阶梯"还是"单次下注额"?加注者付旧价还是新档价? | M 为全局倍数,加注升到下一档并按**新档**付费;M 局间重置为 1 | 费用公式 |
| ~~Q4~~ **已确认** | 下注轮何时强制摊牌?两人残局是否自动比牌?M 封顶后还能否加注? | **定案**:M 封顶后再打满 **2 个下注轮**即强制摊牌(封顶当轮不计);封顶后不可再加注;两人残局**不**强制比牌,玩家自选(`6.4) | 终局节奏 |
| Q5 | 截胡公式的"目标牌实际换牌费"是**首次换牌费快照**,还是随每次截胡更新为最后经手人的支付额? | 保持首次快照(题目"不再乘当前 M"字面含义) | 截胡成本曲线 |
| Q6 | "被截者已付费用不退,但可改换其他牌或放弃"——是**立即补换**还是**下次行动时**? | 立即补换(消耗换牌次数、重新计费、可再次被截) | 截胡链形态 |
| Q7 | 踢牌目标"未被任何人选取"的确切口径:是指"从未离开过公共池的原始牌",还是"当前无人持有"? | 从未被任何玩家选取(everSelected === false),且非暗牌 | 踢牌可用性 |
| Q7b | 他人封锁轮进行中,第三名玩家能否踢牌? | 允许(不同暗牌互不干扰) | 并发封锁 |
| Q8 | 踢牌者"换走暗牌"是否占用其回合的主下注决策? | 不占用,允许换走后仍可 CALL/RAISE/FOLD | 回合结构 |
| Q9 | 看牌时机:仅限自己回合?免费? | 仅限自己回合、免费、幂等、不可逆 | 闷牌策略 |
| Q10 | 平局均分余数归谁? | 给座位序最靠前的平局者(可配置为滚入下一局底池) | 积分守恒细节 |
| Q11 | 人数范围、庄家轮转、首行动者定义 | 2~6 人(引擎上限 19);庄家位每局左移;首行动者 = 庄家下家 | 发牌与顺序 |
| Q12 | 能否换回自己刚放回公共池的同一张牌? | 同回合内禁止(ERR_SELF_RECLAIM),跨回合允许 | 费用刷分风险 |
| Q13 | 紧邻下家已弃牌时,截胡候选是顺延到下一位存活玩家,还是窗口直接关闭? | **顺延到下一个存活的下家**(更符合"紧邻下家"的自然语义) | 截胡链长度 |
| Q14 | 是否存在"过牌/看牌不跟"的零注局面? | 不存在:有人下注则必须跟/加/弃,无人下注时开注者按当前 M 下注 | 下注轮结构 |
| Q15 | 每局是否重新洗牌、M 是否重置? | 每局重新洗牌(同种子可复现),M 重置为 1,换牌/踢牌计数清零 | 局间状态 |
| Q16 | 是否允许"全下(All-in)"? | 不允许:积分不足即不能选该动作,无法跟注必须弃牌 | 与"不允许负分"一致 |
| Q17 | 同一局内比牌次数是否限制? | 不限次,但每次付费;可配置 maxPerHand | 策略平衡 |
| Q18 | 封锁轮内暗牌是否算"公共池 7 张"之一? | 是(池恒 7 张,位置保留,仅可见性不同) | INV1 |
| Q19 | 是否需要 AI 玩家 / 热座 / 观战模式? | 先做 CLI 热座 MVP,AI 与 Web 作为后续里程碑 | 交付范围 |
| Q20 | 是否需要回放/审计日志格式约定? | 是:全部 Event 可序列化,支持"种子 + 动作序列"完整复现 | 反作弊与调试 |
| ~~Q21~~ **已确认** | 是否启用方案 B(同花按花色、同色按色系,12 档并存) | **定案:启用方案 B**,tier 12~1(`3.1);别名开关取消 | 排序、概率、判定分支、测试全部按 12 档重写 |

---

## 12. 单元测试清单

### 12.1 牌堆 Deck

- D-01 `createDeck` 产出 104 张,cardId 全局唯一
- D-02 每点数恰好 8 张;每花色恰好 13 张;每色系恰好 26 张
- D-03 花色 → 色系映射正确(8 条断言)
- D-04 无大小王(不含任何 JOKER)
- D-05 同种子洗牌结果一致;不同种子不同(统计性检验)
- D-06 洗牌为排列(多重集合不变)
- D-07 发牌后 `deck + hands + pool === 104`(INV3)

### 12.2 牌型判定 HandEvaluator(12 档)

- H-01 同花顺:5 张同花色 + 连续 → tier 12
- H-02 皇家同花顺:同花顺且 A 最大 → isRoyalFlush === true
- H-03 五条:5 张同点数(必跨 5 个花色)→ tier 11
- H-04 同色顺:同色系 + 连续且非同花色 → tier 10
- H-05 同花:同花色、不连续 → tier 9;必须与"同色系但花色不同"的 5 张(→ 同色)区分开
- H-06 四条识别及踢脚比较(tier 8)
- H-07 葫芦识别(3 + 2,tier 7)
- H-08 同色:同色系、非同花色、非连续 → tier 6
- H-09 顺子:连续、非同色系 → tier 5
- H-10 三条识别及 2 张踢脚降序(tier 4)
- H-11 两对识别(大对 / 小对 / 踢脚,tier 3)
- H-12 一对识别(3 张踢脚降序,tier 2)
- H-13 高牌(tier 1)
- H-14 A 低顺 A-2-3-4-5 → key = 5;K-A-2-3-4 不判为顺子
- H-15 优先级:同花色 + 连续 → 同花顺,不得判成同花
- H-16 优先级:同色系 + 连续 + 非同花色 → 同色顺,不得判成同色
- H-17 提升:两对且 5 张同色系 → 同色(例 5♥5♦9♥9♦3♥)
- H-18 提升:一对且 5 张同色系 → 同色
- H-19 提升:高牌型且 5 张同色系 → 同色
- H-20 不可能组合断言:同花色 + 对子、同色系 + 三条等非法手牌必须抛错(防外部注入)
- H-21 非法输入(4 张 / 6 张 / 重复 cardId)抛错
- H-22 比较器反对称性与传递性(随机对拍)
- H-23 同 tier 同 key、花色不同 → 平局;平局时结算平分底池
- H-24 **穷举回归**:遍历全部 C(104,5) 手牌,12 类计数逐项等于 `3.1 表,且合计 = 91,962,520(实测约 1 秒,作为排序与概率的最终裁决)
- H-25 稀有度单调:12 类组合数严格递增,与 tier 降序一致
- H-26 **口径回归**:同花只读 suit、同色只读 family —— 红系 ♥♦ 混搭 5 张判为「同色」而非「同花」
- H-27 可配置牌型排序:交换 tier 后比较结果随之变化

### 12.3 费用计算 CostCalculator

- C-01 底注 = 1,且不随 M 变化
- C-02 看牌跟注 = 2M、闷牌跟注 = 1M(多档 M 参数化)
- C-03 换牌费用序列 = [1,3,10] × M,第 4 次抛 ERR_EXCHANGE_LIMIT
- C-04 踢牌 = 8M
- C-05 截胡 n=1/2/3 → swapFeePaid + 2M/6M/12M
- C-06 截胡 swapFeePaid 为快照(多轮截胡后金额不变)
- C-07 加注阶梯 M ∈ {1,2,4,8,16,32},越级抛 ERR_INVALID_RAISE_STEP
- C-08 比牌费用 = 2 × rate × M(看牌 4M / 闷牌 2M),全额进底池
- C-09 所有费用整数、无浮点误差
- C-10 费用扣减为原子操作:失败时不改变 state

### 12.4 换牌与截胡

- I-01 换牌后池仍 7 张、手牌仍 5 张(INV1/INV2)
- I-02 换牌后被放回的牌可被他人换走
- I-03 闷牌者换牌被拒
- I-04 换牌后截胡窗口指向紧邻下家
- I-05 非紧邻下家截胡被拒
- I-06 有经手史者截胡被拒
- I-07 同牌第 4 次截胡被拒
- I-08 全局第 6 次截胡被拒
- I-09 闷牌者截胡被拒
- I-10 截胡者放回 1 张手牌,池恒 7 张
- I-11 被截者补换开启新链路,n 重置为 1
- I-12 截胡链熔断(cascadeDepthLimit)
- I-13 截胡后 holderHistory 正确累积
- I-14 放弃截胡后窗口关闭,后续动作正常

### 12.5 踢牌与封锁轮

- K-01 踢牌后暗牌入池,池恒 7 张,仅 kicker 可见
- K-02 封锁轮内他人换该暗牌被拒
- K-03 kicker 换走暗牌:付费、换牌次数 +1、uninterceptable、失去闷牌
- K-04 kicker 换走暗牌后其暗牌不可被截
- K-05 kicker 选择不换 → 立即公开,之后可换可截
- K-06 kicker 中途弃牌 → 暗牌立即公开
- K-07 封锁轮结束条件:行动指针回到 kicker 且已抉择
- K-08 只剩余 kicker 时封锁轮立即收束
- K-09 每人限 1 次踢牌
- K-10 踢牌目标必须 everSelected === false
- K-11 闷牌者踢牌后仍保持 blind
- K-12 封锁期间 M 变化,换走费用按结算时 M
- K-13 补牌来自牌堆且 cardId 唯一(INV7)
- K-14 封锁轮未决时触发强制摊牌 → 暗牌立即公开,TAKE_BLOCKED 不再可用
- K-15(v1.7)弃牌 → FOLDED 事件带 `revealed` 五张牌面;关闭 `fold.revealToAll` 时为空

### 12.6 下注轮

- B-01 轮转顺序正确(过掉弃牌者)
- B-02 下注轮结束条件:全员行动且无欠注
- B-03 加注后 M 提升,后续跟注按新 M 计费
- B-04 M 达到 32 后禁止再加注(按 Q4)
- B-05 无法跟注者唯一合法动作为 FOLD
- B-06 弃牌者不再参与后续轮次
- B-07 闷牌/看牌混场时各自费率正确
- B-08 每局开始 M 重置为 1
- B-09 比牌占用本回合主决策:比牌后回合立即结束,不能再 CALL/RAISE
- B-10 闷牌者前 3 个下注轮比牌被拒,第 4 轮起通过(D-06)
- B-11 下注轮计数 roundIndex 从 1 开始、轮间递增、局间重置
- B-12 **封顶当轮不计入**:M=32 的那一轮结束后 postCapRoundsPlayed 仍为 0
- B-13 封顶后再打满 2 个下注轮 → 该轮结束立即 SHOWDOWN(不再接受下注)
- B-14 封顶后 RAISE 被拒(ERR_RAISE_OVER_CAP)
- B-15 两人残局不强制比牌:legalActions 仍含 CALL/RAISE/COMPARE/FOLD

### 12.7 结算与终局

- S-01 只剩 1 人 → 独得底池
- S-02 摊牌最高者独得
- S-03 平局均分,余数按 Q10
- S-04 底池守恒:结算前 `Σpoints + pot` = 结算后 `Σpoints`
- S-05 玩家从不出现负分(随机对局 fuzz)
- S-06 阈值 ≥ 判定含等于(恰好 40000 触发)
- S-07 破产 ≤0 判定含等于
- S-08 同时触发阈值与破产 → 阈值者胜
- S-09 多人达阈值 → 最高分者胜;并列 → 整场平局
- S-10 终局后不再产生新局
- S-11 一局内积分恰好到 0 的玩家参与排名为破产
- S-12 剩余可玩玩家 < 2 → 整场结束
- S-13 **局数上限**:打满 maxHands 局 → 结束原因 MAX_HANDS,赢家 = 积分最高且唯一者(并列则无名赢家)
- S-14 **优先级**:同局同时达成阈值与局数上限 → 判 WIN_THRESHOLD(不是 MAX_HANDS)
- S-15 maxHands = null → 不因局数收场

### 12.8 状态机与不变量

- SM-01 每个 phase 的合法动作集合正确
- SM-02 非法动作返回 ValidationResult 且 state 不变(引用相等/快照对比)
- SM-03 全量不变量 INV1~INV9 在每个 reduce 后校验
- SM-04 `clientActionId` 幂等
- SM-05 自动推进阶段(ANTE/DEAL/SETTLE/END_CHECK)在无输入时正确收敛
- SM-06 快照序列化/反序列化后继续对局结果一致
- SM-07 相同种子 + 相同动作序列 → 完全相同的终局(可复现)
- SM-08 随机对局 fuzz(10k 局)不出现崩溃、死循环、不变量破坏

---

### 12.9 比牌与平局(`7.6)

- CJ-01 费用:看牌者 4M / 闷牌者 2M,且全额进底池
- CJ-02 输者 `folded = true`、退出本局,积分不被额外扣减
- CJ-03 平局:双方均不出局,且 `compareTies` 追加一条无向边
- CJ-04 平局且仍有第三方存活 → 对局继续(E10-2)
- CJ-05 存活玩家全在同一平局连通分量 → 本局结束,均分底池
- CJ-06 两人比牌平局 → 立即结束并均分(E10-3)
- CJ-07 连通分量只统计存活玩家(已弃牌者排除,E10-4 / E10-6)
- CJ-08 闷牌者第 1~3 轮比牌 → ERR_BLIND_COMPARE_TOO_EARLY;第 4 轮通过
- CJ-09 盲比不改变 `blind`,后续费率仍为闷牌费率
- CJ-10 同一回合第二次比牌 → ERR_COMPARE_ALREADY_USED
- CJ-11 目标为自己或已弃牌者 → ERR_COMPARE_INVALID_TARGET
- CJ-12 比牌淘汰其余玩家 → 立即结算,独得底池
- CJ-13 摊牌平局仍平分底池(与比牌平局区分)
- CJ-14 **终止性 fuzz**:注入会反复平局的手牌,1 万局内全部收敛(无死循环)
- CJ-15 `revealToOutsiders = false` 时,事件流中不含第三方手牌信息
- CJ-16 强制摊牌为"摊牌平局"路径:平局者平分底池,不触发"继续比赛"
- CJ-17 M 封顶计数在局间重置(capReached / postCapRoundsPlayed 清零)

## 13. 模块划分与里程碑

### 13.1 目录建议(引擎与 UI 分离)

    zhajinhua/
      spec.md                 <- 本文档
      packages/
        engine/               <- 纯逻辑,零 IO 依赖
          src/config.ts       GameConfig + 预设
          src/cards.ts        Card / Deck / Suit / 色系
          src/rng.ts          确定性 RNG
          src/evaluator.ts    牌型判定与比较
          src/costs.ts        费用计算
          src/validate.ts     动作校验
          src/state.ts        GameState 构造与不变量
          src/round.ts        RoundManager / reduce
          src/blockade.ts     踢牌与封锁轮
          src/intercept.ts    换牌与截胡链
          src/settle.ts       结算与终局
          src/events.ts       事件与回放
          src/index.ts
        cli/                  <- 热座 CLI MVP
        web/                  <- 后续 Web UI
      tests/                  <- 与 12.x 测试清单一一对应

### 13.2 里程碑

| 阶段 | 内容 | 产出 |
| --- | --- | --- |
| M0 | 规则确认(本文档) | Q1 已定案;待确认 Q2~Q20 |
| M1 | 牌堆 + 牌型判定 + 单元测试 | evaluator/cards 全绿 |
| M2 | 费用计算 + 校验 + 状态机骨架 | reduce 可用,INV 全绿 |
| M3 | 换牌 / 截胡 / 踢牌封锁轮 / 比牌与平局分量 | 复杂规则全绿 |
| M4 | 结算 / 终局 / 热座 CLI | 可完整对局 |
| M5 | 热座 Web UI(零依赖 + 可见性裁剪) | 已完成 |
| M6 | AI 玩家(规则型 + 蒙特卡洛,共 6 角色) | 已完成,CLI/Web 均可用 |
| M7 | 观战 / 回放(上帝视角 + 时间轴 + 存档) | 已完成 |
| M8 | 自对弈 RL、多人联机 | 可选 |

### 13.3 合规声明

本项目为**纯积分制娱乐游戏**,不涉及真钱、不提供充值提现、不支持任何形式的现金兑换或对局抽水。若涉及真钱玩法,在中国大陆通常受相关法律法规限制,本项目**不应**支持真钱模式。

---

## 14. 实现索引(v1.2)

代码位于 `zhajinhua/`,零第三方依赖(Node ≥ 22.18 原生类型剥离 + 内置测试运行器)。

| 规格章节 | 实现文件 | 对应测试 |
| --- | --- | --- |
| `2 牌堆花色 | `src/cards.ts` | `test/deck.test.ts` D-01~D-06 |
| RNG 可复现 | `src/rng.ts` | D-05/D-06、E2E-14 |
| `3 12 档牌型 | `src/evaluator.ts` | `test/evaluator.test.ts` H-01~H-27、`test/exhaustive.test.ts` H-24/H-25 |
| `4 配置 | `src/config.ts` | `validateConfig` 断言 |
| `5 数据结构 / 不变量 | `src/state.ts` | `test/engine.test.ts` INV1~INV9 |
| `8.1 费用 | `src/costs.ts` | E2E-02~E2E-04 |
| `8.2 校验 | `src/validate.ts` | E2E-05/05b/06 等 |
| `6/`7 引擎 | `src/engine.ts` | E2E-01~E2E-19 |
| `9.2 终局(含 maxHands) | `src/engine.ts` settle() | E2E-15~E2E-19 |
| 随机 bot | `src/bot.ts` | CLI `--selftest` |
| AI 环境(动作枚举/确定化/rollout/MC 评估) | `src/env.ts` | `test/ai.test.ts` AI-04~AI-08 |
| 规则型 AI(Baozi/Sam/Lucas) | `src/ai/heuristic.ts` | AI-01~AI-03 |
| 蒙特卡洛 AI(May/Yeon/Brian) | `src/ai/montecarlo.ts` | AI-05~AI-06、`examples/ai-bench.ts` |
| `13.1 CLI | `src/cli.ts` `src/format.ts` | `--demo` / `--selftest` / `--table` |
| 热座 Web UI | `web/server.ts`(HTTP)`web/view.ts`(可见性裁剪)`web/public/*`(原生前端) | `test/view.test.ts` WEB-01~WEB-05 |
| 配置校验 / 费用表缩放 | `src/config.ts` `scaleEconomy` | `test/config.test.ts` CFG-01~CFG-05 |
| 平衡性探针 | `examples/` 下 `balance-probe` `ante-probe` `threshold-probe` `mix-probe` `scale-probe` | 产出 `9.2 脚注的实测表 |

**验证记录(v1.2)**

- 单元 + 端到端用例 **105 条(104 通过 / 1 条穷举默认跳过)**。
- **穷举回归 H-24**:遍历全部 C(104,5) = 91,962,520 手牌,12 档计数与 `3.1 表**逐项相等**,合计守恒,耗时约 55 秒。
- **随机对战 fuzz**:40 组 / 160,000 次动作 / 18,338 局牌,**积分守恒与 INV1~INV9 全程成立**;其中截胡 1,818 次、踢牌 20,506 次、比牌 9,550 次(平局 1 次)、摊牌 35 次。
- **CLI 冒烟**:`--selftest` 通过并给出终局原因分布;`--demo` 完整跑完一局并打印结算。

**Web 层下发的契约(v1.5)**:牌一律以 `{ id, text }` 下发 —— 前端**只能用服务端给的 id 发动作**,不得自造 id;闷牌者连自己的手牌都不下发;公共池暗牌对非踢牌者 id 为 `null`。回归用例 WEB-01~WEB-08 固化该契约。

**弃牌亮牌(v1.7)**:弃牌即公开手牌(可配置),视图层与 MC 确定化都据此处理;WEB-09 / AI-09 覆盖。

**AI(阶段一/二)**:`src/env.ts` 提供动作枚举、单视角确定化、rollout 与蒙特卡洛评估;6 个角色见 `src/ai/`。**顺手修掉一个引擎 bug**:玩家把刚换来的牌又换回公共池时,"待截胡"会悬挂指向池中的牌 → 新增 `ensurePendingStillValid`,每个动作后校验,悬挂即作废(事件 `INTERCEPT_EXPIRED`)。

**v1.6 截胡时序**:换牌挂起 → 下家回合内可选(可先看牌)→ 不选即作废 → 截胡后自动补齐被截者手牌并链式挂起。

**与规格的三处实现口径**

1. 截胡是"三步三方换牌"(`7.4),公共池 7 → 8 → 7;
2. 封锁轮以 `turnSeq > createdTurn` 判定收束(`7.5);
3. 下注轮按顺时针循环推进,不跳位(`6.3)。
