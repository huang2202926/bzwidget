const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

if (process.env.ELECTRON_RUN_AS_NODE) {
  delete process.env.ELECTRON_RUN_AS_NODE;
}

// 优先走国内镜像，避免 GitHub 下载失败
process.env.ELECTRON_MIRROR = process.env.ELECTRON_MIRROR || 'https://npmmirror.com/mirrors/electron/';
process.env.ELECTRON_BUILDER_BINARIES_MIRROR = process.env.ELECTRON_BUILDER_BINARIES_MIRROR || 'https://npmmirror.com/mirrors/electron-builder-binaries/';

// 默认 dist/；BZWIDGET_DIST 可覆盖（备份逻辑的隔离测试用）
const distDir = process.env.BZWIDGET_DIST
  ? path.resolve(process.env.BZWIDGET_DIST)
  : path.join(__dirname, 'dist');
const backupDir = path.join(distDir, 'backups');
const pkgPath = path.join(__dirname, 'package.json');

// 打包成功后写入的标记文件：记录 dist/bzwidget.exe 到底是哪个版本。
// 备份旧包时读它，而不是读 package.json —— package.json 已经是「新版本号」，
// 拿它给旧包命名会把 1.0.8 的包标成 1.0.9（历史踩过的坑）。
const buildInfoPath = path.join(distDir, '.build-info.json');

function readPkgVersion() {
  try {
    return JSON.parse(fs.readFileSync(pkgPath, 'utf8')).version || '0.0.0';
  } catch (e) {
    return '0.0.0';
  }
}

function readBuiltVersion() {
  try {
    const info = JSON.parse(fs.readFileSync(buildInfoPath, 'utf8'));
    if (info && typeof info.version === 'string' && info.version.trim()) return info.version.trim();
  } catch (e) { /* 首次构建或标记丢失 */ }
  return null;
}

function writeBuildInfo(version) {
  fs.writeFileSync(
    buildInfoPath,
    JSON.stringify({ version, builtAt: new Date().toISOString() }, null, 2)
  );
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
}

// 每次迭代保留旧版本备份：把 dist 里已有的旧 exe 移入 dist/backups/，
// 文件名用「旧包自己的版本号 + 打包时间」。
function backupOldReleases() {
  if (!fs.existsSync(distDir)) return [];
  if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });

  const moved = [];

  // 1) 历史带版本号的旧命名（MomoyuWidget x.x.x.exe），保留兼容
  const versioned = fs.readdirSync(distDir).filter(f => /^MomoyuWidget\s+\d+\.\d+\.\d+\.exe$/i.test(f));
  for (const file of versioned) {
    const dst = path.join(backupDir, file);
    if (fs.existsSync(dst)) continue;
    fs.renameSync(path.join(distDir, file), dst);
    moved.push(file);
    console.log(`Backed up old release: ${file} -> ${path.relative(__dirname, dst)}`);
  }

  // 2) 固定名 bzwidget.exe：按它自己的版本号归档
  const cur = path.join(distDir, 'bzwidget.exe');
  if (!fs.existsSync(cur)) return moved;

  const version = readBuiltVersion();
  const label = version || 'unknown';
  let dstName = `bzwidget_${label}_${timestamp()}.exe`;
  let n = 2;
  while (fs.existsSync(path.join(backupDir, dstName))) {
    dstName = `bzwidget_${label}_${timestamp()}_${n++}.exe`;
  }
  fs.renameSync(cur, path.join(backupDir, dstName));
  moved.push(dstName);
  if (version) {
    console.log(`Backed up old release v${version} -> ${path.relative(__dirname, path.join(backupDir, dstName))}`);
  } else {
    console.warn(`Backed up old release (版本未知，标记文件缺失) -> ${path.relative(__dirname, path.join(backupDir, dstName))}`);
  }
  // 旧包已归档，标记同时作废，避免下一次备份复用同一个版本号
  try { fs.unlinkSync(buildInfoPath); } catch (e) { /* ignore */ }
  return moved;
}

function build() {
  const builder = path.join(__dirname, 'node_modules', 'electron-builder', 'cli.js');
  const args = ['--win', '--x64'];

  console.log('Using node:', process.execPath);
  console.log('Builder:', builder);
  const result = spawnSync(process.execPath, [builder, ...args], { stdio: 'inherit', env: process.env, cwd: __dirname });

  // 打包成功才写版本标记：下次构建备份时用它给旧包命名
  if (result.status === 0 && fs.existsSync(path.join(distDir, 'bzwidget.exe'))) {
    const version = readPkgVersion();
    writeBuildInfo(version);
    console.log(`Marked ${path.relative(__dirname, path.join(distDir, 'bzwidget.exe'))} as v${version}`);
  }
  return result.status ?? 0;
}

module.exports = { backupOldReleases, readBuiltVersion, writeBuildInfo, readPkgVersion, distDir, backupDir };

if (require.main === module) {
  backupOldReleases();
  process.exit(build());
}
