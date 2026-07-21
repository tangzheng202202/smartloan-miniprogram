// 还款计划表页：汇总卡 + 按年分组折叠明细（支持 360+ 行流畅滚动）
// 数据来源：wx.getStorageSync('currentInput')（计算器页写入），无则使用引擎默认房贷示例
'use strict';

const loan = require('../../utils/loan.js');

const METHOD_LABELS = {
  equalPayment: '等额本息',
  equalPrincipal: '等额本金',
  interestFirst: '先息后本',
};

/** 金额格式化：千分位，保留 2 位小数 */
function fmtMoney(v) {
  const n = Number(v) || 0;
  const fixed = n.toFixed(2);
  const parts = fixed.split('.');
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return parts.join('.');
}

/** 金额格式化：千分位，四舍五入到整数（汇总卡用大数字） */
function fmtMoney0(v) {
  const n = Math.round(Number(v) || 0);
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** 生成一行明细的展示对象 */
function buildRow(item, isCombined) {
  const row = {
    month: item.month,
    payment: fmtMoney(item.payment),
    principal: fmtMoney(item.principal),
    interest: fmtMoney(item.interest),
    remaining: fmtMoney(item.remainingPrincipal),
    combinedText: '',
  };
  if (isCombined) {
    row.combinedText =
      '公积金 ' + fmtMoney(item.fundPayment) + ' · 商贷 ' + fmtMoney(item.commercialPayment);
  }
  return row;
}

Page({
  data: {
    disclaimer: loan.DISCLAIMER,
    methodLabel: '',
    isCombined: false,
    // 汇总卡
    summaryTitle: '月供',
    monthlyPayment: '0',
    monthlyDecrease: '', // 等额本金：月递减金额
    totalInterest: '0',
    totalPayment: '0',
    months: 0,
    years: 0,
    // 组合贷汇总小字
    combinedSummary: '',
    // 按年分组：{ yearIndex, label, collapsed, rows: [...] }
    groups: [],
    // 复制用原始数据（不放进 data 的全量 schedule，挂载到 this）
  },

  onLoad() {
    let input;
    try {
      const saved = wx.getStorageSync('currentInput');
      if (saved && typeof saved === 'object') {
        input = loan.inputFromJson(saved);
      }
    } catch (e) {
      input = null;
    }
    if (!input) {
      input = loan.createLoanInput(); // 引擎默认房贷示例
    }
    this._input = input;
    this.renderPlan(input);
  },

  renderPlan(input) {
    const result = loan.LoanEngine.calculate(input);
    const schedule = loan.LoanEngine.schedule(input);
    this._schedule = schedule;

    const months = result.months;
    const isCombined = result.isCombined;
    const method = input.method;
    const r = (isCombined ? 0 : input.annualRate) / 12;

    // 汇总卡
    let summaryTitle = '月供';
    let monthlyPayment = fmtMoney0(result.total.monthlyPayment);
    let monthlyDecrease = '';
    if (method === loan.RepaymentMethod.EQUAL_PRINCIPAL) {
      summaryTitle = '首月月供';
      if (!isCombined) {
        const decrease = (input.principal / months) * r;
        monthlyDecrease = '每月递减 ¥' + fmtMoney(decrease);
      } else {
        const lastPayment = schedule.length > 0 ? schedule[schedule.length - 1].payment : 0;
        monthlyDecrease = '末月月供 ¥' + fmtMoney(lastPayment);
      }
    } else if (method === loan.RepaymentMethod.INTEREST_FIRST) {
      summaryTitle = '每月利息';
      monthlyDecrease = '期末一次性还本 ¥' + fmtMoney0(result.total.principal);
    }

    let combinedSummary = '';
    if (isCombined) {
      combinedSummary =
        '公积金 ¥' + fmtMoney0(result.fund.principal) +
        '（' + (input.fundAnnualRate * 100).toFixed(2) + '%） · ' +
        '商贷 ¥' + fmtMoney0(result.commercial.principal) +
        '（' + (input.commercialAnnualRate * 100).toFixed(2) + '%）';
    }

    // 按年分组（每年 12 期，首年默认展开，其余收起，保证 360+ 行流畅）
    const groups = [];
    for (let y = 0; y * 12 < months; y++) {
      const start = y * 12;
      const end = Math.min(start + 12, months);
      const rows = [];
      for (let i = start; i < end; i++) {
        rows.push(buildRow(schedule[i], isCombined));
      }
      groups.push({
        yearIndex: y,
        label: '第 ' + (y + 1) + ' 年（第 ' + (start + 1) + '–' + end + ' 期）',
        collapsed: y !== 0,
        rows: rows,
      });
    }

    this.setData({
      methodLabel: METHOD_LABELS[method] || method,
      isCombined: isCombined,
      summaryTitle: summaryTitle,
      monthlyPayment: monthlyPayment,
      monthlyDecrease: monthlyDecrease,
      totalInterest: fmtMoney0(result.total.totalInterest),
      totalPayment: fmtMoney0(result.total.totalPayment),
      months: months,
      years: input.years,
      combinedSummary: combinedSummary,
      groups: groups,
    });
  },

  /** 展开 / 收起某一年的分组 */
  onToggleGroup(e) {
    const idx = e.currentTarget.dataset.index;
    const key = 'groups[' + idx + '].collapsed';
    this.setData({ [key]: !this.data.groups[idx].collapsed });
  },

  /** 复制计划表简表文本（按钮与长按表格均可触发） */
  onCopySchedule() {
    const input = this._input;
    const schedule = this._schedule;
    if (!input || !schedule || schedule.length === 0) {
      wx.showToast({ title: '暂无计划表', icon: 'none' });
      return;
    }
    const result = loan.LoanEngine.calculate(input);
    const lines = [];
    lines.push('【还款计划表】');
    lines.push('贷款总额：¥' + fmtMoney0(result.total.principal));
    if (result.isCombined) {
      lines.push(
        '公积金：¥' + fmtMoney0(result.fund.principal) +
        '（' + (input.fundAnnualRate * 100).toFixed(2) + '%），' +
        '商贷：¥' + fmtMoney0(result.commercial.principal) +
        '（' + (input.commercialAnnualRate * 100).toFixed(2) + '%）'
      );
    } else {
      lines.push('年利率：' + (input.annualRate * 100).toFixed(2) + '%');
    }
    lines.push('期限：' + input.years + ' 年（' + result.months + ' 期） · ' + (METHOD_LABELS[input.method] || ''));
    lines.push('总利息：¥' + fmtMoney0(result.total.totalInterest) + ' · 总还款：¥' + fmtMoney0(result.total.totalPayment));
    lines.push('----------------------------');
    lines.push('期数 | 月供 | 本金 | 利息 | 剩余本金');
    for (let i = 0; i < schedule.length; i++) {
      const it = schedule[i];
      let line =
        '第' + it.month + '期 | ' + fmtMoney(it.payment) + ' | ' +
        fmtMoney(it.principal) + ' | ' + fmtMoney(it.interest) + ' | ' +
        fmtMoney(it.remainingPrincipal);
      if (result.isCombined) {
        line += '（公积金 ' + fmtMoney(it.fundPayment) + ' / 商贷 ' + fmtMoney(it.commercialPayment) + '）';
      }
      lines.push(line);
    }
    lines.push('----------------------------');
    lines.push(loan.DISCLAIMER);

    wx.setClipboardData({
      data: lines.join('\n'),
      success() {
        wx.showToast({ title: '计划表已复制', icon: 'success' });
      },
      fail() {
        wx.showToast({ title: '复制失败', icon: 'none' });
      },
    });
  },
});
