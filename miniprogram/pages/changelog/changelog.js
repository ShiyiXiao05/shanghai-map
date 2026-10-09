const { CHANGELOG, CLIENT_VERSION } = require('../../utils/updates.js');
const { applyTheme } = require('../../utils/theme.js');

Page({
  data: { entries: CHANGELOG, version: CLIENT_VERSION },
  onShow() { applyTheme(this); },
});
