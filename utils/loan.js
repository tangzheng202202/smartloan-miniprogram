/**
 * 智贷计算器 - 微信小程序核心计算引擎（纯 JS，无任何依赖）
 * 移植自 Flutter 端 loan_calculator_app/lib/domain/engine/ 与 entities/：
 *   loan_engine.dart / prepayment_engine.dart / rate_converter.dart /
 *   dsr_engine.dart / city_policies.dart / loan_input.dart 等
 *
 * 约定：金额单位为元；年利率为小数（0.034 表示 3.4%）；期数为月。
 *
 * ============================ 导出 API 签名 ============================
 *
 * —— 常量与枚举（字符串）——
 * RepaymentMethod = { EQUAL_PAYMENT:'equalPayment', EQUAL_PRINCIPAL:'equalPrincipal', INTEREST_FIRST:'interestFirst' }
 * LoanCategory    = { MORTGAGE:'mortgage', CAR:'car', CONSUMER:'consumer' }
 * PrepaymentMode  = { REDUCE_TERM:'reduceTerm', REDUCE_PAYMENT:'reducePayment' }
 * HouseType       = { FIRST:'first', SECOND:'second' }
 * DsrRating       = { EXCELLENT:'excellent', GOOD:'good', MODERATE:'moderate', CAUTION:'caution', DANGER:'danger' }
 * MIN_DOWN_PAYMENT_RATIO = 0.15   // 首付比例下限 15%
 * MAX_DOWN_PAYMENT_RATIO = 0.8    // 首付比例上限 80%
 * DISCLAIMER = '计算结果仅供参考，以银行实际审批为准'
 *
 * —— LoanInput（普通对象，含默认值；用 createLoanInput() 构造）——
 * createLoanInput(overrides?) => LoanInput
 *   字段：{ category, principal, years, annualRate, method, isCombined,
 *          fundPrincipal, fundAnnualRate, commercialPrincipal, commercialAnnualRate,
 *          totalPrice, downPaymentAmount, downPaymentRatio }（消费贷后三者为 null）
 * getMonths(input) => number                 // years*12
 * hasDownPayment(input) => boolean           // 房贷/车贷 true
 * validateInput(input) => string[]           // 空数组 = 校验通过
 * inputSignature(input) => string
 * inputToJson(input) => object；inputFromJson(json) => LoanInput
 * normalizeDownPayment(input) => LoanInput
 *
 * —— 首付三联动（返回新 LoanInput，不改原对象）——
 * withTotalPrice(input, yuan) => LoanInput          // 改总价 → 首付按比例重算
 * withDownPaymentRatio(input, ratio) => LoanInput   // 改比例（钳制 15%–80%）
 * withDownPaymentAmount(input, yuan) => LoanInput   // 改首付金额
 * withDerivedLoanAmount(input, yuan) => LoanInput   // 改贷款金额 → 反推首付
 * withCombinedAmounts(input, { fundYuan?, commercialYuan? }) => LoanInput
 * withCategoryDefaults(input, category) => LoanInput
 *
 * —— 贷款引擎 LoanEngine ——
 * LoanEngine.calculatePart({ principal, annualRate, months, method })
 *   => { monthlyPayment, totalPayment, totalInterest, principal }
 * LoanEngine.calculate(input)
 *   => { total, fund, commercial, isCombined, months }（fund/commercial 为 PartResult）
 * LoanEngine.schedulePart({ principal, annualRate, months, method })
 *   => ScheduleItem[]，ScheduleItem = { month, payment, principal, interest,
 *      remainingPrincipal, fundPayment, fundPrincipal, fundInterest,
 *      commercialPayment, commercialPrincipal, commercialInterest }
 * LoanEngine.schedule(input) => ScheduleItem[]     // 组合贷逐月合并
 * LoanEngine.zeroSchedule(months) => ScheduleItem[]
 *
 * —— 提前还款 PrepaymentEngine ——
 * PrepaymentEngine.simulate({ input, monthsPaid, prepayAmount, mode })
 *   => null | { mode, prepayAmount, monthsPaid, remainingBefore, newPrincipal,
 *      newMonthlyPayment, originalRemainingMonths, newMonths, interestSaved,
 *      newTotalInterest, originalRemainingInterest, monthsSaved }
 *   （input 为单贷；组合贷请先拆分分别模拟）
 *
 * —— 利率换算 RateConverter ——
 * RateConverter.fromLpr(lpr, bp) => number          // LPR + 基点 → 年利率
 * RateConverter.toBp(lpr, actualRate) => number
 * RateConverter.compareFixedVsFloating({ principal, months, fixedRate, floatingRate, method? })
 *   => { fixedMonthlyPayment, fixedTotalInterest, floatingMonthlyPayment,
 *        floatingTotalInterest, interestDiff, monthlyDiff }
 *
 * —— 还款能力评估 DsrEngine ——
 * DsrEngine.assess({ monthlyIncome, existingMonthlyDebt, newMonthlyPayment, annualRate=0.035, months=360 })
 *   => { dsr, rating, suggestedMaxMonthlyPayment, suggestedMaxLoan,
 *        monthlyIncome, existingMonthlyDebt, newMonthlyPayment }
 * DsrEngine.loanFromMonthlyPayment(monthlyPayment, annualRate, months) => number
 * DsrEngine.ratingFrom(dsr) => DsrRating
 *
 * —— 城市政策 CityPolicy ——
 * CityPolicy.CITIES => 城市数组（key/nameZh/公积金上限/利率/首付下限/倍数/商贷浮动等）
 * CityPolicy.byKey(key) => city
 * CityPolicy.housingFundRate(city, houseType) => number
 * CityPolicy.commercialRate(city, houseType) => number   // LPR 3.5% + 浮动
 * CityPolicy.housingFundLoanable(city, { balance, spouseBalance=0, housePrice, houseType }) => 元
 * =====================================================================
 *
 * 免责声明：计算结果仅供参考，以银行实际审批为准。
 */

