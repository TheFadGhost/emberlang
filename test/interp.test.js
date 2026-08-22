// Interpreter tests: scoping, closures, control flow, operators, strings,
// arrays, maps, ranges, iteration, assignment, the runtime error registry
// (E0301-E0310), and call tracing. Sources avoid collection literals because
// the parser has none yet: arrays come from range/split/push, maps are
// injected through globals.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { tokenize } from '../src/lexer.js';
import { parse } from '../src/parser.js';
import {
  Interpreter,
  ReturnSignal,
  BreakSignal,
  ContinueSignal
} from '../src/interpreter.js';
import { Env } from '../src/interp/env.js';
import { CODES } from '../src/errors.js';

const compile = (src) => parse(tokenize(src, 't.em'), 't.em');

function run(src, opts = {}) {
  const interp = new Interpreter(opts);
  return { value: interp.run(compile(src), { filePath: 't.em' }), interp };
}

function value(src, opts = {}) {
  return run(src, opts).value;
}

function runWith(src, bindings, opts = {}) {
  const interp = new Interpreter(opts);
  for (const [name, v] of Object.entries(bindings)) interp.globals.define(name, v);
  return { value: interp.run(compile(src), { filePath: 't.em' }), interp };
}

function errOf(fn) {
  try {
    fn();
  } catch (e) {
    return e;
  }
  assert.fail('expected an error, got none');
}

const errOfSrc = (src, opts = {}) => errOf(() => value(src, opts));
const lines = (rows) => rows.join('\n');

describe('scoping', () => {
  test('let defines in current scope, assignment walks the chain', () => {
    assert.equal(value(lines(['let x = 1', 'if true { x = 5 }', 'x'])), 5);
  });

  test('inner let shadows outer; assignment hits the inner binding', () => {
    assert.equal(value(lines(['let x = 1', 'if true { let x = 2', 'x = 3 }', 'x'])), 1);
  });

  test('bare block runs in a child scope and leaks nothing', () => {
    const interp = new Interpreter();
    interp.globals.define('probe', 0);
    const v = interp.run(compile('{ let probe = 9 }'), { filePath: 't.em' });
    assert.equal(v, null);
    assert.equal(interp.globals.get('probe', null, null), 0);
  });

  test('parameters shadow globals of the same name', () => {
    assert.equal(value(lines(['let g = 1', 'fn f(g) { g + 1 }', 'f(41)'])), 42);
  });

  test('function body assigns through the chain to the global', () => {
    assert.equal(value(lines(['let c = 1', 'fn bump() { c += 1 }', 'bump()', 'bump()', 'c'])), 3);
  });

  test('redefinition with let is allowed in the same scope', () => {
    assert.equal(value(lines(['let x = 1', 'let x = 2', 'x'])), 2);
  });
});

describe('functions and closures', () => {
  test('closure counter returns incrementing functions', () => {
    const src = lines([
      'fn make(start) {',
      '  let n = start',
      '  return fn() { n += 1 n }',
      '}',
      'let a = make(0)',
      'let b = make(10)',
      'a()',
      'a()',
      'b()',
      'a()'
    ]);
    assert.equal(value(src), 3);
  });

  test('two counters keep independent state', () => {
    const src = lines([
      'fn make() {',
      '  let n = 0',
      '  return fn() { n += 1 n }',
      '}',
      'let a = make()',
      'let b = make()',
      'a()',
      'a()',
      'b()'
    ]);
    assert.equal(value(src), 1);
  });

  test('loop-capture: closures over a for-in variable see per-iteration values', () => {
    const src = lines([
      'let fs = range(0)',
      'for i in 0..3 { push(fs, fn() { i }) }',
      'let got = range(0)',
      'push(got, fs[0]())',
      'push(got, fs[1]())',
      'push(got, fs[2]())',
      'got'
    ]);
    assert.deepEqual(value(src), [0, 1, 2]);
  });

  test('recursion: factorial and fibonacci', () => {
    assert.equal(value(lines([
      'fn fact(n) { if n <= 1 { return 1 }',
      'n * fact(n - 1) }',
      'fact(5)'
    ])), 120);
    assert.equal(value(lines([
      'fn fib(n) { if n < 2 { return n }',
      'fib(n - 1) + fib(n - 2) }',
      'fib(10)'
    ])), 55);
  });

  test('recursion limit raises a clean E0309, not a crash', () => {
    const e = errOfSrc(lines(['fn spin(n) { spin(n + 1) }', 'spin(0)']));
    assert.equal(e.code, CODES.RECURSION_LIMIT);
    assert.equal(e.kind, 'runtime');
    assert.match(e.message, /^recursion limit exceeded \(400 calls\)$/);
    assert.equal(e.line, 1); // the innermost failing call site sits inside the body
  });

  test('custom maxDepth is honoured and named in the message', () => {
    const e = errOfSrc(lines(['fn spin(n) { spin(n + 1) }', 'spin(0)']), { maxDepth: 25 });
    assert.equal(e.code, CODES.RECURSION_LIMIT);
    assert.equal(e.message, 'recursion limit exceeded (25 calls)');
    assert.match(e.help, /base case/);
  });

  test('deep but legal recursion stays under the limit', () => {
    assert.equal(value(lines([
      'fn down(n) { if n == 0 { return 0 }',
      'down(n - 1) }',
      'down(300)'
    ])), 0);
  });

  test('return without a value yields null, as does falling off the end', () => {
    assert.equal(value(lines(['fn f() { return }', 'f()'])), null);
    assert.equal(value(lines(['fn f() { let x = 1 }', 'f()'])), null);
  });
});

