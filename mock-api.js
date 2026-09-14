const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = 3456;
const stateFile = path.join(__dirname, '.momoyu-mock-state.json');

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  } catch (e) {
    return {
      stealthMode: true,
      monthlySalary: 15000,
      workDaysPerMonth: 21.75,
      workStartTime: '08:00',
      workEndTime: '18:00',
      breakStartTime: '12:00',
      breakEndTime: '13:00',
      status: '搬砖中',
      paydayDay: 15
    };
  }
}

function saveState(state) {
  fs.writeFileSync(stateFile, JSON.stringify(state, null, 2), 'utf8');
}

let state = loadState();

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

function toHm(mins) {
  const total = ((Math.round(mins) % 1440) + 1440) % 1440;
  return String(Math.floor(total / 60)).padStart(2, '0') + ':' + String(total % 60).padStart(2, '0');
}

// 与小组件一致的实时计算逻辑：每天工时 = 下班 − 上班 − 午休
function computeState(now) {
  const salary = Number(state.monthlySalary) || 0;
  const wd = Number(state.workDaysPerMonth) || 21.75;
  const sm = toMinutes(state.workStartTime);
  const em = toMinutes(state.workEndTime);
  const spanMin = (sm !== null && em !== null && em > sm) ? (em - sm) : 0;
  let bs = toMinutes(state.breakStartTime);
  let be = toMinutes(state.breakEndTime);
  if (!(bs !== null && be !== null && be > bs && bs >= sm && be <= em)) { bs = null; be = null; }
  const breakMin = (bs !== null && be !== null) ? (be - bs) : 0;
  const effectiveMin = spanMin - breakMin;
  if (salary > 0 && effectiveMin > 0) {
    const dailyHours = effectiveMin / 60;
    const effectiveSec = effectiveMin * 60;
    const perSec = (salary / wd) / effectiveSec;
    const base = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0).getTime();
    const startMs = base + sm * 60 * 1000;
    const elapsedMs = Math.max(0, Math.min(now.getTime() - startMs, spanMin * 60 * 1000));
    let pausedMs = 0;
    if (breakMin > 0) {
      pausedMs = Math.max(0, Math.min(now.getTime(), base + be * 60 * 1000) - (base + bs * 60 * 1000));
      pausedMs = Math.min(pausedMs, elapsedMs);
    }
    const workedSec = Math.max(0, (elapsedMs - pausedMs) / 1000);
    return {
      income: Number((perSec * workedSec).toFixed(2)),
      progress: Number((workedSec / effectiveSec * 100).toFixed(2)),
      status: state.status || '搬砖中',
      paydayDay: state.paydayDay ?? null,
      monthlySalary: salary,
      workDaysPerMonth: wd,
      workStartTime: toHm(sm),
      workEndTime: toHm(em),
      breakStartTime: bs === null ? '' : toHm(bs),
      breakEndTime: be === null ? '' : toHm(be),
      dailyHours: Number(dailyHours.toFixed(2)),
      hourlyRate: Number((salary / wd / dailyHours).toFixed(2)),
      perSecond: Number(perSec.toFixed(6))
    };
  }
  return {
    income: 0,
    progress: 0,
    stealthMode: !!state.stealthMode,
    status: state.status || '搬砖中',
    studyStatus: state.studyStatus || '学习中',
    paydayDay: state.paydayDay ?? null
  };
}

