/**
 * build.js 旧版本归档逻辑的回归测试。
 * 背景：备份曾用 package.json 的「新版本号」给旧包命名，导致 1.0.8 的包被标成 1.0.9。
 * 现在改为读 dist/.build-info.json（打包成功后写入的标记），本测试锁住这个行为。
 * 不依赖 electron-builder，只测 backupOldReleases()。
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bzwidget-backup-test-'));
process.env.BZWIDGET_DIST = tmp; // 必须在 require 之前设置

const { backupOldReleases, readBuiltVersion, writeBuildInfo } = require('./build.js');

let pass = 0;
const failures = [];
function expect(name, actual, expected) {
  if (actual === expected) {
    pass++;
    console.log(`  ok  ${name}`);
  } else {
    failures.push(name);
    console.log(`  FAIL ${name}\n       期望: ${expected}\n       实际: ${actual}`);
  }
}

const distDir = tmp;
const backupDir = path.join(tmp, 'backups');
const exePath = path.join(distDir, 'bzwidget.exe');
const markerPath = path.join(distDir, '.build-info.json');

function resetDist(marker) {
  fs.rmSync(backupDir, { recursive: true, force: true });
  fs.mkdirSync(distDir, { recursive: true });
  fs.writeFileSync(exePath, 'fake-exe');
  if (marker === null) {
    try { fs.unlinkSync(markerPath); } catch (e) { /* ignore */ }
  } else {
    fs.writeFileSync(markerPath, JSON.stringify(marker));
  }
}

function backups() {
  return fs.existsSync(backupDir) ? fs.readdirSync(backupDir) : [];
}

console.log('build.js 备份命名');

// 1) 标记写的是 1.0.8，package.json 是 1.0.9 → 归档名必须带 1.0.8
resetDist({ version: '1.0.8' });
backupOldReleases();
expect('用旧包自己的版本号命名', backups()[0].includes('_1.0.8_'), true);
expect('不会误标成新版本 1.0.9', backups()[0].includes('1.0.9'), false);
expect('旧 exe 已从 dist 移走', fs.existsSync(exePath), false);
expect('归档后标记被清除', readBuiltVersion(), null);

// 2) 缺标记 → unknown，不猜版本号
resetDist(null);
backupOldReleases();
expect('标记缺失时标为 unknown', backups()[0].includes('_unknown_'), true);

// 3) 同一版本、同一秒连续归档两次 → 不能互相覆盖
resetDist({ version: '1.0.9' });
backupOldReleases();
writeBuildInfo('1.0.9');
fs.writeFileSync(exePath, 'fake-exe-2');
backupOldReleases();
expect('同一秒重复归档不覆盖', backups().length, 2);
expect('第二个文件带序号后缀', backups().some(f => /_2\.exe$/.test(f)), true);

// 4) 历史命名 MomoyuWidget x.x.x.exe 仍会被归档
resetDist({ version: '1.0.9' });
fs.writeFileSync(path.join(distDir, 'MomoyuWidget 1.0.7.exe'), 'old');
backupOldReleases();
expect('兼容旧命名归档', backups().includes('MomoyuWidget 1.0.7.exe'), true);
expect('旧命名与新命名一起归档', backups().length, 2);

// 5) dist 不存在时静默返回
fs.rmSync(distDir, { recursive: true, force: true });
const moved = backupOldReleases();
expect('dist 缺失时不报错', Array.isArray(moved) && moved.length, 0);

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${pass} 项通过${failures.length ? `，${failures.length} 项失败: ${failures.join(', ')}` : ''}`);
process.exit(failures.length ? 1 : 0);
