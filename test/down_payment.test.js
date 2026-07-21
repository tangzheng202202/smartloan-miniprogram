/**
 * 首付（总价/比例/金额/派生贷款）联动与数据兼容测试
 * 移植自 loan_calculator_app/test/engine/down_payment_test.dart
 * 首付比例钳制范围：15% – 80%
 */
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const {
  LoanCategory,
  createLoanInput, hasDownPayment, normalizeDownPayment,
  withTotalPrice, withDownPaymentRatio, withDownPaymentAmount,
  withDerivedLoanAmount, withCombinedAmounts, withCategoryDefaults,
  inputSignature, inputToJson, inputFromJson,
} = require('../utils/loan.js');

function closeTo(actual, expected, tol) {
  assert.ok(Math.abs(actual - expected) <= tol, `期望 ${actual} ≈ ${expected}（容差 ${tol}）`);
}

const defaults = () => createLoanInput();

describe('默认值与恒等式', () => {
  test('默认房贷：总价125万 首付20% → 贷款100万', () => {
    const i = defaults();
    assert.equal(i.category, LoanCategory.MORTGAGE);
    assert.equal(hasDownPayment(i), true);
    assert.equal(i.totalPrice, 1250000);
    assert.equal(i.downPaymentAmount, 250000);
    assert.equal(i.downPaymentRatio, 0.2);
    assert.equal(i.principal, i.totalPrice - i.downPaymentAmount);
  });

  test('车贷默认：总价25万 首付30% → 贷款17.5万', () => {
    const i = withCategoryDefaults(defaults(), LoanCategory.CAR);
    assert.equal(i.totalPrice, 250000);
    assert.equal(i.downPaymentAmount, 75000);
    assert.equal(i.downPaymentRatio, 0.3);
    assert.equal(i.principal, 175000);
    assert.equal(i.isCombined, false);
  });

  test('消费贷默认：首付字段为 null，直输20万', () => {
    const i = withCategoryDefaults(defaults(), LoanCategory.CONSUMER);
    assert.equal(hasDownPayment(i), false);
    assert.equal(i.totalPrice, null);
    assert.equal(i.downPaymentAmount, null);
    assert.equal(i.downPaymentRatio, null);
    assert.equal(i.principal, 200000);
  });
});

describe('三者联动', () => {
  test('改总价 → 首付金额按比例重算', () => {
    const i = withTotalPrice(defaults(), 2000000);
    assert.equal(i.totalPrice, 2000000);
    assert.equal(i.downPaymentAmount, 400000); // 20%
    assert.equal(i.principal, 1600000);
  });

  test('改比例 → 首付金额重算；超出 15%–80% 被钳制', () => {
    const i = withDownPaymentRatio(defaults(), 0.5);
    assert.equal(i.downPaymentAmount, 625000);
    assert.equal(i.principal, 625000);

    const clamped = withDownPaymentRatio(defaults(), 0.95);
    assert.equal(clamped.downPaymentRatio, 0.8);
    assert.equal(clamped.downPaymentAmount, 1000000);
    assert.equal(clamped.principal, 250000);

    const low = withDownPaymentRatio(defaults(), 0.05);
    assert.equal(low.downPaymentRatio, 0.15); // 低于 15% 被钳到下限
    assert.equal(low.downPaymentAmount, 187500);
    assert.equal(low.principal, 1062500);
  });

  test('改首付金额 → 比例重算；超过总价被钳制为零贷款', () => {
    const i = withDownPaymentAmount(defaults(), 500000);
    assert.equal(i.downPaymentAmount, 500000);
    closeTo(i.downPaymentRatio, 0.4, 1e-9);
    assert.equal(i.principal, 750000);

    const full = withDownPaymentAmount(defaults(), 9999999);
    assert.equal(full.downPaymentAmount, 1250000);
    assert.equal(full.principal, 0);
    assert.equal(full.downPaymentRatio, 0.8); // 100% 被钳到上限

    const low = withDownPaymentAmount(defaults(), 100000);
    assert.equal(low.downPaymentAmount, 187500); // 低于 15% 总价被钳到下限
    assert.equal(low.principal, 1062500);
  });

  test('编辑派生贷款金额 → 反推首付金额与比例', () => {
    const i = withDerivedLoanAmount(defaults(), 900000);
    assert.equal(i.principal, 900000);
    assert.equal(i.downPaymentAmount, 350000);
    closeTo(i.downPaymentRatio, 0.28, 1e-9);

    const over = withDerivedLoanAmount(defaults(), 2000000);
    assert.equal(over.principal, 1062500); // 钳到总价 85%（最低首付 15%）
    assert.equal(over.downPaymentAmount, 187500);
  });

  test('消费贷调用联动方法无副作用', () => {
    const i = withCategoryDefaults(defaults(), LoanCategory.CONSUMER);
    assert.equal(withTotalPrice(i, 999999).principal, 200000);
    assert.equal(withDownPaymentRatio(i, 0.5).principal, 200000);
  });
});

