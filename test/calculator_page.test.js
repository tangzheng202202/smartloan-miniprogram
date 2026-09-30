/** 计算器从本地设置与方案库恢复输入。 */
'use strict';

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const loan = require('../utils/loan.js');

const oldPage = global.Page;
const oldWx = global.wx;
let definition;
global.Page = (page) => { definition = page; };
require('../pages/calculator/calculator.js');
after(() => {
  global.Page = oldPage;
  global.wx = oldWx;
});

function pageWithStorage(storage) {
  global.wx = {
    getStorageSync(key) { return storage[key]; },
    removeStorageSync(key) { delete storage[key]; },
    setStorageSync(key, value) { storage[key] = value; },
    navigateTo() {},
  };
  return Object.assign({}, definition, {
    data: Object.assign({}, definition.data),
    setData(patch) { Object.assign(this.data, patch); },
    drawPie() {},
  });
}

test('计算器首次打开使用有效的本地默认设置', () => {
  const page = pageWithStorage({ settings: { annualRate: 3.1, years: 25 } });
  page.onLoad();
  assert.equal(page.input.annualRate, 0.031);
  assert.equal(page.input.years, 25);
  assert.equal(page.data.rateText, '3.10');
  assert.equal(page.data.yearsText, '25');
});

test('方案库回填覆盖默认设置并只消费一次', () => {
  const saved = loan.createLoanInput({
    category: loan.LoanCategory.CAR,
    principal: 175000,
    totalPrice: 250000,
    downPaymentAmount: 75000,
    downPaymentRatio: 0.3,
    years: 5,
    annualRate: 0.045,
  });
  const storage = {
    settings: { annualRate: 3.1, years: 25 },
    currentInput: loan.inputToJson(saved),
  };
  const page = pageWithStorage(storage);
  page.onLoad();
  page.onShow();
  assert.equal(page.input.category, loan.LoanCategory.CAR);
  assert.equal(page.input.principal, 175000);
  assert.equal(page.input.annualRate, 0.045);
  assert.equal(page.input.years, 5);
  assert.equal(page.data.loanAmountText, '175,000');
  assert.equal(storage.currentInput, undefined);

  page.onShow();
  assert.equal(page.input.principal, 175000);

  storage.settings = { annualRate: 2.9, years: 20 };
  page.onShow();
  assert.equal(page.input.annualRate, 0.045);
  assert.equal(page.input.years, 5);
  assert.equal(page.input.principal, 175000);
});

test('从设置页返回更新利率和期限，保留正在编辑的金额字段', () => {
  const storage = { settings: { annualRate: 3.4, years: 30 } };
  const page = pageWithStorage(storage);
  page.onLoad();
  page.onShow();
  page.onTotalPriceInput({ detail: { value: '1,500,000' } });
  const amount = page.input.principal;
  const payment = page.input.downPaymentAmount;

  storage.settings = { annualRate: 3.1, years: 25 };
  page.onShow();
  assert.equal(page.input.annualRate, 0.031);
  assert.equal(page.input.years, 25);
  assert.equal(page.input.principal, amount);
  assert.equal(page.input.downPaymentAmount, payment);
  assert.equal(page.data.totalPriceText, '1,500,000');
  assert.equal(page.data.rateText, '3.10');
  assert.equal(page.data.yearsText, '25');

  storage.settings = {};
  page.onShow();
  assert.equal(page.input.annualRate, loan.createLoanInput().annualRate);
  assert.equal(page.input.years, loan.createLoanInput().years);
  assert.equal(page.data.totalPriceText, '1,500,000');
});

test('从还款计划返回后仍可接收新的默认设置', () => {
  const storage = { settings: { annualRate: 3.4, years: 30 } };
  const page = pageWithStorage(storage);
  page.onLoad();
  page.onViewSchedule();
  assert.equal(storage.currentInput.__source, 'schedule');
  page.onShow();
  assert.equal(page._openedPlanInput, false);

  storage.settings = { annualRate: 3.1, years: 25 };
  page.onShow();
  assert.equal(page.input.annualRate, 0.031);
  assert.equal(page.input.years, 25);
});
