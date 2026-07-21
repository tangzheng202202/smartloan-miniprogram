/**
 * 核心引擎测试（移植自 loan_calculator_app/test/engine/loan_engine_test.dart）
 *
 * 期望值由 Python 按同一公式独立计算（容差 0.01）：
 * - 等额本息 100万 3.6% 360期：M=4546.453502, TP=1636723.260811, TI=636723.260811
 * - 等额本金 100万 3.6% 360期：first=5777.777778, last=2786.111111,
 *   TP=1541500, TI=541500
 * - 先息后本 100万 3.6% 360期：MI=3000, TP=2080000, TI=1080000
 */
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const {
  RepaymentMethod, LoanCategory,
  createLoanInput, validateInput, inputSignature, inputToJson, inputFromJson,
  LoanEngine,
} = require('../utils/loan.js');

const P = 1000000;
const rate = 0.036;
const months = 360;
const TOL = 0.01;

function closeTo(actual, expected, tol) {
  assert.ok(
    Math.abs(actual - expected) <= tol,
    `期望 ${actual} ≈ ${expected}（容差 ${tol}）`
  );
}

const EP = RepaymentMethod.EQUAL_PAYMENT;
const EPR = RepaymentMethod.EQUAL_PRINCIPAL;
const IF = RepaymentMethod.INTEREST_FIRST;

describe('等额本息', () => {
  test('月供 / 总利息 / 总还款', () => {
    const r = LoanEngine.calculatePart({ principal: P, annualRate: rate, months, method: EP });
    closeTo(r.monthlyPayment, 4546.453502, TOL);
    closeTo(r.totalPayment, 1636723.260811, TOL);
    closeTo(r.totalInterest, 636723.260811, TOL);
    closeTo(r.totalInterest, r.totalPayment - P, TOL);
  });

  test('还款计划逐月校验', () => {
    const s = LoanEngine.schedulePart({ principal: P, annualRate: rate, months, method: EP });
    assert.equal(s.length, months);
    for (const e of s) closeTo(e.principal + e.interest, e.payment, 1e-6);
    for (let i = 1; i < s.length; i++) {
      assert.ok(s[i].remainingPrincipal <= s[i - 1].remainingPrincipal + 1e-9);
    }
    assert.equal(s[s.length - 1].remainingPrincipal, 0);
    const principalSum = s.reduce((sum, e) => sum + e.principal, 0);
    closeTo(principalSum, P, 0.01);
    const interestSum = s.reduce((sum, e) => sum + e.interest, 0);
    closeTo(interestSum, 636723.260811, 0.5);
  });
});

describe('等额本金', () => {
  test('首月/末月/总利息/总还款', () => {
    const r = LoanEngine.calculatePart({ principal: P, annualRate: rate, months, method: EPR });
    closeTo(r.monthlyPayment, 5777.777778, TOL);
    closeTo(r.totalPayment, 1541500.0, TOL);
    closeTo(r.totalInterest, 541500.0, TOL);
  });

  test('还款计划：月供递减、月还本金恒定、末期归零', () => {
    const s = LoanEngine.schedulePart({ principal: P, annualRate: rate, months, method: EPR });
    assert.equal(s.length, months);
    assert.ok(s[0].payment > s[s.length - 1].payment);
    closeTo(s[s.length - 1].payment, 2786.111111, TOL);
    const monthlyPrincipal = P / months;
    for (const e of s) {
      closeTo(e.principal, monthlyPrincipal, 1e-6);
      closeTo(e.principal + e.interest, e.payment, 1e-6);
    }
    for (let i = 1; i < s.length; i++) assert.ok(s[i].payment < s[i - 1].payment);
    assert.equal(s[s.length - 1].remainingPrincipal, 0);
  });
});

describe('先息后本', () => {
  test('每月利息 / 总利息 / 总还款', () => {
    const r = LoanEngine.calculatePart({ principal: P, annualRate: rate, months, method: IF });
    closeTo(r.monthlyPayment, 3000.0, TOL);
    closeTo(r.totalPayment, 2080000.0, TOL);
    closeTo(r.totalInterest, 1080000.0, TOL);
  });

  test('还款计划：前期只还息，末期一次性还本', () => {
    const s = LoanEngine.schedulePart({ principal: P, annualRate: rate, months, method: IF });
    assert.equal(s.length, months);
    for (let i = 0; i < months - 1; i++) {
      assert.equal(s[i].principal, 0);
      closeTo(s[i].payment, 3000.0, TOL);
      assert.equal(s[i].remainingPrincipal, P);
    }
    closeTo(s[s.length - 1].payment, 3000.0 + P, TOL);
    assert.equal(s[s.length - 1].principal, P);
    assert.equal(s[s.length - 1].remainingPrincipal, 0);
  });
});

