const { app, BrowserWindow, Tray, Menu, ipcMain, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const { normalize: normalizeTheme } = require('./themes');

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

/* ------------------------------------------------------------------ */
/* 内置后台：一个本地 HTTP 服务，提供设置页面与数据接口                */
/*   GET  /                后台设置页（改参数、立即生效）              */
/*   GET  /api/today       小组件读取的数据                            */
/*   POST /api/update      后台提交参数，写回配置并推送给小组件        */
/* ------------------------------------------------------------------ */

function buildAdminHtml(port) {
  const m = config.mock;
  const paydayDay = (m.paydayDay != null) ? String(m.paydayDay) : '';
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${m.stealthMode ? '学习进度' : '搬砖收入'} · 后台设置</title>
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
  <h1><span class="dot"></span><span id="pageTitle">${m.stealthMode ? '学习进度' : '搬砖收入'} · 后台设置</span></h1>
  <div class="sub" id="pageSub">${m.stealthMode
    ? '「偷偷摸摸」已开启：小组件文案显示为学习风格（今日学习进度 · 学习中 · 距月考还有）'
    : '每天工时 = 下班 − 上班 − 午休；今日收入从上班起按秒累计，午休暂停，到下班封顶'}</div>

  <div class="grid">
    <div class="fg">
      <label>每月发薪日 / 月考日（号，1-31）</label>
      <input type="number" id="paydayDay" min="1" max="31" step="1" value="${paydayDay}">
    </div>
    <div class="fg">
      <label>状态文字（搬砖）</label>
      <input type="text" id="status" value="${m.status ?? '搬砖中'}">
    </div>
  </div>

  <div class="fg">
    <label>状态文字（学习模式）</label>
    <input type="text" id="studyStatus" value="${m.studyStatus ?? '学习中'}">
  </div>

  <div class="grid">
    <div class="fg">
      <label>主标题（搬砖模式）</label>
      <input type="text" id="titleMoyu" value="${m.titleMoyu ?? '今日搬砖收入'}">
    </div>
    <div class="fg">
      <label>主标题（学习模式）</label>
      <input type="text" id="titleStudy" value="${m.titleStudy ?? '今日学习进度'}">
    </div>
  </div>

  <div class="grid">
    <div class="fg">
      <label>月薪（元）</label>
      <input type="number" id="monthlySalary" step="100" value="${m.monthlySalary ?? 15000}">
    </div>
    <div class="fg">
      <label>月工作天数</label>
      <input type="number" id="workDaysPerMonth" step="0.25" value="${m.workDaysPerMonth ?? 21.75}">
      <div class="hint">计薪基数，默认 21.75</div>
    </div>
  </div>

  <div class="grid">
    <div class="fg">
      <label>上班时刻（24 小时制）</label>
      <input type="time" id="workStartTime" step="60" value="${m.workStartTime || '08:00'}">
      <div class="hint">例：08:00</div>
    </div>
    <div class="fg">
      <label>下班时刻（24 小时制）</label>
      <input type="time" id="workEndTime" step="60" value="${m.workEndTime || '18:00'}">
      <div class="hint">例：18:00</div>
    </div>
  </div>

  <div class="grid">
    <div class="fg">
      <label>午休开始（24 小时制）</label>
      <input type="time" id="breakStartTime" step="60" value="${m.breakStartTime || ''}">
      <div class="hint">留空 = 不扣午休</div>
    </div>
    <div class="fg">
      <label>午休结束（24 小时制）</label>
      <input type="time" id="breakEndTime" step="60" value="${m.breakEndTime || ''}">
      <div class="hint">每天工时 = 下班 − 上班 − 午休</div>
    </div>
  </div>

  <div class="mode">
    <div class="mode-title">偷偷摸摸</div>
    <div class="mode-desc">开启后界面文案切换为学习风格，降低划水观感</div>
    <div class="mode-actions">
      <button type="button" class="mode-btn" data-mode="off" onclick="setMode(false)">关闭</button>
      <button type="button" class="mode-btn" data-mode="on" onclick="setMode(true)">开启</button>
    </div>
  </div>

  <div class="preview">
    <div class="pv-label" id="liveLabel">今日实时收入</div>
    <div class="pv-val" id="liveIncome">¥0.00</div>
    <div class="pv-row"><span>今日进度</span><b id="liveProgress">0%</b></div>
    <div class="bar"><i id="liveBar" style="width:0%"></i></div>
    <div class="hint" style="margin-top:8px">计薪工时 <span id="liveHours">0</span>h · 时薪 ¥<span id="liveHourly">0</span> · 每秒 ¥<span id="livePerSec">0</span></div>
  </div>

  <div class="actions">
    <button class="ghost" onclick="load()">重新读取</button>
    <button class="primary" onclick="save()">保存并推送</button>
  </div>

  <div class="foot">
    小组件接口：<code>http://127.0.0.1:${port}/api/today</code><br>
    关闭本窗口不影响小组件运行，可从托盘或右键菜单再次打开。
  </div>
</div>
<div class="toast" id="toast">已保存，小组件即将刷新</div>

<script>
  const $ = id => document.getElementById(id);

  /* —— 偷偷摸摸：开启后界面文案切换为学习风格 —— */
  const STUDY_TITLE = '学习进度 · 后台设置';
  const MOYU_TITLE = '搬砖收入 · 后台设置';
  let stealth = ${m.stealthMode ? 'true' : 'false'};

  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.add('on');
    setTimeout(() => t.classList.remove('on'), 1600);
  }

  function applyMode(on) {
    stealth = !!on;
    document.querySelectorAll('.mode-btn').forEach(b =>
      b.classList.toggle('active', (b.dataset.mode === 'on') === stealth));
    document.title = stealth ? STUDY_TITLE : MOYU_TITLE;
    $('pageTitle').textContent = stealth ? STUDY_TITLE : MOYU_TITLE;
    $('pageSub').textContent = stealth
      ? '「偷偷摸摸」已开启：小组件文案显示为学习风格（今日学习进度 · 学习中 · 距月考还有）'
      : '每天工时 = 下班 − 上班 − 午休；今日收入从上班起按秒累计，午休暂停，到下班封顶';
    $('liveLabel').textContent = stealth ? '今日实时学习时长' : '今日实时收入';
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
      toast(on ? '已切换到学习模式' : '已切换到搬砖模式');
    } catch (e) { toast('保存失败'); }
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
      $('liveIncome').textContent = stealth ? '— 分' : '¥—';
      $('liveProgress').textContent = '—%';
      $('liveBar').style.width = '0%';
      $('liveHours').textContent = '—';
      $('liveHourly').textContent = '—';
      $('livePerSec').textContent = '—';
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
      + income.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      + (stealth ? ' 分' : '');
    $('liveProgress').textContent = prog.toFixed(1) + '%';
    $('liveBar').style.width = Math.min(100, prog) + '%';
    $('liveHours').textContent = dailyHours.toFixed(2);
    $('liveHourly').textContent = ((salary / wd) / dailyHours).toFixed(2);
    $('livePerSec').textContent = perSec.toFixed(4);
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
    $('status').value = s.status ?? '搬砖中';
    $('studyStatus').value = s.studyStatus ?? '学习中';
    $('titleMoyu').value = s.titleMoyu ?? '今日搬砖收入';
    $('titleStudy').value = s.titleStudy ?? '今日学习进度';
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
      status: $('status').value || '搬砖中',
      studyStatus: $('studyStatus').value || '学习中',
      titleMoyu: $('titleMoyu').value || '今日搬砖收入',
      titleStudy: $('titleStudy').value || '今日学习进度',
      stealthMode: stealth,
      paydayDay: (rawDay != null && rawDay >= 1 && rawDay <= 31) ? rawDay : null
    };
    const r = await fetch('/api/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (r.ok) { toast('已保存，小组件即将刷新'); load(); }
    else { toast('保存失败'); }
  }

  ['monthlySalary','workDaysPerMonth','workStartTime','workEndTime','breakStartTime','breakEndTime'].forEach(id =>
    $(id).addEventListener('input', updatePreview));

  // 实时预览每秒刷新；仅在页面未聚焦时从服务端同步，避免打断输入
  applyMode(stealth);            // 首屏立刻按当前模式套用文案与按钮态，不等 5 秒轮询
  setInterval(updatePreview, 1000);
  setInterval(() => { if (!document.hasFocus()) load(); }, 5000);
