import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Env } from '../src/interp/env.js';
import { installBuiltins, expectArgs } from '../src/builtins.js';
import { CODES, EmberError } from '../src/errors.js';

const REGISTRY = {
  len: [1, 1],
  print: [0, Infinity],
  push: [2, 2],
  pop: [1, 1],
  keys: [1, 1],
  values: [1, 1],
  get: [2, 3],
  has: [2, 2],
  str: [1, 1],
  int: [1, 1],
  float: [1, 1],
  type: [1, 1],
  range: [1, 3],
  upper: [1, 1],
  lower: [1, 1],
  trim: [1, 1],
  chars: [1, 1],
  split: [2, 2],
  join: [2, 2],
  replace: [3, 3],
  contains: [2, 2],
  abs: [1, 1],
  floor: [1, 1],
  ceil: [1, 1],
  round: [1, 1],
  min: [1, 1],
  max: [1, 1],
  ask: [0, 1],
  write: [0, Infinity]
};

const CALL = { line: 1, col: 1, endCol: 4 };

function makeEnv() {
  const env = new Env();
  installBuiltins(env);
  return env;
}

function call(env, name, ...args) {
  const fn = env.get(name);
  assert.equal(fn.__native, true, name + ' should be a native builtin');
  return fn.call(CALL, args);
}

function assertNativeError(fn, code, message) {
  let err = null;
  try {
    fn();
  } catch (e) {
    err = e;
  }
  assert.ok(err instanceof EmberError, 'expected EmberError, got ' + String(err));
  assert.equal(err.kind, 'runtime');
  assert.equal(err.code, code);
  assert.equal(err.message, message);
  assert.equal(err.line, CALL.line);
  assert.equal(err.col, CALL.col);
  assert.equal(err.endCol, CALL.endCol);
  assert.equal(err.filePath, null);
  return err;
}

function captureStdout(fn) {
  const chunks = [];
  const original = process.stdout.write;
  process.stdout.write = (chunk) => {
    chunks.push(String(chunk));
    return true;
  };
  let result;
  try {
    result = fn();
  } finally {
    process.stdout.write = original;
  }
  return { out: chunks.join(''), result };
}

test('installBuiltins binds exactly the contracted registry with correct arities', () => {
  const env = makeEnv();
  assert.deepEqual([...env.vars.keys()].sort(), Object.keys(REGISTRY).sort());
  for (const name of Object.keys(REGISTRY)) {
    const fn = env.get(name);
    assert.equal(fn.__native, true, name + ' should be marked __native');
    assert.equal(fn.name, name);
    assert.deepEqual(fn.arity, REGISTRY[name]);
    assert.equal(typeof fn.call, 'function');
  }
});

test('exported expectArgs produces the contracted E0303 message and shape', () => {
  let err = null;
  try {
    expectArgs(CALL, 'len', [1, 2, 3], 1, 2);
  } catch (e) {
    err = e;
  }
  assert.ok(err instanceof EmberError);
  assert.equal(err.kind, 'runtime');
  assert.equal(err.code, CODES.WRONG_ARG_COUNT);
  assert.equal(err.message, '`len` expects between 1 and 2 arguments, got 3');
  assert.equal(err.line, 1);
  assert.equal(err.col, 1);
  assert.equal(err.endCol, 4);
});

test('errors carry the call site span; front ends stamp filePath', () => {
  const env = makeEnv();
  // Natives deliberately leave filePath null (audit finding: the old
  // callNode.filePath lookup was dead code); cli.js/repl.js stamp it via
  // renderError's defaultPath.
  const node = { line: 7, col: 9, endCol: 15 };
  let err = null;
  try {
    env.get('len').call(node, [3]);
  } catch (e) {
    err = e;
  }
  assert.ok(err instanceof EmberError);
  assert.equal(err.kind, 'runtime');
  assert.equal(err.code, CODES.TYPE_ERROR);
  assert.equal(err.filePath, null);
  assert.equal(err.line, 7);
  assert.equal(err.col, 9);
  assert.equal(err.endCol, 15);
});

test('len measures strings by code points, arrays, and maps', () => {
  const env = makeEnv();
  assert.equal(call(env, 'len', ''), 0);
  assert.equal(call(env, 'len', 'hello'), 5);
  assert.equal(call(env, 'len', 'a𝄞b'), 3);
  assert.equal(call(env, 'len', [1, 2, 3]), 3);
  assert.equal(call(env, 'len', []), 0);
  assert.equal(call(env, 'len', new Map([['a', 1], ['b', 2]])), 2);
});

