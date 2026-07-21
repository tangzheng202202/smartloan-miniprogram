/**
 * 提前还款引擎测试（移植自 loan_calculator_app/test/engine/prepayment_engine_test.dart）
 *
 * 参考值（Python 独立计算）：100万 3.6% 360期等额本息，已还 12 期，
 * 提前还款 20 万：
 * - 还款时点剩余本金 981133.277434
 * - 缩短期限：新期限 242 期，节省利息 282545.735073
 * - 减少月供：新月供 3619.677578，节省利息 122518.021797
 */
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const {
  RepaymentMethod, PrepaymentMode,
  createLoanInput, PrepaymentEngine,
} = require('../utils/loan.js');

const TOL = 0.01;
function closeTo(actual, expected, tol) {
  assert.ok(Math.abs(actual - expected) <= tol, `期望 ${actual} ≈ ${expected}（容差 ${tol}）`);
}

const input = createLoanInput({
  principal: 1000000,
  years: 30,
  annualRate: 0.036,
  method: RepaymentMethod.EQUAL_PAYMENT,
});

describe('等额本息提前还款', () => {
  test('缩短期限：月供不变，期数减少，节省利息 > 0', () => {
    const r = PrepaymentEngine.simulate({ input, monthsPaid: 12, prepayAmount: 200000, mode: PrepaymentMode.REDUCE_TERM });
    assert.ok(r);
    closeTo(r.remainingBefore, 981133.277434, TOL);
    closeTo(r.newPrincipal, 781133.277434, TOL);
    assert.equal(r.newMonths, 242);
    assert.equal(r.monthsSaved, 360 - 12 - 242);
    closeTo(r.interestSaved, 282545.735073, TOL);
    assert.ok(r.interestSaved > 0);
    closeTo(r.newMonthlyPayment, 4546.453502, TOL); // 月供不变
  });

  test('减少月供：期限不变，月供降低，节省利息 > 0', () => {
    const r = PrepaymentEngine.simulate({ input, monthsPaid: 12, prepayAmount: 200000, mode: PrepaymentMode.REDUCE_PAYMENT });
    assert.ok(r);
    assert.equal(r.newMonths, 348);
    closeTo(r.newMonthlyPayment, 3619.677578, TOL);
    closeTo(r.interestSaved, 122518.021797, TOL);
    assert.ok(r.interestSaved > 0);
    const r2 = PrepaymentEngine.simulate({ input, monthsPaid: 12, prepayAmount: 200000, mode: PrepaymentMode.REDUCE_TERM });
    assert.ok(r2.interestSaved > r.interestSaved); // 缩短期限省更多利息
  });

  test('已还 0 期：剩余本金 = 原始本金', () => {
    const r = PrepaymentEngine.simulate({ input, monthsPaid: 0, prepayAmount: 100000, mode: PrepaymentMode.REDUCE_PAYMENT });
    assert.ok(r);
    closeTo(r.remainingBefore, 1000000, TOL);
    closeTo(r.newPrincipal, 900000, TOL);
    assert.ok(r.interestSaved > 0);
  });

  test('提前还款金额覆盖全部剩余本金：直接结清', () => {
    const r = PrepaymentEngine.simulate({ input, monthsPaid: 12, prepayAmount: 2000000, mode: PrepaymentMode.REDUCE_TERM });
    assert.ok(r);
    assert.equal(r.newPrincipal, 0);
    assert.equal(r.newMonths, 0);
    assert.equal(r.newMonthlyPayment, 0);
    closeTo(r.interestSaved, r.originalRemainingInterest, TOL);
  });

  test('非法输入返回 null', () => {
    assert.equal(PrepaymentEngine.simulate({ input, monthsPaid: 360, prepayAmount: 100000, mode: PrepaymentMode.REDUCE_TERM }), null);
    assert.equal(PrepaymentEngine.simulate({ input, monthsPaid: -1, prepayAmount: 100000, mode: PrepaymentMode.REDUCE_TERM }), null);
    assert.equal(PrepaymentEngine.simulate({ input, monthsPaid: 12, prepayAmount: 0, mode: PrepaymentMode.REDUCE_TERM }), null);
    const zeroP = createLoanInput({ principal: 0, years: 30, annualRate: 0.036, method: RepaymentMethod.EQUAL_PAYMENT });
    assert.equal(PrepaymentEngine.simulate({ input: zeroP, monthsPaid: 12, prepayAmount: 100000, mode: PrepaymentMode.REDUCE_TERM }), null);
  });
});

describe('等额本金提前还款', () => {
  const ep = createLoanInput({
    principal: 1000000,
    years: 30,
    annualRate: 0.036,
    method: RepaymentMethod.EQUAL_PRINCIPAL,
  });

  test('两种模式节省利息均 > 0 且逻辑正确', () => {
    const rt = PrepaymentEngine.simulate({ input: ep, monthsPaid: 24, prepayAmount: 200000, mode: PrepaymentMode.REDUCE_TERM });
    assert.ok(rt);
    assert.ok(rt.interestSaved > 0);
    assert.ok(rt.newMonths < rt.originalRemainingMonths);
    // 月还本金不变
    closeTo(rt.newMonthlyPayment, 1000000 / 360 + rt.newPrincipal * 0.003, 0.01);

    const rp = PrepaymentEngine.simulate({ input: ep, monthsPaid: 24, prepayAmount: 200000, mode: PrepaymentMode.REDUCE_PAYMENT });
    assert.ok(rp);
    assert.ok(rp.interestSaved > 0);
    assert.equal(rp.newMonths, rp.originalRemainingMonths);
    // 新月供低于原当前月供
    assert.ok(rp.newMonthlyPayment < 1000000 / 360 + 1000000 * 0.003);
  });
});

describe('先息后本提前还款', () => {
  const inf = createLoanInput({
    principal: 500000,
    years: 3,
    annualRate: 0.05,
    method: RepaymentMethod.INTEREST_FIRST,
  });

  test('减少月供：新月供 = 新本金 × 月利率', () => {
    const r = PrepaymentEngine.simulate({ input: inf, monthsPaid: 12, prepayAmount: 100000, mode: PrepaymentMode.REDUCE_PAYMENT });
    assert.ok(r);
    closeTo(r.newMonthlyPayment, (400000 * 0.05) / 12, 0.01);
    assert.ok(r.interestSaved > 0);
    assert.equal(r.newMonths, r.originalRemainingMonths);
  });
});
