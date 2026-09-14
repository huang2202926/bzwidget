/* 单元测试：直接加载 main.js 的 loadConfig / computeTodayState，
   验证旧配置迁移、午休扣减、以及实时计算数值。 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const Module = require('module');

const tmpHome = path.join(os.tmpdir(), 'momoyu-migrate-test');
const cfgDir = path.join(tmpHome, '.momoyu-widget');
fs.rmSync(tmpHome, { recursive: true, force: true });
fs.mkdirSync(cfgDir, { recursive: true });

// 让 main.js 里的 os.homedir() 指向临时目录
process.env.USERPROFILE = tmpHome;
process.env.HOME = tmpHome;

const MAIN = 'C:/Users/Administrator/WorkBuddy/2026-09-11-17-15-47/momoyu-widget/main.js';
let src = fs.readFileSync(MAIN, 'utf8');
src += '\nmodule.exports = { loadConfig, timeToMinutes, minutesToTime, resolveShift, workedSecondsOf, computeTodayState, buildAdminHtml, getConfig: () => config };\n';

const stubElectron = {
  app: { whenReady: () => new Promise(() => {}), on() {}, quit() {} },
  BrowserWindow: function () {},
  Tray: function () {},
  Menu: { buildFromTemplate: () => ({}) },
  ipcMain: { handle() {} },
  screen: { getPrimaryDisplay: () => ({ workAreaSize: { width: 1920, height: 1040 } }) }
};

const m = new Module(MAIN, null);
m.filename = MAIN;
m.paths = Module._nodeModulePaths(path.dirname(MAIN));
const origRequire = m.require.bind(m);
m.require = (id) => (id === 'electron' ? stubElectron : origRequire(id));
m._compile(src, MAIN);

const { loadConfig, computeTodayState, buildAdminHtml } = m.exports;
const liveCfg = m.exports.getConfig();

function writeCfg(mock) {
  fs.writeFileSync(path.join(cfgDir, 'config.json'),
    JSON.stringify({ x: 10, y: 20, width: 280, height: 192, apiUrl: '', mock }, null, 2), 'utf8');
}

let failed = 0;
function expect(name, actual, want) {
  const ok = JSON.stringify(actual) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  => ${JSON.stringify(actual)}${ok ? '' : '  (want ' + JSON.stringify(want) + ')'}`);
}
// 把磁盘配置读进「活动配置」，再算某个时刻的今日状态
function stateAt(mock, h, mi) {
  writeCfg(mock);
  Object.assign(liveCfg.mock, loadConfig().mock);
  const t = new Date(); t.setHours(h, mi || 0, 0, 0);
  return computeTodayState(t);
}

/* ---------- 1. 旧配置迁移 ---------- */
writeCfg({ monthlySalary: 6400, workDaysPerMonth: 24, workStartHour: 8.5, workEndHour: 18,
           status: '搬砖中', paydayDay: 20, income: 245.88, progress: 92, onlineCount: 65 });
let c = loadConfig();
expect('旧 workStartHour 8.5 → 08:30', c.mock.workStartTime, '08:30');
expect('旧 workEndHour 18 → 18:00', c.mock.workEndTime, '18:00');
expect('月薪保留', c.mock.monthlySalary, 6400);
expect('月工作天数保留', c.mock.workDaysPerMonth, 24);
expect('旧字段已清除 workStartHour', 'workStartHour' in c.mock, false);
expect('旧字段已清除 onlineCount', 'onlineCount' in c.mock, false);
expect('午休未存过 → 用默认 12:00-13:00', [c.mock.breakStartTime, c.mock.breakEndTime], ['12:00', '13:00']);

/* ---------- 2. 新格式保留 ---------- */
writeCfg({ monthlySalary: 9000, workDaysPerMonth: 22, workStartTime: '09:30', workEndTime: '18:45',
           breakStartTime: '12:00', breakEndTime: '13:30', paydayDay: 10 });
c = loadConfig();
expect('新格式 09:30–18:45 保留', [c.mock.workStartTime, c.mock.workEndTime], ['09:30', '18:45']);
expect('午休 12:00–13:30 保留', [c.mock.breakStartTime, c.mock.breakEndTime], ['12:00', '13:30']);

/* ---------- 3. 显式留空 = 不扣午休 ---------- */
writeCfg({ monthlySalary: 9000, workDaysPerMonth: 22, workStartTime: '09:00', workEndTime: '18:00',
           breakStartTime: '', breakEndTime: '' });
c = loadConfig();
expect('午休留空 → 仍为空', [c.mock.breakStartTime, c.mock.breakEndTime], ['', '']);

/* ---------- 4. 无配置文件 → 默认 ---------- */
fs.rmSync(path.join(cfgDir, 'config.json'));
c = loadConfig();
expect('默认班次', [c.mock.workStartTime, c.mock.workEndTime, c.mock.breakStartTime, c.mock.breakEndTime],
  ['08:00', '18:00', '12:00', '13:00']);

