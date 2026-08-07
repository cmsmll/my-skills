---
name: akquant
description: AKQuant（akfamily 出品的高性能 Rust/Python 量化框架）策略开发技能。当用户说"akquant"、"AKQuant"、"akfamily"、"run_backtest"、"run_grid_search"、"run_walk_forward"、"run_from_checkpoint"、"网格搜索"、"滚动优化"、"walk-forward"、"checkpoint 恢复"、"断点续跑"、"FillMode"、"NextOpen"、"NextClose"、"NextAverage"、"NextHighLowMid"、"CurrentClose"、"broker_profile"、"BacktestResult"、"AKQuant 回测"、"AKQuant 实盘"、"run_live"、"broker_live"、"commission_policy"、"strategies_by_slot"、"多策略 slot" 等需要编写/讲解 AKQuant 策略时触发。覆盖：安装、数据加载（DataFrame/字典/List[Bar]/DataFeed/DataFeedAdapter/ParquetDataCatalog）、回测入口 run_backtest、策略生命周期（Strategy 类与函数式风格、全部事件回调）、下单 API、五种 FillMode 成交语义、佣金与费用（commission_policy 三模式 + broker_profile 模板）、关键参数速查、配置分层心智模型、风控（RiskConfig + 策略级映射）、多策略 slot、参数优化（run_grid_search / run_walk_forward）、断点恢复（run_from_checkpoint / merge_results）、BacktestResult 结果对象、ML 滚动训练（on_train_signal / SklearnAdapter / PyTorchAdapter）、实盘执行（run_live / broker_live 语义）。
---

# AKQuant（akfamily 高性能 Rust/Python 量化框架）

AKQuant 是 akfamily（AKShare 同一社区）出品的高性能量化投研框架：核心撮合引擎用 **Rust** 编写（事件驱动、Zero-Copy 数据导入、生产级风控），对外提供优雅的 **Python** 接口。内置原生 ML 滚动训练（Walk-forward Validation）、TA-Lib 指标生态、Polars 因子引擎、多进程网格搜索与多资产混合回测。

> **范围**：本技能覆盖 AKQuant 的安装、数据加载、回测入口、策略生命周期、成交语义、佣金、风控、多策略 slot、参数优化、ML 滚动训练、实盘执行。与 **akshare** 的关系：AKShare 是数据源（`ak.stock_zh_a_daily` 等取 A 股数据喂给 AKQuant 回测），AKQuant 是回测/交易框架，二者分属不同包，AKShare 仅作数据提供方，非必需依赖。

## 1. 安装

- **Python >= 3.10**；Windows / macOS / Linux 均支持。
- **推荐从 PyPI 安装预编译 Wheel（无需 Rust 环境）**：

```bash
pip install akquant
# 需要 A 股数据源时一并安装（可选）：
pip install akquant akshare
```

- 可选 ML 依赖：PyTorch（`pip install torch`）、Scikit-learn / XGBoost / LightGBM 等（`akquant.ml` 的适配器按需导入）；开发模式完整依赖用 `uv pip install -e ".[dev,ml,plot]"`。
- **从源码编译（开发模式）**：需安装最新稳定版 Rust（https://www.rust-lang.org/tools/install），克隆仓库后 `pip install maturin && maturin develop --release`。

验证安装：

```python
import akquant
print(akquant.__version__)
```

## 2. Quickstart：最小回测示例

```python
import akshare as ak
from akquant import Strategy, run_backtest

# 1. 准备数据（AKShare 取 A 股日线；列需含 OHLCV + symbol）
df = ak.stock_zh_a_daily(symbol="sh600000", start_date="20250101", end_date="20260212")

# 2. 策略定义：继承 Strategy，重写 on_bar
class MyStrategy(Strategy):
    def on_bar(self, bar):
        current_pos = self.get_position(bar.symbol)
        # 阳线且空仓 -> 买入 100 股
        if current_pos == 0 and bar.close > bar.open:
            self.buy(bar.symbol, 100)
        # 阴线且有持仓 -> 全部卖出
        elif current_pos > 0 and bar.close < bar.open:
            self.close_position(bar.symbol)

# 3. 运行回测
result = run_backtest(
    data=df,
    strategy=MyStrategy,
    initial_cash=100000.0,
    symbols="sh600000",
)

# 4. 查看结果
print(result)              # 等效 print(result.metrics_df)
print(result.trades_df)    # 平仓交易明细
print(result.orders_df)    # 委托明细
print(result.positions_df) # 每日持仓明细
```

生成交互式 HTML 报告（含基准对比区块：累计/年化超额收益、跟踪误差、信息比率、Beta、Alpha）：

```python
benchmark_returns = (
    df.set_index("date")["close"].pct_change().fillna(0.0).rename("SIMPLE_BENCH")
)
result.viz.report(filename="quickstart_report.html", show=False, benchmark=benchmark_returns)
```

## 3. 数据加载：`data` 的六种输入

`run_backtest(data=...)` 支持的输入（内部统一归一化后进引擎）：

| 输入 | 说明 |
|---|---|
| `pandas.DataFrame` | 单标的；列含 `timestamp`/`date` + `open/high/low/close/volume` + `symbol`（符号列可省，单标的时用 `symbols` 参数指定） |
| `Dict[str, pandas.DataFrame]` | 多标的：`{symbol: DataFrame}` |
| `polars.DataFrame` / `polars.LazyFrame` / `pyarrow.Table` | 一等输入，内部零成本转 pandas 路径 |
| `List[Bar]` | `Bar` 对象列表 |
| `DataFeed` | 引擎内部事件数据源（`DataFeed()` / `from_csv` / `create_live` / `from_parquet`） |
| `DataFeedAdapter` | 多时间框数据源（`.resample` / `.replay`），实现 `DataFeedAdapter.load(request)` 的对象 |

### 3.1 DataFrame 自定义因子列

DataFrame 中任意数值列会成为扩展字段，在策略里通过 `bar.extra` 访问：

```python
df["momentum"] = df["close"] / df["open"]
# 策略内：mom = bar.extra.get("momentum", 0.0)  # 返回 float
```

### 3.2 DataFeed 构造与写入

