const { EMOJI_GROUPS, validEmoji } = require('../../utils/emoji.js');
const { categoryMeta } = require('../../utils/config.js');
Component({
  properties: { value: { type: String, value: '' }, category: { type: String, value: '景点' } },
  data: { open: false, groups: EMOJI_GROUPS, group: 0, choices: EMOJI_GROUPS[0].emojis, custom: '', shown: '', customError: '' },
  observers: { 'value, category': function (value, category) { this.setData({ shown: value || categoryMeta(category).emoji }); } },
  methods: {
    openPicker() { this.setData({ open: true, custom: this.data.value, customError: '' }); },
    closePicker() { this.setData({ open: false }); },
    noop() {},
    changeGroup(event) { const group = Number(event.currentTarget.dataset.index); this.setData({ group, choices: EMOJI_GROUPS[group].emojis }); },
    select(event) { this.commit(event.currentTarget.dataset.emoji); },
    reset() { this.commit(''); },
    onCustom(event) { this.setData({ custom: event.detail.value, customError: '' }); },
    useCustom() {
      const value = this.data.custom.trim();
      if (!validEmoji(value)) { this.setData({ customError: '请输入一个 emoji' }); return; }
      this.commit(value);
    },
    commit(value) { this.triggerEvent('change', { value }); this.setData({ open: false }); },
  },
});
