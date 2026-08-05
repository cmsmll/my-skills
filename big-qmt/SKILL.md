---
name: big-qmt
description: 迅投QMT（大QMT·完整版）内置 Python 策略开发技能。当用户说"QMT"、"QMT策略"、"QMT回测"、"QMT实盘"、"handlebar"、"passorder"、"algo_passorder"、"smart_algo_passorder"、"set_basket"、"get_basket"、"组合交易"、"篮子"、"智能算法"、"ContextInfo"、"迅投内置Python"、"回测模型"、"实盘模型" 等需要编写/讲解大QMT内置Python量化策略时触发。覆盖：init/handlebar/stop 生命周期、三种运行机制、四种运行模式、passorder 下单（11参完整签名）、篮子/组合交易（set_basket/get_basket + 组合下单 35/2101）、智能算法下单（smart_algo_passorder 双调用法、任务控制）、get_market_data_ex 行情三态、get_trade_detail_data 账户持仓、逐K线与快速交易机制、防超单的委托状态管理。仅限大QMT内置Python API，不涉及 miniQMT/xtquant。
---

# 大 QMT（迅投QMT完整版）内置 Python 开发

大 QMT = 迅投量化交易终端（完整版），自带 **Python 3.6** 运行时与策略编辑器，提供**行情数据**与**交易下单**两大核心，支持指标计算、策略编写、回测、实盘下单。策略写在终端内置策略编辑器内。

> **范围**：本技能只讲**大QMT内置Python API**。miniQMT / xtquant（外部 Python 用 xtquant SDK）不在范围内，用户问到时明确提示改用对应技能，不在此混入。

## 0. 写策略前的硬性约定

- 策略文件**第一行**必须是 `#coding:gbk`（编码声明约定）。**正文本体可为 UTF-8**：`#coding:gbk` 只是解释器编码声明，不强制正文用 GBK。本技能同目录示例 `.py` 正文即为 UTF-8、首行 `#coding:gbk`。注意若正文含无法用 GBK 表示、又依赖声明解码的字符时，QMT 环境仍以 GBK 读文件——按环境实测为准。
- 缩进**统一**（全 Tab 或全空格，勿混用）。
- 品种代码用**迅投代码** `证券代码.交易所代码`，如 `000001.SZ`（不区分大小写）。**期货合约严格区分大小写**：`rb2401.SF` 不能写成 `RB2401.SF`；`AP401.ZF` 不能写成 `ap401.ZF`。
- 账号类型常量：`'STOCK'` 股票 / `'FUTURE'` 期货 / `'CREDIT'` 信用 / `'STOCK_OPTION'` 股票期权 / `'FUTURE_OPTION'` 期货期权 / `'HUGANGTONG'` 沪港通 / `'SHENGANGTONG'` 深港通。
- 函数命名：`get_` 开头=数据来自客户端内存；`query_` 开头=向服务器查询。

## 1. 策略生命周期

| 函数 | 触发时机 | 用途 |
|---|---|---|
| `init(ContextInfo)` | 策略启动时一次 | 设参数、股票池、订阅、定时器 |
| `after_init(ContextInfo)` | init 之后 | 依赖行情/账号就绪后的初始化 |
| `handlebar(ContextInfo)` | 每根K线 / 每个分笔 | 主逻辑（买卖、止损） |
| `stop(ContextInfo)` | 策略停止时 | 收尾（如 `unsubscribe_quote`） |
| 回调函数 | 订阅/定时触发 | `subscribe_quote` 回调、`run_time` 回调 |

注意：
- `init` 中**不建议**调用 `get_market_data_ex` 等行情函数——init 阶段只能读到本地数据，取不到最新行情。
- `ContextInfo.start` / `ContextInfo.end` / `ContextInfo.capital` 仅在**回测模式**生效、且只在 `init` 中设置；与回测参数面板同时设置时以代码为准。

## 2. 三种运行机制（选对框架）