describe('truthiness and short circuit', () => {
  test('only false and null are falsy; everything else is truthy', () => {
    assert.equal(value('0 or 99'), 0);
    assert.equal(value('"nope" or "fallback"'), 'nope');
    assert.deepEqual(value('range(0) or 99'), []);
    assert.equal(value('false or 99'), 99);
    assert.equal(value('null or 7'), 7);
    assert.equal(value('"yes" and 5'), 5);
    assert.equal(value('0 and 5'), 5);
    assert.equal(value('null and 5'), null);
    assert.equal(value('false and 5'), false);
  });

  test('and/or return the deciding operand', () => {
    assert.equal(value('false or 5'), 5);
    assert.equal(value('true and 7'), 7);
    assert.equal(value('false and 9'), false);
    assert.equal(value('true or 9'), true);
    assert.equal(value('null or null'), null);
  });

  test('short circuit skips the undecided right side entirely', () => {
    const src = lines([
      'let xs = range(0)',
      'false and push(xs, 1)',
      'true or push(xs, 2)',
      'xs'
    ]);
    assert.deepEqual(value(src), []);
  });

  test('side effects happen when the left side does not decide', () => {
    const src = lines(['let xs = range(0)', 'true and push(xs, 1)', 'xs']);
    assert.deepEqual(value(src), [1]);
  });

  test('not returns a bool', () => {
    assert.equal(value('not false'), true);
    assert.equal(value('not null'), true);
    assert.equal(value('not 0'), false);
    assert.equal(value('not ""'), false);
    assert.equal(value('not not 3'), true);
  });
});