/* ---------- 5. 旧 paydayDate 迁移 ---------- */
writeCfg({ workStartTime: '08:00', workEndTime: '18:00', paydayDate: '2026-03-28T00:00:00.000Z' });
c = loadConfig();
expect('paydayDate → paydayDay', c.mock.paydayDay, 28);

/* ---------- 6. 工时扣午休：08:30–18:00，午休 12:00–13:00 ---------- */
const job = { monthlySalary: 6400, workDaysPerMonth: 24,
              workStartTime: '08:30', workEndTime: '18:00',
              breakStartTime: '12:00', breakEndTime: '13:00' };
let st = stateAt(job, 10, 0);
expect('在岗 9.5h − 午休 1h = 计薪 8.5h', st.dailyHours, 8.5);
expect('时薪 31.37', st.hourlyRate, 31.37);
expect('含午休在岗 9.5h', st.spanHours, 9.5);
expect('午休 1h', st.breakHours, 1);

st = stateAt(job, 11, 0);
expect('@11:00 已工作 2.5h 收入 78.43', st.income, 78.43);
expect('@11:00 进度 29.41%', st.progress, 29.41);

st = stateAt(job, 12, 30);
expect('@12:30 午休已扣 0.5h → 3.5h 收入 109.8', st.income, 109.8);

st = stateAt(job, 13, 0);
expect('@13:00 午休结束仍为 3.5h（午休期间不涨）', st.income, 109.8);

st = stateAt(job, 14, 30);
expect('@14:30 在岗 6h 扣 1h 午休 = 5h 收入 156.86', st.income, 156.86);

st = stateAt(job, 18, 0);
expect('@18:00 满 8.5h 收入 266.67', st.income, 266.67);
expect('@18:00 进度 100%', st.progress, 100);

st = stateAt(job, 20, 0);
expect('@20:00 下班后不再增长', st.income, 266.67);

st = stateAt(job, 7, 0);
expect('@07:00 上班前为 0', st.income, 0);

/* ---------- 7. 午休留空 → 按在岗时长计薪 ---------- */
st = stateAt({ monthlySalary: 6400, workDaysPerMonth: 24, workStartTime: '08:30', workEndTime: '18:00',
               breakStartTime: '', breakEndTime: '' }, 18, 0);
expect('不扣午休 → 计薪 9.5h', st.dailyHours, 9.5);
expect('不扣午休 @18:00 收入 266.67', st.income, 266.67);

/* ---------- 8. 午休落在班次外 → 忽略 ---------- */
st = stateAt({ monthlySalary: 6400, workDaysPerMonth: 24, workStartTime: '08:00', workEndTime: '12:00',
               breakStartTime: '12:00', breakEndTime: '13:00' }, 12, 0);
expect('午休超出班次 → 忽略，计薪 4h', st.dailyHours, 4);
expect('返回的午休为空', [st.breakStartTime, st.breakEndTime], ['', '']);

/* ---------- 9. 午休跨中段：09:00–18:00 午休 11:30–12:30 ---------- */
st = stateAt({ monthlySalary: 10000, workDaysPerMonth: 20, workStartTime: '09:00', workEndTime: '18:00',
               breakStartTime: '11:30', breakEndTime: '12:30' }, 12, 0);
expect('09:00–18:00 扣 1h → 计薪 8h', st.dailyHours, 8);
expect('@12:00 已工作 2.5h → 收入 156.25', st.income, 156.25);

/* ---------- 10. 偷偷摸摸（学习风格）模式 ---------- */
// 老配置里没有 stealthMode → 默认开启学习风格文案
writeCfg({ monthlySalary: 6400, workDaysPerMonth: 24, workStartTime: '09:00', workEndTime: '18:00' });
c = loadConfig();
expect('老配置 → 默认开启偷偷摸摸', c.mock.stealthMode, true);
expect('默认学习状态文字', c.mock.studyStatus, '学习中');

// 显式关闭要保留
writeCfg({ stealthMode: false, monthlySalary: 6400, workDaysPerMonth: 24 });
c = loadConfig();
expect('显式关闭 → false', c.mock.stealthMode, false);

// 接口返回模式 + 两套状态文字
st = stateAt({ stealthMode: true, status: '搬砖中', studyStatus: '学习中',
               monthlySalary: 6400, workDaysPerMonth: 24,
               workStartTime: '09:00', workEndTime: '18:00',
               breakStartTime: '', breakEndTime: '' }, 12, 0);
expect('state.stealthMode', st.stealthMode, true);
expect('state.studyStatus', st.studyStatus, '学习中');
expect('state.status（搬砖）', st.status, '搬砖中');
expect('state.titleMoyu', st.titleMoyu, '今日搬砖收入');
expect('state.titleStudy', st.titleStudy, '今日学习进度');

