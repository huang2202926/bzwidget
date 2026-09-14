/* i18n 文案表测试：zh/en 键一致、无空值、插值占位符一致、pick 语义、收入算法英文状态。 */
const { dict, t, normalize, resolve, pick, isBuiltinValue } = require('./i18n');
const Income = require('./income');

let failed = 0;
function expect(name, actual, want) {
  const ok = JSON.stringify(actual) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  => ${JSON.stringify(actual)}${ok ? '' : '  (want ' + JSON.stringify(want) + ')'}`);
}

/* ---------- 1. 键集合一致 ---------- */
const zhKeys = Object.keys(dict.zh).sort();
const enKeys = Object.keys(dict.en).sort();
expect('zh/en 键数量一致', zhKeys.length, enKeys.length);
expect('zh/en 键集合一致', zhKeys.join(','), enKeys.join(','));

let empty = [];
for (const key of zhKeys) {
  if (typeof dict.en[key] !== 'string' || dict.en[key].length === 0) empty.push('en:' + key);
  if (typeof dict.zh[key] !== 'string' || dict.zh[key].length === 0) empty.push('zh:' + key);
}
expect('无空文案', empty, []);

/* ---------- 2. 插值占位符一致 ---------- */
function placeholders(text) {
  const found = [];
  const re = /\{(\w+)\}/g;
  let m;
  while ((m = re.exec(String(text)))) found.push(m[1]);
  return found.sort().join(',');
}
let mismatch = [];
for (const key of zhKeys) {
  if (placeholders(dict.zh[key]) !== placeholders(dict.en[key])) mismatch.push(key);
}
expect('插值占位符两侧一致', mismatch, []);

/* ---------- 3. 取词 / 插值 / 回退 ---------- */
expect('t 插值 zh', t('widget.updatedAt', 'zh', { time: '12:00' }), '更新于 12:00');
expect('t 插值 en', t('admin.rates', 'en', { hours: '8.5', hourly: '31.37', perSec: '0.04' }),
  'Paid hours 8.5h · ¥31.37/h · ¥0.04/s');
expect('未知键返回键名', t('no.such.key', 'zh'), 'no.such.key');
expect('未知键回退中文表', (() => { dict.en.__probe__ = undefined; const r = t('__probe__', 'en'); delete dict.en.__probe__; return r; })(), '__probe__');

/* ---------- 4. normalize / resolve ---------- */
expect("normalize('auto')", normalize('auto'), 'auto');
expect("normalize('')", normalize(''), 'auto');
expect("normalize(null)", normalize(null), 'auto');
expect("normalize('zh-CN')", normalize('zh-CN'), 'zh');
expect("normalize('EN-us')", normalize('EN-us'), 'en');
expect("normalize('fr')", normalize('fr'), 'auto');
expect("resolve('auto','zh-CN')", resolve('auto', 'zh-CN'), 'zh');
expect("resolve('auto','en-US')", resolve('auto', 'en-US'), 'en');
expect("resolve('auto','')", resolve('auto', ''), 'en');
expect("resolve('zh','en-US')", resolve('zh', 'en-US'), 'zh');
expect("resolve('en','zh-CN')", resolve('en', 'zh-CN'), 'en');

/* ---------- 5. pick：自定义优先，内置默认视为未自定义 ---------- */
expect('自定义文案原样保留', pick('搬砖进行中', 'widget.statusMoyu', 'zh'), '搬砖进行中');
expect('自定义文案跨语言保留', pick('My own status', 'widget.statusMoyu', 'en'), 'My own status');
expect('zh 内置默认 → en 默认', pick('搬砖中', 'widget.statusMoyu', 'en'), 'Grinding');
expect('en 内置默认 → zh 默认', pick('Grinding', 'widget.statusMoyu', 'zh'), '搬砖中');
expect('空值 → 当前语言默认', pick(undefined, 'widget.statusMoyu', 'en'), 'Grinding');
expect('空字符串 → 当前语言默认', pick('', 'widget.titleMoyu', 'en'), "Today's Grind Income");
expect('isBuiltinValue 识别中文内置', isBuiltinValue('学习中'), true);
expect('isBuiltinValue 识别英文内置', isBuiltinValue('On break'), true);
expect('isBuiltinValue 不误伤自定义', isBuiltinValue('随便写的状态'), false);

/* ---------- 6. 收入算法英文状态（income.js 直接调用） ---------- */
const job = { monthlySalary: 6000, workDaysPerMonth: 22, workStartTime: '09:00', workEndTime: '18:00',
              breakStartTime: '12:00', breakEndTime: '13:00' };
function at(h, mi) {
  const d = new Date();
  d.setHours(h, mi || 0, 0, 0);
  return d;
}
expect('en 上班前', Income.computeState(job, at(7), 'en').status, 'Off the clock');
expect('en 午休中', Income.computeState(job, at(12, 30), 'en').status, 'On break');
expect('en 下班后', Income.computeState(job, at(19), 'en').status, 'Done for today');
expect('en 学习模式上班前', Income.computeState({ ...job, stealthMode: true }, at(7), 'en').studyStatus, 'Not started yet');
expect('zh 默认（不传语言）上班前', Income.computeState(job, at(7)).status, '未开工');
expect('en 无效时间报错为英文', (() => {
  try { Income.validateTimes({ workStartTime: '25:00' }, 'en'); return 'no error'; }
  catch (e) { return e.message; }
})(), 'Please enter a valid time (00:00–24:00)');
expect('zh 无效时间报错为中文', (() => {
  try { Income.validateTimes({ workStartTime: '25:00' }); return 'no error'; }
  catch (e) { return e.message; }
})(), '请输入有效的时间（00:00–24:00）');

console.log(failed ? `\n${failed} 项失败` : '\n全部通过');
process.exit(failed ? 1 : 0);