```python
feed = aq.DataFeed()                       # 空历史数据源
feed = aq.DataFeed.from_csv(path, symbol)  # 从 CSV 按行读取
feed = aq.DataFeed.create_live()           # 实时数据源（gateway/行情推送写入）
feed.add_bar(bar); feed.add_bars(bars); feed.add_tick(tick)
feed.add_arrays(timestamps, opens, highs, lows, closes, volumes, symbol)  # 批量注入（零拷贝借用 NumPy 缓冲）
feed.sort()                                # 按事件时间排序
```

### 3.3 ParquetDataCatalog（`catalog_path`）

`data` 未显式传入时，`run_backtest(catalog_path=...)` 从目录按 `ParquetDataCatalog` 规则加载。配套工具：

```python
aq.write_canonical_parquet(source, path, symbol=None)  # 规范化写出：timestamp(int64 纳秒 UTC)+OHLCV(float64)+symbol(str)，timestamp 升序、zstd 压缩
feed = aq.DataFeed.from_parquet(path, symbol=None, chunk_size=65536)  # 有界内存(out-of-core)流式读取，峰值内存与数据总量无关
```

### 3.4 DataFeedAdapter 多时间框

```python
base = aq.CSVFeedAdapter(path_template="/data/{symbol}.csv")
feed_15m = base.resample(freq="15min", emit_partial=False)
feed_replay = base.replay(
    freq="1h",
    align="session",            # session(按交易日分区) | day | global
    day_mode="trading",         # 仅 align='day' 生效：trading | calendar
    emit_partial=False,
    session_windows=[("09:30", "11:30"), ("13:00", "15:00")],  # 仅 align='session'
)
result = aq.run_backtest(data=feed_replay, strategy=MyStrategy, symbols="000001", show_progress=False)
```

## 4. 策略编写

### 4.1 两种风格

**类风格（推荐）**：继承 `Strategy`，`__init__` 的参数即策略参数（配合 `strict_strategy_params=True` 严格校验；可内联声明 `fast_period = IntParam(10, ge=2, le=200)` 页面化参数，运行时 `self.params.fast_period` 访问）：

```python
from akquant import Strategy

class MyStrategy(Strategy):
    def __init__(self, fast=5, slow=20):
        super().__init__()
        self.fast, self.slow = fast, slow

    def on_bar(self, bar):
        pass
```

**函数式风格**：`strategy` 传 `on_bar(ctx, bar)` 函数，生命周期用独立回调参数传入：

```python
def initialize(ctx): ctx.stop_loss_pct = 0.05
def on_bar(ctx, bar):
    if ctx.get_position(bar.symbol) == 0:
        ctx.buy(symbol=bar.symbol, quantity=100)
run_backtest(strategy=on_bar, initialize=initialize, data=df, symbols="600000")
```

### 4.2 生命周期与事件回调

| 回调 | 触发时机 | 说明 |
|---|---|---|
| `on_start(ctx)` | 策略启动 | 订阅（`subscribe`）、注册指标 |
| `on_bar(ctx, bar)` | 每根 K 线闭合 | 主逻辑 |
| `on_resume(ctx)` | checkpoint 恢复后的热启动 | **先于 `on_start` 触发**，仅恢复场景 |
| `on_stop(ctx)` | 策略停止 | 收尾 |
| `on_tick(ctx, tick)` | Tick 到达 | |
| `on_order(ctx, order)` | 订单状态更新 | 成交/取消/拒绝 |
| `on_trade(ctx, trade)` | 订单成交 | |
| `on_reject(ctx, order)` | 订单首次进入 Rejected | 仅触发一次 |
| `on_before_trading(ctx, trading_date, timestamp)` | 每交易日首次进入常规交易会话 | 按"前一交易日/前一时点信息可见"语义工作 |
| `on_pre_open(ctx, event)` | 每交易日首个常规行情事件前 | 盘前决策，本次 open 成交；不显式传 `fill_mode` 时默认按 `NextOpen()` 语义 |
| `on_cross_section(ctx, trading_date, timestamp)` | 当日首个跨标的完整 bar 切片后 | 横截面同周期调仓钩子，每交易日最多一次；可见当日历史与账户快照，适合收盘价调仓 |
| `on_after_trading(ctx, trading_date, timestamp)` | 离开常规交易会话 | 跨日则下一事件补发 |
| `on_portfolio_update(ctx, snapshot)` | 账户快照变化 | |
| `on_error(ctx, error, source, payload)` | 其他用户回调抛异常 | 默认触发后继续抛出 |
| `on_expiry(ctx, event)` | 引擎实际执行到期结算后 | 账户状态已更新；`event` 含 `expiry_date/quantity_before/quantity_closed/cash_flow/settlement_type/settlement_price` |
| `on_timer(ctx, payload)` | 定时器触发 | |
| `on_train_signal(ctx)` | ML 滚动训练窗口触发 | 仅 ML 模式 |

函数式回调签名与类方法一致，只是第一个参数换成 `ctx`（类风格里 `self` 等价于 `ctx`）。

### 4.3 快捷属性与上下文

| 属性 | 含义 |
|---|---|
| `self.symbol` / `self.close/open/high/low/volume` | 当前 Bar/Tick 的代码与价格量 |
| `self.position` | 当前标的持仓 helper（`size` / `available`；`entry_price` 均价） |
| `self.positions` | 所有标的持仓 `Dict[str, float]`（只读） |
| `self.cash` | 可用资金（只读） |
| `self.now` | 当前回测时间 `pd.Timestamp` |
| `self.ctx` | `StrategyContext`，底层 API 访问 |
| `self.runtime_config` / `self.error_mode` / `self.portfolio_update_eps` | 运行时行为配置 |

### 4.4 下单 API

```python
self.buy(symbol=None, quantity=None, price=None, trigger_price=None, ...)      # 买入（开多/平空）
self.sell(symbol=None, quantity=None, price=None, trigger_price=None, ...)     # 卖出（平多/开空）
self.close_position(symbol)                                                     # 全部平仓
self.submit_order(symbol, quantity, side, order_type=..., price=..., ...)      # 底层下单
self.cancel_order(order_id)                                                     # 撤单
self.cancel_all_orders(symbol=None)                                             # 撤全部挂单
```

