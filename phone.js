#!/usr/bin/env node
// phone: let any agent read and drive the paired Android phone over adb, by label.
// Reads the screen with `uiautomator dump`, acts with `input`. No helper app, no deps.
'use strict';
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const STATE = path.join(os.homedir(), '.cache', 'phone', 'last.json');
const KEYS = { back: 4, home: 3, enter: 66, del: 67, recent: 187, wake: 224, power: 26, tab: 61, up: 19, down: 20 };

function adb(args, opts = {}) {
  return execFileSync('adb', args, { encoding: 'utf8', timeout: 20000, maxBuffer: 32 << 20, stdio: ['ignore', 'pipe', 'pipe'], ...opts });
}
// adb shell can exit 0 after a Java exception, so check the output too.
function sh(cmd) {
  const out = adb(['shell', cmd]);
  if (/^Exception occurred|SecurityException/m.test(out)) throw Object.assign(new Error(out), { stderr: out });
  return out;
}
// Quote for the phone's /system/bin/sh.
const q = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

const decode = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&apos;/g, "'").replace(/&#10;/g, ' ').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&amp;/g, '&');

// uiautomator XML -> the elements worth showing an agent, numbered e1, e2, ...
function parse(xml) {
  const out = [];
  for (const m of xml.matchAll(/<node ([^>]*?)\/?>/g)) {
    const a = {};
    for (const [, k, v] of m[1].matchAll(/([\w-]+)="([^"]*)"/g)) a[k] = decode(v);
    const b = (a.bounds || '').match(/\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]/);
    if (!b) continue;
    const [x1, y1, x2, y2] = b.slice(1).map(Number);
    if (x2 <= x1 || y2 <= y1) continue;
    const cls = a.class || '';
    const field = /EditText/.test(cls);
    const id = (a['resource-id'] || '').split('/').pop();
    let label = (a.text || '').trim() || (a['content-desc'] || '').trim();
    const checkable = a.checkable === 'true', clickable = a.clickable === 'true' || a['long-clickable'] === 'true';
    const scroll = a.scrollable === 'true';
    if (!label && !field && !checkable && !(clickable && id) && !scroll) continue;
    if (!label) label = id || cls.split('.').pop();
    if (field && a.password === 'true') label = '[password]';
    const kind = checkable ? 'sw' : field ? 'field' : scroll ? 'scroll' : clickable ? 'btn' : 'text';
    let state = '';
    if (checkable) state = a.checked === 'true' ? '=on' : '=off';
    if (a.enabled === 'false') state += ' [disabled]';
    if (a.focused === 'true') state += ' [focused]';
    out.push({ kind, label: label.replace(/\s+/g, ' ').slice(0, 80), state, x: (x1 + x2) >> 1, y: (y1 + y2) >> 1, pkg: a.package });
  }
  // A launcher icon is a button plus the same words as text; show the words once.
  const seen = new Set();
  const kept = out.filter((e) => {
    const dup = seen.has(e.label) && e.kind === 'text';
    seen.add(e.label);
    return !dup;
  });
  kept.forEach((e, i) => { e.id = `e${i + 1}`; });
  return kept;
}

function dump() {
  const xml = sh('uiautomator dump /sdcard/.phone-ui.xml >/dev/null 2>&1; cat /sdcard/.phone-ui.xml');
  if (!xml.includes('<hierarchy')) throw new Error('could not read the screen (is the phone connected and unlocked? try: phone key wake)');
  const els = parse(xml);
  fs.mkdirSync(path.dirname(STATE), { recursive: true });
  fs.writeFileSync(STATE, JSON.stringify(els));
  return els;
}

function look() {
  const els = dump();
  const app = (sh('dumpsys window 2>/dev/null | grep mCurrentFocus').match(/ (\S+)\}/) || [])[1] || els[0]?.pkg || '?';
  return [`app: ${app}`, ...els.map((e) => `${e.id} ${e.kind} ${e.label}${e.state}`)].join('\n');
}

// "e4" from the last look, "x,y", or a label (exact match first, then contains) on a fresh dump.
function find(target) {
  const xy = target.match(/^(\d+),(\d+)$/);
  if (xy) return { x: +xy[1], y: +xy[2], label: target };
  if (/^e\d+$/.test(target)) {
    const els = fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, 'utf8')) : [];
    const e = els.find((el) => el.id === target);
    if (!e) throw new Error(`${target} is not on the last screen, run: phone look`);
    return e;
  }
  return pick(dump(), target);
}

function pick(els, target) {
  const t = target.toLowerCase();
  let hits = els.filter((e) => e.label.toLowerCase() === t);
  if (!hits.length) hits = els.filter((e) => e.label.toLowerCase().includes(t));
  if (!hits.length) throw new Error(`nothing labelled "${target}" on screen`);
  const tappable = hits.filter((e) => e.kind !== 'text');
  if (tappable.length === 1) return tappable[0];
  if (hits.length > 1) throw new Error(`"${target}" matches ${hits.length}: ${hits.map((e) => `${e.id} ${e.label}`).join(' | ')}; use the e-number`);
  return hits[0];
}

