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

function formatMoney(n) {
  return Number(n).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/* 两套界面文案：
   moyu  = 搬砖收入（今日搬砖收入 / ¥ / 距发薪还有 / 搬砖中）
   study = 学习进度（今日学习进度 / 分 / 距月考还有 / 学习中）——由「偷偷摸摸」开关控制 */
const MODE_COPY = {
  moyu: {
    title: '今日搬砖收入',
    unitPrefix: '¥',
    unitSuffix: '',
    countdown: '距发薪还有',
    countdownEmpty: '未设置发薪日',
    countdownToday: '今日发薪！',
    status: '搬砖中'
  },
  study: {
    title: '今日学习进度',
    unitPrefix: '',
    unitSuffix: ' 分',
    countdown: '距月考还有',
    countdownEmpty: '未设置月考日',
    countdownToday: '今日月考！',
    status: '学习中'
  }
};

function isStealth() {
  return !!(currentData.stealthMode ?? config?.mock?.stealthMode);
}

function modeCopy() {
  return isStealth() ? MODE_COPY.study : MODE_COPY.moyu;
}

/* 把标题 / 单位 / 倒计时文案切到当前模式 */
function applyModeCopy() {
  const copy = modeCopy();
  const m = config?.mock || {};
  elTitle.textContent = isStealth()
    ? (currentData.titleStudy || m.titleStudy || copy.title)
    : (currentData.titleMoyu || m.titleMoyu || copy.title);
  elUnitPrefix.textContent = copy.unitPrefix;
  elUnitSuffix.textContent = copy.unitSuffix;
  document.title = isStealth() ? '学习进度' : '搬砖收入';
  updateCountdown();
}

function formatCountdown(targetDate) {
  const copy = modeCopy();
  if (!targetDate) return `${copy.countdown} — 天 — 小时`;
  const now = new Date();
  const target = new Date(targetDate);
  const diff = target - now;
  if (diff <= 0) return copy.countdownToday;
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  return `${copy.countdown} ${days} 天 ${hours} 小时`;
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
  const status = raw?.status ?? raw?.state ?? raw?.text ?? config.mock?.status ?? '搬砖中';
  const studyStatus = raw?.studyStatus ?? config.mock?.studyStatus ?? '学习中';
  const titleMoyu = raw?.titleMoyu ?? config.mock?.titleMoyu ?? '今日搬砖收入';
  const titleStudy = raw?.titleStudy ?? config.mock?.titleStudy ?? '今日学习进度';
  const paydayDay = raw?.paydayDay ?? raw?.salaryDay ?? raw?.payday ?? config.mock?.paydayDay ?? null;
  const stealthMode = raw?.stealthMode ?? raw?.stealth ?? config.mock?.stealthMode ?? false;
  return { income, progress, status, studyStatus, titleMoyu, titleStudy, paydayDay, stealthMode };
}

function render(data) {
  currentData = normalizeData(data);
  // 用后端返回（或本地）的参数做实时计算，让收入/进度每秒跳动
  liveParams = {
    monthlySalary: data?.monthlySalary ?? config.mock?.monthlySalary,
    workDaysPerMonth: data?.workDaysPerMonth ?? config.mock?.workDaysPerMonth,
    workStartTime: data?.workStartTime ?? config.mock?.workStartTime,
    workEndTime: data?.workEndTime ?? config.mock?.workEndTime,
    breakStartTime: (data?.breakStartTime !== undefined ? data.breakStartTime : config.mock?.breakStartTime),
    breakEndTime: (data?.breakEndTime !== undefined ? data.breakEndTime : config.mock?.breakEndTime)
  };
  applyModeCopy();
  elStatus.textContent = isStealth()
    ? (currentData.studyStatus || MODE_COPY.study.status)
    : (currentData.status || MODE_COPY.moyu.status);
  elLastUpdate.textContent = '更新于 ' + new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  ensureLiveTimer();
  tickCompute();
}

/* 24 小时制 "HH:MM" → 距 0 点的分钟数（兼容旧版十进制小时） */
function toMinutes(v) {
  if (v === null || v === undefined || v === '') return null;
  const s = String(v).trim();
  if (/^\d+(\.\d+)?$/.test(s)) {
    const n = Number(s);
    return (n >= 0 && n <= 24) ? Math.round(n * 60) : null;
  }
  const m = /^(\d{1,2}):(\d{2})$/.exec(s);
  if (!m) return null;
  const h = parseInt(m[1], 10);
  const mi = parseInt(m[2], 10);
  if (h > 24 || mi > 59) return null;
  return h * 60 + mi;
}

// 按当前时间实时计算今日收入与进度：
//   每天工时 = 下班 − 上班 − 午休；从上班起按秒累计，午休期间暂停，到下班封顶
function tickCompute() {
  if (!liveParams) return;
  const salary = Number(liveParams.monthlySalary) || 0;
  const wd = Number(liveParams.workDaysPerMonth) || 21.75;
  const sm = toMinutes(liveParams.workStartTime);
  const em = toMinutes(liveParams.workEndTime);
  const spanMin = (sm !== null && em !== null && em > sm) ? (em - sm) : 0;
  // 午休必须完整落在班次内才算数
  let bs = toMinutes(liveParams.breakStartTime);
  let be = toMinutes(liveParams.breakEndTime);
  if (!(bs !== null && be !== null && be > bs && bs >= sm && be <= em)) { bs = null; be = null; }
  const breakMin = (bs !== null && be !== null) ? (be - bs) : 0;
  const effectiveMin = spanMin - breakMin;
  if (salary > 0 && effectiveMin > 0) {
    const effectiveSec = effectiveMin * 60;
    const perSec = (salary / wd) / effectiveSec;
    const now = new Date();
    const base = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0).getTime();
    const startMs = base + sm * 60 * 1000;
    const elapsedMs = Math.max(0, Math.min(now.getTime() - startMs, spanMin * 60 * 1000));
    let pausedMs = 0;
    if (breakMin > 0) {
      pausedMs = Math.max(0, Math.min(now.getTime(), base + be * 60 * 1000) - (base + bs * 60 * 1000));
      pausedMs = Math.min(pausedMs, elapsedMs);
    }
    const workedSec = Math.max(0, (elapsedMs - pausedMs) / 1000);
    const income = perSec * workedSec;
    const prog = workedSec / effectiveSec * 100;
    elIncome.textContent = formatMoney(income);
    const pct = Math.max(0, Math.min(100, prog));
    elPercent.textContent = pct.toFixed(1) + '%';
    elProgressFill.style.width = pct + '%';
  } else {
    // 未配置月薪/班次 → 回退静态值
    elIncome.textContent = formatMoney(currentData.income);
    const pct = Math.max(0, Math.min(100, Number(currentData.progress)));
    elPercent.textContent = pct + '%';
    elProgressFill.style.width = pct + '%';
  }
}

function ensureLiveTimer() {
  if (liveTimer) return;
  liveTimer = setInterval(tickCompute, 1000);
}

async function fetchMockData() {
  return {
    income: config.mock?.income ?? 245.88,
    progress: config.mock?.progress ?? 92,
    status: config.mock?.status ?? '搬砖中',
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
  if (!config.apiUrl) throw new Error('未配置 API 地址');
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
    throw new Error('返回内容不是 JSON');
  }
}

async function fetchData() {
  try {
    const data = config.dataSource === 'api' ? await fetchApiData() : await fetchMockData();
    render(data);
  } catch (err) {
    console.error('获取数据失败', err);
    elLastUpdate.textContent = '获取失败: ' + err.message;
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
  fetchData();
  startAutoRefresh();
});

// 启动
(async () => {
  config = await window.electronAPI.getConfig();
  await fetchData();
  startAutoRefresh();
  if (countdownTimer) clearInterval(countdownTimer);
  countdownTimer = setInterval(updateCountdown, 60000);
})();