- `price` 不传 = 市价单；传 `price` = 限价单；传 `trigger_price` = 止损/止盈单（Stop Market）。
- 不传 `symbol` 时取当前 bar/tick 的标的；**在无行情上下文的回调（如 `on_start`）中必须显式传入**。
- 不传 `quantity` 时 `buy` 按 `self.sizer` 计算下单量（默认 `FixedSize(100)`，可用 `set_sizer()` 替换）；`sell` 不传 `quantity` 时**全平当前持仓**（回测取总持仓，`broker_live` 取可用持仓——A 股 T+1 下当日买入部分不可卖，按总量报单会被柜台整单拒绝）。
- 解析后下单量 `<= 0` 时不报单，返回空回执（`len(receipt) == 0`、`receipt.primary == ""`）。
- **订单级覆盖参数**（`...` 展开）：`fill_mode` / `slippage` / `commission` 可在下单时按订单覆盖策略级与运行级默认值（优先级见 §7）。
- 特殊订单：`submit_order(..., order_type="StopTrail", trail_offset=..., trail_reference_price=None)` 跟踪止损单（`trail_offset` 必须 > 0）；`order_type="StopTrailLimit", price=..., trail_offset=...` 跟踪止损限价单；`broker_options={...}` broker 扩展透传（回测阶段仅记录在 `order.broker_options` 上）。
- 复杂订单助手：`place_oco(first_order_id, second_order_id, group_id=None)` 把两单绑 OCO（任一成交自动撤另一单）；`place_bracket(symbol, quantity, entry_price=None, stop_trigger_price=None, take_profit_price=None, ...)` 进场单成交后自动挂止损/止盈，双退出单自动绑定 OCO；`place_trailing_stop` / `place_trailing_stop_limit` 跟踪止损助手。
- 组合调仓：`rebalance_weights(target_weights, price_map=None, liquidate_unmentioned=False, allow_leverage=False, rebalance_tolerance=0.0)`（`target_weights` 形如 `{symbol: weight}`，默认权重和 ≤ 1.0，先卖后买，`rebalance_tolerance` 按组合市值比例跳过小偏差）；`rebalance_to_topn(scores, top_n, weight_mode="equal", ...)`。

### 4.5 数据与工具方法

- 历史数据：`get_history(count, symbol, field="close") -> np.ndarray`（安全快照拷贝，非零拷贝）；`get_history_multi(count, symbol, fields=...)` 单次多字段；`get_history_map(count, symbols, field)` 多标的；`get_history_df(count, symbol)` 返回 OHLCV DataFrame。
- 持仓/账户：`get_position(symbol)`、`get_available_position(symbol)`、`get_holding_bars(symbol)`、`get_account()`（常见字段：`cash/equity/market_value/notional_value/frozen_cash/margin/used_margin/free_margin/unrealized_pnl/...`；期货保证金账户下 `free_margin = equity - used_margin` 才是可开仓资金，读权益优先用 `equity`）、`ctx.get_position_entry_price(symbol)`。
- 订单/成交：`get_order(order_id)`、`get_open_orders(symbol)`、`get_trades()`（`ClosedTrade` 列表）。
- 定时与日历：`schedule(trigger_time, payload)`、`schedule_daily/weekly/monthly(time_str, payload)`（周末/节假日自动顺延）、`trading_days`（只读交易日序列）、`nth_trading_day_of_month(n)` / `nth_last_trading_day_of_month(n)` / `nth_trading_day_of_week(n)`、`to_local_time(ts)`、`format_time(ts, fmt)`。
- 标的静态属性（推荐，`on_start` 即可用）：`get_instrument(symbol)` / `get_instruments(symbols=None)` / `get_instrument_field(symbol, field)` / `get_instrument_config(symbol, fields=None)`。
- 调试：`self.log(msg, level)`（在 `on_order`/`on_trade`/`on_reject` 中自动携带 `order_id` 等结构化字段）。

## 5. 成交语义：五种 FillMode

从 `akquant` 顶层导入 `FillMode` 构造器，传给 `run_backtest(fill_policy=...)`：

| 场景 | 构造器 | 说明 |
|---|---|---|
| next-open 风格成交（**默认**，无未来函数） | `NextOpen()` | 下一根 K 线开盘价成交 |
| 当根收盘价成交 | `CurrentClose(timer_fill_timing="immediate"\|"deferred")` | 当根收盘价成交 |
| 下一根收盘价成交 | `NextClose()` | 下一根 K 线收盘价成交 |
| 下一根 OHLC4 均价成交 | `NextAverage()` | 下一根 K 线 OHLC4 均价 |
| 下一根 HL2 成交 | `NextHighLowMid()` | 下一根 K 线高低中价 |

要点：

- 只有 `CurrentClose` 支持 `timer_fill_timing` 参数；`"immediate"`（默认）timer 触发即在当根收盘价成交，`"deferred"` timer 不构成成交点、顺延到下一根 bar。**它只影响 `on_timer` 订单，对普通 `on_bar` 订单无影响**；其余四种模式的 `on_timer` 订单均在下一根 bar 成交。
- 底层引擎方法：`Engine.set_fill_mode(mode, timer_timing)`，`mode` 取 `ExecutionMode` 枚举（五个同名值），`timer_timing` 取 `"same_cycle"`/`"next_event"`（仅 `CurrentClose` 有意义）；日常推荐用 `FillMode` 对象由框架翻译。
- ⚠️ **旧的 `fill_policy=dict`（`price_basis`/`bar_offset`/`temporal`）与 `make_fill_policy(...)` 已移除**，传入 dict 会抛 `TypeError`；`legacy_execution_policy_compat`（经 `**kwargs`）也已移除。统一使用 `FillMode` 对象。

推荐示例：

```python
import akquant as aq
from akquant import NextClose, CurrentClose

result = aq.run_backtest(data=data, strategy=MyStrategy, symbols="000001", fill_policy=NextClose())
result = aq.run_backtest(data=data, strategy=MyStrategy, symbols="000001",
                         fill_policy=CurrentClose(timer_fill_timing="deferred"))
```

## 6. 佣金与费用

### 6.1 `commission_policy` 三种模式

