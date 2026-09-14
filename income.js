(function (root) {
'use strict';

/* 文案表按需加载：Node 下 require('./i18n')，浏览器下用 window.WidgetI18n。
   加载不到时退化为返回 key，保证算法本身永远可用。 */
let i18nApi = null;
function i18n() {
  if (!i18nApi) {
    try {
      i18nApi = (typeof module === 'object' && module.exports) ? require('./i18n') : root.WidgetI18n;
    } catch (e) {
      i18nApi = root.WidgetI18n || null;
    }
  }
  return i18nApi;
}
/* 未指定语言时（'auto'）取中文，保持与旧版本一致 */
function tr(key, lang, params) {
  const api = i18n();
  return api ? api.t(key, lang, params) : key;
}
function pickText(custom, key, lang) {
  const api = i18n();
  return api ? api.pick(custom, key, lang) : (custom || tr(key, lang));
}

function timeToMinutes(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number' || /^\d+(\.\d+)?$/.test(String(v).trim())) {
    const n = Number(v);
    if (!(n >= 0 && n <= 24)) return null;
    return Math.round(n * 60);
  }
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(v).trim());
  if (!m) return null;
  const h = parseInt(m[1], 10);
  const mi = parseInt(m[2], 10);
  if (h < 0 || h > 24 || mi < 0 || mi > 59 || (h === 24 && mi !== 0)) return null;
  return h * 60 + mi;
}

// 分钟数 → "HH:MM"（24 小时制）
function minutesToTime(mins) {
  if (mins === null || mins === undefined || isNaN(mins)) return '';
  if (Number(mins) === 1440) return '24:00';
  const total = ((Math.round(mins) % 1440) + 1440) % 1440;
  const h = Math.floor(total / 60);
  const mi = total % 60;
  return String(h).padStart(2, '0') + ':' + String(mi).padStart(2, '0');
}

/* 解析当天的班次：班次区间 + 午休区间 + 有效工时（秒）。参数不合法返回 null。
   午休必须完整落在班次内才算数，否则忽略（避免把工时算成负数）。 */
function resolveShift(m) {
  const startMin = timeToMinutes(m.workStartTime);
  const endMin = timeToMinutes(m.workEndTime);
  if (startMin === null || endMin === null || endMin <= startMin) return null;
  const spanSec = (endMin - startMin) * 60;

  let bStart = timeToMinutes(m.breakStartTime);
  let bEnd = timeToMinutes(m.breakEndTime);
  let breakSec = 0;
  if (bStart !== null && bEnd !== null && bEnd > bStart && bStart >= startMin && bEnd <= endMin) {
    breakSec = (bEnd - bStart) * 60;
  } else {
    bStart = null;
    bEnd = null;
  }
  const effectiveSec = spanSec - breakSec; // 每天实际计薪的工作秒数
  if (effectiveSec <= 0) return null;
  return { startMin, endMin, breakStartMin: bStart, breakEndMin: bEnd, spanSec, breakSec, effectiveSec };
}

/* 今日「已有效工作秒数」= 已过班次时间 − 已经过去的午休时间 */
function workedSecondsOf(shift, nowMs, baseMs) {
  const startMs = baseMs + shift.startMin * 60000;
  const elapsedMs = Math.max(0, Math.min(nowMs - startMs, shift.spanSec * 1000));
  let pausedMs = 0;
  if (shift.breakSec > 0) {
    const bStartMs = baseMs + shift.breakStartMin * 60000;
    const bEndMs = baseMs + shift.breakEndMin * 60000;
    pausedMs = Math.max(0, Math.min(nowMs, bEndMs) - bStartMs);
    pausedMs = Math.min(pausedMs, elapsedMs);
  }
  return Math.max(0, (elapsedMs - pausedMs) / 1000);
}

/* lang：界面语言（'zh' / 'en' / 'auto'），只影响返回的状态文案，不影响数值。
   用户自定义的状态文字优先，内置默认值（任何语言）视为未自定义。 */