describe('operators', () => {
  test('arithmetic', () => {
    assert.equal(value('7 + 2'), 9);
    assert.equal(value('7 - 2'), 5);
    assert.equal(value('7 * 2'), 14);
    assert.equal(value('7 / 2'), 3.5);
    assert.equal(value('6 / 3'), 2);
    assert.equal(value('7 % 3'), 1);
    assert.equal(value('-5 + 2'), -3);
    assert.equal(value('-2.5'), -2.5);
    assert.equal(value('1 + 2.5'), 3.5);
    assert.equal(value('2 + 3 * 4'), 14);
    assert.equal(value('(2 + 3) * 4'), 20);
  });

  test('+ adds numbers, concatenates strings and arrays, nothing else', () => {
    assert.equal(value('"foo" + "bar"'), 'foobar');
    assert.deepEqual(value('range(0, 2) + range(2, 4)'), [0, 1, 2, 3]);
    assert.deepEqual(value('range(0) + range(0)'), []);
    assert.equal(errOfSrc('true + true').code, CODES.TYPE_ERROR);
  });

  test('comparisons on two numbers or two strings', () => {
    assert.equal(value('1 < 2'), true);
    assert.equal(value('2 <= 2'), true);
    assert.equal(value('3 > 4'), false);
    assert.equal(value('4 >= 4'), true);
    assert.equal(value('"a" < "b"'), true);
    assert.equal(value('"b" >= "a"'), true);
    assert.equal(value('"abc" < "abd"'), true);
    const mixed = errOfSrc('1 < "a"');
    assert.equal(mixed.code, CODES.TYPE_ERROR);
    assert.match(mixed.message, /expects two numbers or two strings/);
    assert.equal(errOfSrc('"a" < 1').code, CODES.TYPE_ERROR);
    assert.equal(errOfSrc('true < false').code, CODES.TYPE_ERROR);
    assert.equal(errOfSrc('null >= null').code, CODES.TYPE_ERROR);
  });

  test('equality is deep and typed', () => {
    assert.equal(value('1 == 1.0'), true);
    assert.equal(value('1 != 2'), true);
    assert.equal(value('"a" == "a"'), true);
    assert.equal(value('true == true'), true);
    assert.equal(value('null == null'), true);
    assert.equal(value('1 == "1"'), false);
    assert.equal(value('0 == false'), false);
    assert.equal(value('null == 0'), false);
  });

  test('deep equality on nested arrays', () => {
    assert.equal(value('range(0, 3) == range(0, 3)'), true);
    assert.equal(value('range(0, 3) != range(0, 4)'), true);
    assert.equal(value('range(0, 3) == range(3, 6)'), false);
    const nested = value(lines([
      'let a = range(0)',
      'let b = range(0)',
      'push(a, range(0, 2))',
      'push(b, range(0, 2))',
      'a == b'
    ]));
    assert.equal(nested, true);
  });

  test('division and modulo by zero raise E0307 with exact messages', () => {
    const div = errOfSrc(lines(['let a = 1', '1 / 0']));
    assert.equal(div.code, CODES.DIV_BY_ZERO);
    assert.equal(div.message, '`/` division by zero');
    assert.equal(div.line, 2);
    const mod = errOfSrc('5 % 0');
    assert.equal(mod.code, CODES.DIV_BY_ZERO);
    assert.equal(mod.message, '`%` modulo by zero');
    assert.equal(errOfSrc('1.5 / 0.0').code, CODES.DIV_BY_ZERO);
  });

  test('mixed + names both operands via brief()', () => {
    const add = errOfSrc('1 + "a"');
    assert.equal(add.code, CODES.TYPE_ERROR);
    assert.equal(add.message, '`+` cannot add int 1 and string "a"');
    for (const src of ['"a" + 1', '1 - "a"', '"a" * 2', '1 % "x"', '1 + null', '1 + range(0)', '"ab" + "c" + 9']) {
      assert.equal(errOfSrc(src).code, CODES.TYPE_ERROR, src);
    }
    const mul = errOfSrc('"a" * 2');
    assert.ok(mul.message.startsWith('`*` expects numbers'), mul.message);
    assert.ok(mul.message.includes('string "a" and int 2'), mul.message);
  });

  test('unary minus is numeric only', () => {
    const e = errOfSrc('-"x"');
    assert.equal(e.code, CODES.TYPE_ERROR);
    assert.equal(e.message, '`-` expects a number, got string "x"');
    assert.equal(errOfSrc('-null').code, CODES.TYPE_ERROR);
    assert.equal(errOfSrc('-range(0)').code, CODES.TYPE_ERROR);
    assert.equal(errOfSrc('-false').code, CODES.TYPE_ERROR);
  });
});

describe('strings', () => {
  test('indexing works in code points', () => {
    assert.equal(value('"hello"[0]'), 'h');
    assert.equal(value('"héllo"[1]'), 'é');
    assert.equal(value('len("héllo")'), 5);
  });

  test('string index bounds and type errors', () => {
    const hi = errOfSrc('"abc"[3]');
    assert.equal(hi.code, CODES.INDEX_OUT_OF_RANGE);
    assert.match(hi.message, /index 3 out of range for a string of length 3/);
    const neg = errOfSrc('"abc"[-1]');
    assert.equal(neg.code, CODES.INDEX_OUT_OF_RANGE);
    const type = errOfSrc('"abc"["k"]');
    assert.equal(type.code, CODES.TYPE_ERROR);
    assert.match(type.message, /string index must be an integer/);
  });

  test('astral plane characters count as one element', () => {
    assert.equal(value('"𝕒bc"[0]'), '𝕒');
    assert.equal(value('len("𝕒bc")'), 3);
  });

  test('slicing clamps silently and stays a string', () => {
    assert.equal(value('"hello"[0:3]'), 'hel');
    assert.equal(value('"hello"[:2]'), 'he');
    assert.equal(value('"hello"[3:]'), 'lo');
    assert.equal(value('"hello"[2:2]'), '');
    assert.equal(value('"ab"[3:9]'), '');
    assert.equal(value('"abcdef"[1:100]'), 'bcdef');
    assert.equal(value('"hello"[-2:3]'), 'hel');
    assert.equal(value('"héllo"[1:3]'), 'él');
    assert.equal(value('"abc"[9:1]'), '');
  });

  test('slice bounds must be integers; non-sliceable values are E0304', () => {
    const bound = errOfSrc('"ab"[0:1.5]');
    assert.equal(bound.code, CODES.TYPE_ERROR);
    assert.match(bound.message, /slice bounds must be integers/);
    const notSlice = errOfSrc('5[0:1]');
    assert.equal(notSlice.code, CODES.TYPE_ERROR);
    assert.match(notSlice.message, /cannot slice int 5/);
  });

  test('assigning into a string is E0304 strings are immutable', () => {
    const e = errOfSrc(lines(['let s = "cat"', 's[0] = "b"']));
    assert.equal(e.code, CODES.TYPE_ERROR);
    assert.equal(e.message, 'strings are immutable');
    const compound = errOfSrc(lines(['let s = "cat"', 's[0] += "x"']));
    assert.equal(compound.code, CODES.TYPE_ERROR);
  });
});