运行级 `commission_policy` 支持三种模式（`CommissionPolicy` 与订单级/策略级共用同一结构）：

| 模式 | 结构 | 收费方式 |
|---|---|---|
| 按成交额比例 | `{"type": "percent", "value": 0.0003}` | `成交额 * 0.0003`（万三） |
| 固定金额 | `{"type": "fixed", "value": 3.0}` | 每次成交固定 3 元 |
| 按数量 | `{"type": "per_unit", "value": 0.01}` | `fill_quantity * 0.01`，适合每股/每手/每份 |

- 配套参数：`stamp_tax_rate`（印花税）、`transfer_fee_rate`（过户费）、`min_commission`（最低佣金）、`commission_rate`（比例佣金兼容入口——**显式提供 `commission_policy` 时优先级高于 `commission_rate`**）。
- 股票费率也可用 `Engine.set_stock_fee_rules(commission, stamp_tax, transfer_fee, min_commission)` / `set_stock_fee_policy(...)`；期货 `set_futures_fee_rules(commission_rate)` / `set_futures_fee_rules_by_prefix(symbol_prefix, commission_rate)`；期权 `set_option_fee_rules(...)`（含 `fee_per_contract` 每张手续费）。

### 6.2 `broker_profile` 内置模板

`run_backtest(broker_profile=...)` 一键注入费率/滑点/最小手数等默认值，内置模板：

- `cn_stock_miniqmt`：适配 miniQMT 通道的 A 股默认参数。
- `cn_stock_t1_low_fee`：A 股 T+1 + 低费率模板。
- `cn_stock_sim_high_slippage`：高滑点模拟模板（压力测试用）。

## 7. 关键参数速查（`run_backtest`）

| 参数 | 默认 | 说明 |
|---|---|---|
| `data` | None | 回测数据（§3 六种输入）；不传时用 `catalog_path` |
| `strategy` | None | 策略类 / 实例 / `on_bar` 函数；也可 `strategy_source`/`strategy_loader` 动态加载 |
| `symbols` | `"BENCHMARK"` | 标的代码或代码列表；⚠️ **不再接受旧的 `symbol` 参数** |
| `initial_cash` | 100000.0 | 初始资金（未显式传时回落 `StrategyConfig.initial_cash`） |
| `t_plus_one` | False | 是否启用 T+1 交易规则；启用将强制使用中国市场模型；**运行级/市场级开关，不支持按 strategy_id 分层** |
| `slippage` | 0.0 | 全局滑点，百分比模型：`0.0001` = 1bp (0.01%) |
| `volume_limit_pct` | 0.25 | 单笔成交不超过该 Bar 总成交量的比例 |
| `warmup_period` | 0 | 策略预热期（预加载历史数据 Bar 数，用于指标计算） |
| `lot_size` | None | 最小交易单位；`int` 应用于所有标的，dict 按标的匹配 |
| `start_time` / `end_time` | None | 回测起止；naive 时间串/`Timestamp` 按当前 `timezone` 解释后转 UTC 参与过滤 |
| `timezone` | `"Asia/Shanghai"` | IANA 时区（`BacktestConfig.timezone`） |
| `strict_strategy_params` | True | 严格校验策略构造参数，传入策略不接受的参数立即抛错（防止参数错配被静默忽略） |
| `show_progress` | True（config 内） | 进度条开关 |
| `history_depth` | 0 | 历史数据缓存长度 |
| `context` | None | 传给策略的任意上下文 dict |
| `fill_policy` | `NextOpen()` | 运行级默认成交语义（`FillMode` 对象） |
| `commission_policy` / `commission_rate` / `stamp_tax_rate` / `transfer_fee_rate` / `min_commission` | — | 运行级佣金（§6） |
| `risk_config` | None | 风控配置（§9） |
| `strategies_by_slot` / `strategy_id` | — | 多策略（§10） |
| `strategy_fill_policy` / `strategy_slippage` / `strategy_commission` | None | 策略级默认成交/滑点/佣金映射（`strategy_id -> ...`） |
| `broker_profile` | None | 内置参数模板（§6.2） |
| `on_event` | None | 流式事件回调（`BacktestStreamEvent`），不传保持阻塞返回语义 |
| `analyzer_plugins` | None | Analyzer 插件列表，结果汇总到 `result.analyzer_outputs` |
| `config` | None | `BacktestConfig` 配置对象，集中管理 |

### 7.1 流式参数（配合 `on_event`）

- `stream_progress_interval` / `stream_equity_interval`：`progress`/`equity` 事件采样间隔（正整数）。
- `stream_batch_size` / `stream_max_buffer`：事件批量刷新阈值 / 缓冲区上限。
- `stream_error_mode`：`"continue"`（回调报错后继续回测，`finished.payload` 回传统计）或 `"fail_fast"`（首次报错立即终止并抛异常）。
- `stream_mode`：`"observability"`（允许采样与非关键事件背压丢弃）/ `"audit"`（禁用采样、阻塞背压）。
- 事件结构：`run_id / seq / ts(纳秒) / event_type / symbol / level / payload`；`event_type` 常见：`started, finished, progress, equity, order, trade, risk, expiry, error, tick`；交易事件 payload 含 `owner_strategy_id / order_id / symbol / status / filled_qty / trade_id / price / quantity / reason(风控拒单) / expiry_date / cash_flow / settlement_type` 等。

## 8. 配置分层心智模型

优先级（高 → 低）：

1. **订单级**：`buy/sell/submit_order` 传参（如 `fill_mode`/`slippage`/`commission`）；
2. **策略映射级**：`strategy_*`（按 `strategy_id`/slot，如 `strategy_fill_policy[strategy_id]`）；
3. **运行级**：`run_backtest` 扁平参数（如 `fill_policy` / `slippage` / `commission_policy`）；
4. **市场默认**：market model 内建默认规则。

示例（成交语义）：下单时优先级 `订单级 fill_mode > strategy_fill_policy[strategy_id] > 运行级 fill_policy`；滑点、佣金同理。

参数解析规则（`run_backtest`）：**显式参数 > `config` 配置对象 > 系统默认值**。多策略字段可集中配置在 `config.strategy_config`（如 `strategy_id`、`strategies_by_slot`、`strategy_max_*`、`strategy_priority`、`strategy_risk_budget`、`portfolio_risk_budget`）。

