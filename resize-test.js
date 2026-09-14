/* 端到端验证「窗口自由缩放」：
   加载真实的小组件窗口（直接复用 main.js），模拟拖动右下角手柄，
   检查窗口尺寸是否随之变化、是否触发最小尺寸保护。
   运行：node_modules/electron/dist/electron.exe resize-test.js  */
const { app, BrowserWindow } = require('electron');

require('./main.js');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
function expect(name, actual, want) {
  const ok = JSON.stringify(actual) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  => ${JSON.stringify(actual)}${ok ? '' : '  (want ' + JSON.stringify(want) + ')'}`);
}

app.whenReady().then(async () => {
  await sleep(3500);
  const win = BrowserWindow.getAllWindows()[0];
  if (!win) { console.log('RESIZE FAIL: 没有找到窗口'); app.exit(1); return; }

  const gripOk = await win.webContents.executeJavaScript(
    "!!document.getElementById('resizeGrip')"
  );
  expect('页面存在缩放手柄 #resizeGrip', gripOk, true);

  const drag = (type, x, y) => win.webContents.executeJavaScript(
    "(() => { const g = document.getElementById('resizeGrip');" +
    " g.dispatchEvent(new PointerEvent('" + type + "', {screenX:" + x + ", screenY:" + y +
    ", pointerId:1, bubbles:true, cancelable:true})); return true; })()"
  );

  /* ---- 1. 向右下拖 80×60 ---- */
  const before = win.getBounds();
  await drag('pointerdown', 100, 100);
  await sleep(400);                       // 等 pointerdown 里的 IPC 取回窗口尺寸
  await drag('pointermove', 180, 160);
  await sleep(500);
  const mid = win.getBounds();
  await drag('pointerup', 180, 160);
  await sleep(600);
  const afterUp = win.getBounds();

  expect('右下拖拽 → 宽 +80', mid.width - before.width, 80);
  expect('右下拖拽 → 高 +60', mid.height - before.height, 60);
  expect('松手后尺寸保持', [afterUp.width, afterUp.height], [mid.width, mid.height]);
  expect('左上角位置不动', [mid.x, mid.y], [before.x, before.y]);

  /* ---- 2. 反向拖到极小 → 最小尺寸保护 ---- */
  await drag('pointerdown', 500, 500);
  await sleep(400);
  await drag('pointermove', 0, 0);
  await sleep(500);
  const small = win.getBounds();
  await drag('pointerup', 0, 0);
  await sleep(400);
  expect('缩到极小 → 宽不小于 200', small.width >= 200, true);
  expect('缩到极小 → 高不小于 170', small.height >= 170, true);
  console.log('   最小尺寸实测 =', small.width + 'x' + small.height);

  /* ---- 3. 尺寸已落盘 ---- */
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const cfgPath = path.join(os.homedir(), '.momoyu-widget', 'config.json');
  await sleep(600);
  let saved = {};
  try { saved = JSON.parse(fs.readFileSync(cfgPath, 'utf8')); } catch (e) {}
  expect('缩放宽高已写入配置', [saved.width, saved.height], [small.width, small.height]);

  console.log(failed ? `\n${failed} 项失败` : '\n缩放测试全部通过');
  app.exit(failed ? 1 : 0);
});