</script>
</body>
</html>`;
}

/* 由「月薪 + 班次（上班→下班，扣除午休）」按当前时间实时计算今日收入与进度
   每天工时 = 下班 − 上班 − 午休；收入从上班起按秒累计，午休期间暂停，到下班封顶 */
function computeTodayState(nowDate) { return computeState(config.mock, nowDate); }

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
    res.end(JSON.stringify(computeTodayState()));
    return;
  }

  if (reqUrl.pathname === '/api/update' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body || '{}');
        validateTimes(payload);
        config.mock = Object.assign({}, config.mock, payload);
        saveConfig(config);
        updateTrayMenu();
        // 立即通知小组件刷新，无需等待轮询
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('refresh-data');
        }
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ ok: true, state: config.mock }));
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
    title: (config.mock.stealthMode ? '学习进度' : '搬砖收入') + ' · 后台设置',
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
  tray.setToolTip(config.mock.stealthMode ? '学习进度小组件' : '搬砖收入小组件');
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
    { label: config.mock.stealthMode ? '打开学习设置' : '打开后台设置', click: openAdmin },
    { label: config.mock.stealthMode ? '学习小组件偏好' : '小组件偏好设置', click: openSettings },
    { type: 'separator' },
    { label: '刷新数据', click: () => mainWindow?.webContents.send('refresh-data') },
    { label: config.alwaysOnTop ? '取消置顶' : '置顶', click: () => {
      config.alwaysOnTop = !config.alwaysOnTop;
      saveConfig(config);
      if (mainWindow) {
        mainWindow.setAlwaysOnTop(config.alwaysOnTop);
      }
      updateTrayMenu();
    }},
    { type: 'separator' },
    { label: '退出', click: () => app.quit() }
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
    title: '小组件偏好设置',
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
ipcMain.handle('get-config', () => config);
ipcMain.handle('set-config', (event, newConfig) => {
  if (newConfig.mock) validateTimes(newConfig.mock);
  const mock = newConfig.mock ? Object.assign({}, config.mock, newConfig.mock) : config.mock;
  const nextConfig = { ...config, ...newConfig, mock, theme: normalizeTheme(newConfig.theme ?? config.theme) };
  if (!saveConfig(nextConfig)) throw new Error('设置保存失败，请检查配置目录是否可写');
  config = nextConfig;
  if (mainWindow) {
    mainWindow.setAlwaysOnTop(config.alwaysOnTop);
    mainWindow.setOpacity(config.opacity);
    mainWindow.webContents.send('config-changed', config);
  }
  updateTrayMenu();
  return config;
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