describe('arrays', () => {
  test('index read with int keys; bounds and type errors', () => {
    assert.equal(value('range(1, 4)[0]'), 1);
    assert.equal(value(lines(['let xs = range(1, 4)', 'xs[2]'])), 3);
    const oob = errOfSrc(lines(['let xs = range(1, 4)', 'xs[3]']));
    assert.equal(oob.code, CODES.INDEX_OUT_OF_RANGE);
    assert.match(oob.message, /index 3 out of range for an array of length 3/);
    assert.equal(oob.line, 2);
    assert.equal(errOfSrc(lines(['let xs = range(1, 4)', 'xs[-1]'])).code, CODES.INDEX_OUT_OF_RANGE);
    const frac = errOfSrc(lines(['let xs = range(1, 4)', 'xs[0.5]']));
    assert.equal(frac.code, CODES.TYPE_ERROR);
    assert.match(frac.message, /array index must be an integer/);
  });

  test('index write mutates in place; bad indices are rejected', () => {
    assert.deepEqual(value(lines(['let xs = range(0, 3)', 'xs[1] = 9', 'xs'])), [0, 9, 2]);
    const oob = errOfSrc(lines(['let xs = range(0, 3)', 'xs[5] = 1']));
    assert.equal(oob.code, CODES.INDEX_OUT_OF_RANGE);
    assert.equal(errOfSrc(lines(['let xs = range(0, 3)', 'xs[-2] = 1'])).code, CODES.INDEX_OUT_OF_RANGE);
    assert.equal(errOfSrc(lines(['let xs = range(0, 3)', 'xs[1.5] = 1'])).code, CODES.TYPE_ERROR);
  });

  test('push mutates the array, pop removes from the end', () => {
    assert.deepEqual(value(lines([
      'let xs = range(1, 3)',
      'push(xs, 99)',
      'push(xs, 100)',
      'xs'
    ])), [1, 2, 99, 100]);
    assert.deepEqual(value(lines(['let xs = range(1, 3)', 'pop(xs)', 'xs'])), [1]);
    assert.deepEqual(value(lines(['let xs = split("a,b", ",")', 'len(xs)'])), 2);
  });

  test('array slices clamp like string slices', () => {
    assert.deepEqual(value('range(0, 5)[1:3]'), [1, 2]);
    assert.deepEqual(value('range(0, 5)[:2]'), [0, 1]);
    assert.deepEqual(value('range(0, 5)[3:]'), [3, 4]);
    assert.deepEqual(value('range(0, 5)[50:60]'), []);
    assert.deepEqual(value('range(0, 5)[-3:2]'), [0, 1]);
  });

  test('indexing a non-indexable value is E0304', () => {
    const e = errOfSrc('3[0]');
    assert.equal(e.code, CODES.TYPE_ERROR);
    assert.equal(e.message, 'cannot index int 3');
    assert.equal(errOfSrc('null[0]').code, CODES.TYPE_ERROR);
    assert.equal(errOfSrc('true[0]').code, CODES.TYPE_ERROR);
    assert.equal(errOfSrc('print[0]').code, CODES.TYPE_ERROR);
  });

  test('assignment into a non-container is E0304', () => {
    const e = errOfSrc(lines(['let n = 3', 'n[0] = 1']));
    assert.equal(e.code, CODES.TYPE_ERROR);
    assert.match(e.message, /cannot assign into int 3/);
  });
});