test('len rejects other types with E0304', () => {
  const env = makeEnv();
  assertNativeError(
    () => call(env, 'len', 3),
    CODES.TYPE_ERROR,
    '`len` expects a string, array, or map, got int 3'
  );
});

test('print space-joins args, writes a newline, and returns null', () => {
  const env = makeEnv();
  const r = captureStdout(() => call(env, 'print', 'a', 1, [2], null, true));
  assert.equal(r.result, null);
  assert.equal(r.out, 'a 1 [2] null true\n');
  const nested = captureStdout(() => call(env, 'print', ['x']));
  assert.equal(nested.out, '["x"]\n');
});

test('print with no args writes a bare newline and returns null', () => {
  const env = makeEnv();
  const r = captureStdout(() => call(env, 'print'));
  assert.equal(r.result, null);
  assert.equal(r.out, '\n');
});

test('push mutates the array and returns the same array, enabling chaining', () => {
  const env = makeEnv();
  const xs = [];
  const returned = call(env, 'push', xs, 1);
  assert.equal(returned, xs);
  assert.deepEqual(xs, [1]);
  call(env, 'push', returned, 2);
  assert.deepEqual(xs, [1, 2]);
  const ys = call(env, 'push', call(env, 'push', [], 'a'), 'b');
  assert.deepEqual(ys, ['a', 'b']);
});

test('push rejects a non-array first argument with E0304', () => {
  const env = makeEnv();
  assertNativeError(
    () => call(env, 'push', 3, 1),
    CODES.TYPE_ERROR,
    '`push` expects an array, got int 3'
  );
});

test('pop removes and returns the last element', () => {
  const env = makeEnv();
  const xs = ['a', 'b'];
  assert.equal(call(env, 'pop', xs), 'b');
  assert.deepEqual(xs, ['a']);
  assert.equal(call(env, 'pop', [7]), 7);
});

test('pop on an empty array raises E0305', () => {
  const env = makeEnv();
  assertNativeError(
    () => call(env, 'pop', []),
    CODES.INDEX_OUT_OF_RANGE,
    'pop from an empty array'
  );
});

test('pop rejects a non-array with E0304', () => {
  const env = makeEnv();
  assertNativeError(
    () => call(env, 'pop', 'nope'),
    CODES.TYPE_ERROR,
    '`pop` expects an array, got string "nope"'
  );
});

test('keys and values preserve insertion order', () => {
  const env = makeEnv();
  const m = new Map([['z', 1], ['a', 2], ['m', 3]]);
  assert.deepEqual(call(env, 'keys', m), ['z', 'a', 'm']);
  assert.deepEqual(call(env, 'values', m), [1, 2, 3]);
  assert.deepEqual(call(env, 'keys', new Map()), []);
});

test('keys and values reject non-maps with E0304', () => {
  const env = makeEnv();
  assertNativeError(
    () => call(env, 'keys', 5),
    CODES.TYPE_ERROR,
    '`keys` expects a map, got int 5'
  );
  assertNativeError(
    () => call(env, 'values', 'm'),
    CODES.TYPE_ERROR,
    '`values` expects a map, got string "m"'
  );
});

test('get returns stored values, null for missing keys, and honours defaults', () => {
  const env = makeEnv();
  const m = new Map([['a', 1]]);
  assert.equal(call(env, 'get', m, 'a'), 1);
  assert.equal(call(env, 'get', m, 'missing'), null);
  assert.equal(call(env, 'get', m, 'missing', 'fallback'), 'fallback');
  assert.equal(call(env, 'get', m, 'a', 'fallback'), 1);
  assert.equal(call(env, 'get', m, 'missing', null), null);
  assert.equal(call(env, 'get', m, 'missing', false), false);
  assert.deepEqual(call(env, 'get', m, 'missing', [1]), [1]);
});

test('get rejects non-map receivers and non-string keys with E0304', () => {
  const env = makeEnv();
  assertNativeError(
    () => call(env, 'get', 3, 'k'),
    CODES.TYPE_ERROR,
    '`get` expects a map, got int 3'
  );
  assertNativeError(
    () => call(env, 'get', new Map(), 3),
    CODES.TYPE_ERROR,
    '`get` expects a string, got int 3'
  );
});

