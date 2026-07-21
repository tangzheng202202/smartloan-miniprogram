// 我的页：默认设置读写、免责声明、关于与意见反馈
var SETTINGS_KEY = 'settings';
var FEEDBACK_EMAIL = 'tangzheng202202@gmail.com';

Page({
  data: {
    annualRate: '',   // 默认年利率（%）
    years: '',        // 默认期限（年）
    version: '1.0.0',
    feedbackEmail: FEEDBACK_EMAIL
  },

  onShow() {
    this.loadSettings();
  },

  loadSettings() {
    var s = wx.getStorageSync(SETTINGS_KEY) || {};
    this.setData({
      annualRate: s.annualRate !== undefined && s.annualRate !== null ? String(s.annualRate) : '',
      years: s.years !== undefined && s.years !== null ? String(s.years) : ''
    });
  },

  onRateInput(e) {
    this.setData({ annualRate: e.detail.value });
    this.saveSettings();
  },

  onYearsInput(e) {
    this.setData({ years: e.detail.value });
    this.saveSettings();
  },

  saveSettings() {
    var rate = parseFloat(this.data.annualRate);
    var years = parseInt(this.data.years, 10);
    var settings = {};
    if (!isNaN(rate) && rate > 0 && rate <= 36) {
      settings.annualRate = rate;
    }
    if (!isNaN(years) && years > 0 && years <= 30) {
      settings.years = years;
    }
    wx.setStorageSync(SETTINGS_KEY, settings);
  },

  // 意见反馈：复制邮箱（客服会话占位）
  onFeedback() {
    wx.showActionSheet({
      itemList: ['复制反馈邮箱', '联系在线客服'],
      success(res) {
        if (res.tapIndex === 0) {
          wx.setClipboardData({
            data: FEEDBACK_EMAIL,
            success() {
              wx.showToast({ title: '邮箱已复制', icon: 'success' });
            }
          });
        } else if (res.tapIndex === 1) {
          if (wx.openCustomerServiceChat) {
            wx.openCustomerServiceChat({
              extInfo: { url: '' },
              corpId: '',
              fail() {
                wx.showToast({ title: '客服暂未开通，请使用邮箱反馈', icon: 'none' });
              }
            });
          } else {
            wx.showToast({ title: '客服暂未开通，请使用邮箱反馈', icon: 'none' });
          }
        }
      }
    });
  }
});
