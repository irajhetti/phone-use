'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { parse, pick } = require('./phone.js');

const n = (attrs) => `<node ${Object.entries({ text: '', 'resource-id': '', class: 'android.view.View', package: 'p', 'content-desc': '', checkable: 'false', checked: 'false', clickable: 'false', enabled: 'true', focused: 'false', scrollable: 'false', password: 'false', bounds: '[0,0][100,100]', ...attrs }).map(([k, v]) => `${k}="${v}"`).join(' ')} />`;
const xml = `<hierarchy>${[
  n({ class: 'android.widget.FrameLayout' }), // empty container: dropped
  n({ text: 'Wi-Fi &amp; network', clickable: 'true', bounds: '[0,100][1080,200]' }),
  n({ text: 'Airplane mode', checkable: 'true', checked: 'true', bounds: '[0,200][1080,300]' }),
  n({ class: 'android.widget.EditText', password: 'true', text: 'secret' }),
  n({ 'content-desc': 'Search', clickable: 'true' }),
  n({ text: 'Search results' }),
].join('')}</hierarchy>`;

test('parse keeps labelled and interactive elements, hides passwords', () => {
  const els = parse(xml);
  assert.deepStrictEqual(els.map((e) => `${e.id} ${e.kind} ${e.label}${e.state}`), [
    'e1 btn Wi-Fi & network', 'e2 sw Airplane mode=on', 'e3 field [password]', 'e4 btn Search', 'e5 text Search results',
  ]);
  assert.deepStrictEqual([els[0].x, els[0].y], [540, 150]);
});

test('pick prefers exact label, then the only tappable contains-match, else refuses', () => {
  const els = parse(xml);
  assert.strictEqual(pick(els, 'search').id, 'e4');
  assert.strictEqual(pick(els, 'airplane').id, 'e2');
  assert.throws(() => pick(els, 'nope'), /nothing labelled/);
  assert.throws(() => pick(parse(xml + xml), 'Airplane mode'), /matches 2/);
});

test('a button and its own caption show once', () => {
  const dupXml = `<hierarchy>${n({ text: 'Chrome', clickable: 'true' })}${n({ text: 'Chrome' })}${n({ text: 'Chrome' })}</hierarchy>`;
  assert.deepStrictEqual(parse(dupXml).map((e) => `${e.id} ${e.kind} ${e.label}`), ['e1 btn Chrome']);
});
