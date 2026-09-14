const { app, BrowserWindow, Tray, Menu, ipcMain, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const { normalize: normalizeTheme } = require('./themes');
const { t: translate, normalize: normalizeLanguage, resolve: resolveLanguage, dict: i18nDict, pick: pickText } = require('./i18n');

// 配置文件路径
const configDir = path.join(os.homedir(), '.momoyu-widget');
if (!fs.existsSync(configDir)) fs.mkdirSync(configDir, { recursive: true });
// 将 Chromium 运行数据与其他 Electron 实例隔离；业务配置仍保留原路径。
app.setPath('userData', path.join(configDir, 'runtime'));
const configPath = path.join(configDir, 'config.json');

// 启动日志，便于排查“双击无反应”类问题
const logFile = path.join(configDir, 'startup.log');
function log(...args) {
  const line = `[${new Date().toISOString()}] ${args.join(' ')}\n`;
  try { fs.appendFileSync(logFile, line); } catch (e) { /* ignore */ }
}
process.on('uncaughtException', (e) => log('UNCAUGHT', (e && e.stack) || String(e)));
process.on('unhandledRejection', (e) => log('UNHANDLED', (e && e.stack) || String(e)));
log('=== boot, electron=' + process.versions.electron + ' pid=' + process.pid + ' ===');

// 小组件窗口可自由缩放（拖动窗口边缘），最小尺寸保护
const MIN_WIDGET_WIDTH = 200;
const MIN_WIDGET_HEIGHT = 170;

const defaultConfig = {  x: null,
  y: null,
  width: 280,
  height: 192,
  alwaysOnTop: true,
  opacity: 0.95,
  theme: 'mint',
  language: 'auto',  // 界面语言：'auto' 跟随系统 | 'zh' | 'en'
  dataSource: 'api', // 'mock' | 'api'
  apiUrl: '',        // 留空则自动使用内置后台接口
  apiHeaders: '',
  refreshInterval: 10000, // ms
  // 内置后台的数据（“今日搬砖”参数）
  // income / progress 不再写死，而是由「月薪 + 工作时间段（上班→下班）」按当前时间实时计算
  mock: {
    stealthMode: true,       // 偷偷摸摸：界面文案切换为学习风格（今日学习进度 / 学习中 / 距月考还有）
    monthlySalary: 15000,    // 月薪（元）
    workDaysPerMonth: 21.75, // 月计薪工作天数（劳动法基数，可改）
    workStartTime: '08:00',  // 上班时刻（24 小时制 HH:MM）
    workEndTime: '18:00',    // 下班时刻（24 小时制 HH:MM）
    breakStartTime: '12:00', // 午休开始（24 小时制 HH:MM），留空 = 不扣午休
    breakEndTime: '13:00',   // 午休结束（24 小时制 HH:MM）
    status: '搬砖中',     // 搬砖模式下的状态文字
    studyStatus: '学习中',    // 学习模式下的状态文字
    titleMoyu: '今日搬砖收入', // 搬砖模式下主界面标题
    titleStudy: '今日学习进度', // 学习模式下主界面标题
    paydayDay: null,         // 每月发薪日 / 月考日（1-31），null=未设置
    // 兼容旧版静态字段：仅当未配置月薪/工时区间时使用
    income: 245.88,
    progress: 92
  }
};

/* ---- 时刻工具：统一用 24 小时制的 "HH:MM" 字符串 ---- */

// "HH:MM" → 距 0 点的分钟数；兼容旧版十进制小时（8、8.5、17.5）
const { timeToMinutes, minutesToTime, resolveShift, workedSecondsOf, computeState, validateTimes } = require('./income');

function loadConfig() {
  try {
    if (fs.existsSync(configPath) || fs.existsSync(configPath + '.bak')) {
      let saved;
      try { saved = JSON.parse(fs.readFileSync(configPath, 'utf8')); }
      catch (e) { saved = JSON.parse(fs.readFileSync(configPath + '.bak', 'utf8')); log('Recovered configuration from backup'); }
      const savedMock = saved.mock || {};
      const merged = Object.assign({}, defaultConfig, saved);
      merged.theme = normalizeTheme(saved.theme);
      merged.language = normalizeLanguage(saved.language);
      merged.mock = Object.assign({}, defaultConfig.mock, savedMock);
      // 旧版发薪日存的是完整日期，迁移为「每月几号」
      if (savedMock.paydayDate && savedMock.paydayDay == null) {
        const d = new Date(savedMock.paydayDate);
        if (!isNaN(d.getTime())) merged.mock.paydayDay = d.getDate();
      }
      // 上下班时刻统一为 24 小时制 "HH:MM"：
      //   优先用已存的 workStartTime/workEndTime，其次迁移旧版十进制小时（8、8.5）
      //   注意：必须看 savedMock，不能看 merged——默认值里已含 "08:00"，会让旧字段永远迁移不到
      const startMins = (savedMock.workStartTime != null)
        ? timeToMinutes(savedMock.workStartTime)
        : timeToMinutes(savedMock.workStartHour);
      const endMins = (savedMock.workEndTime != null)
        ? timeToMinutes(savedMock.workEndTime)
        : timeToMinutes(savedMock.workEndHour);
      merged.mock.workStartTime = minutesToTime(startMins) || defaultConfig.mock.workStartTime;
      merged.mock.workEndTime = minutesToTime(endMins) || defaultConfig.mock.workEndTime;
      // 午休：没存过 → 用默认；显式留空（'' 或 null）→ 表示不扣午休
      const resolveBreak = (savedVal, fallback) => {
        if (savedVal === undefined) return fallback;
        if (savedVal === null || savedVal === '') return '';
        return minutesToTime(timeToMinutes(savedVal)) || fallback;
      };
      merged.mock.breakStartTime = resolveBreak(savedMock.breakStartTime, defaultConfig.mock.breakStartTime);
      merged.mock.breakEndTime = resolveBreak(savedMock.breakEndTime, defaultConfig.mock.breakEndTime);
      // 偷偷摸摸：老配置里没有该字段 → 用默认（默认开启学习风格文案）
      merged.mock.stealthMode = (savedMock.stealthMode === undefined)
        ? defaultConfig.mock.stealthMode
        : !!savedMock.stealthMode;
      merged.mock.studyStatus = savedMock.studyStatus || defaultConfig.mock.studyStatus;
      merged.mock.titleMoyu = savedMock.titleMoyu || defaultConfig.mock.titleMoyu;
      merged.mock.titleStudy = savedMock.titleStudy || defaultConfig.mock.titleStudy;
      delete merged.mock.workStartHour;
      delete merged.mock.workEndHour;
      delete merged.mock.paydayDate;
      delete merged.mock.onlineCount;
      // 旧版本高度不足以容纳完整内容，自动升级
      if (merged.height && merged.height <= 152) merged.height = defaultConfig.height;
      return merged;
    }
  } catch (e) {
    console.error('读取配置失败', e);
  }
  return JSON.parse(JSON.stringify(defaultConfig));
}

function saveConfig(cfg) {
  try {
    const serialized = JSON.stringify(cfg, null, 2);
    if (fs.existsSync(configPath)) {
      try {
        const previous = fs.readFileSync(configPath, 'utf8');
        JSON.parse(previous);
        fs.writeFileSync(configPath + '.bak', previous, 'utf8');
      } catch (e) { log('Keeping existing configuration backup'); }
    } else if (!fs.existsSync(configPath + '.bak')) {
      fs.writeFileSync(configPath + '.bak', serialized, 'utf8');
    }
    fs.writeFileSync(configPath + '.tmp', serialized, 'utf8');
    fs.renameSync(configPath + '.tmp', configPath);
    return true;
  } catch (e) {
    console.error('保存配置失败', e);
    return false;
  }
}

let config = loadConfig();
let mainWindow = null;
let tray = null;
let settingsWindow = null;
let adminWindow = null;
let localServer = null;
let localPort = 0;

/* ---- 界面语言 ---- */
/* 'auto' 时按系统语言解析（非中文环境 → 英文），让老外开箱即得英文界面 */
function effectiveLanguage() {
  let locale = '';
  try { locale = (typeof app.getLocale === 'function') ? app.getLocale() : ''; } catch (e) { /* ignore */ }
  return resolveLanguage(config.language, locale);
}
function T(key, params) {
  return translate(key, effectiveLanguage(), params);
}
/* 发给渲染进程的配置带 effectiveLanguage（不落盘，只在内存对象上附加） */
function configForRenderer() {
  return { ...config, effectiveLanguage: effectiveLanguage() };
}
/* 语言切换后同步窗口标题与托盘提示 */
function refreshChromeText() {
  if (tray) {
    tray.setToolTip(T(config.mock.stealthMode ? 'app.nameStudy' : 'app.name'));
    updateTrayMenu();
  }
  if (adminWindow && !adminWindow.isDestroyed()) {
    adminWindow.setTitle(T(config.mock.stealthMode ? 'app.adminTitleStudy' : 'app.adminTitle'));
  }
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.setTitle(T('app.settingsTitle'));
  }
}