'use strict';

// ---------------------------------------------------------------------------
// 常量与枚举
// ---------------------------------------------------------------------------

const RepaymentMethod = {
  EQUAL_PAYMENT: 'equalPayment', // 等额本息
  EQUAL_PRINCIPAL: 'equalPrincipal', // 等额本金
  INTEREST_FIRST: 'interestFirst', // 先息后本
};

const LoanCategory = {
  MORTGAGE: 'mortgage', // 住房贷款
  CAR: 'car', // 汽车贷款
  CONSUMER: 'consumer', // 消费贷款
};

const PrepaymentMode = {
  REDUCE_TERM: 'reduceTerm', // 缩短期限（月供不变）
  REDUCE_PAYMENT: 'reducePayment', // 减少月供（期限不变）
};

const HouseType = { FIRST: 'first', SECOND: 'second' };

const DsrRating = {
  EXCELLENT: 'excellent', // DSR < 20%
  GOOD: 'good', // 20% ≤ DSR < 30%
  MODERATE: 'moderate', // 30% ≤ DSR < 40%
  CAUTION: 'caution', // 40% ≤ DSR < 50%
  DANGER: 'danger', // DSR ≥ 50%
};

/** 首付比例下限（2024-09 起全国商贷最低首付统一为 15%） */
const MIN_DOWN_PAYMENT_RATIO = 0.15;
/** 首付比例上限 */
const MAX_DOWN_PAYMENT_RATIO = 0.8;

/** 免责声明（页面须展示） */
const DISCLAIMER = '计算结果仅供参考，以银行实际审批为准';

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

// ---------------------------------------------------------------------------
// LoanInput（实体 + 首付三联动）
// ---------------------------------------------------------------------------

/**
 * 创建贷款输入对象（默认：房贷，总价 125 万，首付 20%，贷款 100 万，
 * 30 年，年利率 3.4%，等额本息，非组合贷）。
 */
function createLoanInput(overrides) {
  const base = {
    category: LoanCategory.MORTGAGE,
    principal: 1000000,
    years: 30,
    annualRate: 0.034,
    method: RepaymentMethod.EQUAL_PAYMENT,
    isCombined: false,
    fundPrincipal: 0,
    fundAnnualRate: 0.0285,
    commercialPrincipal: 0,
    commercialAnnualRate: 0.0345,
    totalPrice: 1250000,
    downPaymentAmount: 250000,
    downPaymentRatio: 0.2,
  };
  return Object.assign(base, overrides || {});
}

function copyInput(input, overrides) {
  return Object.assign({}, input, overrides || {});
}

/** 总期数（月） */
function getMonths(input) {
  return input.years * 12;
}

/** 该类别是否带首付设置（房贷/车贷有，消费贷无） */
function hasDownPayment(input) {
  return input.category === LoanCategory.MORTGAGE || input.category === LoanCategory.CAR;
}

/**
 * 校验输入，返回错误信息数组（空数组 = 通过）。
 * 规则：期限 1-35 年，金额与利率非负，利率 0%-36%。
 */
function validateInput(input) {
  const errors = [];
  if (input.years < 1 || input.years > 35) {
    errors.push('贷款期限应在1-35年之间');
  }
  if (!input.isCombined) {
    if (input.principal < 0) errors.push('贷款金额不能为负');
    if (input.annualRate < 0 || input.annualRate > 0.36) {
      errors.push('年利率应在0%-36%之间');
    }
  } else {
    if (input.fundPrincipal < 0 || input.commercialPrincipal < 0) {
      errors.push('贷款金额不能为负');
    }
    if (input.fundPrincipal + input.commercialPrincipal <= 0) {
      errors.push('组合贷总金额应大于0');
    }
    if (input.fundAnnualRate < 0 || input.fundAnnualRate > 0.36) {
      errors.push('公积金年利率应在0%-36%之间');
    }
    if (input.commercialAnnualRate < 0 || input.commercialAnnualRate > 0.36) {
      errors.push('商贷年利率应在0%-36%之间');
    }
  }
  return errors;
}

/** 参数签名（历史记录去重用） */
function inputSignature(input) {
  const n = (v) => (v == null ? -1 : v);
  return [
    input.category,
    input.principal.toFixed(2),
    input.years,
    input.annualRate.toFixed(6),
    input.method,
    input.isCombined,
    input.fundPrincipal.toFixed(2),
    input.fundAnnualRate.toFixed(6),
    input.commercialPrincipal.toFixed(2),
    input.commercialAnnualRate.toFixed(6),
    n(input.totalPrice).toFixed(2),
    n(input.downPaymentAmount).toFixed(2),
    n(input.downPaymentRatio).toFixed(6),
  ].join('|');
}

