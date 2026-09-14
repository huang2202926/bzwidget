"""启动打包后的 exe → 用开发版 electron 打开内置后台页截图 → 关掉 exe。"""
import subprocess, socket, time, os, json

BASE = r"C:\Users\Administrator\WorkBuddy\2026-09-11-17-15-47\momoyu-widget"
EXE = os.path.join(BASE, "dist", "win-unpacked", "bzwidget.exe")
ELECTRON = os.path.join(BASE, "node_modules", "electron", "dist", "electron.exe")
SHOT = os.path.join(BASE, "admin-window-shot.js")

# 用用户真实设置，截图里能看到真实数字
subprocess.run(["taskkill", "/F", "/IM", "bzwidget.exe"], capture_output=True)
time.sleep(1.0)

cfg = os.path.join(os.path.expanduser("~"), ".momoyu-widget", "config.json")
c = json.load(open(cfg, encoding="utf-8"))
c["mock"] = {"stealthMode": True, "monthlySalary": 6400, "workDaysPerMonth": 24,
             "workStartTime": "08:30", "workEndTime": "18:00",
             "breakStartTime": "12:00", "breakEndTime": "13:00",
             "status": "搬砖进行中", "studyStatus": "学习中", "paydayDay": 20}
json.dump(c, open(cfg, "w", encoding="utf-8"), ensure_ascii=False, indent=2)

env = dict(os.environ)
env.pop("ELECTRON_RUN_AS_NODE", None)

p = subprocess.Popen([EXE], env=env, stdout=subprocess.PIPE,
                     stderr=subprocess.STDOUT, text=True, errors="replace")

def probe(port):
    s = socket.socket(); s.settimeout(0.2)
    r = s.connect_ex(("127.0.0.1", port)) == 0
    s.close()
    return r

port = None
for i in range(40):
    for cand in range(3456, 3477):
        if probe(cand):
            port = cand; break
    if port:
        print("exe up on port", port); break
    time.sleep(0.5)

if port:
    env2 = dict(env); env2["ADMIN_PORT"] = str(port)
    r = subprocess.run([ELECTRON, SHOT], env=env2, cwd=BASE,
                       capture_output=True, text=True, timeout=120)
    print("electron stdout:", (r.stdout or "").strip()[:800])
    print("electron stderr:", (r.stderr or "").strip()[:800])
else:
    print("PORT NOT FOUND")

time.sleep(0.5)
p.kill()
subprocess.run(["taskkill", "/F", "/IM", "bzwidget.exe"], capture_output=True)
print("exe killed")

out = os.path.join(BASE, "admin-window.png")
print("shot exists:", os.path.exists(out), os.path.getsize(out) if os.path.exists(out) else 0)
