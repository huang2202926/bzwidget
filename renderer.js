const elTitle = document.getElementById('title');
const elUnitPrefix = document.getElementById('unitPrefix');
const elUnitSuffix = document.getElementById('unitSuffix');
const elIncome = document.getElementById('income');
const elCountdown = document.getElementById('countdown');
const elStatus = document.getElementById('status');
const elPercent = document.getElementById('percent');
const elProgressFill = document.getElementById('progressFill');
const elLastUpdate = document.getElementById('lastUpdate');
const elContextMenu = document.getElementById('contextMenu');
const elCard = document.getElementById('card');

let config = null;
let currentData = {};
let liveParams = null;
let refreshTimer = null;
let countdownTimer = null;
let liveTimer = null;
let lang = 'zh';

function formatMoney(n) {
  return Number(n).toLocaleString(lang === 'en' ? 'en-US' : 'zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function T(key, params) {
  return WidgetI18n.t(key, lang, params);
}

/* 把 config 里的语言设置同步过来（effectiveLanguage 由主进程按系统语言解析好） */
function syncLang(next) {
  const previous = lang;
  lang = WidgetI18n.resolve(next?.effectiveLanguage ?? next?.language, navigator.language);
  document.documentElement.lang = lang === 'en' ? 'en' : 'zh-CN';
  return previous !== lang;
}

/* 两套界面文案：
   moyu  = 搬砖收入（今日搬砖收入 / ¥ / 距发薪还有 / 搬砖中）
   study = 学习进度（今日学习进度 / 分 / 距月考还有 / 学习中）——由「偷偷摸摸」开关控制
   文字随界面语言变化，用户自定义的标题/状态优先。 */
function copyFor(stealth) {
  return stealth
    ? {
        titleKey: 'widget.titleStudy',
        title: T('widget.titleStudy'),
        unitPrefix: '',
        unitSuffix: T('widget.studyUnit'),
        countdown: T('widget.countdownPrefixStudy'),
        countdownEmpty: T('widget.countdownEmptyStudy'),
        countdownToday: T('widget.countdownTodayStudy'),
        status: T('widget.statusStudy')
      }
    : {
        titleKey: 'widget.titleMoyu',
        title: T('widget.titleMoyu'),
        unitPrefix: '¥',
        unitSuffix: '',
        countdown: T('widget.countdownPrefix'),
        countdownEmpty: T('widget.countdownEmpty'),
        countdownToday: T('widget.countdownToday'),
        status: T('widget.statusMoyu')
      };
}

function isStealth() {
  return !!(currentData.stealthMode ?? config?.mock?.stealthMode);
}

function modeCopy() {
  return copyFor(isStealth());
}

/* 右键菜单文案（含置顶/取消置顶随状态变化） */
function applyMenuCopy() {
  for (const item of elContextMenu.querySelectorAll('.menu-item')) {
    const action = item.dataset.action;
    if (action === 'toggle-top') {
      const key = config?.alwaysOnTop === false ? 'menu.pin' : 'menu.unpin';
      item.dataset.i18n = key;
      item.textContent = T(key);
      continue;
    }
    const key = item.dataset.i18n;
    if (key) item.textContent = T(key);
  }
}

/* 把标题 / 单位 / 倒计时文案切到当前模式 */
function applyModeCopy() {
  const copy = modeCopy();
  const m = config?.mock || {};
  const stealth = isStealth();
  elTitle.textContent = stealth
    ? WidgetI18n.pick(currentData.titleStudy || m.titleStudy, 'widget.titleStudy', lang)
    : WidgetI18n.pick(currentData.titleMoyu || m.titleMoyu, 'widget.titleMoyu', lang);
  elUnitPrefix.textContent = copy.unitPrefix;
  elUnitSuffix.textContent = copy.unitSuffix;
  document.title = T(stealth ? 'app.widgetTitleStudy' : 'app.widgetTitle');
  updateCountdown();
  applyMenuCopy();
}

function formatCountdown(targetDate) {
  const copy = modeCopy();
  if (!targetDate) {
    return T('widget.countdownFormat', { prefix: copy.countdown, days: '—', hours: '—' });
  }
  const now = new Date();
  const target = new Date(targetDate);
  const diff = target - now;
  if (diff <= 0) return copy.countdownToday;
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  return T('widget.countdownFormat', { prefix: copy.countdown, days, hours });
}

// 发薪日存的是「每月几号」（1-31），返回下一次发薪的具体日期
function getNextPayday(day) {
  if (!day || day < 1 || day > 31) return null;
  const now = new Date();
  const today = now.getDate();
  let y = now.getFullYear();
  let m = now.getMonth();
  if (today > day) {
    // 本月已过，顺延到下个月
    m += 1;
    if (m > 11) { m = 0; y += 1; }
  }
  // 处理月份天数不足（如 31 号遇到小月）
  const lastDay = new Date(y, m + 1, 0).getDate();
  const d = Math.min(day, lastDay);
  return new Date(y, m, d, 0, 0, 0, 0);
}

function updateCountdown() {
  const copy = modeCopy();
  const raw = currentData.paydayDay ?? config.mock?.paydayDay ?? null;
  const next = getNextPayday(raw);
  elCountdown.textContent = next ? formatCountdown(next) : copy.countdownEmpty;
}

function normalizeData(raw) {
  const income = raw?.income ?? raw?.todayIncome ?? raw?.amount ?? raw?.salary ?? config.mock?.income ?? 0;
  const progress = raw?.progress ?? raw?.percent ?? raw?.percentage ?? config.mock?.progress ?? 0;
  const status = raw?.status ?? raw?.state ?? raw?.text ?? config.mock?.status;
  const studyStatus = raw?.studyStatus ?? config.mock?.studyStatus;
  const titleMoyu = raw?.titleMoyu ?? config.mock?.titleMoyu;
  const titleStudy = raw?.titleStudy ?? config.mock?.titleStudy;
  const paydayDay = raw?.paydayDay ?? raw?.salaryDay ?? raw?.payday ?? config.mock?.paydayDay ?? null;
  const stealthMode = raw?.stealthMode ?? raw?.stealth ?? config.mock?.stealthMode ?? false;
  return { income, progress, status, studyStatus, titleMoyu, titleStudy, paydayDay, stealthMode };
}

function render(data) {
  currentData = normalizeData(data);
  // 用后端返回（或本地）的参数做实时计算，让收入/进度每秒跳动
  liveParams = { ...data };
  applyModeCopy();
  const stealth = isStealth();
  elStatus.textContent = WidgetI18n.pick(
    stealth ? currentData.studyStatus : currentData.status,
    stealth ? 'widget.statusStudy' : 'widget.statusMoyu',
    lang
  );
  elLastUpdate.textContent = T('widget.updatedAt', {
    time: new Date().toLocaleTimeString(lang === 'en' ? 'en-US' : 'zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  });
  ensureLiveTimer();
  tickCompute();
}

function tickCompute() {
  if (!liveParams) return;
  const dynamic = Number(liveParams.monthlySalary) > 0 && Income.resolveShift(liveParams);
  const state = dynamic ? Income.computeState(liveParams, undefined, lang) : currentData;
  elIncome.textContent = formatMoney(state.income);
  const pct = Math.max(0, Math.min(100, Number(state.progress) || 0));
  elPercent.textContent = pct.toFixed(1) + '%';
  elProgressFill.style.width = pct + '%';
  const stealth = isStealth();
  elStatus.textContent = WidgetI18n.pick(
    stealth ? (state.studyStatus || currentData.studyStatus) : (state.status || currentData.status),
    stealth ? 'widget.statusStudy' : 'widget.statusMoyu',
    lang
  );
}

function ensureLiveTimer() {
  if (liveTimer) return;
  liveTimer = setInterval(tickCompute, 1000);
}

async function fetchMockData() {
  return {
    ...config.mock,
    income: config.mock?.income ?? 245.88,
    progress: config.mock?.progress ?? 92,
    status: config.mock?.status || T('widget.statusMoyu'),
    paydayDay: config.mock?.paydayDay ?? null,
    monthlySalary: config.mock?.monthlySalary,
    workDaysPerMonth: config.mock?.workDaysPerMonth,
    workStartTime: config.mock?.workStartTime,
    workEndTime: config.mock?.workEndTime,
    breakStartTime: config.mock?.breakStartTime,
    breakEndTime: config.mock?.breakEndTime
  };
}

async function fetchApiData() {
  if (!config.apiUrl) throw new Error(T('widget.noApiUrl'));
  let headers = {};
  try {
    headers = JSON.parse(config.apiHeaders || '{}');
  } catch (e) {
    console.warn('API Headers JSON 解析失败', e);
  }
  const res = await window.electronAPI.fetchApiData(config.apiUrl, headers);
  if (res.error) throw new Error(res.error);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  if (res.contentType && res.contentType.includes('application/json')) {
    return res.body;
  }
  // 尝试把文本按 JSON 解析
  try {
    return JSON.parse(res.body);
  } catch (e) {
    throw new Error(T('widget.badJson'));
  }
}

async function fetchData() {
  // 刷新通知可能早于启动配置读取完成；初始化会在配置就绪后主动取数。
  if (!config) return;
  try {
    const data = config.dataSource === 'api' ? await fetchApiData() : await fetchMockData();
    render(data);
  } catch (err) {
    console.error('获取数据失败', err);
    elLastUpdate.textContent = T('widget.fetchFailed', { msg: err.message });
  }
}

function startAutoRefresh() {
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = setInterval(fetchData, Math.max(2000, config.refreshInterval || 10000));
}

// 右键菜单
let menuVisible = false;

function showContextMenu(x, y) {
  elContextMenu.style.display = 'flex';
  elContextMenu.style.left = Math.min(x, window.innerWidth - 130) + 'px';
  elContextMenu.style.top = Math.min(y, window.innerHeight - 140) + 'px';
  menuVisible = true;
}

function hideContextMenu() {
  elContextMenu.style.display = 'none';
  menuVisible = false;
}

elCard.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  showContextMenu(e.clientX, e.clientY);
});

document.addEventListener('click', (e) => {
  if (menuVisible && !elContextMenu.contains(e.target)) {
    hideContextMenu();
  }
});

elContextMenu.addEventListener('click', async (e) => {
  const action = e.target.dataset.action;
  if (!action) return;
  hideContextMenu();
  switch (action) {
    case 'refresh':
      await fetchData();
      break;
    case 'admin':
      await window.electronAPI.openAdmin();
      break;
    case 'settings':
      await window.electronAPI.openSettings();
      break;
    case 'toggle-top':
      config.alwaysOnTop = !config.alwaysOnTop;
      await window.electronAPI.setConfig({ alwaysOnTop: config.alwaysOnTop });
      applyMenuCopy();
      break;
    case 'quit':
      window.electronAPI.quit();
      break;
  }
});

// 监听主进程通知
window.electronAPI.onRefreshData(() => fetchData());
window.electronAPI.onConfigChanged((newConfig) => {
  config = { ...config, ...newConfig };
  syncLang(config);
  WidgetThemes.apply(config.theme);
  fetchData();
  startAutoRefresh();
});

// 启动
(async () => {
  config = await window.electronAPI.getConfig();
  syncLang(config);
  WidgetThemes.apply(config.theme);
  await fetchData();
  startAutoRefresh();
  if (countdownTimer) clearInterval(countdownTimer);
  countdownTimer = setInterval(updateCountdown, 60000);
})();