describe('maps', () => {
  const makeMap = () => new Map([['a', 1], ['b', 2]]);

  test('read existing keys; missing keys raise E0306', () => {
    assert.equal(runWith('m["a"]', { m: makeMap() }).value, 1);
    const miss = errOf(() => runWith('m["z"]', { m: makeMap() }).value);
    assert.equal(miss.code, CODES.MISSING_KEY);
    assert.equal(miss.message, 'map has no key `z`');
  });

  test('keys must be strings to read and to write', () => {
    const read = errOf(() => runWith('m[1]', { m: makeMap() }).value);
    assert.equal(read.code, CODES.TYPE_ERROR);
    assert.match(read.message, /map key must be a string, got int 1/);
    const write = errOf(() => runWith('m[1] = 2', { m: makeMap() }).value);
    assert.equal(write.code, CODES.TYPE_ERROR);
  });

  test('write updates existing keys and adds new ones', () => {
    const updated = runWith(lines([
      'm["a"] = 9',
      'm["c"] = 3',
      'str(values(m))'
    ]), { m: makeMap() }).value;
    assert.equal(updated, '[9, 2, 3]');
  });

  test('compound assignment on keys; missing key compound is a type error', () => {
    assert.equal(runWith(lines(['m["a"] += 2', 'm["a"]']), { m: makeMap() }).value, 3);
    const missing = errOf(() => runWith('m["q"] += 1', { m: makeMap() }).value);
    assert.equal(missing.code, CODES.TYPE_ERROR);
  });

  test('get() reads with a default instead of raising E0306', () => {
    assert.equal(runWith('get(m, "a", 0)', { m: makeMap() }).value, 1);
    assert.equal(runWith('get(m, "zz", 0)', { m: makeMap() }).value, 0);
  });

  test('for over a map yields keys in insertion order', () => {
    const ks = runWith(lines([
      'let ks = range(0)',
      'for k in m { push(ks, k) }',
      'ks'
    ]), { m: new Map([['x', 1], ['a', 2], ['m', 3]]) }).value;
    assert.deepEqual(ks, ['x', 'a', 'm']);
  });

  test('deep equality ignores key order', () => {
    assert.equal(runWith('m == n', { m: makeMap(), n: new Map([['b', 2], ['a', 1]]) }).value, true);
    assert.equal(runWith('m != n', { m: makeMap(), n: new Map([['a', 5], ['b', 2]]) }).value, true);
    assert.equal(runWith('m == n', { m: makeMap(), n: new Map([['a', 1]]) }).value, false);
  });
});

describe('ranges and iteration', () => {
  test('half-open integer materialisation', () => {
    assert.deepEqual(value('0..5'), [0, 1, 2, 3, 4]);
    assert.deepEqual(value('3..3'), []);
    assert.deepEqual(value('4..2'), []);
    assert.equal(value('len(-3..3)'), 6);
    assert.equal(value('len(0..1000)'), 1000);
  });

  test('bounds must be integers and the element cap holds', () => {
    const frac = errOfSrc('1.5..3');
    assert.equal(frac.code, CODES.TYPE_ERROR);
    assert.match(frac.message, /integer bounds/);
    const big = errOfSrc('0..5000001');
    assert.equal(big.code, CODES.TYPE_ERROR);
    assert.match(big.message, /5000000 elements/);
  });

  test('for over array, string, map, and range', () => {
    assert.equal(value(lines(['let s = 0', 'for x in range(1, 5) { s += x }', 's'])), 10);
    assert.equal(value(lines(['let s = ""', 'for c in "abc" { s = s + c }', 's'])), 'abc');
    assert.equal(value(lines(['let s = 0', 'for i in 0..4 { s += i }', 's'])), 6);
    const ks = runWith(lines([
      'let out = range(0)',
      'for k in m { push(out, k + "!") }',
      'out'
    ]), { m: new Map([['a', 1]]) }).value;
    assert.deepEqual(ks, ['a!']);
  });

  test('iterating non-iterables is E0308 naming the type', () => {
    for (const src of ['for x in 5 { }', 'for x in null { }', 'for x in true { }', 'for x in print { }']) {
      const e = errOfSrc(src);
      assert.equal(e.code, CODES.NOT_ITERABLE, src);
      assert.ok(e.message.includes('cannot iterate over'), src);
    }
    const num = errOfSrc('for x in 5 { }');
    assert.match(num.message, /int 5/);
  });
});