/* ------------------------------------------------------------------ */
/* 内置后台：一个本地 HTTP 服务，提供设置页面与数据接口                */
/*   GET  /                后台设置页（改参数、立即生效）              */
/*   GET  /api/today       小组件读取的数据                            */
/*   POST /api/update      后台提交参数，写回配置并推送给小组件        */
/* ------------------------------------------------------------------ */

function buildAdminHtml(port) {
  const m = config.mock;
  const lang = effectiveLanguage();
  const paydayDay = (m.paydayDay != null) ? String(m.paydayDay) : '';
  return `<!DOCTYPE html>
<html lang="${lang === 'en' ? 'en' : 'zh-CN'}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${T(m.stealthMode ? 'app.adminTitleStudy' : 'app.adminTitle')}</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif;
    background:#0f1a1d;color:#e8eef0;min-height:100vh;display:flex;align-items:flex-start;justify-content:center;padding:24px;
    overflow-y:auto}
  .wrap{width:100%;max-width:460px;background:#1b2629;border:1px solid rgba(45,212,191,.18);border-radius:16px;
    padding:26px;box-shadow:0 18px 60px rgba(0,0,0,.45)}
  h1{font-size:17px;color:#2dd4bf;margin-bottom:4px;display:flex;align-items:center;gap:8px}
  .sub{font-size:12px;color:#5a6b6f;margin-bottom:18px}
  .dot{width:8px;height:8px;border-radius:50%;background:#2dd4bf;box-shadow:0 0 10px #2dd4bf}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}
  .fg{margin-bottom:14px}
  label{display:block;font-size:12px;color:#9aa9ad;margin-bottom:6px}
  .hint{font-size:11px;color:#5a6b6f;margin-top:4px}
  input{width:100%;padding:9px 11px;border-radius:9px;border:1px solid rgba(255,255,255,.1);
    background:#243034;color:#e8eef0;font-size:13px;outline:none;transition:.15s}
  input:focus{border-color:#2dd4bf;box-shadow:0 0 0 3px rgba(45,212,191,.12)}
  .actions{display:flex;gap:10px;margin-top:20px}
  button{flex:1;padding:10px;border-radius:9px;border:none;cursor:pointer;font-size:13px;font-weight:600}
  .primary{background:#2dd4bf;color:#0b2320}
  .primary:hover{background:#5eead4}
  .ghost{background:rgba(255,255,255,.08);color:#c5d0d3;flex:0 0 110px}
  .ghost:hover{background:rgba(255,255,255,.14)}
  .bar{height:8px;border-radius:99px;background:rgba(255,255,255,.09);overflow:hidden;margin-top:6px}
  .bar>i{display:block;height:100%;width:0;background:linear-gradient(90deg,#2dd4bf,#5eead4);transition:width .3s}
  .preview{background:#243034;border:1px solid rgba(45,212,191,.18);border-radius:12px;padding:14px 16px;margin:4px 0 16px}
  .pv-label{font-size:11px;color:#9aa9ad}
  .pv-val{font-size:24px;color:#2dd4bf;font-weight:700;margin:2px 0 8px;font-variant-numeric:tabular-nums}
  .pv-row{display:flex;justify-content:space-between;font-size:12px;color:#c5d0d3;margin-bottom:6px}
  .pv-row b{color:#2dd4bf;font-variant-numeric:tabular-nums}
  .mode{border:1px solid rgba(255,255,255,.1);border-radius:12px;background:#243034;padding:14px 16px;margin:2px 0 18px}
  .mode-title{font-size:14px;font-weight:700;color:#e8eef0;margin-bottom:6px}
  .mode-desc{font-size:12px;color:#5a6b6f;line-height:1.6;margin-bottom:12px}
  .mode-actions{display:flex;gap:10px}
  .mode-btn{flex:0 0 96px;padding:8px 0;border-radius:9px;background:transparent;border:1px solid rgba(255,255,255,.16);
    color:#9aa9ad;font-size:13px;font-weight:600;cursor:pointer;transition:.15s}
  .mode-btn:hover{background:rgba(255,255,255,.06);color:#c5d0d3}
  .mode-btn.active{border-color:#2dd4bf;color:#2dd4bf;background:rgba(45,212,191,.1)}
  .foot{margin-top:16px;padding-top:14px;border-top:1px solid rgba(255,255,255,.07);font-size:11px;color:#5a6b6f;line-height:1.7}
  .foot code{color:#2dd4bf;font-family:Consolas,monospace}
  .toast{position:fixed;top:22px;left:50%;transform:translate(-50%,-70px);background:#2dd4bf;color:#0b2320;
    padding:9px 20px;border-radius:99px;font-size:13px;font-weight:600;transition:.3s;opacity:0}
  .toast.on{transform:translate(-50%,0);opacity:1}
</style>
</head>
<body>
<div class="wrap">
  <h1><span class="dot"></span><span id="pageTitle">${T(m.stealthMode ? 'app.adminTitleStudy' : 'app.adminTitle')}</span></h1>
  <div class="sub" id="pageSub">${T(m.stealthMode ? 'admin.subStudy' : 'admin.subMoyu')}</div>

  <div class="mode" style="margin-top:2px">
    <div class="mode-title">${T('admin.language')}</div>
    <div class="mode-desc">${T('admin.languageHint')}</div>
    <div class="mode-actions" id="langActions">
      <button type="button" class="mode-btn" data-lang="auto" onclick="setLanguage('auto')">${T('settings.languageAuto')}</button>
      <button type="button" class="mode-btn" data-lang="zh" onclick="setLanguage('zh')">简体中文</button>
      <button type="button" class="mode-btn" data-lang="en" onclick="setLanguage('en')">English</button>
    </div>
  </div>

  <div class="grid">
    <div class="fg">
      <label>${T('admin.payday')}</label>
      <input type="number" id="paydayDay" min="1" max="31" step="1" value="${paydayDay}">
    </div>
    <div class="fg">
      <label>${T('admin.status')}</label>
      <input type="text" id="status" value="${pickText(m.status, 'widget.statusMoyu', lang)}">
    </div>
  </div>

  <div class="fg">
    <label>${T('admin.studyStatus')}</label>
    <input type="text" id="studyStatus" value="${pickText(m.studyStatus, 'widget.statusStudy', lang)}">
  </div>

  <div class="grid">
    <div class="fg">
      <label>${T('admin.titleMoyu')}</label>
      <input type="text" id="titleMoyu" value="${pickText(m.titleMoyu, 'widget.titleMoyu', lang)}">
    </div>
    <div class="fg">
      <label>${T('admin.titleStudy')}</label>
      <input type="text" id="titleStudy" value="${pickText(m.titleStudy, 'widget.titleStudy', lang)}">
    </div>
  </div>

  <div class="grid">
    <div class="fg">
      <label>${T('admin.salary')}</label>
      <input type="number" id="monthlySalary" step="100" value="${m.monthlySalary ?? 15000}">
    </div>
    <div class="fg">
      <label>${T('admin.workDays')}</label>
      <input type="number" id="workDaysPerMonth" step="0.25" value="${m.workDaysPerMonth ?? 21.75}">
      <div class="hint">${T('admin.workDaysHint')}</div>
    </div>
  </div>

  <div class="grid">
    <div class="fg">
      <label>${T('admin.workStart')}</label>
      <input type="time" id="workStartTime" step="60" value="${m.workStartTime || '08:00'}">
      <div class="hint">${T('admin.timeExample')}</div>
    </div>
    <div class="fg">
      <label>${T('admin.workEnd')}</label>
      <input type="time" id="workEndTime" step="60" value="${m.workEndTime || '18:00'}">
      <div class="hint">${T('admin.timeExample')}</div>
    </div>
  </div>

  <div class="grid">
    <div class="fg">
      <label>${T('admin.breakStart')}</label>
      <input type="time" id="breakStartTime" step="60" value="${m.breakStartTime || ''}">
      <div class="hint">${T('admin.breakEmpty')}</div>
    </div>
    <div class="fg">
      <label>${T('admin.breakEnd')}</label>
      <input type="time" id="breakEndTime" step="60" value="${m.breakEndTime || ''}">
      <div class="hint">${T('admin.dailyHoursHint')}</div>
    </div>
  </div>

  <div class="mode">
    <div class="mode-title">${T('admin.stealth')}</div>
    <div class="mode-desc">${T('admin.stealthDesc')}</div>
    <div class="mode-actions" id="stealthActions">
      <button type="button" class="mode-btn" data-mode="off" onclick="setMode(false)">${T('admin.off')}</button>
      <button type="button" class="mode-btn" data-mode="on" onclick="setMode(true)">${T('admin.on')}</button>
    </div>
  </div>

  <div class="preview">
    <div class="pv-label" id="liveLabel">${T('admin.liveLabel')}</div>
    <div class="pv-val" id="liveIncome">¥0.00</div>
    <div class="pv-row"><span>${T('admin.progress')}</span><b id="liveProgress">0%</b></div>
    <div class="bar"><i id="liveBar" style="width:0%"></i></div>
    <div class="hint" style="margin-top:8px" id="ratesLine">${translate('admin.rates', lang, { hours: '0', hourly: '0', perSec: '0' })}</div>
  </div>

  <div class="actions">
    <button class="ghost" onclick="load()">${T('admin.reload')}</button>
    <button class="primary" onclick="save()">${T('admin.save')}</button>
  </div>

  <div class="foot">
    ${T('admin.apiLine')}<code>http://127.0.0.1:${port}/api/today</code><br>
    ${T('admin.footHint')}
  </div>
</div>
<div class="toast" id="toast">${T('admin.toastSaved')}</div>

<script>
  const $ = id => document.getElementById(id);

  /* —— i18n：文案表由主进程注入；切换语言后整页刷新，保证文案一致 —— */
  const I18N = ${JSON.stringify(i18nDict)};
  const LANG = ${JSON.stringify(lang)};
  function tr(key, params) {
    const table = I18N[LANG] || I18N.zh;
    let text = (table && table[key] != null) ? table[key]
      : (I18N.zh && I18N.zh[key] != null ? I18N.zh[key] : key);
    if (params) text = text.replace(/\\{(\\w+)\\}/g, (m, k) =>
      Object.prototype.hasOwnProperty.call(params, k) ? String(params[k]) : m);
    return text;
  }

  function markLanguage(selected) {
    const value = String(selected || 'auto').toLowerCase();
    for (const b of document.querySelectorAll('#langActions .mode-btn')) {
      b.classList.toggle('active', b.dataset.lang === value);
    }
  }

  async function setLanguage(value) {
    try {
      const r = await fetch('/api/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ language: value })
      });
      if (r.ok) location.reload();
      else toast(tr('admin.toastSaveFailed'));
    } catch (e) { toast(tr('admin.toastSaveFailed')); }
  }

  /* —— 偷偷摸摸：开启后界面文案切换为学习风格 —— */
  const titleFor = on => tr(on ? 'app.adminTitleStudy' : 'app.adminTitle');
  let stealth = ${m.stealthMode ? 'true' : 'false'};

  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.add('on');
    setTimeout(() => t.classList.remove('on'), 1600);
  }

  function applyMode(on) {
    stealth = !!on;
    document.querySelectorAll('#stealthActions .mode-btn').forEach(b =>
      b.classList.toggle('active', (b.dataset.mode === 'on') === stealth));
    document.title = titleFor(stealth);
    $('pageTitle').textContent = titleFor(stealth);
    $('pageSub').textContent = tr(stealth ? 'admin.subStudy' : 'admin.subMoyu');
    $('liveLabel').textContent = tr(stealth ? 'admin.liveLabelStudy' : 'admin.liveLabel');
    updatePreview();
  }

  async function setMode(on) {
    applyMode(on);
    try {
      await fetch('/api/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stealthMode: !!on })
      });
      toast(tr(on ? 'admin.toastModeOn' : 'admin.toastModeOff'));
    } catch (e) { toast(tr('admin.toastSaveFailed')); }
  }

  function toMin(v) {
    if (!v) return null;
    const m = /^(\\d{1,2}):(\\d{2})$/.exec(String(v).trim());
    if (!m) return null;
    const h = parseInt(m[1], 10), mi = parseInt(m[2], 10);
    if (h > 24 || mi > 59) return null;
    return h * 60 + mi;
  }

  function updatePreview() {
    const salary = parseFloat($('monthlySalary').value) || 0;
    const wd = parseFloat($('workDaysPerMonth').value) || 21.75;
    const sm = toMin($('workStartTime').value);
    const em = toMin($('workEndTime').value);
    const spanMin = (sm != null && em != null && em > sm) ? (em - sm) : 0;
    // 午休必须完整落在班次内才算数
    let bs = toMin($('breakStartTime').value);
    let be = toMin($('breakEndTime').value);
    if (!(bs != null && be != null && be > bs && bs >= sm && be <= em)) { bs = null; be = null; }
    const breakMin = (bs != null && be != null) ? (be - bs) : 0;
    const effectiveMin = spanMin - breakMin;      // 扣除午休后的计薪工时
    if (!(salary > 0 && effectiveMin > 0)) {
      $('liveIncome').textContent = stealth ? ('—' + tr('widget.studyUnit')) : '¥—';
      $('liveProgress').textContent = '—%';
      $('liveBar').style.width = '0%';
      $('ratesLine').innerHTML = tr('admin.rates', { hours: '—', hourly: '—', perSec: '—' });
      return;
    }
    const dailyHours = effectiveMin / 60;
    const effectiveSec = effectiveMin * 60;
    const perSec = (salary / wd) / effectiveSec;
    const now = new Date();
    const base = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0).getTime();
    const startMs = base + sm * 60 * 1000;
    const endMs = base + em * 60 * 1000;
    const elapsedMs = Math.max(0, Math.min(now.getTime() - startMs, spanMin * 60 * 1000));
    let pausedMs = 0;
    if (breakMin > 0) {
      pausedMs = Math.max(0, Math.min(now.getTime(), base + be * 60 * 1000) - (base + bs * 60 * 1000));
      pausedMs = Math.min(pausedMs, elapsedMs);
    }
    const workedSec = Math.max(0, (elapsedMs - pausedMs) / 1000);
    const income = perSec * workedSec;
    const prog = workedSec / effectiveSec * 100;
    $('liveIncome').textContent = (stealth ? '' : '¥')
      + income.toLocaleString(LANG === 'en' ? 'en-US' : 'zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      + (stealth ? tr('widget.studyUnit') : '');
    $('liveProgress').textContent = prog.toFixed(1) + '%';
    $('liveBar').style.width = Math.min(100, prog) + '%';
    $('ratesLine').innerHTML = tr('admin.rates', {
      hours: dailyHours.toFixed(2),
      hourly: ((salary / wd) / dailyHours).toFixed(2),
      perSec: perSec.toFixed(4)
    });
  }

  async function load() {
    const r = await fetch('/api/today', { cache: 'no-store' });
    const s = await r.json();
    $('monthlySalary').value = s.monthlySalary ?? 15000;
    $('workDaysPerMonth').value = s.workDaysPerMonth ?? 21.75;
    $('workStartTime').value = s.workStartTime || '08:00';
    $('workEndTime').value = s.workEndTime || '18:00';
    $('breakStartTime').value = s.breakStartTime || '';
    $('breakEndTime').value = s.breakEndTime || '';
    $('status').value = s.status ?? tr('widget.statusMoyu');
    $('studyStatus').value = s.studyStatus ?? tr('widget.statusStudy');
    $('titleMoyu').value = s.titleMoyu ?? tr('widget.titleMoyu');
    $('titleStudy').value = s.titleStudy ?? tr('widget.titleStudy');
    $('paydayDay').value = (s.paydayDay != null) ? s.paydayDay : '';
    applyMode(s.stealthMode);
  }

  async function save() {
    const rawDay = $('paydayDay').value ? parseInt($('paydayDay').value, 10) : null;
    const payload = {
      monthlySalary: parseFloat($('monthlySalary').value) || 0,
      workDaysPerMonth: parseFloat($('workDaysPerMonth').value) || 21.75,
      workStartTime: $('workStartTime').value || '08:00',
      workEndTime: $('workEndTime').value || '18:00',
      breakStartTime: $('breakStartTime').value || '',
      breakEndTime: $('breakEndTime').value || '',
      status: $('status').value || tr('widget.statusMoyu'),
      studyStatus: $('studyStatus').value || tr('widget.statusStudy'),
      titleMoyu: $('titleMoyu').value || tr('widget.titleMoyu'),
      titleStudy: $('titleStudy').value || tr('widget.titleStudy'),
      stealthMode: stealth,
      paydayDay: (rawDay != null && rawDay >= 1 && rawDay <= 31) ? rawDay : null
    };
    const r = await fetch('/api/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (r.ok) { toast(tr('admin.toastSaved')); load(); }
    else { toast(tr('admin.toastSaveFailed')); }
  }

  ['monthlySalary','workDaysPerMonth','workStartTime','workEndTime','breakStartTime','breakEndTime'].forEach(id =>
    $(id).addEventListener('input', updatePreview));

  // 实时预览每秒刷新；仅在页面未聚焦时从服务端同步，避免打断输入
  markLanguage(${JSON.stringify(normalizeLanguage(config.language))});  // 标记当前语言
  applyMode(stealth);            // 首屏立刻按当前模式套用文案与按钮态，不等 5 秒轮询
  setInterval(updatePreview, 1000);
  setInterval(() => { if (!document.hasFocus()) load(); }, 5000);
</script>
</body>
</html>`;
}