/** 旧记录归一化：房贷/车贷但无首付字段时，视为 0% 首付（总价=贷款金额） */
function normalizeDownPayment(input) {
  if (!hasDownPayment(input) || input.totalPrice != null) return input;
  return copyInput(input, {
    totalPrice: input.principal,
    downPaymentAmount: 0,
    downPaymentRatio: 0,
  });
}

/** 组合贷重拆：公积金 40% + 商贷 60%（按新本金，保留各自利率） */
function resplitCombined(base) {
  if (!base.isCombined) return base;
  const fund = Math.round((base.principal * 0.4) / 10000) * 10000;
  const clampedFund = clamp(fund, 0, base.principal);
  return copyInput(base, {
    fundPrincipal: clampedFund,
    commercialPrincipal: base.principal - clampedFund,
  });
}

/** 联动：改总价 → 首付金额按比例重算 → 贷款金额派生 */
function withTotalPrice(input, yuan) {
  if (!hasDownPayment(input)) return input;
  const total = yuan < 0 ? 0 : yuan;
  const ratio = clamp(input.downPaymentRatio || 0, MIN_DOWN_PAYMENT_RATIO, MAX_DOWN_PAYMENT_RATIO);
  const down = clamp(total * ratio, 0, total);
  return resplitCombined(
    copyInput(input, {
      totalPrice: total,
      downPaymentRatio: ratio,
      downPaymentAmount: down,
      principal: total - down,
    })
  );
}

/** 联动：改首付比例 → 首付金额重算（钳制 15%–80%） */
function withDownPaymentRatio(input, ratio) {
  if (!hasDownPayment(input)) return input;
  const total = input.totalPrice != null ? input.totalPrice : input.principal;
  const r = clamp(ratio, MIN_DOWN_PAYMENT_RATIO, MAX_DOWN_PAYMENT_RATIO);
  const down = clamp(total * r, 0, total);
  return resplitCombined(
    copyInput(input, {
      downPaymentRatio: r,
      downPaymentAmount: down,
      principal: total - down,
    })
  );
}

/** 联动：改首付金额 → 比例重算（钳制 15%·总价 ≤ 首付 ≤ 总价） */
function withDownPaymentAmount(input, yuan) {
  if (!hasDownPayment(input)) return input;
  const total = input.totalPrice != null ? input.totalPrice : input.principal;
  const down = clamp(yuan, total * MIN_DOWN_PAYMENT_RATIO, total);
  const ratio = total > 0 ? down / total : 0;
  return resplitCombined(
    copyInput(input, {
      downPaymentAmount: down,
      downPaymentRatio: clamp(ratio, 0, MAX_DOWN_PAYMENT_RATIO),
      principal: total - down,
    })
  );
}

/** 联动：编辑派生贷款金额 → 反推首付金额与比例 */
function withDerivedLoanAmount(input, yuan) {
  if (!hasDownPayment(input)) {
    return copyInput(input, { principal: yuan < 0 ? 0 : yuan });
  }
  const total = input.totalPrice != null ? input.totalPrice : input.principal;
  const loan = clamp(yuan, 0, total * (1 - MIN_DOWN_PAYMENT_RATIO));
  const down = total - loan;
  const ratio = total > 0 ? down / total : 0;
  return resplitCombined(
    copyInput(input, {
      principal: loan,
      downPaymentAmount: down,
      downPaymentRatio: clamp(ratio, 0, MAX_DOWN_PAYMENT_RATIO),
    })
  );
}

/** 组合贷两段金额变化后：本金=两段之和，首付字段反推保持恒等 */
function withCombinedAmounts(input, opts) {
  const o = opts || {};
  let fund = o.fundYuan != null ? o.fundYuan : input.fundPrincipal;
  let commercial = o.commercialYuan != null ? o.commercialYuan : input.commercialPrincipal;
  if (fund < 0) fund = 0;
  if (commercial < 0) commercial = 0;
  const sum = fund + commercial;
  let next = copyInput(input, {
    fundPrincipal: fund,
    commercialPrincipal: commercial,
    principal: sum,
  });
  if (hasDownPayment(next) && next.totalPrice != null) {
    const total = next.totalPrice;
    const down = clamp(total - sum, 0, total);
    next = copyInput(next, {
      downPaymentAmount: down,
      downPaymentRatio: total > 0 ? clamp(down / total, 0, MAX_DOWN_PAYMENT_RATIO) : 0,
    });
  }
  return next;
}

/**
 * 切换类别时的默认值（含首付字段初始化）
 * 房贷：总价 125 万 / 首付 20% → 贷款 100 万；
 * 车贷：总价 25 万 / 首付 30% → 贷款 17.5 万；
 * 消费贷：直输 20 万，首付字段置 null。
 */
function withCategoryDefaults(input, c) {
  switch (c) {
    case LoanCategory.MORTGAGE:
      return copyInput(input, {
        category: c,
        totalPrice: 1250000,
        downPaymentRatio: 0.2,
        downPaymentAmount: 250000,
        principal: 1000000,
      });
    case LoanCategory.CAR:
      return copyInput(input, {
        category: c,
        isCombined: false,
        totalPrice: 250000,
        downPaymentRatio: 0.3,
        downPaymentAmount: 75000,
        principal: 175000,
      });
    case LoanCategory.CONSUMER:
      return copyInput(input, {
        category: c,
        isCombined: false,
        totalPrice: null,
        downPaymentAmount: null,
        downPaymentRatio: null,
        principal: 200000,
      });
    default:
      return input;
  }
}