const adminHtml = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>搬砖收入后台（Mock）</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', sans-serif; background: #1b2629; color: #e8eef0; padding: 24px; }
    h1 { font-size: 18px; margin-bottom: 20px; color: #2dd4bf; }
    .form-group { margin-bottom: 14px; }
    label { display: block; color: #9aa9ad; margin-bottom: 6px; font-size: 13px; }
    input { width: 100%; padding: 8px 10px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.1); background: #243034; color: #e8eef0; }
    button { margin-top: 10px; padding: 8px 18px; border-radius: 8px; border: none; background: #2dd4bf; color: #102a2a; font-weight: 600; cursor: pointer; }
    .url { margin-top: 20px; padding: 12px; background: rgba(255,255,255,0.05); border-radius: 8px; font-family: Consolas, monospace; font-size: 12px; color: #2dd4bf; }
  </style>
</head>
<body>
  <h1>搬砖收入后台设置（Mock）</h1>
  <div class="form-group">
    <label>月薪（元）</label>
    <input type="number" id="monthlySalary" step="100" value="${state.monthlySalary}">
  </div>
  <div class="form-group">
    <label>月工作天数</label>
    <input type="number" id="workDaysPerMonth" step="0.25" value="${state.workDaysPerMonth}">
  </div>
  <div class="form-group">
    <label>上班时刻（24 小时制，例 08:00）</label>
    <input type="time" id="workStartTime" value="${state.workStartTime || '08:00'}">
  </div>
  <div class="form-group">
    <label>下班时刻（24 小时制，例 18:00）</label>
    <input type="time" id="workEndTime" value="${state.workEndTime || '18:00'}">
  </div>
  <div class="form-group">
    <label>午休开始（24 小时制，留空 = 不扣午休）</label>
    <input type="time" id="breakStartTime" value="${state.breakStartTime || ''}">
  </div>
  <div class="form-group">
    <label>午休结束（24 小时制）</label>
    <input type="time" id="breakEndTime" value="${state.breakEndTime || ''}">
  </div>
  <div class="form-group">
    <label>每月发薪日（号，1-31）</label>
    <input type="number" id="paydayDay" min="1" max="31" value="${state.paydayDay ?? ''}">
  </div>
  <div class="form-group">
    <label>状态文字</label>
    <input type="text" id="status" value="${state.status}">
  </div>
  <button onclick="save()">保存并推送</button>
  <div class="url">小组件 API 地址：http://localhost:${PORT}/api/today</div>
  <script>
    let stealth = ${state.stealthMode ? 'true' : 'false'};
    function toggleMode() {
      stealth = !stealth;
      const b = document.getElementById('modeBtn');
      b.textContent = stealth ? '已开启 → 点击关闭' : '已关闭 → 点击开启';
    }
    async function save() {
      const raw = document.getElementById('paydayDay').value ? parseInt(document.getElementById('paydayDay').value, 10) : null;
      const payload = {
        monthlySalary: parseFloat(document.getElementById('monthlySalary').value) || 0,
        workDaysPerMonth: parseFloat(document.getElementById('workDaysPerMonth').value) || 21.75,
        workStartTime: document.getElementById('workStartTime').value || '08:00',
        workEndTime: document.getElementById('workEndTime').value || '18:00',
        breakStartTime: document.getElementById('breakStartTime').value || '',
        breakEndTime: document.getElementById('breakEndTime').value || '',
        status: document.getElementById('status').value,
        studyStatus: document.getElementById('studyStatus').value || '学习中',
        stealthMode: stealth,
        paydayDay: (raw != null && raw >= 1 && raw <= 31) ? raw : null
      };
      await fetch('/api/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      alert('已保存');
    }
  </script>
</body>
</html>`;

const server = http.createServer((req, res) => {
  const parsed = url.parse(req.url, true);
  const setJson = () => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
  };

  if (parsed.pathname === '/api/today') {
    setJson();
    res.end(JSON.stringify(computeState(new Date())));
    return;
  }

  if (parsed.pathname === '/api/update' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const payload = JSON.parse(body);
        state = { ...state, ...payload };
        saveState(state);
      } catch (e) {
        console.error('update error', e);
      }
      setJson();
      res.end(JSON.stringify({ ok: true, state }));
    });
    return;
  }

  if (parsed.pathname === '/') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(adminHtml);
    return;
  }

  res.statusCode = 404;
  res.end('Not found');
});

server.listen(PORT, () => {
  console.log(`Mock API running at http://localhost:${PORT}`);
  console.log(`Admin page: http://localhost:${PORT}/`);
  console.log(`Widget endpoint: http://localhost:${PORT}/api/today`);
});
