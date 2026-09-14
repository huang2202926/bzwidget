const { spawn } = require('child_process');

// 当前 WorkBuddy / CodeBuddy 运行环境会设置 ELECTRON_RUN_AS_NODE=1，
// 这会导致 electron 以 Node 模式启动，require('electron') 返回路径字符串而非 API。
// 在真正启动 Electron 子进程前必须清除该变量。
if (process.env.ELECTRON_RUN_AS_NODE) {
  delete process.env.ELECTRON_RUN_AS_NODE;
}

const electronPath = require('electron');
const args = ['.', ...process.argv.slice(2)];

const child = spawn(electronPath, args, { stdio: 'inherit', env: process.env, cwd: __dirname });

child.on('exit', (code) => {
  process.exit(code ?? 0);
});

child.on('error', (err) => {
  console.error('启动 Electron 失败:', err.message);
  process.exit(1);
});