| 机制 | 触发 | 匹配需求 |
|---|---|---|
| **逐K线** `handlebar` | 主图历史K线逐根 + 盘中订阅推送（股票分笔约3秒一次） | 实盘中模拟逐K线效果；回测也用此机制 |
| **事件驱动** `subscribe_quote` | 盘中订阅品种分笔到达 → 回调 | 盘中随分笔行情判断交易 |
| **定时任务** `run_time` / `schedule_run` | 固定间隔触发回调 | 盘中固定时间间隔判断（如每5秒扫全市场） |

要点：
- 实盘中股票 `handlebar` 由主图股票 tick 驱动（约3秒一次）；期货策略建议把主图设为期货品种，或用 `subscribe` / `run_time` 保证频率。
- **非交易时段** `handlebar` 也可能被调用（行情服务重启后重订阅推送合并数据触发）；按需用时间判断跳过（如 `now < 09:15 直接 return`）。

## 3. 四种运行模式

`调试运行 / 回测 / 模拟信号 / 实盘交易`（运行策略时选择）。

- **调试运行**：编辑界面点「运行」，实时行情计算，**不记录交易信号**。
- **回测**：编辑界面点「回测」，按回测面板周期推进行情。必须先**下载历史行情**（左上角 操作→数据管理→补充数据，选周期/板块/时间范围），推荐使用**等比前复权**。
  - 取本地数据用 `get_market_data_ex(subscribe=False)`（回测不订阅，速度快）。
  - 撮合规则：委托价在当根K线高低点间→按指定价撮合；超出→按当根K线收盘价撮合；委托量>可用→按可用量撮合。
  - 必须以**副图模式**执行，不要选主图/主图叠加。
- **模拟信号**：模型交易界面选「模拟」，`passorder` **不产生实际委托**，仅记录在下方「策略信号」栏。
- **实盘交易**：模型交易界面选「实盘」，`passorder` **真实下单**。
  - 撮合以交易所为准：股票价格超 2% 价格笼子→废单；数量超可用→废单。

## 4. 行情三态（选对接口）

| 数据 | 特点 | 接口 |
|---|---|---|
| **本地数据** | 硬盘上的历史数据，盘中不更新 | `get_market_data_ex(subscribe=False)`；先用 `download_history_data` 下载 |
| **全推数据** | 盘中全市场最新快照，**无历史**，约50ms更新，不限数量 | `get_full_tick` / `subscribe_whole_quote` |
| **订阅数据** | 向服务器订阅指定品种（分笔/1m/5m/1d 四周期），**受数量上限**（约500） | `subscribe_quote` / `get_market_data_ex(subscribe=True)` |

⚠️ **已弃用**：`set_universe` / `get_history_data` / `get_market_data`（早期订阅接口，无订阅号、无法手动反订阅，只能停止策略释放）。
⚠️ 超出订阅上限时返回行情用**前值填充**（数据重复，非真实行情）。

### `ContextInfo.get_market_data_ex(fields, stock_list, period='1d', start_time, end_time, count, dividend_type, fill_data, subscribe)`

- 返回 `dict {股票代码: pd.DataFrame}`，index=时间，columns=fields。
- 常用 fields：`time/open/high/low/close/volume/amount/settle/openInterest/preClose/suspendFlag`。
- period：`'tick'` 及各级K线，L2 权限可 `'l2quote'/'l2order'/'l2transaction'/...`。
- `dividend_type`：`'none'` 不复权 / `'front'` 前复权 / `'back'` 后复权 / `'front_ratio'` 等比前复权 / `'back_ratio'` 等比后复权。
- 合成周期：3m 由 1m 合成、5m~2h 由 5m 合成、1w 及以上由 1d 合成——取历史需先下载基础周期。

## 5. 下单：`passorder`（11 参完整形式）

```python
passorder(opType, orderType, accountID, orderCode, prType, price, volume,
          strategyName, quickTrade, userOrderId, ContextInfo)
```

