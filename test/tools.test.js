/**
 * DSR / 利率换算 / 城市政策测试（移植自 loan_calculator_app/test/engine/tools_test.dart）
 */
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const {
  RepaymentMethod, HouseType, DsrRating,
  DsrEngine, RateConverter, CityPolicy,
} = require('../utils/loan.js');

function closeTo(actual, expected, tol) {
  assert.ok(Math.abs(actual - expected) <= tol, `期望 ${actual} ≈ ${expected}（容差 ${tol}）`);
}

describe('DSR 还款能力评估', () => {
  test('DSR 计算与五级评级边界', () => {
    assert.equal(DsrEngine.ratingFrom(0.0), DsrRating.EXCELLENT);
    assert.equal(DsrEngine.ratingFrom(0.1999), DsrRating.EXCELLENT);
    assert.equal(DsrEngine.ratingFrom(0.2), DsrRating.GOOD);
    assert.equal(DsrEngine.ratingFrom(0.2999), DsrRating.GOOD);
    assert.equal(DsrEngine.ratingFrom(0.3), DsrRating.MODERATE);
    assert.equal(DsrEngine.ratingFrom(0.3999), DsrRating.MODERATE);
    assert.equal(DsrEngine.ratingFrom(0.4), DsrRating.CAUTION);
    assert.equal(DsrEngine.ratingFrom(0.4999), DsrRating.CAUTION);
    assert.equal(DsrEngine.ratingFrom(0.5), DsrRating.DANGER);
    assert.equal(DsrEngine.ratingFrom(0.9), DsrRating.DANGER);
  });

  test('综合评估：收入3万、负债2千、月供8千 → 适中', () => {
    const a = DsrEngine.assess({ monthlyIncome: 30000, existingMonthlyDebt: 2000, newMonthlyPayment: 8000 });
    closeTo(a.dsr, 1 / 3, 1e-6);
    assert.equal(a.rating, DsrRating.MODERATE);
    closeTo(a.suggestedMaxMonthlyPayment, 10000, 0.01);
    closeTo(a.suggestedMaxLoan, 2226949.85, 1);
  });

  test('收入为 0 时 DSR = 1（过高）', () => {
    const a = DsrEngine.assess({ monthlyIncome: 0, existingMonthlyDebt: 0, newMonthlyPayment: 1000 });
    assert.equal(a.dsr, 1.0);
    assert.equal(a.rating, DsrRating.DANGER);
  });

  test('年金反推公式：0 利率退化为线性', () => {
    assert.equal(DsrEngine.loanFromMonthlyPayment(5000, 0, 120), 600000);
    assert.equal(DsrEngine.loanFromMonthlyPayment(0, 0.035, 360), 0);
  });
});

describe('利率换算', () => {
  test('LPR ± BP 换算', () => {
    closeTo(RateConverter.fromLpr(0.035, -60), 0.029, 1e-12);
    closeTo(RateConverter.fromLpr(0.035, 55), 0.0405, 1e-12);
    closeTo(RateConverter.toBp(0.035, 0.029), -60, 1e-9);
  });

  test('固定 vs 浮动利息对比：低利率省息为正', () => {
    const c = RateConverter.compareFixedVsFloating({
      principal: 1000000,
      months: 360,
      fixedRate: 0.036,
      floatingRate: 0.029,
      method: RepaymentMethod.EQUAL_PAYMENT,
    });
    closeTo(c.fixedTotalInterest, 636723.260811, 0.01);
    assert.ok(c.interestDiff > 0);
    assert.ok(c.monthlyDiff < 0);
  });
});

describe('城市政策', () => {
  test('北京：公积金上限120万、利率2.85%、首付15%', () => {
    const bj = CityPolicy.byKey('beijing');
    assert.equal(bj.maxHousingFundLoanFirst, 120);
    assert.equal(bj.housingFundRateFirst, 0.0285);
    assert.equal(bj.minDownPaymentRatioFirst, 0.15);
  });

  test('成都：上限120万、优惠利率2.6%', () => {
    const cd = CityPolicy.byKey('chengdu');
    assert.equal(cd.maxHousingFundLoanFirst, 120);
    assert.equal(cd.housingFundRateFirst, 0.026);
  });

  test('重庆：上限80万、余额×25倍', () => {
    const cq = CityPolicy.byKey('chongqing');
    assert.equal(cq.maxHousingFundLoanFirst, 80);
    assert.equal(cq.balanceMultiplier, 25);
  });

  test('公积金可贷额度：北京 余额10万 房价450万 → 120万', () => {
    const loanable = CityPolicy.housingFundLoanable(CityPolicy.byKey('beijing'), {
      balance: 100000,
      housePrice: 4500000,
      houseType: HouseType.FIRST,
    });
    closeTo(loanable, 1200000, 0.01);
  });

  test('配偶余额合并计算（上海）', () => {
    const loanable = CityPolicy.housingFundLoanable(CityPolicy.byKey('shanghai'), {
      balance: 50000,
      spouseBalance: 50000,
      housePrice: 7200000,
      houseType: HouseType.FIRST,
    });
    assert.ok(loanable > 0);
    closeTo(loanable, 1200000, 0.01);
  });

  test('低余额按元乘倍数，配偶余额只加一次', () => {
    const city = CityPolicy.byKey('beijing');
    const base = { balance: 1000, housePrice: 4500000, houseType: HouseType.FIRST };
    assert.equal(CityPolicy.housingFundLoanable(city, base), 15000);
    assert.equal(CityPolicy.housingFundLoanable(city, { ...base, spouseBalance: 1000 }), 30000);
  });

  test('商贷利率 = LPR + 浮动', () => {
    closeTo(CityPolicy.commercialRate(CityPolicy.byKey('beijing'), HouseType.FIRST), 0.03, 1e-12);
    closeTo(CityPolicy.commercialRate(CityPolicy.byKey('beijing'), HouseType.SECOND), 0.04, 1e-12);
    closeTo(CityPolicy.commercialRate(CityPolicy.byKey('shanghai'), HouseType.FIRST), 0.029, 1e-12);
  });
});