test('str renders every type', () => {
  const env = makeEnv();
  assert.equal(call(env, 'str', null), 'null');
  assert.equal(call(env, 'str', true), 'true');
  assert.equal(call(env, 'str', false), 'false');
  assert.equal(call(env, 'str', 3), '3');
  assert.equal(call(env, 'str', -7), '-7');
  assert.equal(call(env, 'str', 2.5), '2.5');
  assert.equal(call(env, 'str', 'hi'), 'hi');
  assert.equal(call(env, 'str', [1]), '[1]');
  assert.equal(call(env, 'str', [1, 'a']), '[1, "a"]');
  assert.equal(call(env, 'str', new Map([['a', 1]])), '{"a": 1}');
  assert.equal(call(env, 'str', env.get('len')), '<fn len>');
});

test('int converts numbers by truncating toward zero', () => {
  const env = makeEnv();
  assert.equal(call(env, 'int', 5), 5);
  assert.equal(call(env, 'int', -7), -7);
  assert.equal(call(env, 'int', 3.9), 3);
  assert.equal(call(env, 'int', 3.1), 3);
  assert.equal(call(env, 'int', -3.9), -3);
  assert.equal(call(env, 'int', -3.1), -3);
  const negZero = call(env, 'int', -0.5);
  assert.ok(negZero === 0);
  assert.equal(String(negZero), '0');
});

test('int parses whole-number strings fully', () => {
  const env = makeEnv();
  assert.equal(call(env, 'int', '0'), 0);
  assert.equal(call(env, 'int', '42'), 42);
  assert.equal(call(env, 'int', '-17'), -17);
  assert.equal(call(env, 'int', '+8'), 8);
  assert.equal(call(env, 'int', ' 12 '), 12);
});

test('int rejects garbage strings with E0304 and a help line', () => {
  const env = makeEnv();
  for (const s of ['abc', '2.5', '1e3', '12x', '']) {
    const err = assertNativeError(
      () => call(env, 'int', s),
      CODES.TYPE_ERROR,
      '`int` cannot convert ' + JSON.stringify(s)
    );
    assert.match(err.help, /^value must look like/);
  }
});

test('int rejects non-string non-number values with E0304', () => {
  const env = makeEnv();
  assertNativeError(
    () => call(env, 'int', true),
    CODES.TYPE_ERROR,
    '`int` cannot convert true'
  );
  assertNativeError(
    () => call(env, 'int', null),
    CODES.TYPE_ERROR,
    '`int` cannot convert null'
  );
  assertNativeError(
    () => call(env, 'int', [1]),
    CODES.TYPE_ERROR,
    '`int` cannot convert [..1 items]'
  );
});

test('float converts numbers and parses numeric strings', () => {
  const env = makeEnv();
  assert.equal(call(env, 'float', 2), 2);
  assert.equal(call(env, 'float', 2.5), 2.5);
  assert.equal(call(env, 'float', -3.5), -3.5);
  assert.equal(call(env, 'float', '3'), 3);
  assert.equal(call(env, 'float', '2.5'), 2.5);
  assert.equal(call(env, 'float', '-1.25'), -1.25);
  assert.equal(call(env, 'float', '1e3'), 1000);
  assert.equal(call(env, 'float', ' 2.5 '), 2.5);
});

test('float rejects garbage strings with E0304 and a help line', () => {
  const env = makeEnv();
  for (const s of ['abc', '', 'x1', '--3']) {
    const err = assertNativeError(
      () => call(env, 'float', s),
      CODES.TYPE_ERROR,
      '`float` cannot convert ' + JSON.stringify(s)
    );
    assert.match(err.help, /^value must look like/);
  }
});

test('float rejects non-string non-number values with E0304', () => {
  const env = makeEnv();
  assertNativeError(
    () => call(env, 'float', true),
    CODES.TYPE_ERROR,
    '`float` cannot convert true'
  );
  assertNativeError(
    () => call(env, 'float', [1]),
    CODES.TYPE_ERROR,
    '`float` cannot convert [..1 items]'
  );
});