| 参数 | 类型 | 含义 / 常用值 |
|---|---|---|
| `opType` | int | 委托类别：股票 `23`买入 `24`卖出；两融 `33`担保品买入 `34`担保品卖出 `27`融资买入 `28`融券卖出 `32`直接还款；期货六键 `0`开多 `3`开空 `6`平多(优先平今) `5`平空(优先平今)；期权 `50`买入开仓 `51`卖出平仓 `52`卖出开仓 `53`买入平仓；ETF `60`申购 `61`赎回 |
| `orderType` | int | 下单方式：`1101`单股按数量(股/手/张) `1102`单股按金额(元，仅股票) `1113`总资产比例(0~1) `1123`可用比例；组合 `2101`按篮子份数 `2102`按篮子权重(元) |
| `accountID` | str | 资金账号（可 `'股票账号,期货账号'` 逗号分隔）或账号组名 |
| `orderCode` | str | 合约代码（如 `'000001.SZ'`）；组合交易填篮子名称 |
| `prType` | int | 选价类型：`5`最新价 `11`指定价(限价，仅单股) `14`对手价 `42`最优五档即时成交剩余撤销(沪/北，price为保护限价，填0自动取涨跌停价) `43`~`48` 其他市价 `49`盘后定价 |
| `price` | float | 委托价格：`prType=5/14` 时填 `-1` 自动取价；`prType=11` 填指定价；市价单填保护限价 |
| `volume` | int | 数量（单位由 orderType 末位决定：1=股/手/张，2=金额元，3=比例%） |
| `strategyName` | str | 策略名（自定义），用于区分 order/deal 来源；`get_trade_detail_data` 可按此过滤 |
| `quickTrade` | int | **快速交易参数**，见下 |
| `userOrderId` | str | 投资备注（任意串，<24字符），落到 order/deal 的 `m_strRemark` |
| `ContextInfo` | obj | 上下文对象 |

### `quickTrade` 语义（重点）

| 值 | 行为 |
|---|---|
| `0`（默认） | 只在 **K线结束**分笔调用时产生有效信号，其他调用丢弃（逐K线下单用这个） |
| `1` | 当前K线为**最新K线**（`is_last_bar()` 为 True）时立即委托；历史K线不触发。有信号闪烁风险 |
| `2` | **任何情况**下调用都立即委托（历史K线也触发）。`after_init`/定时回调/行情回调/`init` 里下单**必须传 2** |

场景速查：handlebar 逐K线下单→`0`；handlebar 盘中立即下单→`1`；定时器/init/回调内下单→`2`。**通常不建议传 2**。

### 撤单 `cancel(orderId, accountID, accountType, ContextInfo)`

- `orderId` = order/deal 对象的 `m_strOrderSysID`（委托号）；`accountType` = `'STOCK'`/`'FUTURE'`/...。返回 bool（是否发出撤单信号）。
- 推荐流程：`get_last_order_id` 取最新委托号 → `get_value_by_order_id` 查委托状态 → `cancel` 撤单。

### 下单事务特性（务必记住）

- 交易接口**异步**：`passorder` 调用后立刻返回，不等待回报、不阻塞线程。
- 委托/成交/持仓/账号在**客户端后台**更新：`get_trade_detail_data` 读本地缓存（有交易主推的柜台 50ms 刷新，无则 1~6 秒）；卖出后立刻查询查不到对应委托。
- **所有策略在同一个线程运行**：策略里禁止 `sleep`/死循环/加锁，否则卡住全部策略。
- 下单后需一段时间才能查到委托号；废单时只能查到上次成功单的委托号。

## 6. 篮子 / 组合交易（多股一键买卖）

组合交易 = 把多只股票的买卖方向打包成一个「篮子」，一次调用完成整个组合的调仓。两条腿的核心函数：

