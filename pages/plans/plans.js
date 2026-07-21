// 方案库页：读取本地存储的贷款方案，支持查看详情（回填计算器）与删除
var STORAGE_KEY = 'plans';

function formatMoney(value) {
  var n = Number(value) || 0;
  var s = Math.round(n).toString();
  return s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function formatTime(ts) {
  if (!ts) return '';
  var d = new Date(ts);
  if (isNaN(d.getTime())) return '';
  function pad(x) { return x < 10 ? '0' + x : '' + x; }
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
    ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
}

Page({
  data: {
    plans: []
  },

  onShow() {
    this.loadPlans();
  },

  loadPlans() {
    var raw = wx.getStorageSync(STORAGE_KEY);
    var list = Array.isArray(raw) ? raw : [];
    var plans = list.map(function (p) {
      return {
        id: p.id,
        name: p.name || '未命名方案',
        input: p.input,
        monthlyPayment: p.monthlyPayment,
        totalInterest: p.totalInterest,
        totalPayment: p.totalPayment,
        createdAt: p.createdAt,
        monthlyPaymentText: formatMoney(p.monthlyPayment),
        totalInterestText: formatMoney(p.totalInterest),
        createdAtText: formatTime(p.createdAt)
      };
    }).sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); });
    this.setData({ plans: plans });
  },

  // 点击卡片：把 input 写回 currentInput，跳转到计算器页对比/查看详情
  onTapPlan(e) {
    var id = e.currentTarget.dataset.id;
    var plan = null;
    for (var i = 0; i < this.data.plans.length; i++) {
      if (this.data.plans[i].id === id) { plan = this.data.plans[i]; break; }
    }
    if (!plan) return;
    wx.setStorageSync('currentInput', plan.input);
    wx.switchTab({ url: '/pages/calculator/calculator' });
  },

  // 长按删除（弹确认框）
  onLongPressPlan(e) {
    var that = this;
    var id = e.currentTarget.dataset.id;
    var plan = null;
    for (var i = 0; i < this.data.plans.length; i++) {
      if (this.data.plans[i].id === id) { plan = this.data.plans[i]; break; }
    }
    if (!plan) return;
    wx.showModal({
      title: '删除方案',
      content: '确定删除「' + plan.name + '」吗？删除后不可恢复。',
      confirmText: '删除',
      confirmColor: '#e6432d',
      success(res) {
        if (res.confirm) that.deletePlan(id);
      }
    });
  },

  deletePlan(id) {
    var raw = wx.getStorageSync(STORAGE_KEY);
    var list = Array.isArray(raw) ? raw : [];
    var kept = list.filter(function (p) { return p.id !== id; });
    wx.setStorageSync(STORAGE_KEY, kept);
    this.loadPlans();
    wx.showToast({ title: '已删除', icon: 'success' });
  },

  // 空状态引导：去计算器新建方案
  onGoCalculator() {
    wx.switchTab({ url: '/pages/calculator/calculator' });
  }
});