st = stateAt({ stealthMode: false, monthlySalary: 6400, workDaysPerMonth: 24,
               workStartTime: '09:00', workEndTime: '18:00' }, 12, 0);
expect('关闭模式后 stealthMode=false', st.stealthMode, false);

/* ---------- 11. 内置后台页（偷偷摸摸区块 + 内嵌脚本语法） ---------- */
liveCfg.mock.stealthMode = true;
const htmlOn = buildAdminHtml(3456);
expect('学习模式：页面标题', htmlOn.includes('<title>学习进度 · 后台设置</title>'), true);
expect('含偷偷摸摸区块', htmlOn.includes('偷偷摸摸'), true);
expect('含说明文案', htmlOn.includes('开启后界面文案切换为学习风格，降低划水观感'), true);
expect('含关闭/开启按钮', htmlOn.includes('data-mode="off"') && htmlOn.includes('data-mode="on"'), true);
expect('含学习状态文字输入', htmlOn.includes('id="studyStatus"'), true);
expect('含搬砖标题输入', htmlOn.includes('id="titleMoyu"'), true);
expect('含学习标题输入', htmlOn.includes('id="titleStudy"'), true);
expect('含模式切换脚本', htmlOn.includes('function setMode'), true);
expect('首屏即套用模式', htmlOn.includes('applyMode(stealth);'), true);

liveCfg.mock.stealthMode = false;
const htmlOff = buildAdminHtml(3456);
expect('搬砖模式：页面标题', htmlOff.includes('<title>搬砖收入 · 后台设置</title>'), true);

const scriptMatch = /<script>([\s\S]*?)<\/script>/.exec(htmlOn);
expect('可抽出内嵌脚本', !!scriptMatch, true);
if (scriptMatch) {
  try {
    new (require('vm').Script)(scriptMatch[1]);
    expect('内嵌脚本语法正确', true, true);
  } catch (e) {
    expect('内嵌脚本语法正确（' + e.message + '）', false, true);
  }
}

/* ---------- 12. 渲染层文案 / 缩放手柄 ---------- */
const base = path.dirname(MAIN);
const rendererSrc = fs.readFileSync(path.join(base, 'renderer.js'), 'utf8');
expect('renderer 含学习文案',
  rendererSrc.includes('今日学习进度') && rendererSrc.includes('距月考还有') && rendererSrc.includes('学习中'), true);
expect('renderer 含两套文案映射', rendererSrc.includes('MODE_COPY') && rendererSrc.includes('applyModeCopy'), true);
expect('renderer 读取自定义标题', rendererSrc.includes('titleMoyu') && rendererSrc.includes('titleStudy'), true);

const indexSrc = fs.readFileSync(path.join(base, 'index.html'), 'utf8');
expect('index 含单位后缀节点', indexSrc.includes('id="unitSuffix"'), true);
expect('index 不再含可见缩放手柄节点', !indexSrc.includes('id="resizeGrip"'), true);

const mainSrc = fs.readFileSync(MAIN, 'utf8');
expect('主进程允许自由缩放', mainSrc.includes('resizable: true'), true);
expect('主进程使用原生最小尺寸', mainSrc.includes('minWidth: MIN_WIDGET_WIDTH') && mainSrc.includes('minHeight: MIN_WIDGET_HEIGHT'), true);
expect('主进程设了最小尺寸常量', mainSrc.includes('MIN_WIDGET_WIDTH') && mainSrc.includes('MIN_WIDGET_HEIGHT'), true);
expect('主进程不再保留旧拖拽 IPC', !mainSrc.includes("'resize-window'") && !mainSrc.includes("'get-window-bounds'"), true);

const settingsHtmlSrc = fs.readFileSync(path.join(base, 'settings.html'), 'utf8');
expect('偏好窗口不再含重复的收入参数', !settingsHtmlSrc.includes('收入计算参数'), true);
expect('偏好窗口不再含重复的模式切换', !settingsHtmlSrc.includes('偷偷摸摸'), true);
expect('偏好窗口保留数据源设置', settingsHtmlSrc.includes('dataSource'), true);
expect('偏好窗口保留窗口设置', settingsHtmlSrc.includes('透明度') && settingsHtmlSrc.includes('alwaysOnTop'), true);

const settingsSrc = fs.readFileSync(path.join(base, 'settings.js'), 'utf8');
expect('偏好窗口配置仅保存独立项', settingsSrc.includes('dataSource') && settingsSrc.includes('opacity') && !settingsSrc.includes('monthlySalary'), true);

console.log(failed ? `\n${failed} 项失败` : '\n全部通过');
process.exit(failed ? 1 : 0);