describe('control flow', () => {
  test('if/elif/else pick branches by truthiness and yield the body value', () => {
    assert.equal(value('if true { 1 }'), 1);
    assert.equal(value('if false { 1 }'), null);
    assert.equal(value('if false { 1 } elif true { 2 } else { 3 }'), 2);
    assert.equal(value('if false { 1 } elif false { 2 } else { 3 }'), 3);
    assert.equal(value('if 0 { "zero is truthy" } else { "no" }'), 'zero is truthy');
    assert.equal(value('if "" { "empty is truthy" }'), 'empty is truthy');
    assert.equal(value('if null { 1 } else { 2 }'), 2);
  });

  test('while loops count down and up', () => {
    assert.equal(value(lines(['let n = 0', 'while n < 5 { n += 1 }', 'n'])), 5);
  });

  test('break exits a while loop early', () => {
    assert.equal(value(lines([
      'let n = 0',
      'while true {',
      '  n += 1',
      '  if n == 4 { break }',
      '}',
      'n'
    ])), 4);
  });

  test('continue skips the rest of a while body without losing the condition', () => {
    assert.equal(value(lines([
      'let i = 0',
      'let total = 0',
      'while i < 5 {',
      '  i += 1',
      '  if i == 2 { continue }',
      '  total += i',
      '}',
      'total'
    ])), 13);
  });

  test('break and continue work in for loops', () => {
    assert.deepEqual(value(lines([
      'let xs = range(0)',
      'for i in 0..10 {',
      '  if i == 3 { continue }',
      '  if i == 6 { break }',
      '  push(xs, i)',
      '}',
      'xs'
    ])), [0, 1, 2, 4, 5]);
  });

  test('nested loops: continue and break bind to the innermost loop', () => {
    assert.equal(value(lines([
      'let hits = 0',
      'for i in 0..5 {',
      '  for j in 0..5 {',
      '    if j == 2 { continue }',
      '    if j == 4 { break }',
      '    hits += 1',
      '  }',
      '}',
      'hits'
    ])), 15);
  });
});

describe('assignment', () => {
  test('all six compound operators on identifiers', () => {
    assert.equal(value(lines([
      'let n = 1',
      'n += 2',
      'n -= 1',
      'n *= 4',
      'n /= 2',
      'n %= 3',
      'n'
    ])), 1);
    assert.equal(value(lines(['let n = 3', 'n /= 2', 'n'])), 1.5);
  });

  test('compound assignment on array elements reads and writes once', () => {
    assert.deepEqual(value(lines(['let xs = range(1, 3)', 'xs[0] *= 10', 'xs'])), [10, 2]);
  });

  test('compound division by zero raises E0307', () => {
    const e = errOfSrc(lines(['let n = 8', 'n /= 0']));
    assert.equal(e.code, CODES.DIV_BY_ZERO);
  });

  test('compound type mismatch raises E0304', () => {
    const e = errOfSrc(lines(['let s = "a"', 's += 1']));
    assert.equal(e.code, CODES.TYPE_ERROR);
  });

  test('assignment or compound use of an undeclared name is E0301', () => {
    const plain = errOfSrc('zz = 1');
    assert.equal(plain.code, CODES.UNDEFINED_VARIABLE);
    assert.match(plain.message, /undefined variable `zz`/);
    const compound = errOfSrc('qq += 1');
    assert.equal(compound.code, CODES.UNDEFINED_VARIABLE);
    const read = errOfSrc('neverDefined');
    assert.equal(read.code, CODES.UNDEFINED_VARIABLE);
    assert.equal(read.line, 1);
  });

  test('declarations and assignments evaluate to null so run stays quiet', () => {
    assert.equal(value('let q = 1'), null);
    assert.equal(value(lines(['let q = 1', 'q = 2'])), null);
  });
});