/** 序列化为 JSON（首付字段为 null 时不写键，向后兼容旧记录） */
function inputToJson(input) {
  const j = {
    category: input.category,
    principal: input.principal,
    years: input.years,
    annualRate: input.annualRate,
    method: input.method,
    isCombined: input.isCombined,
    fundPrincipal: input.fundPrincipal,
    fundAnnualRate: input.fundAnnualRate,
    commercialPrincipal: input.commercialPrincipal,
    commercialAnnualRate: input.commercialAnnualRate,
  };
  if (input.totalPrice != null) j.totalPrice = input.totalPrice;
  if (input.downPaymentAmount != null) j.downPaymentAmount = input.downPaymentAmount;
  if (input.downPaymentRatio != null) j.downPaymentRatio = input.downPaymentRatio;
  return j;
}

/** 从 JSON 反序列化（旧记录无首付字段时为 null，向后兼容） */
function inputFromJson(json) {
  const g = json || {};
  const num = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d);
  const numOrNull = (v) => (typeof v === 'number' && isFinite(v) ? v : null);
  return createLoanInput({
    category: typeof g.category === 'string' ? g.category : LoanCategory.MORTGAGE,
    principal: num(g.principal, 0),
    years: Math.trunc(num(g.years, 30)),
    annualRate: num(g.annualRate, 0),
    method: typeof g.method === 'string' ? g.method : RepaymentMethod.EQUAL_PAYMENT,
    isCombined: g.isCombined === true,
    fundPrincipal: num(g.fundPrincipal, 0),
    fundAnnualRate: num(g.fundAnnualRate, 0),
    commercialPrincipal: num(g.commercialPrincipal, 0),
    commercialAnnualRate: num(g.commercialAnnualRate, 0),
    totalPrice: numOrNull(g.totalPrice),
    downPaymentAmount: numOrNull(g.downPaymentAmount),
    downPaymentRatio: numOrNull(g.downPaymentRatio),
  });
}

// ---------------------------------------------------------------------------
// 贷款引擎 LoanEngine
// ---------------------------------------------------------------------------

function zeroPart() {
  return { monthlyPayment: 0, totalPayment: 0, totalInterest: 0, principal: 0 };
}

function zeroScheduleItem(month) {
  return {
    month: month,
    payment: 0,
    principal: 0,
    interest: 0,
    remainingPrincipal: 0,
    fundPayment: 0,
    fundPrincipal: 0,
    fundInterest: 0,
    commercialPayment: 0,
    commercialPrincipal: 0,
    commercialInterest: 0,
  };
}

function scheduleItem(month, payment, principal, interest, remainingPrincipal, extra) {
  return Object.assign(zeroScheduleItem(month), {
    payment: payment,
    principal: principal,
    interest: interest,
    remainingPrincipal: remainingPrincipal,
  }, extra || {});
}