/* 由「月薪 + 班次（上班→下班，扣除午休）」按当前时间实时计算今日收入与进度
   每天工时 = 下班 − 上班 − 午休；收入从上班起按秒累计，午休期间暂停，到下班封顶 */
function computeTodayState(nowDate) { return computeState(config.mock, nowDate, effectiveLanguage()); }

function handleLocalRequest(req, res) {
  const reqUrl = new URL(req.url, `http://127.0.0.1:${localPort}`);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  if (reqUrl.pathname === '/api/today') {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    // 附带当前语言，方便后台页等外部使用方跟随
    res.end(JSON.stringify({ ...computeTodayState(), language: effectiveLanguage() }));
    return;
  }

  if (reqUrl.pathname === '/api/update' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body || '{}');
        // language 是顶层字段，不进 mock
        const { language: langPatch, ...mockPatch } = payload;
        const nextLang = normalizeLanguage(langPatch ?? config.language);
        validateTimes(mockPatch, nextLang === 'auto' ? effectiveLanguage() : nextLang);
        config.mock = Object.assign({}, config.mock, mockPatch);
        const languageChanged = nextLang !== config.language;
        config.language = nextLang;
        saveConfig(config);
        updateTrayMenu();
        if (languageChanged) refreshChromeText();
        // 立即通知小组件刷新（config-changed 会带上 effectiveLanguage，语言/皮肤都能即时跟随）
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('config-changed', configForRenderer());
        }
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ ok: true, state: config.mock, language: config.language, effectiveLanguage: effectiveLanguage() }));
      } catch (e) {
        res.statusCode = 400;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    });
    return;
  }

  if (reqUrl.pathname === '/' || reqUrl.pathname === '/admin') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(buildAdminHtml(localPort));
    return;
  }

  res.statusCode = 404;
  res.end('Not found');
}