配置对象树：

```
BacktestConfig (顶层)
├── StrategyConfig (策略与账户)
│   ├── initial_cash / commission_policy / commission_rate / slippage / volume_limit_pct
│   └── RiskConfig (风控：safety_margin / max_position_pct / ...)
└── InstrumentConfig (资产属性：multiplier / commission_rate / tick_size / lot_size / 期权字段)
    └── 中国期货扩展 ChinaFuturesConfig（品种前缀模板/费率/校验/交易时段）
    └── 中国期权扩展 ChinaOptionsConfig（fee_per_contract / fee_by_symbol_prefix / sessions）
```

- `InstrumentConfig` 关键字段：`symbol / asset_type(STOCK|FUTURES|FUND|OPTION) / multiplier(乘数) / margin_ratio(保证金率, 0.1=10%) / tick_size / lot_size / commission_rate / min_commission / stamp_tax_rate / transfer_fee_rate / slippage`，期权相关 `option_type(CALL|PUT) / strike_price / expiry_date / settlement_type(cash|settlement_price|force_close) / underlying_symbol`。
- 常用枚举（`akquant` 顶层）：`InstrumentAssetTypeEnum`（STOCK/FUTURES/FUND/OPTION）、`InstrumentOptionTypeEnum`（CALL/PUT）、`InstrumentSettlementTypeEnum`（CASH/SETTLEMENT_PRICE/FORCE_CLOSE）。
- `StrategyRuntimeConfig`：运行时行为注入（如 `StrategyRuntimeConfig(error_mode="continue", portfolio_update_eps=1.0)`），不修改策略类代码即可覆盖；`runtime_config_override=True` 应用外部配置、`False` 保留策略侧；未知字段/非法值快速失败并给字段级错误。
- 日志：`akquant` 库默认静默（仅挂 `NullHandler`）；用 `configure_logging(LogConfig(...))` / `register_logger(...)` / `set_log_level(...)` / `get_logger(name)` 打开（`LogConfig` 支持 `profile="research"|"optimize"|"live"`、JSON 输出、`order_audit_file` 实盘订单审计落盘、`mask_sensitive` 敏感字段脱敏）。

## 9. 风控

### 9.1 `risk_config` 参数

`run_backtest(risk_config=...)` 支持 **dict**（如 `{"max_position_pct": 0.1}`）或 **`RiskConfig` 对象**；若同时提供 `config.strategy_config.risk`，此参数覆盖其中的同名字段（"基准配置 + 快速覆盖"模式）。

`RiskConfig` 常用字段（`akquant.config.RiskConfig`）：

| 字段 | 默认 | 说明 |
|---|---|---|
| `active` | True | 风控总开关 |
| `check_cash` | True | 资金检查 |
| `safety_margin` | 0.0001 | 安全垫 |
| `max_order_size` / `max_order_value` | None | 单笔最大数量 / 金额 |
| `max_position_size` | None | 单标的最大持仓 |
| `restricted_list` | None | 禁买标的列表 |
| `max_position_pct` | None | 单标的持仓占比上限 |
| `sector_concentration` | None | 行业集中度限制（float 或 tuple） |
| `max_account_drawdown` | None | 账户最大回撤阈值（0~1），以历史权益峰值为基准，超阈值后拒新单 |
| `max_daily_loss` | None | 单日亏损阈值（0~1），以当日首次风控检查时权益为基准 |
| `stop_loss_threshold` | None | 账户净值止损阈值（0~1），低于"规则首次生效时权益 × 阈值"后拒新单 |
| `account_mode` | `"cash"` | `"cash"` 现金 / `"margin"` 融资融券（配合 `enable_short_sell`、`initial_margin_ratio`、`maintenance_margin_ratio`、`financing_rate_annual`、`borrow_rate_annual`、`allow_force_liquidation`、`liquidation_priority="short_first"`） |

拒单原因体现在 `orders_df.reject_reason` 字段。margin 模式回测可用 `result.liquidation_audit_df` 查看强平审计。

### 9.2 策略级风控映射（多策略下按 strategy_id）

- `strategy_max_order_value` / `strategy_max_order_size` / `strategy_max_position_size`
- `strategy_max_daily_loss` / `strategy_max_drawdown`
- `strategy_reduce_only_after_risk`（风控触发后仅平仓）
- `strategy_risk_cooldown_bars`（风控触发后冷却 bars）
- `strategy_priority`（策略优先级）
- `strategy_risk_budget` / `portfolio_risk_budget` / `risk_budget_mode`（默认 `"order_notional"`）/ `risk_budget_reset_daily`

⚠️ 所有策略级映射的键**必须**在 `strategy_id + strategies_by_slot` 集合内，键为空/未知策略键/负值阈值会触发参数校验失败（报错 "unknown strategy id"）。

## 10. 多策略：slot 执行

```python
from akquant import BacktestConfig, StrategyConfig, run_backtest

config = BacktestConfig(
    strategy_config=StrategyConfig(
        strategy_id="alpha",                                  # 主策略归属 ID
        strategies_by_slot={"beta": BetaStrategy},            # 额外 slot -> 策略
        strategy_max_order_size={"alpha": 10, "beta": 20},    # 策略级风控按 strategy_id 键控
        strategy_reduce_only_after_risk={"alpha": True, "beta": False},
        strategy_risk_cooldown_bars={"alpha": 2, "beta": 0},
        strategy_priority={"alpha": 1, "beta": 2},
    )
)
result = run_backtest(data=data, strategy=MyStrategy, symbols="TEST", config=config, show_progress=False)
```

- 也可直接在 `run_backtest(strategies_by_slot={...}, strategy_id=..., strategy_max_*=..., ...)` 传扁平参数。
- 归属：`orders_df`/`trades_df` 有 `owner_strategy_id` 归属列；`result.orders_by_strategy()` / `result.executions_by_strategy()` 按策略聚合统计。
- 账户模型为**共享账户**（非独立子账户）；热启动场景用 `run_from_checkpoint` 恢复时建议复用同一 `config` 保持 slot 与风控映射连续。