const LoanEngine = {
  /**
   * 计算单笔贷款汇总结果。
   * 本金 ≤ 0 或期数 ≤ 0 时返回全零结果。
   * 等额本金 monthlyPayment 为首月月供；先息后本为每月利息。
   */
  calculatePart(opts) {
    const principal = opts.principal;
    const annualRate = opts.annualRate;
    const months = opts.months;
    const method = opts.method;
    if (principal <= 0 || months <= 0) return zeroPart();

    const r = annualRate / 12;

    if (method === RepaymentMethod.EQUAL_PAYMENT) {
      // 等额本息：M = P·r·(1+r)^n / ((1+r)^n − 1)
      let monthlyPayment;
      if (r === 0) {
        monthlyPayment = principal / months;
      } else {
        const power = Math.pow(1 + r, months);
        monthlyPayment = (principal * r * power) / (power - 1);
      }
      const totalPayment = monthlyPayment * months;
      return {
        monthlyPayment: monthlyPayment,
        totalPayment: totalPayment,
        totalInterest: totalPayment - principal,
        principal: principal,
      };
    }

    if (method === RepaymentMethod.EQUAL_PRINCIPAL) {
      // 等额本金：每月固定本金 P/n + 剩余本金利息
      const monthlyPrincipal = principal / months;
      let totalInterest = 0;
      let remaining = principal;
      for (let i = 0; i < months; i++) {
        totalInterest += remaining * r;
        remaining -= monthlyPrincipal;
      }
      const firstPayment = monthlyPrincipal + principal * r;
      return {
        monthlyPayment: firstPayment,
        totalPayment: principal + totalInterest,
        totalInterest: totalInterest,
        principal: principal,
      };
    }

    // 先息后本：每月还息，期末还本
    const monthlyInterest = principal * r;
    const totalInterest = monthlyInterest * months;
    return {
      monthlyPayment: monthlyInterest,
      totalPayment: principal + totalInterest,
      totalInterest: totalInterest,
      principal: principal,
    };
  },

  /** 主计算入口：按输入计算汇总结果（支持组合贷） */
  calculate(input) {
    const months = getMonths(input);
    if (!input.isCombined) {
      const part = this.calculatePart({
        principal: input.principal,
        annualRate: input.annualRate,
        months: months,
        method: input.method,
      });
      return { total: part, fund: zeroPart(), commercial: zeroPart(), isCombined: false, months: months };
    }

    // 组合贷：公积金部分 + 商贷部分分别计算后合并
    const fund = this.calculatePart({
      principal: input.fundPrincipal,
      annualRate: input.fundAnnualRate,
      months: months,
      method: input.method,
    });
    const commercial = this.calculatePart({
      principal: input.commercialPrincipal,
      annualRate: input.commercialAnnualRate,
      months: months,
      method: input.method,
    });
    return {
      total: {
        monthlyPayment: fund.monthlyPayment + commercial.monthlyPayment,
        totalPayment: fund.totalPayment + commercial.totalPayment,
        totalInterest: fund.totalInterest + commercial.totalInterest,
        principal: fund.principal + commercial.principal,
      },
      fund: fund,
      commercial: commercial,
      isCombined: true,
      months: months,
    };
  },

  /**
   * 生成单笔贷款还款计划。
   * 期数 ≤ 0 返回空数组；本金 ≤ 0 返回全零计划。
   */
  schedulePart(opts) {
    const principal = opts.principal;
    const annualRate = opts.annualRate;
    const months = opts.months;
    const method = opts.method;
    if (months <= 0) return [];
    if (principal <= 0) return this.zeroSchedule(months);

    const r = annualRate / 12;
    const items = [];

    if (method === RepaymentMethod.EQUAL_PAYMENT) {
      let monthlyPayment;
      if (r === 0) {
        monthlyPayment = principal / months;
      } else {
        const power = Math.pow(1 + r, months);
        monthlyPayment = (principal * r * power) / (power - 1);
      }
      let remaining = principal;
      for (let month = 1; month <= months; month++) {
        const interest = remaining * r;
        const principalPaid = monthlyPayment - interest;
        remaining -= principalPaid;
        if (month === months) remaining = 0; // 末期强制归零
        items.push(scheduleItem(month, monthlyPayment, principalPaid, interest, Math.max(0, remaining)));
      }
    } else if (method === RepaymentMethod.EQUAL_PRINCIPAL) {
      const monthlyPrincipal = principal / months;
      for (let month = 1; month <= months; month++) {
        const interest = (principal - monthlyPrincipal * (month - 1)) * r;
        const payment = monthlyPrincipal + interest;
        const remaining = month === months ? 0 : principal - monthlyPrincipal * month;
        items.push(scheduleItem(month, payment, monthlyPrincipal, interest, Math.max(0, remaining)));
      }
    } else {
      // 先息后本
      const monthlyInterest = principal * r;
      for (let month = 1; month <= months; month++) {
        const isLast = month === months;
        items.push(
          scheduleItem(
            month,
            isLast ? monthlyInterest + principal : monthlyInterest,
            isLast ? principal : 0,
            monthlyInterest,
            isLast ? 0 : principal
          )
        );
      }
    }
    return items;
  },

  /** 全零还款计划（组合贷中本金为 0 的子部分使用） */
  zeroSchedule(months) {
    const out = [];
    for (let i = 1; i <= months; i++) out.push(zeroScheduleItem(i));
    return out;
  },

  /** 主入口：生成还款计划（组合贷逐月合并两部分明细） */
  schedule(input) {
    const months = getMonths(input);
    if (months <= 0) return [];

    if (!input.isCombined) {
      return this.schedulePart({
        principal: input.principal,
        annualRate: input.annualRate,
        months: months,
        method: input.method,
      });
    }

    const fundItems = this.schedulePart({
      principal: input.fundPrincipal,
      annualRate: input.fundAnnualRate,
      months: months,
      method: input.method,
    });
    const cmItems = this.schedulePart({
      principal: input.commercialPrincipal,
      annualRate: input.commercialAnnualRate,
      months: months,
      method: input.method,
    });

    const hasFund = input.fundPrincipal > 0;
    const hasCm = input.commercialPrincipal > 0;

    const out = [];
    for (let i = 0; i < months; i++) {
      const f = fundItems[i];
      const c = cmItems[i];
      out.push({
        month: i + 1,
        payment: f.payment + c.payment,
        principal: f.principal + c.principal,
        interest: f.interest + c.interest,
        remainingPrincipal: Math.max(0, f.remainingPrincipal + c.remainingPrincipal),
        fundPayment: hasFund ? f.payment : 0,
        fundPrincipal: hasFund ? f.principal : 0,
        fundInterest: hasFund ? f.interest : 0,
        commercialPayment: hasCm ? c.payment : 0,
        commercialPrincipal: hasCm ? c.principal : 0,
        commercialInterest: hasCm ? c.interest : 0,
      });
    }
    return out;
  },
};

// ---------------------------------------------------------------------------
// 提前还款引擎 PrepaymentEngine
// ---------------------------------------------------------------------------

