const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const assert = require('node:assert/strict');
const debugPort = require('node:crypto').randomInt(20000, 50000);
const testDir = fs.mkdtempSync(path.join(__dirname, 'dist', 'verify-'));
const cfgDir = path.join(testDir, '.momoyu-widget');
fs.mkdirSync(cfgDir);
fs.writeFileSync(path.join(cfgDir, 'config.json'), JSON.stringify({ x: 120, y: 120, mock: { monthlySalary: 8000, workDaysPerMonth: 20, workStartTime: '00:00', workEndTime: '24:00', breakStartTime: '', breakEndTime: '', titleMoyu: '打包验证', stealthMode: false } }));
const env = { ...process.env, USERPROFILE: testDir };
delete env.ELECTRON_RUN_AS_NODE;
// 默认在验证结束后回收临时配置目录，避免 dist/ 里堆积 verify-* 目录；加 --keep 可保留以便人工查看
const keep = process.argv.includes('--keep');
function cleanup() {
  if (keep) return;
  try { fs.rmSync(testDir, { recursive: true, force: true }); }
  catch (e) { console.warn('Cleanup skipped:', e.message); }
}
const executable = process.argv.includes('--source') ? require('electron') : process.argv.includes('--unpacked') ? path.join(__dirname, 'dist', 'win-unpacked', 'bzwidget.exe') : path.join(__dirname, 'dist', 'bzwidget.exe');
const child = spawn(executable, [...(process.argv.includes('--source') ? [__dirname] : []), ...(process.argv.includes('--renderer') ? ['--remote-debugging-port=' + debugPort] : [])], { env, stdio: 'ignore', windowsHide: true });
child.on('exit', (code, signal) => console.log('Launcher exit:', code, signal));
child.on('error', e => { console.error(e); process.exit(1); });
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  let port;
  for (let i = 0; i < 120; i++) {
    const logPath = path.join(cfgDir, 'startup.log');
    const log = fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8') : '';
    const match = log.match(/apiUrl=http:\/\/127\.0\.0\.1:(\d+)/);
    if (match) { port = Number(match[1]); break; }
    await sleep(500);
  }
  assert.ok(port, 'Portable executable did not start its isolated server');
  const base = 'http://127.0.0.1:' + port;
  const update = body => fetch(base + '/api/update', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  let state = await (await fetch(base + '/api/today')).json();
  assert.equal(state.workEndTime, '24:00');
  assert.equal(state.monthlySalary, 8000);
  assert.ok(state.income >= 0 && state.income <= 400);
  assert.equal((await update({ workEndTime: '24:30' })).status, 400);
  assert.equal((await update({ monthlySalary: 9600 })).status, 200);
  state = await (await fetch(base + '/api/today')).json();
  assert.equal(state.monthlySalary, 9600);
  assert.ok(fs.existsSync(path.join(cfgDir, 'config.json.bak')));
  assert.equal(JSON.parse(fs.readFileSync(path.join(cfgDir, 'config.json'), 'utf8')).mock.monthlySalary, 9600);
  assert.ok((await (await fetch(base)).text()).includes('保存并推送'));
  if (process.argv.includes('--renderer')) {
    const targets = await (await fetch('http://127.0.0.1:' + debugPort + '/json')).json();
    const target = targets.find(t => t.url.endsWith('/index.html'));
    assert.ok(target, 'Widget page is missing');
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
    let id = 0;
    const evaluate = expression => new Promise((resolve, reject) => {
      const requestId = ++id;
      const listener = event => {
        const response = JSON.parse(event.data);
        if (response.id !== requestId) return;
        ws.removeEventListener('message', listener);
        if (response.error || response.result.exceptionDetails) reject(new Error(JSON.stringify(response)));
        else resolve(response.result.result.value);
      };
      ws.addEventListener('message', listener);
      ws.send(JSON.stringify({ id: requestId, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } }));
    });
    await sleep(1000);
    assert.equal(await evaluate('config.apiUrl'), base + '/api/today', 'Debug target must belong to this test instance');
    const before = await evaluate("document.getElementById('income').textContent");
    let after = before;
    for (let i = 0; i < 20 && after === before; i++) {
      await sleep(250);
      after = await evaluate("document.getElementById('income').textContent");
    }
    assert.notEqual(before, after, 'Income should update each second');
    await update({ stealthMode: true, titleStudy: '学习模式验证' });
    await sleep(500);
    assert.equal(await evaluate("document.getElementById('title').textContent"), '学习模式验证');
    assert.equal(await evaluate("document.getElementById('unitSuffix').textContent"), ' 分');
    await evaluate('window.electronAPI.openAdmin()');
    await sleep(700);
    const opened = await (await fetch('http://127.0.0.1:' + debugPort + '/json')).json();
    assert.ok(opened.some(t => t.url === base + '/'), 'Settings window should open');
    console.log('PASS renderer: live income, study mode refresh, native admin window');
    ws.close();
  }
  fs.writeFileSync(path.join(__dirname, 'dist', 'verification.json'), JSON.stringify({ testDir, launcherPid: child.pid, port, debugPort, rendererVerified: process.argv.includes('--renderer'), result: 'PASS: startup, calculation, validation, settings persistence, backup, admin page' }, null, 2));
  console.log('PASS portable startup, calculation, invalid-time rejection, settings persistence, backup, admin page');
  const checkIndex = process.argv.indexOf('--check-script');
  if (checkIndex !== -1) {
    assert.ok(process.argv[checkIndex + 1], 'Missing check script path');
    await new Promise((resolve, reject) => {
      const check = spawn(process.execPath, [process.argv[checkIndex + 1]], { stdio: 'inherit', windowsHide: true });
      check.on('error', reject);
      check.on('exit', code => code === 0 ? resolve() : reject(new Error('Additional UI check failed: ' + code)));
    });
  }
  if (keep) {
    console.log('Verification instance ready for desktop inspection; PID=' + child.pid);
  } else {
    cleanup();
    console.log('Temporary profile removed (' + testDir + ')');
  }
  child.unref();
})().catch(async e => {
  console.error(e);
  process.exitCode = 1;
  child.kill();
  await sleep(500);
  cleanup();
});