test('type reports all seven value types plus function', () => {
  const env = makeEnv();
  assert.equal(call(env, 'type', null), 'null');
  assert.equal(call(env, 'type', true), 'bool');
  assert.equal(call(env, 'type', false), 'bool');
  assert.equal(call(env, 'type', 3), 'int');
  assert.equal(call(env, 'type', -7), 'int');
  assert.equal(call(env, 'type', 2.5), 'float');
  assert.equal(call(env, 'type', 's'), 'string');
  assert.equal(call(env, 'type', [1]), 'array');
  assert.equal(call(env, 'type', new Map()), 'map');
  assert.equal(call(env, 'type', env.get('type')), 'function');
});

test('range supports the one-argument form', () => {
  const env = makeEnv();
  assert.deepEqual(call(env, 'range', 3), [0, 1, 2]);
  assert.deepEqual(call(env, 'range', 0), []);
  assert.deepEqual(call(env, 'range', 1), [0]);
  assert.deepEqual(call(env, 'range', -3), []);
});

test('range supports the two-argument half-open form', () => {
  const env = makeEnv();
  assert.deepEqual(call(env, 'range', 2, 5), [2, 3, 4]);
  assert.deepEqual(call(env, 'range', 5, 5), []);
  assert.deepEqual(call(env, 'range', 5, 2), []);
  assert.deepEqual(call(env, 'range', -2, 2), [-2, -1, 0, 1]);
});

test('range supports a positive step', () => {
  const env = makeEnv();
  assert.deepEqual(call(env, 'range', 0, 10, 3), [0, 3, 6, 9]);
  assert.deepEqual(call(env, 'range', 0, 5, 1), [0, 1, 2, 3, 4]);
});

test('range supports a descending negative step', () => {
  const env = makeEnv();
  assert.deepEqual(call(env, 'range', 3, 0, -1), [3, 2, 1]);
  assert.deepEqual(call(env, 'range', 5, 0, -2), [5, 3, 1]);
  assert.deepEqual(call(env, 'range', 0, -6, -2), [0, -2, -4]);
});

test('range rejects a zero step with E0304', () => {
  const env = makeEnv();
  assertNativeError(
    () => call(env, 'range', 1, 2, 0),
    CODES.TYPE_ERROR,
    '`range` step must not be zero'
  );
});

test('range refuses results beyond the 5000000 element cap with E0304', () => {
  const env = makeEnv();
  assertNativeError(
    () => call(env, 'range', 6_000_000),
    CODES.TYPE_ERROR,
    '`range` is limited to 5000000 elements'
  );
});

test('range rejects non-number arguments with E0304', () => {
  const env = makeEnv();
  assertNativeError(
    () => call(env, 'range', 'a'),
    CODES.TYPE_ERROR,
    '`range` expects a number, got string "a"'
  );
});

test('upper lower and trim handle their happy paths', () => {
  const env = makeEnv();
  assert.equal(call(env, 'upper', 'ember'), 'EMBER');
  assert.equal(call(env, 'upper', ''), '');
  assert.equal(call(env, 'lower', 'EmBer'), 'ember');
  assert.equal(call(env, 'trim', '  hi  '), 'hi');
  assert.equal(call(env, 'trim', ' \t hi \n '), 'hi');
  assert.equal(call(env, 'trim', 'x'), 'x');
});

test('upper rejects non-strings with E0304', () => {
  const env = makeEnv();
  assertNativeError(
    () => call(env, 'upper', 3),
    CODES.TYPE_ERROR,
    '`upper` expects a string, got int 3'
  );
});

test('chars splits a string into code points', () => {
  const env = makeEnv();
  assert.deepEqual(call(env, 'chars', 'ab c'), ['a', 'b', ' ', 'c']);
  assert.deepEqual(call(env, 'chars', ''), []);
  assert.deepEqual(call(env, 'chars', 'a𝄞'), ['a', '𝄞']);
});

test('split divides a string on a non-empty separator', () => {
  const env = makeEnv();
  assert.deepEqual(call(env, 'split', 'a,b,c', ','), ['a', 'b', 'c']);
  assert.deepEqual(call(env, 'split', 'aXXbXXc', 'XX'), ['a', 'b', 'c']);
  assert.deepEqual(call(env, 'split', '', ','), ['']);
  assert.deepEqual(call(env, 'split', 'abc', 'x'), ['abc']);
});

