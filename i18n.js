/* 界面语言（i18n）：主进程 / 渲染进程 / 后台页共用一份文案表。
   用法：
     Node      const { t, resolve, pick } = require('./i18n'); t('menu.refresh', 'en')
     渲染进程   window.WidgetI18n.t('menu.refresh', 'en')
   取值规则（pick）：用户自定义文案优先；但「内置默认值」视为未自定义，
   这样界面上不会残留另一种语言的内置文案。 */
(function (root) {
'use strict';

const langs = [
  { id: 'zh', name: '简体中文' },
  { id: 'en', name: 'English' }
];

const dict = {
  zh: {
    'app.name': '搬砖收入小组件',
    'app.nameStudy': '学习进度小组件',
    'app.widgetTitle': '搬砖收入',
    'app.widgetTitleStudy': '学习进度',
    'app.adminTitle': '搬砖收入 · 后台设置',
    'app.adminTitleStudy': '学习进度 · 后台设置',
    'app.settingsTitle': '小组件偏好设置',

    'widget.titleMoyu': '今日搬砖收入',
    'widget.titleStudy': '今日学习进度',
    'widget.statusMoyu': '搬砖中',
    'widget.statusStudy': '学习中',
    'widget.studyUnit': ' 分',
    'widget.countdownPrefix': '距发薪还有',
    'widget.countdownPrefixStudy': '距月考还有',
    'widget.countdownFormat': '{prefix} {days} 天 {hours} 小时',
    'widget.countdownEmpty': '未设置发薪日',
    'widget.countdownEmptyStudy': '未设置月考日',
    'widget.countdownToday': '今日发薪！',
    'widget.countdownTodayStudy': '今日月考！',
    'widget.updatedAt': '更新于 {time}',
    'widget.fetchFailed': '获取失败: {msg}',
    'widget.noApiUrl': '未配置 API 地址',
    'widget.badJson': '返回内容不是 JSON',

    'phase.before': '未开工',
    'phase.beforeStudy': '尚未开始',
    'phase.done': '今日完成',
    'phase.break': '休息中',

    'menu.refresh': '刷新数据',
    'menu.admin': '后台设置',
    'menu.settings': '小组件偏好',
    'menu.pin': '置顶',
    'menu.unpin': '取消置顶',
    'menu.quit': '退出',

    'tray.openAdmin': '打开后台设置',
    'tray.openAdminStudy': '打开学习设置',
    'tray.openSettings': '小组件偏好设置',
    'tray.openSettingsStudy': '学习小组件偏好',

    'admin.payday': '每月发薪日 / 月考日（号，1-31）',
    'admin.status': '状态文字（搬砖）',
    'admin.studyStatus': '状态文字（学习模式）',
    'admin.titleMoyu': '主标题（搬砖模式）',
    'admin.titleStudy': '主标题（学习模式）',
    'admin.salary': '月薪（元）',
    'admin.workDays': '月工作天数',
    'admin.workDaysHint': '计薪基数，默认 21.75',
    'admin.workStart': '上班时刻（24 小时制）',
    'admin.workEnd': '下班时刻（24 小时制）',
    'admin.timeExample': '例：08:00',
    'admin.breakStart': '午休开始（24 小时制）',
    'admin.breakEnd': '午休结束（24 小时制）',
    'admin.breakEmpty': '留空 = 不扣午休',
    'admin.dailyHoursHint': '每天工时 = 下班 − 上班 − 午休',
    'admin.stealth': '偷偷摸摸',
    'admin.stealthDesc': '开启后界面文案切换为学习风格，降低划水观感',
    'admin.off': '关闭',
    'admin.on': '开启',
    'admin.liveLabel': '今日实时收入',
    'admin.liveLabelStudy': '今日实时学习时长',
    'admin.progress': '今日进度',
    'admin.rates': '计薪工时 {hours}h · 时薪 ¥{hourly} · 每秒 ¥{perSec}',
    'admin.reload': '重新读取',
    'admin.save': '保存并推送',
    'admin.apiLine': '小组件接口：',
    'admin.footHint': '关闭本窗口不影响小组件运行，可从托盘或右键菜单再次打开。',
    'admin.subMoyu': '每天工时 = 下班 − 上班 − 午休；今日收入从上班起按秒累计，午休暂停，到下班封顶',
    'admin.subStudy': '「偷偷摸摸」已开启：小组件文案显示为学习风格（今日学习进度 · 学习中 · 距月考还有）',
    'admin.toastSaved': '已保存，小组件即将刷新',
    'admin.toastSaveFailed': '保存失败',
    'admin.toastModeOn': '已切换到学习模式',
    'admin.toastModeOff': '已切换到搬砖模式',
    'admin.language': '界面语言',
    'admin.languageHint': '切换后立即生效并自动保存，小组件与菜单同步跟随。',

    'settings.h1': '搬砖收入小组件设置',
    'settings.theme': '小组件皮肤',
    'settings.themeHint': '点击皮肤立即应用并自动保存，其他设置请点击底部“保存”。',
    'settings.themeSaved': '皮肤已自动保存。其他设置请点击底部“保存”。',
    'settings.themeFailed': '皮肤保存失败，请重试。',
    'settings.language': '界面语言',
    'settings.languageAuto': '跟随系统',
    'settings.languageHint': '切换后立即生效并自动保存；小组件、右键菜单与后台都会跟随。',
    'settings.languageSaved': '界面语言已切换并保存。',
    'settings.languageFailed': '界面语言保存失败，请重试。',
    'settings.adminSection': '内置后台（改参数，立即生效）',
    'settings.adminPlaceholder': '内置后台窗口',
    'settings.openAdmin': '打开后台',
    'settings.adminHint': '后台以程序窗口打开（不调起浏览器），改完保存，小组件会自动刷新，无需重启。',
    'settings.dataSource': '数据来源',
    'settings.dataSourceApi': '内置后台 / API 接口',
    'settings.dataSourceMock': '本地静态模拟数据',
    'settings.apiUrl': 'API 地址',
    'settings.apiUrlHint': '留空则自动使用内置后台接口；也可填自建接口，返回 JSON 字段：income、progress、status、paydayDay、monthlySalary、workStartTime、workEndTime',
    'settings.apiHeaders': '请求头 Headers（JSON）',
    'settings.apiHeadersHint': '如需 Cookie/Token，按 JSON 格式填写',
    'settings.refresh': '刷新间隔（毫秒）',
    'settings.refreshHint': '最少 2000 毫秒，默认 10000 毫秒（10 秒）',
    'settings.window': '窗口',
    'settings.alwaysOnTop': '窗口始终置顶',
    'settings.opacity': '透明度',
    'settings.cancel': '取消',
    'settings.save': '保存',
    'settings.saveFailed': '设置保存失败，请重试。',

    'error.invalidTime': '请输入有效的时间（00:00–24:00）'
  },

  en: {
    'app.name': 'Grind Widget',
    'app.nameStudy': 'Study Widget',
    'app.widgetTitle': 'Grind Income',
    'app.widgetTitleStudy': 'Study Progress',
    'app.adminTitle': 'Grind Income · Settings',
    'app.adminTitleStudy': 'Study Progress · Settings',
    'app.settingsTitle': 'Widget Preferences',

    'widget.titleMoyu': "Today's Grind Income",
    'widget.titleStudy': "Today's Study Progress",
    'widget.statusMoyu': 'Grinding',
    'widget.statusStudy': 'Studying',
    'widget.studyUnit': ' pts',
    'widget.countdownPrefix': 'Payday in',
    'widget.countdownPrefixStudy': 'Exam in',
    'widget.countdownFormat': '{prefix} {days}d {hours}h',
    'widget.countdownEmpty': 'Payday not set',
    'widget.countdownEmptyStudy': 'Exam day not set',
    'widget.countdownToday': 'Payday today!',
    'widget.countdownTodayStudy': 'Exam today!',
    'widget.updatedAt': 'Updated at {time}',
    'widget.fetchFailed': 'Fetch failed: {msg}',
    'widget.noApiUrl': 'API URL is not configured',
    'widget.badJson': 'Response is not JSON',

    'phase.before': 'Off the clock',
    'phase.beforeStudy': 'Not started yet',
    'phase.done': 'Done for today',
    'phase.break': 'On break',

    'menu.refresh': 'Refresh',
    'menu.admin': 'Settings',
    'menu.settings': 'Preferences',
    'menu.pin': 'Pin on top',
    'menu.unpin': 'Unpin',
    'menu.quit': 'Quit',

    'tray.openAdmin': 'Open settings',
    'tray.openAdminStudy': 'Open study settings',
    'tray.openSettings': 'Widget preferences',
    'tray.openSettingsStudy': 'Study widget preferences',

    'admin.payday': 'Payday / exam day (day of month, 1-31)',
    'admin.status': 'Status text (grind)',
    'admin.studyStatus': 'Status text (study mode)',
    'admin.titleMoyu': 'Main title (grind mode)',
    'admin.titleStudy': 'Main title (study mode)',
    'admin.salary': 'Monthly salary (CNY)',
    'admin.workDays': 'Work days per month',
    'admin.workDaysHint': 'Payroll divisor, default 21.75',
    'admin.workStart': 'Work starts (24h)',
    'admin.workEnd': 'Work ends (24h)',
    'admin.timeExample': 'e.g. 08:00',
    'admin.breakStart': 'Break starts (24h)',
    'admin.breakEnd': 'Break ends (24h)',
    'admin.breakEmpty': 'Leave empty = break is paid',
    'admin.dailyHoursHint': 'Daily hours = end − start − break',
    'admin.stealth': 'Stealth mode',
    'admin.stealthDesc': 'Switches the widget to study-style text so it looks less like slacking off',
    'admin.off': 'Off',
    'admin.on': 'On',
    'admin.liveLabel': "Today's live income",
    'admin.liveLabelStudy': "Today's live study time",
    'admin.progress': 'Progress today',
    'admin.rates': 'Paid hours {hours}h · ¥{hourly}/h · ¥{perSec}/s',
    'admin.reload': 'Reload',
    'admin.save': 'Save & push',
    'admin.apiLine': 'Widget API: ',
    'admin.footHint': 'Closing this window will not stop the widget. Reopen it from the tray or the right-click menu.',
    'admin.subMoyu': 'Daily hours = end − start − break. Income accrues every second from the start time, pauses during the break and caps at the end time.',
    'admin.subStudy': 'Stealth mode is on: the widget shows study-style text (Study Progress · Studying · Exam in)',
    'admin.toastSaved': 'Saved — the widget will refresh',
    'admin.toastSaveFailed': 'Save failed',
    'admin.toastModeOn': 'Switched to study mode',
    'admin.toastModeOff': 'Switched to grind mode',
    'admin.language': 'Language',
    'admin.languageHint': 'Applies instantly and is saved automatically. The widget and menus follow.',

    'settings.h1': 'Grind Widget Preferences',
    'settings.theme': 'Theme',
    'settings.themeHint': "Click a theme to apply it instantly (auto-saved). Use Save at the bottom for other settings.",
    'settings.themeSaved': 'Theme saved automatically. Use Save at the bottom for other settings.',
    'settings.themeFailed': 'Failed to save the theme, please try again.',
    'settings.language': 'Language',
    'settings.languageAuto': 'System default',
    'settings.languageHint': 'Applies instantly and is saved automatically. The widget, menus and settings page all follow.',
    'settings.languageSaved': 'Language switched and saved.',
    'settings.languageFailed': 'Failed to save the language, please try again.',
    'settings.adminSection': 'Built-in settings (changes apply instantly)',
    'settings.adminPlaceholder': 'Built-in settings window',
    'settings.openAdmin': 'Open',
    'settings.adminHint': 'Opens inside the app window (no browser). Save and the widget refreshes — no restart needed.',
    'settings.dataSource': 'Data source',
    'settings.dataSourceApi': 'Built-in settings / API',
    'settings.dataSourceMock': 'Local demo data',
    'settings.apiUrl': 'API URL',
    'settings.apiUrlHint': 'Leave empty to use the built-in API. You can also point it at your own endpoint returning JSON fields: income, progress, status, paydayDay, monthlySalary, workStartTime, workEndTime',
    'settings.apiHeaders': 'Request headers (JSON)',
    'settings.apiHeadersHint': 'For Cookie/Token, provide a JSON object',
    'settings.refresh': 'Refresh interval (ms)',
    'settings.refreshHint': 'Minimum 2000 ms, default 10000 ms (10 s)',
    'settings.window': 'Window',
    'settings.alwaysOnTop': 'Always on top',
    'settings.opacity': 'Opacity',
    'settings.cancel': 'Cancel',
    'settings.save': 'Save',
    'settings.saveFailed': 'Failed to save settings, please try again.',

    'error.invalidTime': 'Please enter a valid time (00:00–24:00)'
  }
};

/* 全部语言里出现过的内置文案：用于判断某个值是不是「内置默认」而非用户自定义 */
function isBuiltinValue(value) {
  if (value === null || value === undefined || value === '') return false;
  const v = String(value);
  for (const lang of Object.keys(dict)) {
    for (const text of Object.values(dict[lang])) {
      if (text === v) return true;
    }
  }
  return false;
}

/* 'auto' | 'zh' | 'en'；兼容 zh-CN / en-US / 大小写 */
function normalize(value) {
  const v = String(value == null ? '' : value).trim().toLowerCase();
  if (v === 'auto' || v === '') return 'auto';
  if (v.startsWith('zh')) return 'zh';
  if (v.startsWith('en')) return 'en';
  return 'auto';
}

/* 'auto' 时按系统语言判断（非中文环境默认英文） */
function resolve(selected, locale) {
  const v = normalize(selected);
  if (v !== 'auto') return v;
  return String(locale || '').toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

function interpolate(text, params) {
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (m, key) =>
    Object.prototype.hasOwnProperty.call(params, key) ? String(params[key]) : m);
}

/* 取词：找不到 key 时回退中文，再找不到就返回 key 本身（便于发现漏译） */
function t(key, lang, params) {
  const l = dict[normalize(lang)] ? normalize(lang) : 'zh';
  const table = dict[l] || dict.zh;
  const text = table[key] != null ? table[key] : (dict.zh[key] != null ? dict.zh[key] : key);
  return interpolate(text, params);
}

/* 用户自定义文案优先；但等于任何内置默认值时视为未自定义，改用当前语言的默认值 */
function pick(custom, key, lang) {
  const value = (custom === null || custom === undefined) ? '' : String(custom);
  if (value && !isBuiltinValue(value)) return value;
  return t(key, lang);
}

const api = { langs, dict, normalize, resolve, t, pick, isBuiltinValue };
if (typeof module === 'object' && module.exports) module.exports = api;
else root.WidgetI18n = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
