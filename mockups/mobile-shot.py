#!/usr/bin/env python3
"""Screenshot taakl with real mobile emulation (CDP): iPhone-ish 390x844 DPR3,
mobile UA + touch. Usage: mobile_shot.py <url> <out.png> [setup-js] [settle-ms]
"""
import json, subprocess, sys, tempfile, time, urllib.request, base64, os, signal

import websocket

url, out = sys.argv[1], sys.argv[2]
setup_js = sys.argv[3] if len(sys.argv) > 3 else ''
settle = int(sys.argv[4]) if len(sys.argv) > 4 else 1800

profile = tempfile.mkdtemp(prefix='ttmob')
port = 9333
proc = subprocess.Popen([
    'google-chrome', '--headless=new', '--disable-gpu', '--no-first-run',
    '--remote-debugging-port=%d' % port, '--remote-allow-origins=*',
    '--user-data-dir=%s' % profile,
    'about:blank'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
try:
    ws_url = None
    for _ in range(50):
        try:
            tabs = json.load(urllib.request.urlopen('http://localhost:%d/json' % port))
            page = [t for t in tabs if t['type'] == 'page'][0]
            ws_url = page['webSocketDebuggerUrl']
            break
        except Exception:
            time.sleep(0.2)
    ws = websocket.create_connection(ws_url, timeout=30)
    mid = [0]
    def cmd(method, params=None):
        mid[0] += 1
        ws.send(json.dumps({'id': mid[0], 'method': method, 'params': params or {}}))
        while True:
            msg = json.loads(ws.recv())
            if msg.get('id') == mid[0]:
                if 'error' in msg:
                    raise RuntimeError(method + ': ' + json.dumps(msg['error']))
                return msg.get('result', {})

    cmd('Emulation.setDeviceMetricsOverride', {
        'width': 390, 'height': 844, 'deviceScaleFactor': 3, 'mobile': True})
    cmd('Emulation.setTouchEmulationEnabled', {'enabled': True, 'maxTouchPoints': 5})
    cmd('Emulation.setUserAgentOverride', {'userAgent':
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 '
        '(KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'})
    cmd('Page.enable')
    cmd('Page.navigate', {'url': url})
    time.sleep(2.0)
    if setup_js:
        cmd('Runtime.evaluate', {'expression': setup_js, 'awaitPromise': False})
    time.sleep(settle / 1000.0)
    shot = cmd('Page.captureScreenshot', {'format': 'png'})
    open(out, 'wb').write(base64.b64decode(shot['data']))
    # report layout diagnostics
    diag = cmd('Runtime.evaluate', {'expression': """
      (function(){
        var d=document, r=[];
        r.push('scrollW='+d.documentElement.scrollWidth+'/'+window.innerWidth);
        var bar=d.getElementById('active-session');
        if(bar && bar.classList.contains('collapsed')) r.push('barH='+bar.offsetHeight);
        var c=d.getElementById('container');
        if(c) r.push('padTop='+getComputedStyle(c).paddingTop);
        return r.join(' | ');
      })()""", 'returnByValue': True})
    print(out, '::', diag['result'].get('value'))
    ws.close()
finally:
    proc.terminate()
    try:
        proc.wait(timeout=5)
    except Exception:
        proc.kill()
    subprocess.run(['rm', '-rf', profile])