```python
set_basket(basketDict)            # 创建/覆盖篮子，返回 bool
get_basket(basketName)            # 读回篮子，返回 list[dict] 或 None
```

- `basketDict = {'name': 篮子名, 'stocks': [腿, 腿, ...]}`；腿 dict 字段：
  - `'stock'` 股票代码 `'weight'` 权重（按权重下单用，通常填 0.0） `'quantity'` 股数 `'optType'` `23`买 / `24`卖。
- `get_basket` 返回每腿的 dict 列表；`set_basket` 后**先回读校验**再下单（篮子创建有延迟，立刻下单可能取不到）。

### 组合下单

```python
passorder(35, 2101, accountID, 篮子名, prType, price, volume, strategyName, quickTrade, userOrderId, ContextInfo)
```

- **`opType=35`**：普通账号一键买卖（组合交易）——篮子里的腿自动按各自 `optType` 方向执行，一条委托对应整个篮子。
- **`orderType=2101`**：按篮子**份数**下单，`volume`=份数（每份 = 篮子每腿的 `quantity`）；`2102` 按篮子权重（金额）。
- `orderCode` 传**篮子名称**。
- **`prType=11` 限价对组合交易不支持**，用 `12` 市价（配 `price=0` 占位）或 `5` 最新价。
- 撤单/查询同普通委托：`cancel(委托号, ...)`、`get_trade_detail_data(..., 'order')`。

## 7. 智能算法下单：`smart_algo_passorder`（需【智能算法】权限）

两种调用方法（客户端版本不同支持不同，方法一常见）：

### 方法一（推荐，参数可缺省）

```python
smart_algo_passorder(opType, orderType, accountid, orderCode, prType, price, volume,
                     strategyName, quickTrade, userOrderId,
                     smartAlgoType, limitOverRate, minAmountPerOrder,
                     [targetPriceLevel, startTime, endTime, limitControl], ContextInfo)
```

| 参数 | 含义 |
|---|---|
| `opType/orderType/accountid/orderCode` | 同 passorder；组合交易取 `35/2101/账号/篮子名` |
| `prType` | `11`限价（仅单股，**组合交易不支持**）/ `12`市价（组合交易用） |
| `price` | `11` 时填限价，`12` 时填 0 |
| `volume` | 数量；组合交易=篮子份数 |
| `smartAlgoType` | 算法名（enum）：`VWAP` / `TWAP` / `冰山` / `网格` 等 |
| `limitOverRate` | **量比 0~100**（网格算法无此项；algoParam 填时 0~1 小数） |
| `minAmountPerOrder` | 最小委托金额 0~100000 |
| `targetPriceLevel` | 1~7，**仅冰山算法**使用，其他算法可缺省 |
| `startTime` / `endTime` | `'HH:MM:SS'`，限时完成区间；缺省 `'09:30:00'` / `'15:30:00'` |
| `limitControl` | 默认 `1`：涨停不卖/跌停不买；`0` 无限制 |

### 方法二（旧客户端部分不支持，参数不可缺省）

```python
smart_algo_passorder(opType, orderType, accountid, orderCode, prType, modelprice, volume,
                     strategyName, quickTrade, userid, smartAlgoType, startTime, endTime,
                     algoParam, ContextInfo)
```

- `algoParam` 用 `get_smart_algo_param(algoList)` 查询，字段：`m_dLimitOverRate`(量比 0~1)、`m_dMinAmountPerOrder`、`m_dMaxAmountPerOrder`、`m_nStopTradeForOwnHiLow`、`m_dMulitAccountRate`、`m_strCmdRemark`。

### 智能算法任务控制

```python
cancel_task(taskId, accountId, accountType, ContextInfo)   # 撤智能算法任务（撤单）
pause_task(taskId, accountId, accountType, ContextInfo)    # 暂停任务
resume_task(taskId, accountId, accountType, ContextInfo)   # 恢复任务
```