const PrepaymentEngine = {
  /**
   * 模拟提前还款（input 为单贷；组合贷请先拆分后分别模拟）。
   * 返回 null 表示输入无效（已还期数超出范围、金额非正等）。
   *
   * 节省利息口径：相对「提前还款时点之后」的剩余利息，
   * 即 原剩余利息 − 新方案利息（新本金计）。
   */
  simulate(opts) {
    const input = opts.input;
    const monthsPaid = opts.monthsPaid;
    const prepayAmount = opts.prepayAmount;
    const mode = opts.mode;

    const totalMonths = getMonths(input);
    if (input.principal <= 0 || totalMonths <= 0) return null;
    if (monthsPaid < 0 || monthsPaid >= totalMonths) return null;
    if (prepayAmount <= 0) return null;

    const schedule = LoanEngine.schedulePart({
      principal: input.principal,
      annualRate: input.annualRate,
      months: totalMonths,
      method: input.method,
    });
    if (schedule.length === 0) return null;

    // 提前还款时点剩余本金（已还 0 期时为原始本金）
    const remainingBefore = monthsPaid === 0 ? input.principal : schedule[monthsPaid - 1].remainingPrincipal;

    // 原方案剩余利息 = 剩余各期利息之和
    let originalRemainingInterest = 0;
    for (let i = monthsPaid; i < schedule.length; i++) {
      originalRemainingInterest += schedule[i].interest;
    }

    const newPrincipal = Math.max(0, remainingBefore - prepayAmount);
    const remainingMonths = totalMonths - monthsPaid;

    const baseResult = {
      mode: mode,
      prepayAmount: prepayAmount,
      monthsPaid: monthsPaid,
      remainingBefore: remainingBefore,
      originalRemainingMonths: remainingMonths,
      originalRemainingInterest: originalRemainingInterest,
    };

    // 提前还款金额覆盖全部剩余本金：直接结清
    if (newPrincipal <= 0) {
      return Object.assign(baseResult, {
        newPrincipal: 0,
        newMonthlyPayment: 0,
        newMonths: 0,
        interestSaved: originalRemainingInterest,
        newTotalInterest: 0,
        monthsSaved: remainingMonths,
      });
    }

    const r = input.annualRate / 12;

    if (mode === PrepaymentMode.REDUCE_TERM) {
      // 缩短期限：月供负担不变，重新推演期数
      let newMonthlyPayment;
      let newInterest = 0;
      let newMonths = 0;
      let remaining = newPrincipal;

      if (input.method === RepaymentMethod.EQUAL_PAYMENT) {
        // 月供不变，逐月摊还直至结清（末期可能不足整月供）
        newMonthlyPayment = schedule[monthsPaid].payment;
        while (remaining > 1e-9 && newMonths < 1200) {
          const interest = remaining * r;
          let principalPaid = newMonthlyPayment - interest;
          if (principalPaid <= 0) principalPaid = remaining; // 极端防御
          principalPaid = Math.min(principalPaid, remaining);
          remaining -= principalPaid;
          newInterest += interest;
          newMonths++;
        }
      } else if (input.method === RepaymentMethod.EQUAL_PRINCIPAL) {
        // 月还本金不变 → 新期限 = ceil(新本金 / 月还本金)
        const monthlyPrincipal = input.principal / totalMonths;
        newMonths = Math.ceil(newPrincipal / monthlyPrincipal);
        // 新首月月供 = 月还本金 + 新本金首月利息
        newMonthlyPayment = monthlyPrincipal + newPrincipal * r;
        let rem = newPrincipal;
        for (let i = 0; i < newMonths; i++) {
          newInterest += rem * r;
          rem = Math.max(0, rem - monthlyPrincipal);
        }
      } else {
        // 先息后本：每月还款额不变（原每月利息），超出利息部分冲抵本金
        newMonthlyPayment = input.principal * r;
        while (remaining > 1e-9 && newMonths < 1200) {
          const interest = remaining * r;
          let principalPaid = Math.min(newMonthlyPayment - interest, remaining);
          if (principalPaid < 0) principalPaid = remaining;
          remaining -= principalPaid;
          newInterest += interest;
          newMonths++;
        }
      }

      return Object.assign(baseResult, {
        newPrincipal: newPrincipal,
        newMonthlyPayment: newMonthlyPayment,
        newMonths: newMonths,
        interestSaved: originalRemainingInterest - newInterest,
        newTotalInterest: newInterest,
        monthsSaved: remainingMonths - newMonths,
      });
    }

    // 减少月供：剩余期限不变，按新本金重新计算
    let newMonthlyPayment;
    let newInterest;

    if (input.method === RepaymentMethod.EQUAL_PAYMENT) {
      if (r === 0) {
        newMonthlyPayment = newPrincipal / remainingMonths;
      } else {
        const power = Math.pow(1 + r, remainingMonths);
        newMonthlyPayment = (newPrincipal * r * power) / (power - 1);
      }
      newInterest = newMonthlyPayment * remainingMonths - newPrincipal;
    } else if (input.method === RepaymentMethod.EQUAL_PRINCIPAL) {
      const monthlyPrincipal = newPrincipal / remainingMonths;
      newMonthlyPayment = monthlyPrincipal + newPrincipal * r;
      let interest = 0;
      let rem = newPrincipal;
      for (let i = 0; i < remainingMonths; i++) {
        interest += rem * r;
        rem -= monthlyPrincipal;
      }
      newInterest = interest;
    } else {
      newMonthlyPayment = newPrincipal * r;
      newInterest = newMonthlyPayment * remainingMonths;
    }

    return Object.assign(baseResult, {
      newPrincipal: newPrincipal,
      newMonthlyPayment: newMonthlyPayment,
      newMonths: remainingMonths,
      interestSaved: originalRemainingInterest - newInterest,
      newTotalInterest: newInterest,
      monthsSaved: 0,
    });
  },
};

// ---------------------------------------------------------------------------
// 利率换算 RateConverter
// ---------------------------------------------------------------------------

