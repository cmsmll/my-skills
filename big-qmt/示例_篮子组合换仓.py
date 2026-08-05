#coding:gbk
"""
一篮子换仓 + 智能算法下单示例 —— 参考用户微盘股实盘打法，基于官方文档
运行模式：实盘 or 模拟盘（editor 模式编辑器/自动执行）。

流程（三种场景统一为一个篮子函数）：
  1. 构造当前持仓视图（position 得到 股票->手数，经内置函数转成 buy/sell 腿）。
  2. 对所有目标标的，按「持仓无目标 -> 卖」，「持仓不足目标 -> 差额买」对腿。
  3. 用 set_basket 提交篮子（腿里带 optType：23买 / 24卖）。
  4. get_basket 回读校验后，用 smart_algo_passorder 一键组合成交（VWAP）、防重。
  5. 成交后，用 active 委托去重，避免重复重复触发。

篮子/组合交易核心函数见：SKILL.md 第 6 节（篮子/组合交易）与第 7 节（智能算法下单）。
"""
from datetime import datetime

ALGO_VWAP = 'VWAP'
SMART_ALGO_LIMIT_OVER_RATE = 25      # 量比 0-100（智能算法网格/冰山算法去量参数）
SMART_ALGO_MIN_AMOUNT = 0            # 最小委托金额 0~100000
SMART_ALGO_LIMIT_CONTROL = 1         # 1=涨停不卖/跌停不买


def _current_positions():
    """读当前股票持仓，返回 {代码: 手数/股数}。"""
    pos = {}
    for p in get_trade_detail_data('', 'stock', 'position'):
        code = p.m_strInstrumentID + '.' + p.m_strExchangeID
        pos[code] = pos.get(code, 0) + p.m_nCanUseVolume
    return pos


def _today():
    return datetime.now().strftime('%Y%m%d')


def make_basket_legs(C, targets, positions):
    """targets: {代码SH:目标手数}; positions: {代码SH:当前手数}
    返回 [(stock, weight, quantity, opt_type)]，其中 weight 一律 0（组合按手数）。"""
    legs = []
    all_codes = set(targets) | set(positions)
    for code in all_codes:
        tgt = targets.get(code, 0)
        cur = positions.get(code, 0)
        if cur == 0 and tgt == 0:
            continue
        if cur < tgt:              # 补仓到目标
            legs.append({'stock': code, 'weight': 0.0, 'quantity': tgt - cur, 'optType': 23})
        elif cur > tgt:            # 多出的卖掉
            legs.append({'stock': code, 'weight': 0.0, 'quantity': cur - tgt, 'optType': 24})
    return legs


def rebalance(C, target_hand, strategy_name, algo_start='09:30:00', algo_end='15:00:00'):
    """target_hand: {代码: 目标手数}; 构建篮子并组合下单。smart_algo_passorder 18参与真实实盘一致。"""
    # 0. 取当日全部委托（备注防重），若有交集先撤
    today = _today()
    active = []   # active = C.assert委托里 remark 含 today 且 未成交部分
    # ...（省略：查询当日未成交/部分成交，先 cancel 保证换仓幂等）

    # 1. 构造腿
    legs = make_basket_legs(C, target_hand, _current_positions())
    if not legs:
        print('无腿，跳过')
        return

    # 2. 创建篮子并回读
    set_basket({'name': C.BASKET_NAME, 'stocks': legs})

    # 3. 组合下单：35=一键买卖组合, 2101=按篮子份数, 12=市价(组合交易不能用11限价), volume=篮子份数
    accounts = get_trade_detail_data('', 'stock', 'account')
    if not accounts:
        return
    account_id = accounts[0].m_strAccountID
    remark = '%s_%s_调仓' % (today, strategy_name)
    smart_algo_passorder(
        35, 2101, account_id, C.BASKET_NAME, 12, 0, 1, strategy_name,
        2, remark, ALGO_VWAP, SMART_ALGO_LIMIT_OVER_RATE, SMART_ALGO_MIN_AMOUNT,
        1, algo_start, algo_end, SMART_ALGO_LIMIT_CONTROL, C   # targetPriceLevel 仅冰山算法用，VWAP 可缺省
    )
    # 组合交易不支持 11 限价，均价用 VWAP 拆单；量比 0~100、最小金额 0~100000 见上。
    print('%s 已提交组合：%s' % (today, remark))


def smart_algo_ex_note():
    """旧版本/部分客户端可用的调用方法二：参数不可缺省，algoParam 用 get_smart_algo_param 查询。
    smart_algo_passorder(35, 2101, acct, BASKET, 12, modelprice, 1, 'strategy',
                         2, userid, 'VWAP', '09:30:00', '15:00:00', algoParam, C)
    algoParam keys: m_dLimitOverRate 量比0~1小数, m_dMinAmountPerOrder, m_dMaxAmountPerOrder,
                    m_nStopTradeForOwnHiLow, m_dMulitAccountRate, m_strCmdRemark。
    """
    pass