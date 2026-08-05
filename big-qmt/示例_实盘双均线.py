#coding:gbk
"""
实盘（或模拟盘）双均线策略示例 —— 基于QMT内置Python
运行模式：实盘，快速下单；用订阅推送的实时K线触发交易。

要点：
  - init 里订阅历史数据、设置参数；handlebar 的触发方式取决于「编辑界面->配置运行」。
  - 本示例对每分钟 K 线做双均线判断，只在 is_last_bar 时检查信号，
    配合 quickTrade=2 实现立即下单（不等收盘）。
  - 下单是异步的：调用后建议用 timer 回调轮询成交回报，或用查询接口核对。
"""
import numpy as np


def init(C):
    C.stock = C.stockcode + '.' + C.market          # 主图标的，如 600000.SH
    C.line1 = 10                                    # 快线周期
    C.line2 = 20                                    # 慢线周期
    C.accountid = "你的资金账号"                      # 实盘填真实账号
    C.userOrderId = "MA_" + C.stock                 # 备注，用于防重复下单

    # 订阅历史数据：周期对齐主图，先用 count 拉最近 N 根
    C.subscribe_quote(C.stock, C.period)
    data = C.get_market_data_ex(['close'], [C.stock],
                                period=C.period, count=max(C.line1, C.line2))
    C.close_list = list(data[C.stock].iloc[:, 0])
    C.today_orders = set()                          # 当日已下订单备注，防重


def handlebar(C):
    # 仅处理最新一根K线（实盘快速下单场景）
    if not C.is_last_bar():
        return

    bar_date = timetag_to_datetime(C.get_bar_timetag(C.barpos), '%Y%m%d%H%M%S')
    # 用订阅的实时K线：get_market_data_ex 不指定 end_time 时取本地最新
    data = C.get_market_data_ex(['close'], [C.stock], period=C.period, count=1)
    latest_close = float(data[C.stock].iloc[-1, 0])
    C.close_list.append(latest_close)
    if len(C.close_list) > max(C.line1, C.line2) * 3:
        C.close_list = C.close_list[-max(C.line1, C.line2) * 3:]

    if len(C.close_list) < max(C.line1, C.line2):
        return

    line1_mean = np.mean(C.close_list[-C.line1:])
    line2_mean = np.mean(C.close_list[-C.line2:])

    # 持仓查询（示例用当日成交去重，实际请核对持仓）
    positions = {p.m_strInstrumentID + '.' + p.m_strExchangeID: p.m_nVolume
                 for p in get_trade_detail_data('', 'stock', 'position')}
    hold_vol = positions.get(C.stock, 0)

    # 信号
    if hold_vol == 0 and line1_mean > line2_mean:
        # 用可用资金算整百股
        account = get_trade_detail_data('', 'stock', 'account')[0]
        vol = int(account.m_dAvailable / latest_close / 100) * 100
        if vol >= 100:
            # 最新价买：passorder(opType=23买, 1101普通, 账号, 代码, prType=5最新价, price占位-1, 数量, 策略名, quickTrade=2立即, 备注防重, ContextInfo)
            passorder(23, 1101, C.accountid, C.stock, 5, -1, vol,
                      'MA实盘', 2, C.userOrderId + bar_date, C)
            print(bar_date + ' 开仓买入 %d' % vol)
    elif hold_vol > 0 and line1_mean < line2_mean:
        # 最新价卖
        passorder(24, 1101, C.accountid, C.stock, 5, -1, hold_vol,
                  'MA实盘', 2, C.userOrderId + bar_date, C)
        print(bar_date + ' 平仓卖出 %d' % hold_vol)