const RateConverter = {
  /** LPR（小数）加基点浮动，返回实际年利率。例：0.035, -60 → 0.029 */
  fromLpr(lpr, bp) {
    return lpr + bp / 10000;
  },

  /** 实际年利率相对 LPR 的基点差。例：0.035, 0.029 → -60 */
  toBp(lpr, actualRate) {
    return (actualRate - lpr) * 10000;
  },

  /**
   * 固定 vs 浮动利率总利息对比（假设利率全期不变）。
   * interestDiff = 固定 − 浮动（正值表示浮动省息）；monthlyDiff = 浮动 − 固定。
   */
  compareFixedVsFloating(opts) {
    const method = opts.method || RepaymentMethod.EQUAL_PAYMENT;
    const fixed = LoanEngine.calculatePart({
      principal: opts.principal,
      annualRate: opts.fixedRate,
      months: opts.months,
      method: method,
    });
    const floating = LoanEngine.calculatePart({
      principal: opts.principal,
      annualRate: opts.floatingRate,
      months: opts.months,
      method: method,
    });
    return {
      fixedMonthlyPayment: fixed.monthlyPayment,
      fixedTotalInterest: fixed.totalInterest,
      floatingMonthlyPayment: floating.monthlyPayment,
      floatingTotalInterest: floating.totalInterest,
      interestDiff: fixed.totalInterest - floating.totalInterest,
      monthlyDiff: floating.monthlyPayment - fixed.monthlyPayment,
    };
  },
};

// ---------------------------------------------------------------------------
// 还款能力评估 DsrEngine
// ---------------------------------------------------------------------------

const DsrEngine = {
  /** 建议月供上限占收入比例（银行常用红线 40%） */
  MAX_MONTHLY_RATIO: 0.4,

  /** 从 DSR 数值判定五级评级 */
  ratingFrom(dsr) {
    if (dsr < 0.2) return DsrRating.EXCELLENT;
    if (dsr < 0.3) return DsrRating.GOOD;
    if (dsr < 0.4) return DsrRating.MODERATE;
    if (dsr < 0.5) return DsrRating.CAUTION;
    return DsrRating.DANGER;
  },

  /**
   * 评估还款能力。
   * DSR =（新增月供 + 既有月供负债）/ 月收入；
   * 建议最高月供 = 月收入 × 40% − 既有负债；
   * 建议最高可贷额度按等额本息年金公式反推。
   */
  assess(opts) {
    const monthlyIncome = opts.monthlyIncome;
    const existingMonthlyDebt = opts.existingMonthlyDebt;
    const newMonthlyPayment = opts.newMonthlyPayment;
    const annualRate = opts.annualRate != null ? opts.annualRate : 0.035;
    const months = opts.months != null ? opts.months : 360;

    const totalDebt = existingMonthlyDebt + newMonthlyPayment;
    const dsr = monthlyIncome > 0 ? totalDebt / monthlyIncome : 1.0;
    const rating = this.ratingFrom(dsr);

    const suggestedMaxMonthly = Math.max(0, monthlyIncome * this.MAX_MONTHLY_RATIO - existingMonthlyDebt);
    const suggestedMaxLoan = this.loanFromMonthlyPayment(suggestedMaxMonthly, annualRate, months);

    return {
      dsr: dsr,
      rating: rating,
      suggestedMaxMonthlyPayment: suggestedMaxMonthly,
      suggestedMaxLoan: suggestedMaxLoan,
      monthlyIncome: monthlyIncome,
      existingMonthlyDebt: existingMonthlyDebt,
      newMonthlyPayment: newMonthlyPayment,
    };
  },

  /**
   * 等额本息年金公式：由月供反推可贷本金
   * P = M · ((1+r)^n − 1) / (r · (1+r)^n)
   */
  loanFromMonthlyPayment(monthlyPayment, annualRate, months) {
    if (monthlyPayment <= 0 || months <= 0) return 0;
    const r = annualRate / 12;
    if (r === 0) return monthlyPayment * months;
    const power = Math.pow(1 + r, months);
    return (monthlyPayment * (power - 1)) / (r * power);
  },
};

// ---------------------------------------------------------------------------
// 城市房贷/公积金政策 CityPolicy
// 数据为静态快照（2026 年 3 月口径），仅供参考。
// ---------------------------------------------------------------------------

const LPR_BASE = 0.035; // 5 年期 LPR 基准（2026 年 3 月口径 3.5%）