- 任务号 `taskId` = `get_trade_detail_data(..., 'TASK')` 返回对象的 `m_nTaskId`；用 `m_strRemark`（投资备注）匹配自己的任务。

### 拆单下单 `algo_passorder`（普通算法，无需权限）

```python
algo_passorder(opType, orderType, accountid, orderCode, prType, price, volume,
               [strategyName, quickTrade, userOrderId, userOrderParam], ContextInfo)
```

- `userOrderParam` 为 dict，控制拆单：`OrderType`(0普通/1算法/2随机量) `PriceType` `MaxOrderCount` 最大单数 `SinglePriceRange`/`PriceRangeType`/`PriceRangeValue`/`PriceRangeRate` 单笔价格范围 `SuperPriceType`(0比例/1数值) `SuperPriceRate`/`SuperPriceValue` 超价 `VolumeType` `VolumeRate` `SingleNumMin`/`SingleNumMax` 单笔数量 `ValidTimeType` `ValidTimeElapse` `ValidTimeStart`/`ValidTimeEnd` 有效时间 `UndealtEntrustRule` 未成交处理 `PlaceOrderInterval` 下单间隔 `UseTrigger` `TriggerType`(1最新价大于/2小于) `TriggerPrice` 触发 `SuperPriceEnable`。
- `prType` 若赋有效值优先于 `userOrderParam`/界面设置；`prType=-1` 时用 `userOrderParam` 或函数交易面板设置。

## 8. 交易数据查询：`get_trade_detail_data(accountID, accountType, datatype[, strategyName])`

- datatype 大小写不敏感：`account` / `position` / `order` / `deal`（还有 `POSITION_STATISTICS` 期货持仓统计、`TASK`）。
- 返回 `list[对象]`；用 `dir(obj)` 查看全部 `m_` 属性。

常用关键字段：

| 对象 | 常用字段 |
|---|---|
| `account`（资金） | `m_dBalance` 总资产 `m_dAssureAsset` 净资产 `m_dAvailable` 可用金额 `m_dInstrumentValue` 总市值 `m_dTotalDebit` 总负债 `m_dPositionProfit` 持仓盈亏 `m_dFrozenCash` 冻结金额 |
| `position`（持仓） | `m_strInstrumentID` 代码 `m_strExchangeID` 市场 `m_nVolume` 持仓量 `m_nCanUseVolume` 可用数量 `m_nFrozenVolume` 冻结 `m_dOpenPrice` 成本价 `m_dLastPrice` 最新价 `m_dMarketValue` 市值 `m_dPositionProfit` 盈亏 |
| `order`（委托） | `m_strOrderSysID` 委托号（撤单用） `m_nVolumeTotalOriginal` 委托数量 `m_nVolumeTraded` 成交数量 `m_dLimitPrice` 委托价 `m_nOrderStatus` 委托状态（49待报/50已报/51待撤/54已撤/55部成/56已成/57废单） `m_strRemark` 投资备注 `m_strErrorMsg` 废单原因 |
| `deal`（成交） | `m_dPrice` 成交均价 `m_nVolume` 成交量 `m_dTradeAmount` 成交额 `m_strTradeID` 成交编号 `m_strRemark` 投资备注 |
| `TASK`（算法任务） | `m_nTaskId` 任务号（撤/停/复任务用） `m_strRemark` 投资备注 |

## 9. 实盘委托状态管理（防超单，必做）

因接口异步 + 缓存延迟，实盘策略必须自行维护委托状态：

1. 用**普通全局变量**（如 `class A(): pass; A = A()` 或全局 dict）保存状态，**不要**存在 `ContextInfo` 属性里（`quickTrade=2` 时 ContextInfo 的逐K线机制不适用）；
2. 每笔委托生成独立 `userOrderId`（投资备注）作 dict 的 key，下单后置为「待报」；
3. 之后每根K线/回调中用 `get_trade_detail_data(...,'deal')` 按 `m_strRemark` 匹配更新状态，查到成交则移除；
4. 某品种存在「待报/未查到」委托 → **暂停该品种后续报单**，防止超单。

