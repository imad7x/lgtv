#!/usr/bin/env node
// Minimal client for the LG webOS remote-control API (SSAP over wss://TV:3001).
// Usage:
//   lgtv pair                      show the "Allow?" prompt on the TV and save the client key
//   lgtv call <ssap-uri> [json]    one SSAP request, prints the response payload
//   lgtv luna <luna-uri> [json]    run a luna call through the system alert trick (no result returned)
//   lgtv btn <NAME>...             press remote buttons (HOME BACK UP DOWN LEFT RIGHT ENTER MENU ...)
//   lgtv shot <file.png>           screenshot of whatever is on screen
//   lgtv apps                      installed apps (id, title, flags)
//   lgtv launch <appId> [json]     launch an app with optional params
//   lgtv fg                        foreground app
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'; // the TV uses a self-signed certificate
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const HOST = process.env.LGTV_HOST || '192.168.0.66';
const DIR = path.join(os.homedir(), '.local/share/lgtv');
const KEYFILE = path.join(DIR, 'client-key');
const pairing = JSON.parse(fs.readFileSync(path.join(DIR, 'pairing.json'), 'utf8'));
const sleep = ms => new Promise(r => setTimeout(r, ms));

function connect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.onopen = () => resolve(ws);
    ws.onerror = e => reject(new Error('websocket error ' + (e.message || url)));
  });
}

export class Tv {
  constructor() { this.id = 0; this.pending = new Map(); this.subs = new Map(); }
  // allowPrompt=false: never put the pairing prompt on screen (long-running callers like the watcher)
  async open(timeoutMs = 15000, allowPrompt = true) {
    // the TV sometimes refuses a socket right after another one closed
    for (let i = 0; ; i++) {
      try { this.ws = await connect(`wss://${HOST}:3001`); break; }
      catch (e) { if (i >= 3) throw e; await sleep(1500); }
    }
    this.ws.onclose = () => {
      for (const p of this.pending.values()) p.reject(new Error('closed'));
      this.onclose && this.onclose();
    };
    this.ws.onmessage = ev => {
      const m = JSON.parse(ev.data);
      const sub = this.subs.get(m.id);
      if (sub) { sub(m.payload || {}); return; }
      const p = this.pending.get(m.id);
      if (!p) return;
      if (m.type === 'response' && m.payload && m.payload.pairingType === 'PROMPT') {
        if (!allowPrompt) {
          this.pending.delete(m.id); this.ws.close();
          p.reject(new Error('not paired (client key rejected); run: lgtv pair'));
          return;
        }
        console.error('Waiting for "Allow" on the TV...');
        return;
      }
      this.pending.delete(m.id);
      if (m.type === 'error') p.reject(new Error(m.error + ' ' + JSON.stringify(m.payload || {})));
      else p.resolve(m.payload);
    };
    const key = fs.existsSync(KEYFILE) ? fs.readFileSync(KEYFILE, 'utf8').trim() : undefined;
    const payload = { ...pairing, ...(key ? { 'client-key': key } : {}) };
    const reg = await this.send('register', undefined, payload, timeoutMs);
    if (reg['client-key'] && reg['client-key'] !== key) {
      fs.writeFileSync(KEYFILE, reg['client-key'], { mode: 0o600 });
      console.error('Paired; client key saved.');
    }
    return this;
  }
  send(type, uri, payload, timeoutMs = 15000) {
    const id = type + '_' + (++this.id);
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => { this.pending.delete(id); reject(new Error('timeout ' + (uri || type))); }, timeoutMs);
      this.pending.set(id, {
        resolve: v => { clearTimeout(t); resolve(v); },
        reject: e => { clearTimeout(t); reject(e); },
      });
      this.ws.send(JSON.stringify({ type, id, ...(uri ? { uri } : {}), payload: payload || {} }));
    });
  }
  call(uri, payload, timeoutMs) { return this.send('request', uri, payload, timeoutMs); }
  subscribe(uri, payload, onEvent) {
    const id = 'sub_' + (++this.id);
    this.subs.set(id, onEvent);
    this.ws.send(JSON.stringify({ type: 'subscribe', id, uri, payload: payload || {} }));
  }
  async luna(uri, params = {}) {
    // The system runs the alert's onclose action with its own rights, so luna calls the SSAP API
    // does not expose still go through. The result is not returned.
    const action = { uri, params };
    const a = await this.call('ssap://system.notifications/createAlert', {
      message: ' ', buttons: [{ label: '', onClick: uri, params }], onclose: action, onfail: action,
    });
    await this.call('ssap://system.notifications/closeAlert', { alertId: a.alertId });
    return a;
  }
  async buttons(names, gapMs = Number(process.env.LGTV_GAP || 700)) {
    if (!this.pointer) {
      const { socketPath } = await this.call('ssap://com.webos.service.networkinput/getPointerInputSocket');
      this.pointer = await connect(socketPath);
    }
    for (const n of names) {
      this.pointer.send(`type:button\nname:${n.toUpperCase()}\n\n`);
      await sleep(gapMs);
    }
  }
  async shot(file) {
    const r = await this.call('ssap://tv/executeOneShot', { path: '/tmp/webos_capture.png', method: 'DISPLAY', format: 'PNG' }, 20000);
    const res = await fetch(r.imageUri);
    if (!res.ok) throw new Error('capture fetch ' + res.status);
    fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
    return file;
  }
  close() { try { this.pointer && this.pointer.close(); } catch {} try { this.ws.close(); } catch {} }
}

async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  const tv = new Tv();
  await tv.open(cmd === 'pair' ? 180000 : 15000);
  try {
    if (cmd === 'pair') console.log('ok');
    else if (cmd === 'call') console.log(JSON.stringify(await tv.call(args[0], args[1] ? JSON.parse(args[1]) : {}), null, 1));
    else if (cmd === 'luna') console.log(JSON.stringify(await tv.luna(args[0], args[1] ? JSON.parse(args[1]) : {})));
    else if (cmd === 'btn') await tv.buttons(args);
    else if (cmd === 'shot') console.log(await tv.shot(args[0] || 'tv.png'));
    else if (cmd === 'launch') console.log(JSON.stringify(await tv.call('ssap://system.launcher/launch', { id: args[0], ...(args[1] ? { params: JSON.parse(args[1]) } : {}) })));
    else if (cmd === 'fg') console.log(JSON.stringify(await tv.call('ssap://com.webos.applicationManager/getForegroundAppInfo')));
    else if (cmd === 'apps') {
      const r = await tv.call('ssap://com.webos.applicationManager/listApps');
      for (const a of r.apps.sort((x, y) => x.id.localeCompare(y.id)))
        console.log([a.id, a.title, a.visible === false ? 'hidden' : '', a.systemApp ? 'system' : '', a.removable ? 'removable' : '', a.version].join('\t'));
    } else console.log('commands: pair call luna btn shot apps launch fg');
  } finally { tv.close(); }
}
if (import.meta.url === `file://${process.argv[1]}`) main().catch(e => { console.error(e.message); process.exit(1); });
