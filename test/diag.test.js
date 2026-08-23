import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveTheme } from '../src/diag/theme.js';
import { renderDiagnostic, displayWidth, expandLine } from '../src/diag/render.js';

const SRC = 'let total = (a + b))\nlet ok = 1\n';

function diag(overrides = {}) {
  return {
    severity: 'error',
    kind: 'syntax',
    code: 'E0203',
    message: 'unexpected `)`',
    filePath: 'examples/calc.em',
    line: 1,
    col: 18,
    endCol: 19,
    help: 'remove the extra `)`',
    ...overrides
  };
}

const off = { enabled: false, paint: (_r, t) => t };

test('plain diagnostic block matches snapshot', () => {
  assert.equal(renderDiagnostic(diag(), SRC, off),
    'error[E0203]: unexpected `)`\n' +
    '  --> examples/calc.em:1:18\n' +
    '  |\n' +
    '1 | let total = (a + b))\n' +
    '  |                  ^\n' +
    '  |\n' +
    'help: remove the extra `)`\n\n');
});

test('no excerpt when no source text, location and help still render', () => {
  assert.equal(renderDiagnostic(diag(), null, off),
    'error[E0203]: unexpected `)`\n' +
    '  --> examples/calc.em:1:18\n' +
    'help: remove the extra `)`\n\n');
});

test('no excerpt or location for spanless runtime errors', () => {
  const out = renderDiagnostic(diag({ line: null, col: null, endCol: null, filePath: null }), null, off);
  assert.equal(out,
    'error[E0203]: unexpected `)`\nhelp: remove the extra `)`\n\n');
});

test('caret spans full token width', () => {
  // cols 13..18 -> display cells 12..17 -> five carets
  const out = renderDiagnostic(diag({ col: 13, endCol: 18 }), SRC, off);
  const lines = out.split('\n');
  assert.equal(lines[3], '1 | let total = (a + b))');
  assert.equal(lines[4], '  |             ^^^^^');
});

test('tabs expand and caret stays under token', () => {
  const src = '\tlet x = 42\n';
  const out = renderDiagnostic(diag({ code: 'E0101', message: 'invalid character `?`', col: 10, endCol: 11, help: null }), src, off);
  const lines = out.split('\n');
  assert.equal(lines[2], '  |');            // tab expands to 4 cells
  assert.equal(lines[3], '1 |     let x = 42');
  // tab fills cells 0-3; eight 1-cell chars follow; token lands at cell 12
  assert.equal(lines[4], '  |             ^');
});

test('wide CJK character shifts caret correctly', () => {
  const src = '名 + 1\n';
  const out = renderDiagnostic(diag({ code: 'E0304', message: 'cannot add `int` and `string`', filePath: 'w.em', col: 5, endCol: 6, help: null }), src, off);
  const lines = out.split('\n');
  assert.equal(lines[3], '1 | 名 + 1');
  // 名 takes cells 0-1; col 5 is the 5th code point (`1`), which sits at cell 5
  assert.equal(lines[4], '  |      ^');
});

test('long lines elide with marker and stay within budget', () => {
  const long = 'x'.repeat(200);
  const src = 'print("' + long + '")\n';
  const out = renderDiagnostic(diag({ col: 8, endCol: 208, help: null }), src, off);
  const lines = out.split('\n');
  assert.ok(displayWidth(lines[3]) <= 125, 'elided excerpt within budget');
  assert.ok(lines[3].includes(MARKER_CHECK));
  assert.ok(lines[4].trimEnd().length > 0, 'caret row present');
});
const MARKER_CHECK = '...';

test('multi-digit gutter aligns rule rows', () => {
  const src = Array.from({ length: 11 }, (_, i) => 'let v' + i + ' = ' + i).join('\n');
  const out = renderDiagnostic(diag({ line: 11, col: 1, endCol: 4, filePath: 'm.em' }), src, off);
  const lines = out.split('\n');
  assert.equal(lines[2], '   |');
  assert.equal(lines[3], '11 | let v10 = 10');
  assert.equal(lines[4], '   | ^^^');
});

test('colored dark theme wraps roles', () => {
  const color = resolveTheme({ themeName: 'dark', stream: fakeTTY() });
  assert.equal(color.enabled, true);
  const out = renderDiagnostic(diag(), SRC, color);
  assert.ok(out.includes('\x1b[1;31merror\x1b[0m'));
  assert.ok(out.includes('\x1b[36m`)`\x1b[0m'));
  assert.ok(out.includes('\x1b[31m^\x1b[0m'));
  assert.ok(out.includes('\x1b[32mhelp: \x1b[0m'));
});

test('light theme differs from dark', () => {
  const light = resolveTheme({ themeName: 'light', stream: fakeTTY() });
  const dark = resolveTheme({ themeName: 'dark', stream: fakeTTY() });
  const l = renderDiagnostic(diag(), SRC, light);
  const d = renderDiagnostic(diag(), SRC, dark);
  assert.notEqual(l, d);
  assert.ok(l.includes('\x1b[31merror\x1b[0m'));       // light error not bold
  assert.ok(d.includes('\x1b[1;31merror\x1b[0m'));
});

test('colour disabled via NO_COLOR env', () => {
  const c = resolveTheme({ stream: fakeTTY(), env: { NO_COLOR: '1' } });
  assert.equal(c.enabled, false);
});

test('colour disabled when stream is not a TTY', () => {
  const c = resolveTheme({ stream: { isTTY: false }, env: {} });
  assert.equal(c.enabled, false);
});

test('unknown theme falls back to dark with warning on stderr', () => {
  const sink = [];
  const orig = process.stderr.write;
  process.stderr.write = (s) => { sink.push(s); return true; };
  try {
    const c = resolveTheme({ themeName: 'solarflare', stream: fakeTTY() });
    assert.equal(c.themeName, 'dark');
  } finally {
    process.stderr.write = orig;
  }
  assert.match(sink.join(''), /unknown theme `solarflare`/);
});

test('internal error renders bug notice without stack', () => {
  const out = renderDiagnostic(diag({ severity: 'internal', code: 'E9901', message: 'eval fell off a cliff', help: null, line: null, col: null, endCol: null, filePath: null }), SRC, off);
  assert.equal(out,
    'internal[E9901]: eval fell off a cliff\n\nthis is a bug in Ember, not in your program\n\n');
});

test('endCol past end of line clamps to line width', () => {
  const raw = SRC.split('\n')[0];
  const out = renderDiagnostic(diag({ col: 15, endCol: 999, help: null }), SRC, off);
  const caretRow = out.split('\n')[4];
  const expectedCarets = raw.length - 14; // cells 14..20 inclusive
  assert.equal(caretRow, '  | ' + ' '.repeat(14) + '^'.repeat(expectedCarets));
});

test('displayWidth counts wide chars as two cells', () => {
  assert.equal(displayWidth('ab'), 2);
  assert.equal(displayWidth('名'), 2);
  assert.equal(expandLine('\ta').text.startsWith('    '), true);
});

function fakeTTY() {
  return { isTTY: true, write: () => {} };
}