function startLocalServer(startPort = 3456) {
  return new Promise((resolve) => {
    let port = startPort;
    const attempt = () => {
      const server = http.createServer(handleLocalRequest);
      server.once('error', (err) => {
        if (err.code === 'EADDRINUSE' && port < startPort + 20) {
          port += 1;
          attempt();
        } else {
          log('内置后台启动失败: ' + err.message);
          resolve(null);
        }
      });
      server.listen(port, '127.0.0.1', () => {
        localPort = port;
        localServer = server;
        log('内置后台已启动: http://127.0.0.1:' + port + '/');
        resolve(server);
      });
    };
    attempt();
  });
}

/* 后台设置：以程序自身的窗口打开（不再调起浏览器） */
function openAdmin() {
  if (!localPort) {
    log('openAdmin 失败：内置服务未启动');
    return;
  }
  if (adminWindow && !adminWindow.isDestroyed()) {
    adminWindow.show();
    adminWindow.focus();
    return;
  }
  adminWindow = new BrowserWindow({
    width: 520,
    height: 920,
    minWidth: 460,
    minHeight: 620,
    title: T(config.mock.stealthMode ? 'app.adminTitleStudy' : 'app.adminTitle'),
    frame: true,
    resizable: true,
    maximizable: false,
    autoHideMenuBar: true,
    backgroundColor: '#0f1a1d',
    icon: path.join(__dirname, 'icon.ico'),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  adminWindow.setMenuBarVisibility(false);
  adminWindow.loadURL(`http://127.0.0.1:${localPort}/`);
  adminWindow.webContents.on('did-fail-load', (e, code, desc) => log('admin window FAILED: ' + code + ' ' + desc));
  adminWindow.on('closed', () => { adminWindow = null; });
}

/* ------------------------------------------------------------------ */

function createWindow() {
  const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize;
  const x = config.x ?? (sw - config.width - 20);
  const y = config.y ?? (sh - config.height - 60);
  log('createWindow x=' + x + ' y=' + y + ' display=' + sw + 'x' + sh);

  mainWindow = new BrowserWindow({
    width: config.width,
    height: config.height,
    minWidth: MIN_WIDGET_WIDTH,
    minHeight: MIN_WIDGET_HEIGHT,
    x,
    y,
    frame: false,
    resizable: true,        // 允许拖动窗口边缘自由缩放
    transparent: true,
    hasShadow: false,
    alwaysOnTop: config.alwaysOnTop,
    skipTaskbar: true,
    show: false,
    icon: path.join(__dirname, 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  mainWindow.webContents.on('did-finish-load', () => log('index.html loaded'));
  mainWindow.webContents.on('did-fail-load', (e, code, desc) => log('index.html FAILED: ' + code + ' ' + desc));

  mainWindow.once('ready-to-show', () => {
    log('ready-to-show, showing window');
    mainWindow.show();
  });

  mainWindow.on('closed', () => {
    log('mainWindow closed');
    mainWindow = null;
  });

  // 拖动后记住位置
  mainWindow.on('moved', () => {
    const [x, y] = mainWindow.getPosition();
    config.x = x;
    config.y = y;
    saveConfig(config);
  });

  // 缩放后记住尺寸（节流写入，避免拖拽过程中频繁落盘）
  let resizeSaveTimer = null;
  mainWindow.on('resized', () => {
    clearTimeout(resizeSaveTimer);
    resizeSaveTimer = setTimeout(() => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      const [w, hgt] = mainWindow.getSize();
      config.width = w;
      config.height = hgt;
      saveConfig(config);
    }, 400);
  });
}

function createTray() {
  const trayIcon = path.join(__dirname, 'tray.png');
  tray = new Tray(trayIcon);
  tray.setToolTip(T(config.mock.stealthMode ? 'app.nameStudy' : 'app.name'));
  updateTrayMenu();
  tray.on('click', () => {
    if (mainWindow) {
      mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show();
    }
  });
}

function updateTrayMenu() {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: T(config.mock.stealthMode ? 'tray.openAdminStudy' : 'tray.openAdmin'), click: openAdmin },
    { label: T(config.mock.stealthMode ? 'tray.openSettingsStudy' : 'tray.openSettings'), click: openSettings },
    { type: 'separator' },
    { label: T('menu.refresh'), click: () => mainWindow?.webContents.send('refresh-data') },
    { label: T(config.alwaysOnTop ? 'menu.unpin' : 'menu.pin'), click: () => {
      config.alwaysOnTop = !config.alwaysOnTop;
      saveConfig(config);
      if (mainWindow) {
        mainWindow.setAlwaysOnTop(config.alwaysOnTop);
      }
      updateTrayMenu();
    }},
    { type: 'separator' },
    { label: T('menu.quit'), click: () => app.quit() }
  ]));
}