describe('组合贷联动', () => {
  const combined = () =>
    createLoanInput({ isCombined: true, fundPrincipal: 400000, commercialPrincipal: 600000 });

  test('组合贷改总价 → 本金派生后按 40/60 重拆', () => {
    const i = withTotalPrice(combined(), 2500000); // 贷款 200万
    assert.equal(i.principal, 2000000);
    assert.equal(i.fundPrincipal, 800000);
    assert.equal(i.commercialPrincipal, 1200000);
    assert.equal(i.fundPrincipal + i.commercialPrincipal, i.principal);
  });

  test('组合贷改两段金额 → 本金求和且首付反推恒等', () => {
    const i = withCombinedAmounts(combined(), { fundYuan: 500000 });
    assert.equal(i.principal, 1100000);
    assert.equal(i.downPaymentAmount, 150000); // 125万 − 110万
    closeTo(i.downPaymentRatio, 0.12, 1e-9);
  });
});

describe('归一化与旧记录兼容', () => {
  test('旧记录无首付字段：反序列化为 null，归一化为 0% 首付', () => {
    const legacy = {
      category: 'mortgage',
      principal: 1000000,
      years: 30,
      annualRate: 0.034,
      method: 'equalPayment',
      isCombined: false,
      fundPrincipal: 0,
      fundAnnualRate: 0.0285,
      commercialPrincipal: 0,
      commercialAnnualRate: 0.0345,
    };
    const i = inputFromJson(legacy);
    assert.equal(i.totalPrice, null);
    assert.equal(i.downPaymentAmount, null);

    const n = normalizeDownPayment(i);
    assert.equal(n.totalPrice, 1000000);
    assert.equal(n.downPaymentAmount, 0);
    assert.equal(n.downPaymentRatio, 0);
    assert.equal(n.principal, 1000000);
    // 归一化后联动正常
    const edited = withDownPaymentRatio(n, 0.3);
    assert.equal(edited.downPaymentAmount, 300000);
    assert.equal(edited.principal, 700000);
  });

  test('新字段 JSON 往返无损', () => {
    const i = defaults();
    const j = inputToJson(i);
    assert.equal(j.totalPrice, 1250000);
    assert.equal(j.downPaymentAmount, 250000);
    assert.equal(j.downPaymentRatio, 0.2);
    assert.deepEqual(inputFromJson(j), i);
  });

  test('消费贷 JSON 不写首付键，往返后仍为 null', () => {
    const i = withCategoryDefaults(defaults(), LoanCategory.CONSUMER);
    const j = inputToJson(i);
    assert.equal('totalPrice' in j, false);
    const back = inputFromJson(j);
    assert.equal(back.totalPrice, null);
    assert.equal(hasDownPayment(back), false);
  });

  test('签名包含首付字段（新旧记录不冲突）', () => {
    const a = defaults();
    const b = Object.assign({}, a, { totalPrice: null, downPaymentAmount: null, downPaymentRatio: null });
    assert.notEqual(inputSignature(a), inputSignature(b));
  });
});