## 11. 参数优化

### 11.1 `run_grid_search`（网格搜索）

```python
def run_grid_search(
    strategy: Type[Strategy],
    param_grid: Mapping[str, Sequence[Any]],   # 如 {"fast": [5, 10, 20], "slow": [20, 40, 60]}
    data: Any = None,
    max_workers: Optional[int] = None,          # 并行 worker 数
    sort_by: Union[str, List[str]] = "sharpe_ratio",
    ascending: Union[bool, List[bool]] = False, # 默认降序（指标越大越好）
    return_df: bool = True,                     # True 返回 DataFrame，False 返回 List[OptimizationResult]
    warmup_calc: Optional[Any] = None,
    constraint: Optional[Any] = None,           # 参数组合约束
    result_filter: Optional[Any] = None,        # 结果过滤
    timeout: Optional[float] = None,
    max_tasks_per_child: Optional[int] = None,
    db_path: Optional[str] = None,              # 结果落盘（SQLite）
    forward_worker_logs: bool = False,          # 子进程日志回传主进程
    **kwargs: Any,                              # 透传 run_backtest
) -> Union[pd.DataFrame, List[OptimizationResult]]
```

- `param_grid` 的键必须与策略构造参数严格匹配：`run_grid_search` 内 `strict_strategy_params` 默认 `True`，参数不匹配快速失败，避免静默回退。
- `forward_worker_logs=False`：吞吐优先，日志可能在主进程不可见；`True`：启用日志聚合便于排障。
- 常用示例：

```python
import akquant as aq

df = aq.run_grid_search(
    strategy=MyStrategy,
    param_grid={"fast": [5, 10], "slow": [20, 40]},
    data=data,
    sort_by=["sharpe_ratio", "total_return_pct"],  # 多指标排序
    max_workers=4,
)
print(df)  # 每行一个参数组合 + 指标列，已按 sort_by 排序
```

### 11.2 `run_walk_forward`（滚动优化 / Walk-forward）

```python
def run_walk_forward(
    strategy: Type[Strategy],
    param_grid: Mapping[str, Sequence[Any]],
    data: pd.DataFrame,
    train_period: int,       # 样本内窗口（bar 数）
    test_period: int,        # 样本外窗口（bar 数）
    metric: Union[str, List[str]] = "sharpe_ratio",
    ascending: Union[bool, List[bool]] = False,
    initial_cash: float = 100_000.0,
    warmup_period: int = 0,
    warmup_calc: Optional[Any] = None,
    constraint: Optional[Any] = None,
    result_filter: Optional[Any] = None,
    compounding: bool = False,   # 窗口间是否复利滚存资金
    timeout: Optional[float] = None,
    max_tasks_per_child: Optional[int] = None,
    **kwargs: Any,
) -> pd.DataFrame
```

- 流程：按窗口执行"**样本内参数优化**（`run_grid_search`）→ **样本外验证**（`run_backtest`）"，并拼接样本外资金曲线。
- `**kwargs` 透传 `run_grid_search`（样本内优化阶段）与 `run_backtest`（样本外验证阶段）；因此 `forward_worker_logs`、`strict_strategy_params` 等语义在两阶段保持一致（默认严格）。
- `compounding=True` 时各窗口在上一窗口期末权益基础上继续；`False` 每窗口用 `initial_cash` 重新开始。

## 12. 断点恢复：`run_from_checkpoint`

```python
def run_from_checkpoint(
    checkpoint_path: str,                  # 快照路径
    data: Optional[BacktestDataInput] = None,
    show_progress: bool = True,
    symbols: ... = "BENCHMARK",
    # 与 run_backtest 相同的策略 slot / 策略级风控 / 成交默认项参数均可传
    **kwargs: Any,
) -> BacktestResult
```

- 从快照恢复并**继续运行**回测（支持多策略 slot 执行），不重新跑已回放部分。
- 恢复语义：对 slot / 策略级风控 / 成交默认项，优先级为 **显式函数参数 > `config.strategy_config` > checkpoint 恢复值 / 默认值**。
- 生命周期：恢复后的热启动阶段触发 `on_resume(ctx)`，且**先于 `on_start(ctx)`**。
- 分阶段续跑产生的多段结果用 `merge_results(*results, drop_expired_instruments=True, dedupe_boundary=True) -> MergedResult` 按时间顺序合并（各段须时间递增、互不重叠，重叠段抛 `ValueError`；`dedupe_boundary=True` 去重相邻段重叠边界时间戳；`MergedResult.metrics` 只重算可从权益曲线+交易明细推导的核心指标，其余字段访问抛 `AttributeError`）。

## 13. 结果对象 `BacktestResult`

| 属性/方法 | 说明 |
|---|---|
| `metrics_df` | 绩效指标表（`print(result)` 等效）；交易相关主字段：`closed_trade_count / execution_count / open_position_count` |
| `metrics` | 指标对象（`result.metrics.total_return_pct / sharpe_ratio / max_drawdown_pct / annualized_return / sortino_ratio / profit_factor / calmar_ratio / volatility / win_rate / var_95 / var_99 / cvar_95 / cvar_99 / sqn / kelly_criterion / max_leverage / min_margin_level` 等约 60 项） |
| `trades_df` / `orders_df` / `executions_df` / `positions_df` | 平仓交易 / 委托 / 成交流水 / 每日持仓明细表 |
| `equity_curve` / `cash_curve` / `margin_curve` | 权益 / 现金 / 保证金曲线（`List[Tuple[timestamp, value]]`） |
| `equity_curve_daily` / `cash_curve_daily` / `margin_curve_daily` | 日频末值聚合曲线 |
| `trades` / `executions` / `snapshots` | `ClosedTrade` 列表 / `Trade` 列表 / 每日 `PositionSnapshot` 列表 |
| `exposure_df(freq="D")` | 组合暴露分解（净暴露/总暴露/杠杆） |
| `attribution_df(by="symbol"\|"tag")` | 按标的/标签归因 |
| `capacity_df(freq="D")` | 容量代理（成交率/换手） |
| `benchmark_analysis(benchmark=None, curve_freq=...)` / `export_benchmark_analysis(path, ...)` | 基准对比分析（结构化结果 / 导出 JSON·parquet） |
| `top_reject_reason_types(top_n=10)` | 拒单原因聚合统计 |
| `orders_by_strategy()` / `executions_by_strategy()` | 按策略归属聚合订单 / 成交流水 |
| `get_event_stats()` | 流式事件统计（`processed_events / dropped_event_count / callback_error_count / backpressure_policy / stream_mode`） |
| `viz.report(filename=..., show=True, benchmark=None, compact_currency=True, curve_freq="D"\|"raw")` | Plotly 交互式 HTML 报告（权益曲线/回撤/月度热力图/基准对比/强平审计） |
| `liquidation_audit_df` | 融资融券强平审计明细（margin 模式） |

