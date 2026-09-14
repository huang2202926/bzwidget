const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

if (process.env.ELECTRON_RUN_AS_NODE) {
  delete process.env.ELECTRON_RUN_AS_NODE;
}

// 优先走国内镜像，避免 GitHub 下载失败
process.env.ELECTRON_MIRROR = process.env.ELECTRON_MIRROR || 'https://npmmirror.com/mirrors/electron/';
process.env.ELECTRON_BUILDER_BINARIES_MIRROR = process.env.ELECTRON_BUILDER_BINARIES_MIRROR || 'https://npmmirror.com/mirrors/electron-builder-binaries/';

const distDir = path.join(__dirname, 'dist');
const backupDir = path.join(distDir, 'backups');

// 每次迭代保留旧版本备份：把 dist 里已有的旧 exe 移入 dist/backups/
function backupOldReleases() {
  if (!fs.existsSync(distDir)) return;
  if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });

  // 1) 历史带版本号的旧命名（MomoyuWidget x.x.x.exe），保留兼容
  const versioned = fs.readdirSync(distDir).filter(f => /^MomoyuWidget\s+\d+\.\d+\.\d+\.exe$/i.test(f));
  for (const file of versioned) {
    const dst = path.join(backupDir, file);
    if (fs.existsSync(dst)) continue;
    fs.renameSync(path.join(distDir, file), dst);
    console.log(`Backed up old release: ${file} -> dist/backups/`);
  }

  // 2) 固定名 bzwidget.exe：打包前搬到 backups，用「版本号 + 时间戳」命名，避免覆盖历史版本
  const cur = path.join(distDir, 'bzwidget.exe');
  if (fs.existsSync(cur)) {
    let version = 'x';
    try { version = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8')).version || 'x'; } catch (e) { /* ignore */ }
    const ts = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
    const dstName = `bzwidget_${version}_${ts}.exe`;
    fs.renameSync(cur, path.join(backupDir, dstName));
    console.log(`Backed up current release -> dist/backups/${dstName}`);
  }
}

backupOldReleases();

const builder = path.join(__dirname, 'node_modules', 'electron-builder', 'cli.js');
const args = ['--win', '--x64'];

console.log('Using node:', process.execPath);
console.log('Builder:', builder);
const result = spawnSync(process.execPath, [builder, ...args], { stdio: 'inherit', env: process.env, cwd: __dirname });
process.exit(result.status ?? 0);
