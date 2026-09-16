// 页面共用：昵称确认弹层的开关与确认/取消处理。
// 用法：Page({ behaviors: [require('../../utils/identity-behavior.js')], ... })，
// 写操作前 auth.requireIdentity(this, retry)，wxml 末尾挂 <nickname-modal show="{{nickModalShow}}" ... />
const auth = require('./auth.js');

module.exports = Behavior({
  data: { nickModalShow: false },
  methods: {
    async onNickConfirm(event) {
      try {
        await auth.confirmNickname(this, event.detail);
      } catch (err) {
        wx.showToast({ title: err.message || '保存失败，请重试', icon: 'none' });
      }
    },
    onNickCancel() {
      auth.cancelNickname(this);
    },
  },
});