## 14. ML：滚动训练（Walk-forward）

### 14.1 核心设计

- **Signal 与 Action 分离**：模型（`QuantModel` 统一接口）只输出预测信号，不直接输出买卖指令；策略层结合风控/资金管理做决策。
- **Adapter 适配器**：`SklearnAdapter`（XGBoost/LightGBM/RandomForest 等）、`PyTorchAdapter`（LSTM/Transformer，自动处理 DataLoader 与训练循环）。
- **防未来函数**：特征 X 只能用当前及之前数据；标签 y 描述 t+1 状态（构造时 `shift(-1)`，训练前剔除 NaN 行）；特征预处理必须封装在 `sklearn.pipeline.Pipeline` 中（否则 `StandardScaler` 在全量数据上 fit 会泄露测试集统计量）。
- **生命周期（兼容模式）**：当前 bar 完成后，用最近 `train_window` 根数据训练新模型副本 → **下一根 bar 才生效**（延迟生效）→ `test_window` 定义该模型计划覆盖的样本外区间 → `rolling_step` 决定重训触发点（`0` 则回退用 `test_window`）→ 框架调用 `QuantModel.clone()` 创建每窗口模型副本（默认 `deepcopy`，GPU 句柄/锁等不可拷贝状态需重写）。

### 14.2 策略内使用

```python
from akquant import Strategy
from akquant.ml import SklearnAdapter
from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import StandardScaler
from sklearn.pipeline import Pipeline

class WalkForwardStrategy(Strategy):
    def __init__(self):
        pipeline = Pipeline([('scaler', StandardScaler()), ('model', LogisticRegression())])
        self.model = SklearnAdapter(pipeline)
        self.model.set_validation(
            method='walk_forward',
            train_window=50,   # 用过去 50 个 bar 训练；支持 '1y'/'6m'/'50d' 或整数 bar
            test_window=20,    # 每个模型默认覆盖 20 个样本外 bar
            rolling_step=10,   # 每 10 个 bar 重训一次；0 则回退用 test_window
            frequency='1m',    # 数据频率（时间字符串 -> bar 数的换算依据，如 '1d' 下 1y=252）
            incremental=False, # 增量训练（Sklearn partial_fit）还是从头重训
            verbose=True,
        )
        self.set_history_depth(60)  # 或 self.warmup_period = 60

    def prepare_features(self, df, mode="training"):
        """[必须实现] 纯函数，不应依赖外部状态。
        mode="training" 返回 (X, y)；mode="inference" 返回 X（通常是最后一行）。"""
        X = pd.DataFrame()
        X['ret1'] = df['close'].pct_change()
        X['ret2'] = df['close'].pct_change(2)
        if mode == 'inference':
            return X.iloc[-1:]
        future_ret = df['close'].pct_change().shift(-1)  # 构造标签：未来涨跌
        data = pd.concat([X, future_ret.rename("future_ret")], axis=1).dropna()
        return data[["ret1", "ret2"]], (data["future_ret"] > 0).astype(int)

    def on_bar(self, bar):
        if not self.is_model_ready():          # 首个训练窗口完成前为 False
            return
        window = self.current_validation_window()  # window_index/active_start_bar/active_end_bar/next_train_bar
        hist = self.get_history_df(10)
        X_curr = self.prepare_features(hist, mode='inference')
        signal = self.model.predict(X_curr)[0]  # 二分类返回 Class 1 概率
        pos = self.get_position(bar.symbol)
        if signal > 0.55 and pos == 0:
            self.buy(bar.symbol, 100)
        elif signal < 0.45 and pos > 0:
            self.sell(bar.symbol, pos)
```

- 运行：`run_backtest(data=df, strategy=WalkForwardStrategy, symbols="TEST", lot_size=1, fill_policy=CurrentClose(), history_depth=60, warmup_period=50)`。
- 模型持久化：`self.model.save("my_model.pkl")` / `self.model.load("my_model.pkl")`（在 `__init__` 中加载）。
- PyTorch：`PyTorchAdapter(network=SimpleNet(), criterion=nn.BCELoss(), optimizer_cls=optim.Adam, lr=0.001, epochs=20, batch_size=64, device='cuda')`。
- 函数式风格对应 `on_train_signal(ctx)` 回调：仅在 ML 滚动训练窗口触发。
- `set_validation` 完整签名：`method='walk_forward'`（目前仅支持）、`train_window='1y'|int`、`test_window='3m'`、`rolling_step`、`frequency='1d'`、`incremental=False`、`verbose=False`。

## 15. 实盘执行：`run_live` / `broker_live`

```python
from akquant import run_live

run_live(
    strategy_cls=on_bar,
    instruments=instruments,
    broker="ctp",
    trading_mode="broker_live",
    gateway_options={"execution_semantics_mode": "strict"},
)
```

**`gateway_options.execution_semantics_mode` 执行语义**：

| 取值 | 默认 | 行为 | 推荐场景 |
|---|---|---|---|
| `strict` | 是 | `Cancelled` / `Rejected` / `Filled` 等终态由订单回报（`OnRtnOrder`）**最终确认**；错误回报会先缓存拒单原因，再在后续订单回报中补齐 | 生产实盘 |
| `compatible` | 否 | 在部分错误/撤单路径允许本地立即推进终态，兼容历史行为 | 迁移过渡 |

严格模式注意事项：

