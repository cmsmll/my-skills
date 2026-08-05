#coding:gbk
"""
回测双均线策略示例（迅投QMT内置Python）
运行模式：回测（逐K线），读本地数据，不订阅。

依赖与本文件：无依赖。
运行：先在 QMT 内置编辑器打开本文件，选标的为主图品种，先 操作>数据管理 下载对应周期历史数据，
      编辑界面点「回测」用副图模式跑。
"""
import numpy as np


def init(C):
    # 设置测试标的为主图品种
    C.stock = C.stockcode + '.' + C.market
    C.line1 = 10   # 快线参数
    C.line2 = 20   # 慢线参数
    C.accountid = "testS"   # 回测模式资金账号可填任意字符串


def handlebar(C):
    bar_date = timetag_to_datetime(C.get_bar_timetag(C.barpos), '%Y%m%d%H%M%S')
    # 回测: 不订阅、读本地数据（需先下载对应周期历史数据）
    local_data = C.get_market_data_ex(['close'], [C.stock],
        end_time=bar_date, period=C.period, count=max(C.line1, C.line2), subscribe=False)
    close_list = list(local_data[C.stock].iloc[:, 0])
    if len(close_list) < max(C.line1, C.line2):
        print(bar_date, '行情不足 跳过')
        return

    line1_mean = sum(close_list[-C.line1:]) / C.line1
    line2_mean = sum(close_list[-C.line2:]) / C.line2

    account = get_trade_detail_data('test', 'stock', 'account')[0]
    available_cash = int(account.m_dAvailable)

    holdings = {p.m_strInstrumentID + '.' + p.m_strExchangeID: p.m_nVolume
                 for p in get_trade_detail_data('test', 'stock', 'position')}
    holding_vol = holdings.get(C.stock, 0)

    if holding_vol == 0 and line1_mean > line2_mean:
        vol = int(available_cash / close_list[-1] / 100) * 100   # 取整百股
        if vol >= 100:
            passorder(23, 1101, C.accountid, C.stock, 5, -1, vol,
                      '回测双均线', 1, 'MA', C)   # 最新价买入开
            print(bar_date + " 开仓")
    elif holding_vol > 0 and line1_mean < line2_mean:
            passorder(24, 1101, C.accountid, C.stock, 5, -1, holding_vol,
                  '回测双均线', 1, 'MA', C)   # 最新价平掉
            print(bar_date + " 平仓")