describe('组合贷款', () => {
  const input = createLoanInput({
    isCombined: true,
    years: 30,
    method: EP,
    fundPrincipal: 800000,
    fundAnnualRate: 0.0285,
    commercialPrincipal: 1200000,
    commercialAnnualRate: 0.0345,
  });

  test('合并汇总 = 两部分之和', () => {
    const r = LoanEngine.calculate(input);
    assert.equal(r.isCombined, true);
    closeTo(r.fund.monthlyPayment, 3308.459076, TOL);
    closeTo(r.commercial.monthlyPayment, 5355.099539, TOL);
    closeTo(r.total.monthlyPayment, 8663.558615, TOL);
    closeTo(r.total.totalInterest, 1118881.101460, TOL);
    closeTo(r.total.totalPayment, 3118881.101460, TOL);
    closeTo(r.total.monthlyPayment, r.fund.monthlyPayment + r.commercial.monthlyPayment, 1e-6);
    closeTo(r.total.totalInterest, r.fund.totalInterest + r.commercial.totalInterest, 1e-6);
  });

  test('合并明细 = 两部分逐月之和', () => {
    const s = LoanEngine.schedule(input);
    assert.equal(s.length, 360);
    for (const e of s) {
      closeTo(e.payment, e.fundPayment + e.commercialPayment, 1e-6);
      closeTo(e.principal, e.fundPrincipal + e.commercialPrincipal, 1e-6);
      closeTo(e.interest, e.fundInterest + e.commercialInterest, 1e-6);
    }
    assert.ok(s[s.length - 1].remainingPrincipal < 1);
  });

  test('公积金部分为 0 时退化为纯商贷', () => {
    const zeroFund = Object.assign({}, input, { fundPrincipal: 0 });
    const r = LoanEngine.calculate(zeroFund);
    assert.deepEqual(r.fund, { monthlyPayment: 0, totalPayment: 0, totalInterest: 0, principal: 0 });
    closeTo(r.total.monthlyPayment, r.commercial.monthlyPayment, 1e-9);
    const s = LoanEngine.schedule(zeroFund);
    assert.equal(s.length, 360);
    for (const e of s) {
      assert.equal(e.fundPayment, 0);
      closeTo(e.payment, e.commercialPayment, 1e-9);
    }
  });
});

describe('边界用例', () => {
  test('0 本金返回零值', () => {
    for (const m of [EP, EPR, IF]) {
      const r = LoanEngine.calculatePart({ principal: 0, annualRate: rate, months, method: m });
      assert.deepEqual(r, { monthlyPayment: 0, totalPayment: 0, totalInterest: 0, principal: 0 });
    }
  });

  test('0 期数返回零值', () => {
    const r = LoanEngine.calculatePart({ principal: P, annualRate: rate, months: 0, method: EP });
    assert.deepEqual(r, { monthlyPayment: 0, totalPayment: 0, totalInterest: 0, principal: 0 });
    const s = LoanEngine.schedulePart({ principal: P, annualRate: rate, months: 0, method: EP });
    assert.equal(s.length, 0);
  });

  test('0 利率：等额本息月供 = 本金/期数，总利息为 0', () => {
    const r = LoanEngine.calculatePart({ principal: 120000, annualRate: 0, months: 12, method: EP });
    closeTo(r.monthlyPayment, 10000.0, TOL);
    closeTo(r.totalInterest, 0, TOL);
    closeTo(r.totalPayment, 120000.0, TOL);
    const s = LoanEngine.schedulePart({ principal: 120000, annualRate: 0, months: 12, method: EP });
    assert.equal(s.length, 12);
    assert.equal(s[s.length - 1].remainingPrincipal, 0);
    for (const e of s) assert.equal(e.interest, 0);
  });

  test('1 年期：10万 6% 等额本息', () => {
    const r = LoanEngine.calculatePart({ principal: 100000, annualRate: 0.06, months: 12, method: EP });
    closeTo(r.monthlyPayment, 8606.642971, TOL);
    closeTo(r.totalPayment, 103279.715648, TOL);
    closeTo(r.totalInterest, 3279.715648, TOL);
  });

  test('负本金按计划返回全零条目', () => {
    const s = LoanEngine.schedulePart({ principal: -1, annualRate: rate, months: 12, method: EP });
    assert.equal(s.length, 12);
    for (const e of s) {
      assert.equal(e.payment, 0);
      assert.equal(e.remainingPrincipal, 0);
    }
  });
});

describe('输入校验', () => {
  test('默认输入有效', () => {
    assert.deepEqual(validateInput(createLoanInput()), []);
  });

  test('期限越界报错', () => {
    assert.notDeepEqual(validateInput(createLoanInput({ years: 0 })), []);
    assert.notDeepEqual(validateInput(createLoanInput({ years: 36 })), []);
  });

  test('组合贷两部分全 0 报错', () => {
    const input = createLoanInput({ isCombined: true, fundPrincipal: 0, commercialPrincipal: 0 });
    assert.notDeepEqual(validateInput(input), []);
  });

  test('签名稳定性：同参数同签名，异参数异签名', () => {
    const a = createLoanInput();
    const b = createLoanInput();
    assert.equal(inputSignature(a), inputSignature(b));
    const c = Object.assign({}, a, { years: 20 });
    assert.notEqual(inputSignature(c), inputSignature(a));
  });

  test('JSON 往返', () => {
    const input = createLoanInput({
      category: LoanCategory.MORTGAGE,
      principal: 1234567,
      years: 25,
      annualRate: 0.0315,
      method: RepaymentMethod.EQUAL_PRINCIPAL,
      isCombined: true,
      fundPrincipal: 500000,
      fundAnnualRate: 0.0285,
      commercialPrincipal: 734567,
      commercialAnnualRate: 0.0345,
    });
    const decoded = inputFromJson(inputToJson(input));
    assert.deepEqual(decoded, input);
  });
});
