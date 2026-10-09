const THEME_KEY = 'wish-theme-mode';
export const THEME_MODES = ['system', 'light', 'dark'];
export const THEME_LABELS = ['跟随系统', '浅色', '深色'];
const light = { paper: '#f2f6f5', card: '#ffffff', ink: '#1f2d2a', 'ink-soft': '#5b6f6b', 'ink-faint': '#738781', line: '#dde7e4', metro: '#0f766e', 'metro-soft': 'rgba(15,118,110,0.1)', brick: '#be4a43', 'neon-a': '#0f766e', 'neon-b': '#0891b2' };
const dark = { paper: '#171a1b', card: '#222627', ink: '#edf1ef', 'ink-soft': '#b1bdb8', 'ink-faint': '#8b9b93', line: '#3a4240', metro: '#78d6b0', 'metro-soft': 'rgba(120,214,176,0.1)', brick: '#f58d83', 'neon-a': '#287a60', 'neon-b': '#397b8d' };
let systemDark = null;

export function getThemeMode() {
  const value = typeof wx.getStorageSync === 'function' ? wx.getStorageSync(THEME_KEY) : '';
  return THEME_MODES.includes(value) ? value : 'system';
}
export function setThemeMode(mode) {
  if (!THEME_MODES.includes(mode)) return;
  wx.setStorageSync(THEME_KEY, mode);
  applyAllThemes();
}
export function applyTheme(page, navigation = true) {
  if (systemDark === null) {
    const appBase = typeof wx.getAppBaseInfo === 'function' ? wx.getAppBaseInfo() : null;
    systemDark = appBase ? appBase.theme === 'dark' : typeof wx.getSystemInfoSync === 'function' && wx.getSystemInfoSync().theme === 'dark';
  }
  const mode = getThemeMode();
  const isDark = mode === 'dark' || (mode === 'system' && systemDark);
  const colors = isDark ? dark : light;
  const themeStyle = Object.keys(colors).map((key) => `--${key}:${colors[key]}`).join(';') + `;background-color:${colors.paper};color:${colors.ink};`;
  page.setData({ themeStyle, isDark, themeMode: mode, themeIndex: THEME_MODES.indexOf(mode) });
  if (navigation && typeof wx.setNavigationBarColor === 'function') wx.setNavigationBarColor({ frontColor: isDark ? '#ffffff' : '#000000', backgroundColor: colors.card });
  if (navigation && typeof wx.setBackgroundColor === 'function') wx.setBackgroundColor({ backgroundColor: colors.paper });
}
export function applyAllThemes() {
  const pages = typeof getCurrentPages === 'function' ? getCurrentPages() : [];
  pages.forEach((page, index) => applyTheme(page, index === pages.length - 1));
}
export function watchTheme() {
  if (typeof wx.onThemeChange === 'function') wx.onThemeChange(({ theme }) => { systemDark = theme === 'dark'; applyAllThemes(); });
}
