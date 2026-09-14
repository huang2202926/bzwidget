"""启动打包后的 exe，验证内置后台与接口是否正常。"""
import subprocess, socket, time, json, os, urllib.request, sys

EXE = r"C:\Users\Administrator\WorkBuddy\2026-09-11-17-15-47\momoyu-widget\dist\win-unpacked\bzwidget.exe"
LOG = os.path.join(os.path.expanduser("~"), ".momoyu-widget", "startup.log")

try:
    open(LOG, "w").close()
except Exception:
    pass

env = dict(os.environ)
env.pop("ELECTRON_RUN_AS_NODE", None)   # 关键：否则 electron 会以 node 模式启动

p = subprocess.Popen([EXE], env=env, stdout=subprocess.PIPE,
                     stderr=subprocess.STDOUT, text=True, errors="replace")

def probe(port):
    s = socket.socket(); s.settimeout(0.2)
    r = s.connect_ex(("127.0.0.1", port)) == 0
    s.close()
    return r

port = None
for i in range(40):
    if p.poll() is not None:
        print("PROCESS EXITED EARLY, code =", p.returncode); break
    for cand in range(3456, 3477):
        if probe(cand):
            port = cand; break
    if port:
        print("exe server up after %.1fs on port %d" % ((i + 1) * 0.5, port)); break
    time.sleep(0.5)

if port:
    def http(method, path, body=None):
        req = urllib.request.Request("http://127.0.0.1:%d%s" % (port, path), method=method)
        if body is not None:
            req.add_header("Content-Type", "application/json")
            req.data = json.dumps(body).encode()
        with urllib.request.urlopen(req, timeout=3) as r:
            return r.status, r.read().decode("utf-8")
    print("GET  /api/today   ->", http("GET", "/api/today"))
    print("POST /api/update  ->", http("POST", "/api/update",
          {"monthlySalary": 15000, "workDaysPerMonth": 21.75,
           "workStartTime": "08:00", "workEndTime": "18:00",
           "breakStartTime": "12:00", "breakEndTime": "13:00", "paydayDay": 15,
           "status": "搬砖中·exe验证", "studyStatus": "学习中·exe验证"}))
    print("GET  /api/today   ->", http("GET", "/api/today"))
    print("POST stealthMode=false ->", http("POST", "/api/update", {"stealthMode": False}))
    print("GET  /api/today（关闭后）->", http("GET", "/api/today"))
    print("POST stealthMode=true  ->", http("POST", "/api/update", {"stealthMode": True}))
    print("GET  /api/today（开启后）->", http("GET", "/api/today"))
    st, html = http("GET", "/")
    checks = {
        "后台设置": "后台设置" in html,
        "24小时制时间输入": 'type="time"' in html,
        "workStartTime 字段": 'id="workStartTime"' in html,
        "workEndTime 字段": 'id="workEndTime"' in html,
        "午休字段 breakStartTime": 'id="breakStartTime"' in html,
        "午休字段 breakEndTime": 'id="breakEndTime"' in html,
        "偷偷摸摸区块": "偷偷摸摸" in html,
        "开启后说明文案": "开启后界面文案切换为学习风格，降低划水观感" in html,
        "关闭/开启按钮": 'data-mode="off"' in html and 'data-mode="on"' in html,
        "学习状态文字字段": 'id="studyStatus"' in html,
        "模式切换脚本": "function setMode" in html,
        "首屏套用模式": "applyMode(stealth);" in html,
        "学习模式页面标题": "学习进度 · 后台设置" in html,
        "已移除在线人数": "onlineCount" not in html,
    }
    print("GET  /  status=%d len=%d" % (st, len(html)))
    for k, v in checks.items():
        print("   %-18s %s" % (k, "OK" if v else "FAIL"))

time.sleep(2)
p.kill()
try:
    out, _ = p.communicate(timeout=5)
except Exception:
    out = ""

print("--- startup.log ---")
try:
    print(open(LOG, encoding="utf-8", errors="replace").read())
except Exception as e:
    print("no log:", e)
print("--- child stdout ---")
print((out or "(empty)")[:2000])
