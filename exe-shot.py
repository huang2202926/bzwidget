"""启动 exe 并截图桌面，确认小组件实际渲染效果。

注意：会临时写入一份演示配置（截图用），结束后把原配置原样还原。
"""
import subprocess, time, os, json, shutil

BASE = r"C:\Users\Administrator\WorkBuddy\2026-09-11-17-15-47\momoyu-widget"
EXE = os.path.join(BASE, "dist", "win-unpacked", "bzwidget.exe")
SHOT = os.path.join(BASE, "widget-shot.png")
CFG = os.path.join(os.path.expanduser("~"), ".momoyu-widget", "config.json")
BACKUP = CFG + ".bak"

# 备份原配置
have_backup = os.path.exists(CFG)
if have_backup:
    shutil.copy2(CFG, BACKUP)

try:
    cfg = json.load(open(CFG, encoding="utf-8")) if have_backup else {}
except Exception:
    cfg = {}

# 保留原窗口位置，只换演示数据
cfg.update({
    "width": 280, "height": 192, "alwaysOnTop": True, "opacity": 1,
    "dataSource": "api", "refreshInterval": 10000,
    "mock": {"stealthMode": True, "monthlySalary": 6400, "workDaysPerMonth": 24,
             "workStartTime": "08:30", "workEndTime": "18:00",
             "breakStartTime": "12:00", "breakEndTime": "13:00",
             "status": "搬砖进行中", "studyStatus": "学习中", "paydayDay": 20},
})
os.makedirs(os.path.dirname(CFG), exist_ok=True)
json.dump(cfg, open(CFG, "w", encoding="utf-8"), ensure_ascii=False, indent=2)

env = dict(os.environ)
env.pop("ELECTRON_RUN_AS_NODE", None)

# 清掉可能残留的实例，避免旧窗口/菜单入镜
subprocess.run(["taskkill", "/F", "/IM", "bzwidget.exe"], capture_output=True, text=True)
time.sleep(1.5)

p = subprocess.Popen([EXE], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(7)

# 把鼠标移开，避免悬停在卡片上触发任何态样
try:
    import ctypes
    ctypes.windll.user32.SetCursorPos(5, 5)
    time.sleep(1)
except Exception:
    pass

ps = (
    "Add-Type -AssemblyName System.Windows.Forms,System.Drawing;"
    "$b = New-Object System.Drawing.Bitmap([System.Windows.Forms.Screen]::PrimaryScreen.Bounds.Width,"
    "[System.Windows.Forms.Screen]::PrimaryScreen.Bounds.Height);"
    "$g = [System.Drawing.Graphics]::FromImage($b);"
    "$g.CopyFromScreen(0,0,0,0,$b.Size);"
    "$b.Save('" + SHOT.replace("\\", "\\\\") + "');"
    "$b.Dispose()"
)
r = subprocess.run(["powershell", "-NoProfile", "-Command", ps], capture_output=True, text=True, timeout=60)

p.kill()
time.sleep(1)
subprocess.run(["taskkill", "/F", "/IM", "bzwidget.exe"], capture_output=True)

# 还原原配置
if os.path.exists(BACKUP):
    shutil.move(BACKUP, CFG)
    print("config restored")

print("shot exists:", os.path.exists(SHOT))
if os.path.exists(SHOT):
    print("shot size:", os.path.getsize(SHOT))
print("ps rc:", r.returncode)
print("ps err:", (r.stderr or "")[:500])
