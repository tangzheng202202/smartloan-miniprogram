/**
 * 计算器主页
 * 贷款类型切换 / 首付三联动 / 等额本息·等额本金 / 组合贷 / 即时重算 /
 * 还款计划跳转 / 方案保存 / 本金利息占比饼图
 */
const loan = require('../../utils/loan.js');

const CATEGORY_TABS = [
  { key: loan.LoanCategory.MORTGAGE, label: '房贷' },
  { key: loan.LoanCategory.CAR, label: '车贷' },
  { key: loan.LoanCategory.CONSUMER, label: '消费贷' },
];

const METHOD_TABS = [
  { key: loan.RepaymentMethod.EQUAL_PAYMENT, label: '等额本息' },
  { key: loan.RepaymentMethod.EQUAL_PRINCIPAL, label: '等额本金' },
];

/** 元 → 千分位整数字符串 */
function fmtYuan(n) {
  const v = Math.round(Number(n) || 0);
  return String(v).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** 输入框字符串 → 元（非法输入返回 0） */
function parseYuan(s) {
  const n = parseFloat(String(s).replace(/,/g, ''));
  return isFinite(n) && n > 0 ? n : 0;
}

function readDefaultTerms() {
  const settings = wx.getStorageSync('settings') || {};
  const defaults = loan.createLoanInput();
  return {
    annualRate: typeof settings.annualRate === 'number' && isFinite(settings.annualRate) &&
      settings.annualRate > 0 && settings.annualRate <= 36
      ? settings.annualRate / 100 : defaults.annualRate,
    years: Number.isInteger(settings.years) && settings.years > 0 && settings.years <= 30
      ? settings.years : defaults.years,
  };
}

Page({
  data: {
    categoryTabs: CATEGORY_TABS,
    methodTabs: METHOD_TABS,
    category: loan.LoanCategory.MORTGAGE,
    hasDown: true,
    // 输入区（字符串）
    totalPriceText: '1250000',
    ratioPercent: 20, // 滑块 15-80
    downPaymentText: '250000',
    loanAmountText: '1,000,000', // 派生只读
    principalText: '1000000', // 消费贷直输贷款金额
    yearsText: '30',
    rateText: '3.40',
    method: loan.RepaymentMethod.EQUAL_PAYMENT,
    isEqualPrincipal: false,
    isCombined: false,
    fundText: '0',
    fundRateText: '2.85',
    commercialText: '0',
    commercialRateText: '3.45',
    // 结果区
    monthlyLabel: '月供',
    monthlyText: '0',
    decreaseText: '',
    totalInterestText: '0',
    totalPaymentText: '0',
    downText: '',
    totalCostText: '',
    principalLegend: '0',
    interestLegend: '0',
    disclaimer: loan.DISCLAIMER,
  },

  onLoad() {
    const defaults = readDefaultTerms();
    this._lastDefaultTerms = defaults;
    this._openedPlanInput = false;
    this.input = loan.createLoanInput(defaults);
    this.syncFromInput();
    this.recalc();
  },

  onShow() {
    const defaults = readDefaultTerms();
    const previous = this._lastDefaultTerms;
    const settingsChanged = !previous || defaults.annualRate !== previous.annualRate ||
      defaults.years !== previous.years;
    this._lastDefaultTerms = defaults;
    const saved = wx.getStorageSync('currentInput');
    if (saved && typeof saved === 'object' && !Array.isArray(saved)) {
      wx.removeStorageSync('currentInput');
      if (saved.__source !== 'schedule') this._openedPlanInput = true;
      this.input = loan.normalizeDownPayment(loan.inputFromJson(saved));
      this.syncFromInput();
      this.recalc();
    }
    if (settingsChanged && !this._openedPlanInput) {
      // 默认设置只更新期限和利率，保留正在编辑的金额及其输入框原文。
      this.input = Object.assign({}, this.input, defaults);
      this.setData({
        yearsText: String(defaults.years),
        rateText: (defaults.annualRate * 100).toFixed(2),
      });
      this.recalc();
    }
  },

  onReady() {
    this.drawPie();
  },

  /** 内部 LoanInput → 输入区显示值 */
  syncFromInput() {
    const i = this.input;
    const hasDown = loan.hasDownPayment(i);
    const patch = {
      category: i.category,
      hasDown: hasDown,
      yearsText: String(i.years),
      rateText: (i.annualRate * 100).toFixed(2),
      method: i.method,
      isEqualPrincipal: i.method === loan.RepaymentMethod.EQUAL_PRINCIPAL,
      isCombined: !!i.isCombined,
      fundText: String(Math.round(i.fundPrincipal || 0)),
      fundRateText: ((i.fundAnnualRate || 0) * 100).toFixed(2),
      commercialText: String(Math.round(i.commercialPrincipal || 0)),
      commercialRateText: ((i.commercialAnnualRate || 0) * 100).toFixed(2),
    };
    if (hasDown) {
      patch.totalPriceText = String(Math.round(i.totalPrice || 0));
      patch.ratioPercent = Math.round((i.downPaymentRatio || 0) * 100);
      patch.downPaymentText = String(Math.round(i.downPaymentAmount || 0));
      patch.loanAmountText = fmtYuan(i.principal);
    } else {
      patch.principalText = String(Math.round(i.principal || 0));
    }
    this.setData(patch);
  },

  // ------------------------------------------------------------------
  // 输入事件
  // ------------------------------------------------------------------

  onCategoryTap(e) {
    const category = e.currentTarget.dataset.key;
    if (category === this.input.category) return;
    this.input = loan.withCategoryDefaults(this.input, category);
    this.syncFromInput();
    this.recalc();
  },

  onTotalPriceInput(e) {
    this.input = loan.withTotalPrice(this.input, parseYuan(e.detail.value));
    this.syncFromInput();
    this.setData({ totalPriceText: e.detail.value }); // 保留用户原始输入
    this.recalc();
  },

  onRatioChange(e) {
    this.input = loan.withDownPaymentRatio(this.input, e.detail.value / 100);
    this.syncFromInput();
    this.recalc();
  },

  onDownPaymentInput(e) {
    this.input = loan.withDownPaymentAmount(this.input, parseYuan(e.detail.value));
    this.syncFromInput();
    this.setData({ downPaymentText: e.detail.value });
    this.recalc();
  },

  onPrincipalInput(e) {
    // 消费贷：直接改贷款金额
    const yuan = parseYuan(e.detail.value);
    this.input = loan.withDerivedLoanAmount(this.input, yuan);
    this.setData({ principalText: e.detail.value });
    this.recalc();
  },

  onYearsInput(e) {
    const y = parseInt(e.detail.value, 10);
    this.input = Object.assign({}, this.input, {
      years: isFinite(y) && y > 0 ? Math.min(y, 30) : 0,
    });
    this.setData({ yearsText: e.detail.value });
    this.recalc();
  },

  onRateInput(e) {
    const r = parseFloat(e.detail.value);
    this.input = Object.assign({}, this.input, {
      annualRate: isFinite(r) && r >= 0 ? r / 100 : 0,
    });
    this.setData({ rateText: e.detail.value });
    this.recalc();
  },

  onMethodTap(e) {
    this.input = Object.assign({}, this.input, { method: e.currentTarget.dataset.key });
    this.setData({
      method: this.input.method,
      isEqualPrincipal: this.input.method === loan.RepaymentMethod.EQUAL_PRINCIPAL,
    });
    this.recalc();
  },

  onCombinedSwitch(e) {
    const on = e.detail.value;
    let next = Object.assign({}, this.input, { isCombined: on });
    if (on && (next.fundPrincipal || 0) + (next.commercialPrincipal || 0) <= 0) {
      // 默认拆一半公积金、一半商贷
      const half = Math.round((next.principal || 0) / 2);
      next = loan.withCombinedAmounts(next, { fundYuan: half, commercialYuan: (next.principal || 0) - half });
    }
    this.input = next;
    this.syncFromInput();
    this.recalc();
  },

  onFundInput(e) {
    this.input = loan.withCombinedAmounts(this.input, { fundYuan: parseYuan(e.detail.value) });
    this.syncFromInput();
    this.setData({ fundText: e.detail.value });
    this.recalc();
  },

  onFundRateInput(e) {
    const r = parseFloat(e.detail.value);
    this.input = Object.assign({}, this.input, {
      fundAnnualRate: isFinite(r) && r >= 0 ? r / 100 : 0,
    });
    this.setData({ fundRateText: e.detail.value });
    this.recalc();
  },

  onCommercialInput(e) {
    this.input = loan.withCombinedAmounts(this.input, { commercialYuan: parseYuan(e.detail.value) });
    this.syncFromInput();
    this.setData({ commercialText: e.detail.value });
    this.recalc();
  },

  onCommercialRateInput(e) {
    const r = parseFloat(e.detail.value);
    this.input = Object.assign({}, this.input, {
      commercialAnnualRate: isFinite(r) && r >= 0 ? r / 100 : 0,
    });
    this.setData({ commercialRateText: e.detail.value });
    this.recalc();
  },

  // ------------------------------------------------------------------
  // 计算与结果展示
  // ------------------------------------------------------------------

  recalc() {
    const errors = loan.validateInput(this.input);
    if (errors.length > 0) {
      this.setData({
        monthlyLabel: '月供',
        monthlyText: '--',
        decreaseText: '',
        totalInterestText: '--',
        totalPaymentText: '--',
        downText: '',
        totalCostText: '',
        principalLegend: '--',
        interestLegend: '--',
      });
      this.result = null;
      this.drawPie(0, 0);
      return;
    }

    const result = loan.LoanEngine.calculate(this.input);
    const total = result.total;
    const months = result.months;
    const isEP = this.input.method === loan.RepaymentMethod.EQUAL_PRINCIPAL;

    // 等额本金月递减额 = 各段 Σ(本金/期数 × 月利率)
    let decrease = 0;
    if (isEP) {
      const parts = [{ principal: this.input.principal, annualRate: this.input.annualRate }];
      if (result.isCombined) {
        parts.length = 0;
        parts.push({ principal: this.input.fundPrincipal, annualRate: this.input.fundAnnualRate });
        parts.push({ principal: this.input.commercialPrincipal, annualRate: this.input.commercialAnnualRate });
      }
      parts.forEach((p) => {
        decrease += (p.principal / months) * (p.annualRate / 12);
      });
    }

    const hasDown = loan.hasDownPayment(this.input);
    const down = hasDown ? this.input.downPaymentAmount || 0 : 0;
    const totalCost = total.totalPayment + down;
    const costLabel = this.input.category === loan.LoanCategory.MORTGAGE ? '购房总成本' : '购车总成本';

    this.result = total;
    this.setData({
      monthlyLabel: isEP ? '首月月供' : '月供',
      monthlyText: '¥' + fmtYuan(total.monthlyPayment),
      decreaseText: isEP ? '月递减 ¥' + fmtYuan(decrease) : '',
      totalInterestText: '¥' + fmtYuan(total.totalInterest),
      totalPaymentText: '¥' + fmtYuan(total.totalPayment),
      downText: hasDown ? '首付 ¥' + fmtYuan(down) : '',
      totalCostText: hasDown ? costLabel + ' ¥' + fmtYuan(totalCost) : '',
      principalLegend: '本金 ¥' + fmtYuan(total.principal),
      interestLegend: '利息 ¥' + fmtYuan(total.totalInterest),
    });
    this.drawPie(total.principal, total.totalInterest);
  },

  /** 本金/利息占比饼图（原生 canvas，无第三方依赖） */
  drawPie(principal, interest) {
    const p = Number(principal) || 0;
    const it = Number(interest) || 0;
    const ctx = wx.createCanvasContext('pieChart', this);
    const size = 200; // canvas 宽高（px）
    const cx = size / 2;
    const cy = size / 2;
    const r = 84;

    ctx.clearRect(0, 0, size, size);
    if (p + it <= 0) {
      ctx.beginPath();
      ctx.setFillStyle('#EEF1F6');
      ctx.arc(cx, cy, r, 0, 2 * Math.PI);
      ctx.fill();
    } else {
      const pAngle = (p / (p + it)) * 2 * Math.PI;
      // 本金（主题蓝）
      ctx.beginPath();
      ctx.setFillStyle('#1A6BFF');
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + pAngle);
      ctx.closePath();
      ctx.fill();
      // 利息（浅灰）
      ctx.beginPath();
      ctx.setFillStyle('#D9E2F3');
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, r, -Math.PI / 2 + pAngle, -Math.PI / 2 + 2 * Math.PI);
      ctx.closePath();
      ctx.fill();
      // 中心镂空成环形
      ctx.beginPath();
      ctx.setFillStyle('#FFFFFF');
      ctx.arc(cx, cy, r * 0.58, 0, 2 * Math.PI);
      ctx.fill();
      // 中心文案：利息占比
      const ratio = Math.round((it / (p + it)) * 100);
      ctx.setFillStyle('#333333');
      ctx.setFontSize(20);
      ctx.setTextAlign('center');
      ctx.setTextBaseline('middle');
      ctx.fillText(ratio + '%', cx, cy - 10);
      ctx.setFillStyle('#999999');
      ctx.setFontSize(12);
      ctx.fillText('利息占比', cx, cy + 14);
    }
    ctx.draw();
  },

  // ------------------------------------------------------------------
  // 操作
  // ------------------------------------------------------------------

  /** 查看还款计划表 */
  onViewSchedule() {
    if (!this.result) {
      wx.showToast({ title: '请先完善输入', icon: 'none' });
      return;
    }
    wx.setStorageSync('currentInput', Object.assign({ __source: 'schedule' }, loan.inputToJson(this.input)));
    wx.navigateTo({ url: '/pages/schedule/schedule' });
  },

  /** 保存方案到本地方案库 */
  onSavePlan() {
    if (!this.result) {
      wx.showToast({ title: '请先完善输入', icon: 'none' });
      return;
    }
    const self = this;
    wx.showModal({
      title: '保存方案',
      editable: true,
      placeholderText: '请输入方案名称',
      success(res) {
        if (!res.confirm) return;
        const name = (res.content || '').trim() || '未命名方案';
        let plans = [];
        try {
          plans = wx.getStorageSync('plans') || [];
        } catch (e) {
          plans = [];
        }
        plans.unshift({
          id: String(Date.now()),
          name: name,
          input: loan.inputToJson(self.input),
          monthlyPayment: Math.round(self.result.monthlyPayment * 100) / 100,
          totalInterest: Math.round(self.result.totalInterest * 100) / 100,
          totalPayment: Math.round(self.result.totalPayment * 100) / 100,
          createdAt: new Date().toISOString(),
        });
        wx.setStorageSync('plans', plans);
        wx.showToast({ title: '已保存', icon: 'success' });
      },
    });
  },
});