- **撤单请求发送成功 ≠ `Cancelled`**，需等待 `OnRtnOrder(Cancelled)`。
- **收到错误回报 ≠ `Rejected`**，最终状态以订单回报为准。
- 实盘与回测的差异补充：`sell` 不传数量时 `broker_live` 取**可用持仓**（A 股 T+1 当日买入部分不可卖）；实盘 `InstrumentSnapshot` 只覆盖 `symbol/asset_type/multiplier/margin_ratio/tick_size/lot_size/option_margin_model/implied_volatility/reference_volatility`，期权字段（`option_type/strike_price/expiry_date/underlying_symbol/settlement_type/settlement_price/static_attrs`）为 `None`，期权策略需自行经策略参数或 `context` 传入。
- 自定义 broker：`akquant.gateway` 提供 `register_broker(name, builder)` / `unregister_broker(name)` / `get_broker_builder(name)` / `list_registered_brokers()` / `create_gateway_bundle(broker, feed, symbols, use_aggregator)`。
- 实盘审计：`LogConfig(order_audit_file=...)` 可将每笔订单的提交/回报/成交/撤单/拒单以 JSON line 写入独立审计文件。
- **本文档对 `run_live` 仅覆盖上述执行语义；完整实盘流程（网关接入、账户配置、状态管理等）见官方文档。**

## 16. 常见坑

- **`fill_policy` 传 dict 会抛 `TypeError`**：旧 `{"price_basis": ..., "bar_offset": ..., "temporal": ...}` 与 `make_fill_policy(...)` 已移除，统一用 `FillMode` 对象（`NextOpen()`/`NextClose()`/`NextAverage()`/`NextHighLowMid()`/`CurrentClose(timer_fill_timing=...)`）。
- **`legacy_execution_policy_compat`、legacy 价格基准参数、legacy 时序参数均已移除**，不再接受；公开执行配置全量统一用 `FillMode`。
- **`symbol` 参数已移除**：`run_backtest`/`run_from_checkpoint` 只接受 `symbols`（字符串或列表），传 `symbol=` 会报错。
- **`timer_fill_timing` 只对 `CurrentClose` 有意义**：`"immediate"`（默认）timer 触发当期成交，`"deferred"` 顺延到下一根 bar；其余模式 `on_timer` 订单一律下一根 bar 成交。
- **T+1 不支持按策略分层**：`t_plus_one` 是运行级/市场级开关；启用后强制使用中国市场模型。
- **`strict_strategy_params` 保持默认 `True`**：`run_grid_search` 中 `param_grid` 与策略构造参数不匹配会快速失败，不要关掉它来"绕过错配"——那会静默回退导致结果偏差。
- **`forward_worker_logs=False` 时子进程日志主进程不可见**：排障时置 `True`。
- **策略级风控映射键必须合法**：键不在 `strategy_id + strategies_by_slot` 集合内报 "unknown strategy id"；空键/负阈值触发校验失败。
- **`sell` 不传数量 = 全平**，且 `broker_live` 下按**可用持仓**（T+1 当日买入部分不可卖，按总量报单会被柜台整单拒绝）；解析后下单量 ≤ 0 不报单、返回空回执。
- **`on_pre_open` 的默认成交语义是 `NextOpen()`**（当日 open），想当根收盘成交需显式传 `fill_mode`。
- **实盘终态以订单回报为准**：撤单成功 ≠ Cancelled、错误回报 ≠ Rejected（strict 模式）。
- **时区：内部用 UTC 保存事件真实时刻**（`bar.timestamp_iso` 是 `Z` 结尾的 UTC ISO 8601），展示层用本地时区（`+08:00`）——同一时刻两种表达，不是时间错了；naive `start_time`/`end_time` 按当前 `timezone` 解释再转 UTC 过滤。
- **期货费率接口统一复数命名** `set_futures_fee_rules*`，旧单数 `set_future_fee_rules*` 已移除。
- **PyCharm 看不到进度条**：Run 配置勾选 `Emulate terminal in output console`（确认 `show_progress=True`），或改用 `on_event` 消费 `progress` 事件输出文本进度。
- **回测与实盘的 `InstrumentSnapshot` 字段覆盖不同**：实盘只接 `Instrument` 对象，期权字段与 `static_attrs` 为 None，依赖这些字段的期权策略需自行传参。
- **ML 特征必须防泄露**：预处理放 `Pipeline`；标签 `shift(-1)` 后的 NaN 行训练前剔除；训练窗口内 `prepare_features` 是纯函数，不要依赖外部状态。
- **`merge_results` 各段必须时间递增、互不重叠**，重叠段抛 `ValueError`。
- **库默认静默日志**：未 `configure_logging` 前 `akquant` 根 logger 只有 `NullHandler`，看不到 Rust 侧 warning（如保证金不足拒单、收盘过期）——排查时先开日志。

## 17. 官方文档（权威）

- 文档首页（中文）：https://akquant.akfamily.xyz/
- API 参考（run_backtest / run_grid_search / run_walk_forward / run_from_checkpoint / run_live / 执行语义 / 配置系统 / 风控 / BacktestResult / 数据 I/O）：https://akquant.akfamily.xyz/reference/api/
- GitHub 仓库（README/核心特性）：https://github.com/akfamily/akquant
- 安装指南：https://github.com/akfamily/akquant/blob/main/docs/zh/start/installation.md
- 快速开始（quickstart）：https://github.com/akfamily/akquant/blob/main/docs/zh/start/quickstart.md
- 机器学习与滚动训练指南：https://github.com/akfamily/akquant/blob/main/docs/zh/advanced/ml.md
- 多策略指南：https://github.com/akfamily/akquant/blob/main/docs/zh/advanced/multi_strategy_guide.md
- 热启动（checkpoint 恢复）指南：https://github.com/akfamily/akquant/blob/main/docs/zh/advanced/warm_start.md
- 时区处理指南：https://github.com/akfamily/akquant/blob/main/docs/zh/advanced/timezone.md
- 贡献指南：https://github.com/akfamily/akquant/blob/main/CONTRIBUTING.md
- PyPI 发布页：https://pypi.org/project/akquant/
- 数据源 AKShare：https://github.com/akfamily/akshare

---

*说明：本技能按 AKQuant 官方文档（akquant.akfamily.xyz + GitHub docs/zh）整理；接口签名以文档最新版为准。*