describe('top level statement misuse', () => {
  test('stray return/break/continue become E0310 with exact messages', () => {
    const ret = errOfSrc('return 1');
    assert.equal(ret.code, CODES.MISUSED_STATEMENT);
    assert.equal(ret.message, '`return` outside a function');
    const brk = errOfSrc('break');
    assert.equal(brk.code, CODES.MISUSED_STATEMENT);
    assert.equal(brk.message, '`break` outside a loop');
    const cnt = errOfSrc('continue');
    assert.equal(cnt.code, CODES.MISUSED_STATEMENT);
    assert.equal(cnt.message, '`continue` outside a loop');
  });

  test('misuse spans point at the offending keyword line', () => {
    const e = errOfSrc(lines(['let a = 1', 'let b = 2', 'return 9']));
    assert.equal(e.line, 3);
    assert.equal(e.filePath, 't.em');
  });

  test('stray return escapes through loops and blocks before being caught', () => {
    assert.equal(errOfSrc('while true { return 1 }').code, CODES.MISUSED_STATEMENT);
    const viaFor = errOfSrc('for i in 0..3 { return i }');
    assert.equal(viaFor.code, CODES.MISUSED_STATEMENT);
    assert.equal(viaFor.line, 1);
  });

  test('break and continue inside a bare function body are E0310', () => {
    const brk = errOfSrc(lines(['fn f() { break }', 'f()']));
    assert.equal(brk.code, CODES.MISUSED_STATEMENT);
    assert.equal(brk.message, '`break` outside a loop');
    const cnt = errOfSrc(lines(['fn f() { continue }', 'f()']));
    assert.equal(cnt.code, CODES.MISUSED_STATEMENT);
    assert.equal(cnt.message, '`continue` outside a loop');
  });
});

describe('calls', () => {
  test('calling a non-function is E0302 rendering brief()', () => {
    const num = errOfSrc(lines(['let x = 1', 'x()']));
    assert.equal(num.code, CODES.NOT_CALLABLE);
    assert.equal(num.message, '1 is not callable');
    const str = errOfSrc('"s"()');
    assert.equal(str.code, CODES.NOT_CALLABLE);
    assert.equal(str.message, '"s" is not callable');
    assert.equal(errOfSrc('null()').message, 'null is not callable');
    const arr = errOfSrc('range(0)()');
    assert.equal(arr.message, '[..0 items] is not callable');
  });

  test('ember arity mismatches are E0303 with expected vs got at the call site', () => {
    const few = errOfSrc(lines(['fn f(a, b) { a }', 'f(1)']));
    assert.equal(few.code, CODES.WRONG_ARG_COUNT);
    assert.equal(few.message, '`f` expects 2 arguments, got 1');
    assert.equal(few.line, 2);
    const many = errOfSrc(lines(['fn f(a, b) { a }', 'f(1, 2, 3)']));
    assert.equal(many.code, CODES.WRONG_ARG_COUNT);
    assert.equal(many.message, '`f` expects 2 arguments, got 3');
    const one = errOfSrc(lines(['fn g(x) { x }', 'g()']));
    assert.equal(one.message, '`g` expects 1 argument, got 0');
  });

  test('native arity is enforced at the call site too', () => {
    const zero = errOfSrc('len()');
    assert.equal(zero.code, CODES.WRONG_ARG_COUNT);
    assert.equal(zero.message, '`len` expects 1 argument, got 0');
    const three = errOfSrc('push(range(0), 1, 2)');
    assert.equal(three.code, CODES.WRONG_ARG_COUNT);
    assert.equal(three.message, '`push` expects 2 arguments, got 3');
    const typeErr = errOfSrc('push("no", 1)');
    assert.equal(typeErr.code, CODES.TYPE_ERROR);
  });

  test('arguments evaluate before the call executes', () => {
    assert.equal(value(lines([
      'fn tag(x) { x * 10 }',
      'tag(1) + tag(2)'
    ])), 30);
  });

  test('functions are first class values with the pinned shape', () => {
    const f = value(lines(['fn f(a) { a }', 'f']));
    assert.equal(f.__fn, true);
    assert.equal(f.name, 'f');
    assert.deepEqual(f.params.map((p) => p.name), ['a']);
    assert.equal(f.body.kind, 'Block');
    assert.ok(f.closure instanceof Env);
    const anon = value('fn(a) { a }');
    assert.equal(anon.__fn, true);
    assert.equal(anon.name, '');
    assert.equal(value(lines([
      'fn apply(g, n) { g(n) }',
      'apply(fn(n) { n * 3 }, 7)'
    ])), 21);
  });

  test('equality on functions is identity', () => {
    assert.equal(value(lines(['fn f() { 1 }', 'f == f'])), true);
    assert.equal(value(lines(['fn f() { 1 }', 'let g = f', 'f == g'])), true);
    assert.equal(value(lines(['fn f() { 1 }', 'fn g() { 1 }', 'f == g'])), false);
  });
});

