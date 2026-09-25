#!/usr/bin/env python3
"""Headless regression test for the auto-sync mid-typing clobber bug.

Drives the real app in headless Chrome:
1. Add a new task, type first letter (queues the insert), keep typing.
2. Inject a server echo carrying the stale first-letter name while the
   editor is focused -> name and textarea must keep the full typed text.
3. Same for the node-view notes editor (text + focus must survive a
   sync-triggered re-render and a stale echo).
4. Check applyServerChanges defers echoes for uuids still in synchQueue.
5. Check the finalize baseline survives a mid-edit re-render (blur still
   queues the update).

Usage: python3 mockups/sync-clobber-test.py   (from anywhere; serves the
repo itself, needs google-chrome + python3-websocket like mobile-shot.py)
"""
import json, subprocess, sys, tempfile, time, urllib.request, os, signal

import websocket

SITE_PORT = 8127
APP = 'http://localhost:%d/index.html' % SITE_PORT
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

site = subprocess.Popen(
    ['php', '-S', 'localhost:%d' % SITE_PORT, '-t', REPO],
    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

profile = tempfile.mkdtemp(prefix='ttsynctest')
port = 9334
chrome = subprocess.Popen([
    'google-chrome', '--headless=new', '--disable-gpu', '--no-first-run',
    '--remote-debugging-port=%d' % port, '--remote-allow-origins=*',
    '--user-data-dir=%s' % profile,
    'about:blank'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

def cleanup():
    chrome.send_signal(signal.SIGTERM)
    site.send_signal(signal.SIGTERM)

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

    def js(expr, await_promise=False):
        r = cmd('Runtime.evaluate', {
            'expression': expr, 'awaitPromise': await_promise,
            'returnByValue': True})
        if r.get('exceptionDetails'):
            raise RuntimeError(json.dumps(r['exceptionDetails'])[:800])
        return r['result'].get('value')

    def step(expr):
        """Run expr, then wait past the debounced re-render."""
        return js('new Promise(function(res){ var v = (function(){ %s })(); '
                  'setTimeout(function(){ res(v); }, 80); })' % expr, True)

    cmd('Page.enable')
    cmd('Emulation.setFocusEmulationEnabled', {'enabled': True})
    cmd('Page.navigate', {'url': APP})
    for _ in range(60):
        try:
            if js("typeof ttData !== 'undefined' && typeof treeView !== 'undefined'"):
                break
        except RuntimeError:
            pass
        time.sleep(0.3)
    else:
        raise RuntimeError('app never loaded')
    time.sleep(0.5)

    results = {}

    # --- Scenario 1: tree view, new task, stale echo while typing ---
    step("localStorage.clear(); ttData.nodes = {}; ttData.rootOrder = []; "
         "synchQueue.queue = []; ttData.synchQueue = []; "
         "setView('taskList');")
    step("treeView.addFirst();")
    step("var ta = document.querySelector('.tree-text');"
         "ta.focus(); ta.value = 'B';"
         "ta.dispatchEvent(new Event('input'));")   # promotion + insert queued
    step("var ta = document.activeElement;"
         "ta.value = 'Buy groceries';"
         "ta.dispatchEvent(new Event('input'));")
    results['insert_queued'] = js(
        "synchQueue.queue.length === 1 && synchQueue.queue[0].action === 'insert'")
    nid = js("ttData.rootOrder[0]")
    # simulate: push happened (queue spliced), echo arrives with stale name
    results['echo_deferred_mid_edit'] = step(
        "synchQueue.queue = []; ttData.synchQueue = [];"
        "var d = applyServerChanges([{action:'insert', type:'node', uuid:'%s',"
        " parentUuid:null, data:{name:'B', type:'task', childOrder:[]}}]);"
        "emitEvent('server','synch'); return d;" % nid)
    results['name_survives'] = js("getNode('%s').name" % nid)
    results['textarea_survives'] = js(
        "var el = document.querySelector('.tree-text[data-node-id=\"%s\"]');"
        "el ? el.value : null" % nid)
    results['focus_survives'] = js(
        "document.activeElement && "
        "document.activeElement.getAttribute('data-node-id') === '%s'" % nid)

    # --- Scenario 2: finalize baseline survives the re-render; blur queues update ---
    results['baseline_kept'] = js(
        "treeView.originalValues['%s'] && treeView.originalValues['%s'].name === ''" % (nid, nid))
    step("document.activeElement.blur();")
    results['update_queued_on_blur'] = js(
        "synchQueue.queue.length === 1 && synchQueue.queue[0].uuid === '%s' && "
        "synchQueue.queue[0].data.name === 'Buy groceries'" % nid)

    # --- Scenario 3: echo skipped while a local change is still queued ---
    results['queued_echo_deferred'] = js(
        "applyServerChanges([{action:'insert', type:'node', uuid:'%s',"
        " parentUuid:null, data:{name:'stale', type:'task', childOrder:[]}}])" % nid)
    results['queued_echo_no_clobber'] = js("getNode('%s').name" % nid)
    step("synchQueue.queue = []; ttData.synchQueue = [];")

    # --- Scenario 4: unfocused changes still apply normally ---
    results['normal_apply'] = step(
        "var d = applyServerChanges([{action:'update', type:'node', uuid:'%s',"
        " parentUuid:null, data:{name:'Renamed remotely', type:'task', childOrder:[]}}]);"
        "emitEvent('server','synch'); return d;" % nid)
    results['normal_apply_name'] = js("getNode('%s').name" % nid)

    # --- Scenario 5: notes editor survives re-render + stale echo ---
    step("treeView.viewingNodeId = '%s'; treeView.update();" % nid)
    step("var nt = document.querySelector('.node-view-notes-textarea');"
         "nt.parentElement.style.display = 'block';"
         "nt.focus(); nt.value = 'half-typed note';"
         "nt.dispatchEvent(new Event('input'));")
    results['notes_echo_deferred'] = step(
        "var d = applyServerChanges([{action:'update', type:'node', uuid:'%s',"
        " parentUuid:null, data:{name:'Renamed remotely', type:'task',"
        " childOrder:[], notes:''}}]);"
        "emitEvent('server','synch'); return d;" % nid)
    results['notes_survive'] = js("getNode('%s').notes" % nid)
    results['notes_textarea'] = js(
        "var el = document.querySelector('.node-view-notes-textarea');"
        "el ? el.value : null")
    results['notes_focus'] = js(
        "document.activeElement && document.activeElement.className"
        ".indexOf('node-view-notes-textarea') !== -1")
    step("document.activeElement.blur();")
    results['notes_update_queued_on_blur'] = js(
        "synchQueue.queue.length >= 1 && "
        "synchQueue.queue[synchQueue.queue.length-1].data.notes === 'half-typed note'")

    print(json.dumps(results, indent=2))
    expected = {
        'insert_queued': True,
        'echo_deferred_mid_edit': True,
        'name_survives': 'Buy groceries',
        'textarea_survives': 'Buy groceries',
        'focus_survives': True,
        'baseline_kept': True,
        'update_queued_on_blur': True,
        'queued_echo_deferred': True,
        'queued_echo_no_clobber': 'Buy groceries',
        'normal_apply': False,
        'normal_apply_name': 'Renamed remotely',
        'notes_echo_deferred': True,
        'notes_survive': 'half-typed note',
        'notes_textarea': 'half-typed note',
        'notes_focus': True,
        'notes_update_queued_on_blur': True,
    }
    failed = [k for k, v in expected.items() if results.get(k) != v]
    if failed:
        print('FAILED: ' + ', '.join(failed))
        sys.exit(1)
    print('ALL PASS')
finally:
    cleanup()
