// 昵称一次性确认弹层：input type="nickname" 会在键盘上方展示微信昵称供一键选用
// （2022-10 起 wx.getUserProfile 已收回，这是官方唯一的合规取昵称方式）
Component({
  properties: {
    show: { type: Boolean, value: false },
  },
  data: { value: '' },
  methods: {
    onInput(event) {
      this.setData({ value: event.detail.value });
    },
    onConfirm() {
      const value = (this.data.value || '').trim();
      if (!value) {
        wx.showToast({ title: '给自己起个名字吧', icon: 'none' });
        return;
      }
      if (value.length > 30) {
        wx.showToast({ title: '昵称最多 30 字', icon: 'none' });
        return;
      }
      this.triggerEvent('confirm', value);
    },
    onCancel() {
      this.triggerEvent('cancel');
    },
    noop() {
      // 阻止点击卡片冒泡到遮罩关闭
    },
  },
});