const CITIES = [
  {
    key: 'beijing', nameZh: '北京',
    maxHousingFundLoanFirst: 120, maxHousingFundLoanSecond: 100,
    housingFundRateFirst: 0.0285, housingFundRateSecond: 0.03075,
    minDownPaymentRatioFirst: 0.15, minDownPaymentRatioSecond: 0.25,
    maxLoanRatioFirst: 0.85, maxLoanRatioSecond: 0.75,
    balanceMultiplier: 15,
    commercialFloatingFirst: -0.005, commercialFloatingSecond: 0.005,
  },
  {
    key: 'shanghai', nameZh: '上海',
    maxHousingFundLoanFirst: 120, maxHousingFundLoanSecond: 100,
    housingFundRateFirst: 0.0285, housingFundRateSecond: 0.03075,
    minDownPaymentRatioFirst: 0.15, minDownPaymentRatioSecond: 0.5,
    maxLoanRatioFirst: 0.85, maxLoanRatioSecond: 0.5,
    balanceMultiplier: 15,
    commercialFloatingFirst: -0.006, commercialFloatingSecond: 0.006,
  },
  {
    key: 'guangzhou', nameZh: '广州',
    maxHousingFundLoanFirst: 120, maxHousingFundLoanSecond: 100,
    housingFundRateFirst: 0.0285, housingFundRateSecond: 0.03075,
    minDownPaymentRatioFirst: 0.15, minDownPaymentRatioSecond: 0.3,
    maxLoanRatioFirst: 0.85, maxLoanRatioSecond: 0.7,
    balanceMultiplier: 8,
    commercialFloatingFirst: -0.005, commercialFloatingSecond: 0.006,
  },
  {
    key: 'shenzhen', nameZh: '深圳',
    maxHousingFundLoanFirst: 120, maxHousingFundLoanSecond: 90,
    housingFundRateFirst: 0.0285, housingFundRateSecond: 0.03075,
    minDownPaymentRatioFirst: 0.15, minDownPaymentRatioSecond: 0.3,
    maxLoanRatioFirst: 0.85, maxLoanRatioSecond: 0.7,
    balanceMultiplier: 14,
    commercialFloatingFirst: -0.005, commercialFloatingSecond: 0.006,
  },
  {
    key: 'chengdu', nameZh: '成都',
    maxHousingFundLoanFirst: 120, maxHousingFundLoanSecond: 80,
    housingFundRateFirst: 0.026, housingFundRateSecond: 0.03075,
    minDownPaymentRatioFirst: 0.15, minDownPaymentRatioSecond: 0.3,
    maxLoanRatioFirst: 0.85, maxLoanRatioSecond: 0.7,
    balanceMultiplier: 25,
    commercialFloatingFirst: -0.005, commercialFloatingSecond: 0.006,
  },
  {
    key: 'chongqing', nameZh: '重庆',
    maxHousingFundLoanFirst: 80, maxHousingFundLoanSecond: 80,
    housingFundRateFirst: 0.026, housingFundRateSecond: 0.03075,
    minDownPaymentRatioFirst: 0.15, minDownPaymentRatioSecond: 0.3,
    maxLoanRatioFirst: 0.85, maxLoanRatioSecond: 0.7,
    balanceMultiplier: 25,
    commercialFloatingFirst: -0.005, commercialFloatingSecond: 0.006,
  },
];

const CityPolicy = {
  LPR_BASE: LPR_BASE,
  CITIES: CITIES,

  /** 按键查找城市（未找到时返回第一个城市） */
  byKey(key) {
    const found = CITIES.find((c) => c.key === key);
    return found || CITIES[0];
  },

  /** 公积金利率（按房屋类型） */
  housingFundRate(city, houseType) {
    return houseType === HouseType.FIRST ? city.housingFundRateFirst : city.housingFundRateSecond;
  },

  /** 商贷利率 = LPR + 浮动 */
  commercialRate(city, houseType) {
    const floating = houseType === HouseType.FIRST ? city.commercialFloatingFirst : city.commercialFloatingSecond;
    return LPR_BASE + floating;
  },

  /**
   * 计算公积金可贷额度（元）：
   * min(余额合计 × 倍数 × 1万, 房价 × 最高贷款成数, 政策上限 × 1万)
   */
  housingFundLoanable(city, opts) {
    const balance = opts.balance;
    const spouseBalance = opts.spouseBalance || 0;
    const housePrice = opts.housePrice;
    const houseType = opts.houseType;
    const totalBalance = balance + spouseBalance;
    const maxByBalance = totalBalance * city.balanceMultiplier * 10000;
    const maxByPrice = housePrice * (houseType === HouseType.FIRST ? city.maxLoanRatioFirst : city.maxLoanRatioSecond);
    const maxByPolicy =
      (houseType === HouseType.FIRST ? city.maxHousingFundLoanFirst : city.maxHousingFundLoanSecond) * 10000;
    return Math.min(maxByBalance, Math.min(maxByPrice, maxByPolicy));
  },
};

// ---------------------------------------------------------------------------
// 导出（CommonJS，微信小程序与 Node 测试通用）
// ---------------------------------------------------------------------------

module.exports = {
  RepaymentMethod: RepaymentMethod,
  LoanCategory: LoanCategory,
  PrepaymentMode: PrepaymentMode,
  HouseType: HouseType,
  DsrRating: DsrRating,
  MIN_DOWN_PAYMENT_RATIO: MIN_DOWN_PAYMENT_RATIO,
  MAX_DOWN_PAYMENT_RATIO: MAX_DOWN_PAYMENT_RATIO,
  DISCLAIMER: DISCLAIMER,

  createLoanInput: createLoanInput,
  getMonths: getMonths,
  hasDownPayment: hasDownPayment,
  validateInput: validateInput,
  inputSignature: inputSignature,
  normalizeDownPayment: normalizeDownPayment,
  withTotalPrice: withTotalPrice,
  withDownPaymentRatio: withDownPaymentRatio,
  withDownPaymentAmount: withDownPaymentAmount,
  withDerivedLoanAmount: withDerivedLoanAmount,
  withCombinedAmounts: withCombinedAmounts,
  withCategoryDefaults: withCategoryDefaults,
  inputToJson: inputToJson,
  inputFromJson: inputFromJson,

  LoanEngine: LoanEngine,
  PrepaymentEngine: PrepaymentEngine,
  RateConverter: RateConverter,
  DsrEngine: DsrEngine,
  CityPolicy: CityPolicy,
};