test('split rejects an empty separator with E0304', () => {
  const env = makeEnv();
  assertNativeError(
    () => call(env, 'split', 'a', ''),
    CODES.TYPE_ERROR,
    '`split` separator must not be empty'
  );
});

test('join concatenates stringified elements with the separator', () => {
  const env = makeEnv();
  assert.equal(call(env, 'join', ['a', 'b', 'c'], '-'), 'a-b-c');
  assert.equal(call(env, 'join', [], '-'), '');
  assert.equal(call(env, 'join', ['a'], '-'), 'a');
  assert.equal(call(env, 'join', [1, 2.5, true, null], ','), '1,2.5,true,null');
});

test('join rejects a non-array receiver with E0304', () => {
  const env = makeEnv();
  assertNativeError(
    () => call(env, 'join', 3, '-'),
    CODES.TYPE_ERROR,
    '`join` expects an array, got int 3'
  );
});

test('replace substitutes every occurrence of the search string', () => {
  const env = makeEnv();
  assert.equal(call(env, 'replace', 'banana', 'a', 'o'), 'bonono');
  assert.equal(call(env, 'replace', 'abc', 'b', 'XY'), 'aXYc');
  assert.equal(call(env, 'replace', 'abc', 'b', ''), 'ac');
  assert.equal(call(env, 'replace', 'abc', 'xyz', 'q'), 'abc');
});

test('replace rejects an empty search string with E0304', () => {
  const env = makeEnv();
  assertNativeError(
    () => call(env, 'replace', 'a', '', 'b'),
    CODES.TYPE_ERROR,
    '`replace` separator must not be empty'
  );
});

test('contains checks array membership with deep equality', () => {
  const env = makeEnv();
  assert.equal(call(env, 'contains', [1, 2, 3], 2), true);
  assert.equal(call(env, 'contains', [1, 2, 3], 9), false);
  assert.equal(call(env, 'contains', [[1, 2], [3, 4]], [3, 4]), true);
  assert.equal(call(env, 'contains', [[1, 2]], [9, 9]), false);
  assert.equal(
    call(env, 'contains', [new Map([['a', 1], ['b', 2]])], new Map([['b', 2], ['a', 1]])),
    true
  );
});

test('contains checks substrings', () => {
  const env = makeEnv();
  assert.equal(call(env, 'contains', 'hello', 'ell'), true);
  assert.equal(call(env, 'contains', 'hello', 'z'), false);
  assert.equal(call(env, 'contains', '', 'x'), false);
});

test('contains checks map keys', () => {
  const env = makeEnv();
  const m = new Map([['k', 1]]);
  assert.equal(call(env, 'contains', m, 'k'), true);
  assert.equal(call(env, 'contains', m, 'j'), false);
});

test('contains rejects unsupported containers with E0304', () => {
  const env = makeEnv();
  assertNativeError(
    () => call(env, 'contains', 3, 1),
    CODES.TYPE_ERROR,
    '`contains` expects an array, string, or map, got int 3'
  );
  assertNativeError(
    () => call(env, 'contains', null, 'x'),
    CODES.TYPE_ERROR,
    '`contains` expects an array, string, or map, got null null'
  );
  assertNativeError(
    () => call(env, 'contains', true, 'x'),
    CODES.TYPE_ERROR,
    '`contains` expects an array, string, or map, got bool true'
  );
});

test('contains requires a string needle for strings and maps', () => {
  const env = makeEnv();
  assertNativeError(
    () => call(env, 'contains', 'abc', 1),
    CODES.TYPE_ERROR,
    '`contains` expects a string, got int 1'
  );
  assertNativeError(
    () => call(env, 'contains', new Map(), 1),
    CODES.TYPE_ERROR,
    '`contains` expects a string, got int 1'
  );
});

test('abs floor ceil round compute as documented', () => {
  const env = makeEnv();
  assert.equal(call(env, 'abs', -3), 3);
  assert.equal(call(env, 'abs', 3), 3);
  assert.equal(call(env, 'abs', -2.5), 2.5);
  assert.equal(call(env, 'floor', 2.9), 2);
  assert.equal(call(env, 'floor', -2.1), -3);
  assert.equal(call(env, 'floor', 3), 3);
  assert.equal(call(env, 'ceil', 2.1), 3);
  assert.equal(call(env, 'ceil', -2.9), -2);
  assert.equal(call(env, 'ceil', 3), 3);
  assert.equal(call(env, 'round', 2.5), 3);
  assert.equal(call(env, 'round', 2.4), 2);
  assert.equal(call(env, 'round', -2.5), -2);
  assert.equal(call(env, 'round', 3), 3);
});

