/* 验证偏好设置窗口（settings.html）里「偷偷摸摸」开关的初始状态 */
const { app, BrowserWindow } = require('electron');
const path = require('path');

require('./main.js');

app.whenReady().then(async () => {
  await new Promise((r) => setTimeout(r, 3000));
  const w = new BrowserWindow({
    width: 480, height: 760, show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: false
    }
  });
  await w.loadFile(path.join(__dirname, 'settings.html'));
  await new Promise((r) => setTimeout(r, 1500));
  const dom = await w.webContents.executeJavaScript(`(() => {
    const act = document.querySelector('.mode-btn.active');
    const g = id => { const e = document.getElementById(id); return e ? (e.value !== undefined ? e.value : e.textContent) : null; };
    return {
      hasModeOn: !!document.getElementById('btnModeOn'),
      activeButton: act ? act.id : null,
      studyStatus: g('mockStudyStatus'),
      moyuStatus: g('mockStatus'),
      salary: g('mockSalary'),
      workDays: g('mockWorkDays'),
      start: g('mockStartTime'),
      end: g('mockEndTime'),
      payday: g('mockPaydayDay')
    };
  })()`);
  console.log('SETTINGS DOM', JSON.stringify(dom));
  app.exit(0);
});