function openSettings() {
  if (settingsWindow) {
    settingsWindow.focus();
    return;
  }
  settingsWindow = new BrowserWindow({
    width: 480,
    height: 800,
    frame: true,
    resizable: false,
    modal: false,
    parent: mainWindow || undefined,
    title: T('app.settingsTitle'),
    autoHideMenuBar: true,
    backgroundColor: '#1b2629',
    icon: path.join(__dirname, 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  settingsWindow.loadFile(path.join(__dirname, 'settings.html'));
  settingsWindow.on('closed', () => { settingsWindow = null; });
}

// IPC 通信
ipcMain.handle('get-config', () => configForRenderer());
ipcMain.handle('set-config', (event, newConfig) => {
  if (newConfig.mock) validateTimes(newConfig.mock, effectiveLanguage());
  const mock = newConfig.mock ? Object.assign({}, config.mock, newConfig.mock) : config.mock;
  // effectiveLanguage 只是主进程附加的展示字段，不允许写回配置
  const { effectiveLanguage: _displayOnly, ...patch } = newConfig || {};
  const nextConfig = {
    ...config,
    ...patch,
    mock,
    theme: normalizeTheme(patch.theme ?? config.theme),
    language: normalizeLanguage(patch.language ?? config.language)
  };
  if (!saveConfig(nextConfig)) throw new Error('设置保存失败，请检查配置目录是否可写');
  const languageChanged = nextConfig.language !== config.language;
  config = nextConfig;
  if (mainWindow) {
    mainWindow.setAlwaysOnTop(config.alwaysOnTop);
    mainWindow.setOpacity(config.opacity);
    mainWindow.webContents.send('config-changed', configForRenderer());
  }
  updateTrayMenu();
  if (languageChanged) refreshChromeText();
  return configForRenderer();
});
ipcMain.handle('open-settings', () => { openSettings(); return true; });
ipcMain.handle('open-admin', () => { openAdmin(); return `http://127.0.0.1:${localPort}/`; });
ipcMain.handle('get-admin-url', () => `http://127.0.0.1:${localPort}/`);
ipcMain.handle('quit-app', () => { app.quit(); return true; });
ipcMain.handle('show-context-menu', () => {
  if (!tray) return;
  tray.popUpContextMenu();
});

// 在主进程发起请求，绕过 CORS 限制，便于抓取私有接口
ipcMain.handle('fetch-api-data', async (event, { url, headers }) => {
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        ...headers
      }
    });
    const contentType = res.headers.get('content-type') || '';
    let body;
    if (contentType.includes('application/json')) {
      body = await res.json();
    } else {
      body = await res.text();
    }
    return {
      ok: res.ok,
      status: res.status,
      statusText: res.statusText,
      contentType,
      body
    };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

app.whenReady().then(async () => {
  log('whenReady');
  await startLocalServer();

  // 未单独配置远端接口时，默认指向内置后台，做到开箱即用
  const isLocal = !config.apiUrl || /^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(config.apiUrl);
  if (isLocal && localPort) {
    config.apiUrl = `http://127.0.0.1:${localPort}/api/today`;
    if (config.dataSource !== 'api') config.dataSource = 'api';
    saveConfig(config);
  }
  log('apiUrl=' + config.apiUrl + ' dataSource=' + config.dataSource);

  createWindow();
  createTray();
  log('window+tray ready');

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  log('window-all-closed fired');
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  if (localServer) {
    try { localServer.close(); } catch (e) { /* ignore */ }
  }
});