const settle = () => execFileSync('sleep', ['0.8']);

function act(cmd, args) {
  const rest = args.join(' ');
  switch (cmd) {
    case 'tap': case 'long': {
      const e = find(rest);
      sh(cmd === 'tap' ? `input tap ${e.x} ${e.y}` : `input swipe ${e.x} ${e.y} ${e.x} ${e.y} 700`);
      return `${cmd === 'tap' ? 'tapped' : 'long-pressed'} ${e.label}`;
    }
    case 'type':
      // shortcut: `input text` is ASCII only; for other text paste it with the clipboard by hand.
      if (/[^\x20-\x7e]/.test(rest)) throw new Error('type only handles plain ASCII text');
      sh(`input text ${q(rest.replace(/%/g, '%%').replace(/ /g, '%s'))}`);
      return `typed ${rest.length} chars`;
    case 'key': {
      const code = KEYS[rest.toLowerCase()] ?? (/^\d+$/.test(rest) ? rest : null);
      if (code == null) throw new Error(`unknown key "${rest}", one of: ${Object.keys(KEYS).join(' ')}`);
      sh(`input keyevent ${code}`);
      return `pressed ${rest}`;
    }
    case 'swipe': {
      const [w, h] = (sh('wm size').match(/(\d+)x(\d+)\s*$/) || [, 1080, 2400]).slice(1).map(Number);
      const cx = w >> 1, cy = h >> 1, dy = Math.round(h * 0.3), dx = Math.round(w * 0.35);
      const v = { up: [cx, cy + dy, cx, cy - dy], down: [cx, cy - dy, cx, cy + dy], left: [cx + dx, cy, cx - dx, cy], right: [cx - dx, cy, cx + dx, cy] }[rest];
      if (!v) throw new Error('swipe up|down|left|right (up scrolls the page down)');
      sh(`input swipe ${v.join(' ')} 300`);
      return `swiped ${rest}`;
    }
    case 'open': {
      let pkg = rest;
      if (!rest.includes('.')) {
        const pkgs = sh('pm list packages').split('\n').map((l) => l.replace('package:', '').trim()).filter((p) => p.toLowerCase().includes(rest.toLowerCase()));
        if (pkgs.length !== 1) throw new Error(pkgs.length ? `"${rest}" matches ${pkgs.join(', ')}; give the package` : `no app matching "${rest}"`);
        pkg = pkgs[0];
      }
      sh(`monkey -p ${q(pkg)} -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1`);
      return `opened ${pkg}`;
    }
    case 'url':
      sh(`am start -a android.intent.action.VIEW -d ${q(rest)} >/dev/null`);
      return `opened ${rest}`;
  }
  return null;
}

const HELP = `phone: read and drive the Android phone (adb on PATH; set ANDROID_SERIAL if several devices)
  phone look                 what is on screen: e-numbered elements (btn, sw=on/off, field, text, scroll)
  phone tap <eN|label|x,y>   tap; a label matches exact text first, then contains
  phone long <eN|label|x,y>  long-press
  phone type <text>          type into the focused field (ASCII; tap the field first)
  phone key <name>           ${Object.keys(KEYS).join(' ')}
  phone swipe <up|down|left|right>
  phone open <app|package>   e.g. phone open chrome
  phone url <url>            open a link in the default browser/app
  phone shot <file.png>      screenshot
Every action prints the screen it led to. On Xiaomi, taps/typing also need "USB debugging (Security settings)".`;

function main(argv) {
  const [cmd, ...args] = argv;
  if (!cmd || cmd === 'help' || cmd === '-h' || cmd === '--help') return console.log(HELP);
  if (cmd === 'look') return console.log(look());
  if (cmd === 'shot') {
    if (!args[0]) throw new Error('phone shot <file.png>');
    fs.writeFileSync(args[0], adb(['exec-out', 'screencap', '-p'], { encoding: 'buffer' }));
    return console.log(`saved ${args[0]}`);
  }
  if (!args.length) throw new Error(`phone ${cmd} needs an argument, see: phone help`);
  const done = act(cmd, args);
  if (done == null) throw new Error(`unknown command "${cmd}", see: phone help`);
  settle();
  console.log(`${done}\n${look()}`);
}

if (require.main === module) {
  try { main(process.argv.slice(2)); } catch (e) {
    const msg = String(e.stderr || e.message || e);
    console.error(/INJECT_EVENTS/.test(msg)
      ? 'input blocked by the phone. On Xiaomi/Redmi/POCO turn on Developer options > "USB debugging (Security settings)"'
      : msg.trim().split('\n').slice(-3).join('\n'));
    process.exit(1);
  }
}
module.exports = { parse, pick };