test('min and max fold numeric arrays', () => {
  const env = makeEnv();
  assert.equal(call(env, 'min', [3, 1, 2]), 1);
  assert.equal(call(env, 'max', [3, 1, 2]), 3);
  assert.equal(call(env, 'min', [-2.5, -1]), -2.5);
  assert.equal(call(env, 'max', [2, 2.5]), 2.5);
  assert.equal(call(env, 'min', [7]), 7);
  assert.equal(call(env, 'max', [-1]), -1);
});

test('min and max on an empty array raise E0304', () => {
  const env = makeEnv();
  assertNativeError(
    () => call(env, 'min', []),
    CODES.TYPE_ERROR,
    '`min` expects a non-empty array'
  );
  assertNativeError(
    () => call(env, 'max', []),
    CODES.TYPE_ERROR,
    '`max` expects a non-empty array'
  );
});

test('min and max reject non-array receivers and non-number elements', () => {
  const env = makeEnv();
  assertNativeError(
    () => call(env, 'min', 3),
    CODES.TYPE_ERROR,
    '`min` expects an array, got int 3'
  );
  assertNativeError(
    () => call(env, 'min', [1, 'x']),
    CODES.TYPE_ERROR,
    '`min` expects a number, got string "x"'
  );
  assertNativeError(
    () => call(env, 'max', [true]),
    CODES.TYPE_ERROR,
    '`max` expects a number, got bool true'
  );
});

test('abs rejects non-numbers with E0304', () => {
  const env = makeEnv();
  assertNativeError(
    () => call(env, 'abs', 'x'),
    CODES.TYPE_ERROR,
    '`abs` expects a number, got string "x"'
  );
});

test('expectArgs raises E0303 with every contracted message form', () => {
  const cases = [
    ['len', [], 1, 1, '`len` expects 1 argument, got 0'],
    ['len', [1, 2], 1, 1, '`len` expects 1 argument, got 2'],
    ['push', [[1]], 2, 2, '`push` expects 2 arguments, got 1'],
    ['get', [new Map()], 2, 3, '`get` expects between 2 and 3 arguments, got 1'],
    ['range', [], 1, 3, '`range` expects between 1 and 3 arguments, got 0'],
    ['ask', [1, 2], 0, 1, '`ask` expects between 0 and 1 arguments, got 2'],
    ['print', [1, 2], 3, Infinity, '`print` expects at least 3 arguments, got 2']
  ];
  for (const [name, args, min, max, message] of cases) {
    assertNativeError(
      () => expectArgs(CALL, name, args, min, max),
      CODES.WRONG_ARG_COUNT,
      message
    );
  }
});

test('registry arities match the contracted signatures', () => {
  const env = makeEnv();
  for (const [name, arity] of Object.entries(REGISTRY)) {
    assert.deepEqual(env.get(name).arity, arity, 'arity of ' + name);
  }
});

test('ask rejects a non-string prompt before touching stdin', () => {
  const env = makeEnv();
  assertNativeError(
    () => call(env, 'ask', 3),
    CODES.TYPE_ERROR,
    '`ask` expects a string, got int 3'
  );
});

test('has distinguishes stored values from missing keys', () => {
  const env = makeEnv();
  const m = new Map([['a', null], ['b', 1]]);
  assert.equal(call(env, 'has', m, 'a'), true);   // stored null is present
  assert.equal(call(env, 'has', m, 'b'), true);
  assert.equal(call(env, 'has', m, 'z'), false);
  assertNativeError(() => call(env, 'has', [1], 'a'), CODES.TYPE_ERROR, '`has` expects a map, got array [..1 items]');
});

test('write emits without a trailing newline and returns null', () => {
  const env = makeEnv();
  const chunks = [];
  const orig = process.stdout.write;
  process.stdout.write = (s) => { chunks.push(s); return true; };
  try {
    assert.equal(call(env, 'write', 'a', 1), null);
    assert.equal(call(env, 'write'), null);
  } finally {
    process.stdout.write = orig;
  }
  assert.deepEqual(chunks, ['a 1', '']);
});