describe('trace', () => {
  test('trace emits indented call and ret lines to the sink', () => {
    const sink = [];
    const src = lines([
      'fn dbl(n) { n * 2 }',
      'fn quad(n) { dbl(dbl(n)) }',
      'quad(2)'
    ]);
    const v = value(src, { trace: true, traceSink: (l) => sink.push(l) });
    assert.equal(v, 8);
    assert.deepEqual(sink, [
      '  call quad(2)',
      '    call dbl(2)',
      '    ret dbl -> 4',
      '    call dbl(4)',
      '    ret dbl -> 8',
      '  ret quad -> 8'
    ]);
  });

  test('trace renders string arguments with repr quoting', () => {
    const sink = [];
    value(lines(['fn id(x) { x }', 'id("hi")']), { trace: true, traceSink: (l) => sink.push(l) });
    assert.deepEqual(sink, ['  call id("hi")', '  ret id -> "hi"']);
  });

  test('early returns still emit their ret line', () => {
    const sink = [];
    value(lines([
      'fn f(n) { if n > 0 { return n }',
      '0 }',
      'f(3)'
    ]), { trace: true, traceSink: (l) => sink.push(l) });
    assert.deepEqual(sink, ['  call f(3)', '  ret f -> 3']);
  });

  test('trace off leaves the sink untouched', () => {
    const sink = [];
    value(lines(['fn f() { 1 }', 'f()']), { traceSink: (l) => sink.push(l) });
    assert.deepEqual(sink, []);
  });

  test('anonymous functions trace under a stable placeholder name', () => {
    const sink = [];
    value(lines(['let f = fn(n) { n }', 'f(1)']), { trace: true, traceSink: (l) => sink.push(l) });
    assert.deepEqual(sink, ['  call <anon>(1)', '  ret <anon> -> 1']);
  });
});

describe('interpreter surface', () => {
  test('globals holds builtins and accepts host bindings', () => {
    const interp = new Interpreter();
    assert.ok(interp.globals instanceof Env);
    assert.equal(interp.globals.get('len', null, null).__native, true);
    interp.globals.define('answer', 42);
    assert.equal(interp.run(compile('answer'), { filePath: 't.em' }), 42);
  });

  test('bare blocks execute in a child scope of the run scope', () => {
    const interp = new Interpreter();
    interp.globals.define('probe', 0);
    const v = interp.run(compile('{ let probe = 9 }'), { filePath: 't.em' });
    assert.equal(v, null);
    assert.equal(interp.globals.get('probe', null, null), 0);
  });

  test('run returns the last value or null', () => {
    assert.equal(value(''), null);
    assert.equal(value(lines(['1', '2', '3'])), 3);
    assert.equal(value('if true { 5 }'), 5);
    assert.equal(value('if false { 5 }'), null);
    assert.equal(value('for i in 0..3 { i * 2 }'), 4);
    assert.equal(value('while false { 1 }'), null);
    assert.equal(value('{ 7 }'), 7);
  });

  test('runtime errors carry the file path given to run()', () => {
    const e = errOfSrc('boom');
    assert.equal(e.code, CODES.UNDEFINED_VARIABLE);
    assert.equal(e.filePath, 't.em');
  });

  test('error spans land on the smallest offending node line', () => {
    const div = errOfSrc(lines(['let a = 1', 'let b = 2', '1 / 0']));
    assert.equal(div.line, 3);
    const idx = errOfSrc(lines(['let xs = range(0, 3)', 'xs[9]']));
    assert.equal(idx.code, CODES.INDEX_OUT_OF_RANGE);
    assert.equal(idx.line, 2);
  });

  test('builtin errors point at their call site', () => {
    const e = errOfSrc(lines(['let a = 1', 'pop(range(0))']));
    assert.equal(e.code, CODES.INDEX_OUT_OF_RANGE);
    assert.equal(e.line, 2);
  });

  test('signal classes are distinct exports carrying their node', () => {
    const node = { kind: 'BreakStmt' };
    const r = new ReturnSignal(null, node);
    assert.ok(r instanceof ReturnSignal);
    assert.equal(r.value, null);
    assert.equal(r.node, node);
    const b = new BreakSignal(node);
    const c = new ContinueSignal(node);
    assert.ok(b instanceof BreakSignal);
    assert.ok(c instanceof ContinueSignal);
    assert.notEqual(BreakSignal, ContinueSignal);
    assert.notEqual(ReturnSignal, BreakSignal);
  });
});