function computeState(m, nowDate, lang) {
  const now = nowDate || new Date();
  const salary = Number(m.monthlySalary) || 0;
  const workDays = Number(m.workDaysPerMonth) || 21.75;
  const shift = resolveShift(m);

  const activeStatus = pickText(m.activeStatus || m.status, 'widget.statusMoyu', lang);
  const activeStudyStatus = pickText(m.activeStudyStatus || m.studyStatus, 'widget.statusStudy', lang);

  // 已配置月薪与班次 → 动态计算
  if (salary > 0 && shift) {
    const dailyHours = shift.effectiveSec / 3600;        // 已扣除午休的有效工时
    const dailySalary = salary / workDays;
    const perSecond = dailySalary / shift.effectiveSec;
    const base = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0).getTime();
    const workedSec = workedSecondsOf(shift, now.getTime(), base);
    const income = perSecond * workedSec;
    const progress = (workedSec / shift.effectiveSec) * 100;
    return {
      income: Number(income.toFixed(2)),
      progress: Number(progress.toFixed(2)),
      stealthMode: !!m.stealthMode,
      status: phaseStatus(shift, now, false, lang) || activeStatus,
      studyStatus: phaseStatus(shift, now, true, lang) || activeStudyStatus,
      activeStatus,
      activeStudyStatus,
      titleMoyu: pickText(m.titleMoyu, 'widget.titleMoyu', lang),
      titleStudy: pickText(m.titleStudy, 'widget.titleStudy', lang),
      paydayDay: m.paydayDay ?? null,
      monthlySalary: salary,
      workDaysPerMonth: workDays,
      workStartTime: minutesToTime(shift.startMin),
      workEndTime: minutesToTime(shift.endMin),
      breakStartTime: shift.breakStartMin === null ? '' : minutesToTime(shift.breakStartMin),
      breakEndTime: shift.breakEndMin === null ? '' : minutesToTime(shift.breakEndMin),
      breakHours: Number((shift.breakSec / 3600).toFixed(2)),
      spanHours: Number((shift.spanSec / 3600).toFixed(2)),   // 含午休的在岗时长
      dailyHours: Number(dailyHours.toFixed(2)),              // 扣除午休后的计薪工时
      hourlyRate: Number((dailySalary / dailyHours).toFixed(2)),
      perSecond: Number(perSecond.toFixed(6))
    };
  }

  return {
    income: Number(m.income ?? 0),
    progress: Number(m.progress ?? 0),
    stealthMode: !!m.stealthMode,
    status: activeStatus,
    studyStatus: activeStudyStatus,
    titleMoyu: pickText(m.titleMoyu, 'widget.titleMoyu', lang),
    titleStudy: pickText(m.titleStudy, 'widget.titleStudy', lang),
    paydayDay: m.paydayDay ?? null,
    monthlySalary: salary,
    workDaysPerMonth: workDays,
    workStartTime: m.workStartTime || '',
    workEndTime: m.workEndTime || '',
    breakStartTime: m.breakStartTime || '',
    breakEndTime: m.breakEndTime || ''
  };
}


function phaseStatus(shift, now, study, lang) {
  const minute = now.getHours() * 60 + now.getMinutes();
  if (minute < shift.startMin) return tr(study ? 'phase.beforeStudy' : 'phase.before', lang);
  if (minute >= shift.endMin) return tr('phase.done', lang);
  if (shift.breakSec && minute >= shift.breakStartMin && minute < shift.breakEndMin) return tr('phase.break', lang);
  return null;
}
function validateTimes(m, lang) {
  for (const key of ['workStartTime', 'workEndTime', 'breakStartTime', 'breakEndTime']) {
    if (m[key] !== undefined && m[key] !== null && m[key] !== '' && timeToMinutes(m[key]) === null)
      throw new Error(tr('error.invalidTime', lang));
  }
}

const api = { timeToMinutes, minutesToTime, resolveShift, workedSecondsOf, computeState, validateTimes };
if (typeof module === 'object' && module.exports) module.exports = api;
else root.Income = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