## 10. 示例（完整代码在同目录 .py 文件）

| 文件 | 场景 | 关键点 |
|---|---|---|
| `示例_回测双均线.py` | 回测·逐K线 | 本地数据 `subscribe=False`、双均线、最新价买卖 |
| `示例_实盘双均线.py` | 实盘·立即下单 | `is_last_bar` + `quickTrade=2`、备注防重、持仓查询 |
| `示例_篮子组合换仓.py` | 实盘·一篮子换仓 | `set_basket` 建篮、`get_basket` 回读、`smart_algo_passorder(35,2101,...,12,...,VWAP,...)` 一键组合、备注防重 |

示例为教学骨架：账号、目标持仓、算法参数需按实际填写；**切勿直接照搬上线**。

## 11. 常见坑

- 策略文件首行须 `#coding:gbk`（声明约定）；正文本体按需 UTF-8。输出打印乱码时按终端/客户端环境调整编码（文件用 UTF-8 时 `print` 中文一般正常，异常则回退 GBK）。
- `print` 中文/特殊字符注意编码。
- **第三方库**：券商后台有 Python 库白名单，`ImportError: Forbidden: Module openpyxl not in whitelist!` → 找券商开通；`NameError: pandas` → 检查 设置>模型设置 的 python 路径应指向安装目录 `bin.x64`，并已下载 python 环境；`module 'pandas' has no attribute 'core'` → 重启客户端。内置已集成 NumPy / Pandas / SciPy / TA-Lib 等。
- 自行装库：`pip install xxx -t {安装目录}\bin.x64\Lib\site-packages`。
- **委托数量规则**：科创板限价单笔≤10万股、市价≤5万股、200股起1股递增；创业板限价≤30万股、100股起100股递增；主板≤100万股、100股起100股递增。
- 实盘 `prType=14`（对手价）报「对手价无效」→ 修改行情源的全推行情级别。
- 回测用 `subscribe=False` 读本地数据；实盘需要动态行情才 `subscribe=True`。
- 行情服务重启后非交易时段会触发 `handlebar`，用时间判断跳过。
- 组合交易 `prType=11` 限价不可用 → 用 `12` 市价。
- 篮子 `set_basket` 后立刻下单可能取不到 → 先 `get_basket` 回读校验。
- 智能算法需要券商开通【智能算法】权限，否则报权限错误。

## 12. 官方文档（权威）

- 快速开始 / 机制与示例：https://dict.thinktrader.net/innerApi/start_now.html
- 交易函数（passorder / cancel / algo_passorder / smart_algo_passorder / set_basket / get_basket / get_trade_detail_data / get_last_order_id）：https://dict.thinktrader.net/innerApi/trading_function.html
- 行情函数（get_market_data_ex / subscribe_quote / get_full_tick / download_history_data）：https://dict.thinktrader.net/innerApi/data_function.html
- 系统函数（init / after_init / handlebar / stop / run_time / schedule_run / is_last_bar）：https://dict.thinktrader.net/innerApi/system_function.html
- 枚举常量（opType / orderType / prType / quickTrade / 委托状态 / smartAlgoType）：https://dict.thinktrader.net/innerApi/enum_constants.html
- 数据结构（Account / Order / Deal / Position 全部字段）：https://dict.thinktrader.net/innerApi/data_structure.html
- 变量约定（迅投代码 / 账号类型 / ContextInfo 属性）：https://dict.thinktrader.net/innerApi/variable_convention.html
- 完整示例：https://dict.thinktrader.net/innerApi/code_examples.html
- 常见问题：https://dict.thinktrader.net/innerApi/question_answer.html

---

*说明：本技能内容按迅投官方文档（dict.thinktrader.net/innerApi）整理；具体函数以文档最新版为准。*
