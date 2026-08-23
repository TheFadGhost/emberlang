// Regression tests for findings from the pre-1.0 independent audits.
// Each test names the defect it pins; see AUDIT.md for the round that
// produced it. If one of these fails, an audit finding has regressed.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tokenize } from '../src/lexer.js';
import { parse } from '../src/parser.js';
import { Interpreter } from '../src/interpreter.js';
import { equals } from '../src/interp/values.js';
import { syntaxError } from '../src/errors.js';
import { renderDiagnostic } from '../src/diag/render.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bin = path.join(root, 'bin', 'ember.js');

function runSrc(src) {
  const program = parse(tokenize(src, 'audit.em'), 'audit.em');
  return new Interpreter().run(program, { filePath: 'audit.em' });
}

function runCli(args) {
  return spawnSync(process.execPath, [bin, ...args], { cwd: root, encoding: 'utf8' });
}

function parseExpectThrow(src, code) {
  try {
    parse(tokenize(src, 'audit.em'), 'audit.em');
  } catch (e) {
    assert.equal(e.code, code);
    return e;
  }
  assert.fail('expected a parse error for: ' + src.slice(0, 60));
}

test('finding 1: unary chains hit E0206, not a host stack overflow', () => {
  const err = parseExpectThrow('-'.repeat(100_000) + '1', 'E0206');
  assert.match(err.message, /nested more than \d+ levels deep/);
});

test('finding 2: deeply nested blocks hit E0206, not a host stack overflow', () => {
  const deep = '{'.repeat(5000);
  const err = parseExpectThrow(deep, 'E0206');
  assert.match(err.message, /blocks nested more than/);
});

test('finding 2b: nested if-blocks are covered by the same guard', () => {
  const n = 3000;
  const prog = 'if true ' + '{ '.repeat(n) + '}'.repeat(n);
  const err = parseExpectThrow(prog, 'E0206');
  assert.ok(err.line >= 1);
});

test('finding 3: cyclic arrays compare without crashing', () => {
  const a = [1, 2];
  a.push(a);
  const b = [1, 2];
  b.push(b);
  assert.equal(equals(a, b), true);
  const c = [1, 3];
  c.push(c);
  assert.equal(equals(a, c), false);
});

test('finding 3b: cyclic maps compare and differ cleanly', () => {
  const m = new Map([['self', null]]);
  m.set('self', m);
  const n = new Map([['self', null]]);
  n.set('self', n);
  assert.equal(equals(m, n), true);
  const o = new Map([['self', null], ['other', 1]]);
  o.set('self', o);
  assert.equal(equals(m, o), false);
});

test('finding 3c: very deep acyclic structures compare iteratively', () => {
  let a = 1;
  let b = 1;
  for (let i = 0; i < 20_000; i++) {
    a = [a];
    b = [b];
  }
  assert.equal(equals(a, b), true);
  b = [2];
  for (let i = 0; i < 19_999; i++) b = [b];
  assert.equal(equals(a, b), false);
});

test('finding 4: min/max handle large arrays without argument spread', () => {
  assert.equal(runSrc('print(min(range(200000)))'), undefined ?? null);
});

test('finding 5: malformed parameter lists are rejected', () => {
  try {
    runSrc('fn f(a,,b) { return a } print(f)');
    assert.fail('fn f(a,,b) must not parse');
  } catch (e) {
    assert.equal(e.kind, 'syntax');
    assert.match(e.message, /parameter name/);
  }
});

test('finding 6: anonymous function arity errors name the function', () => {
  try {
    runSrc('let f = fn(x) { return x } f(1, 2)');
    assert.fail('arity mismatch expected');
  } catch (e) {
    assert.equal(e.code, 'E0303');
    assert.equal(e.message, '`<anon>` expects 1 argument, got 2');
  }
});

test('finding D2: caret lands on the tail, not the marker, on elided lines', () => {
  const filler = 'x'.repeat(150);
  // Offending token sits past the elision cut (cell > 120).
  const line = 'let s = "' + filler + '" @ here\n';
  const col = line.indexOf('@') + 1;
  const out = renderDiagnostic({
    severity: 'error', kind: 'runtime', code: 'E0304',
    message: 'synthetic', filePath: 'elide.em',
    line: 1, col, endCol: col + 1, help: null
  }, line, { enabled: false, paint: (_r, t) => t });
  const caretRow = out.split('\n')[4];
  const excerptRow = out.split('\n')[3];
  // The excerpt is elided but keeps its tail; the caret must sit under the
  // '@' near the END of the rendered excerpt, not under the leading dots.
  const markerAt = excerptRow.indexOf('...');
  const caretAt = caretRow.indexOf('^');
  assert.ok(markerAt !== -1, 'excerpt was elided');
  assert.ok(caretAt > markerAt, 'caret after marker: ' + caretRow);
});

test('finding 19: non-finite numeric literals raise E0103', () => {
  const err = parseExpectThrow('print(9e999)', 'E0103');
  assert.match(err.message, /out of range/);
});

test('finding 20: meaningless flag combinations exit 2', () => {
  const r1 = runCli(['repl', '--ast']);
  assert.equal(r1.status, 2);
  assert.match(r1.stderr, /only applies to `run`/);
  const r2 = runCli(['repl', '--trace-calls']);
  assert.equal(r2.status, 2);
  const r3 = runCli(['run', '--tokens', '--ast', 'examples/hello.em']);
  assert.equal(r3.status, 2);
  assert.match(r3.stderr, /cannot be combined/);
});

test('regression: parser nesting errors carry spans inside the source', () => {
  const err = parseExpectThrow('let x = ' + '('.repeat(600) + '1' + ')'.repeat(600), 'E0206');
  assert.equal(err.filePath, 'audit.em');
});
