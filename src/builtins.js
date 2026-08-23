// Builtin library. Natives receive (callNode, args) and throw runtime
// errors with the CALL SITE span so diagnostics point at the caller.

import fs from 'node:fs';
import { runtimeError, CODES, brief, argWord, asSpan } from './errors.js';
import { stringify, typeName, equals as deepEq, MAX_RANGE } from './interp/values.js';

// --- shared argument helpers (used by builtins and available to tests) ---

export function expectArgs(callNode, name, args, min, max = min) {
  const got = args.length;
  if (got >= min && got <= max) return;
  let expected;
  if (min === max) expected = 'expects ' + min + ' ' + argWord(min);
  else if (max === Infinity) expected = 'expects at least ' + min + ' ' + argWord(min);
  else expected = 'expects between ' + min + ' and ' + max + ' arguments';
  throw runtimeError(
    CODES.WRONG_ARG_COUNT,
    '`' + name + '` ' + expected + ', got ' + got,
    asSpan(callNode),
    null
  );
}

function expectType(callNode, name, v, kind) {
  // numbers: int or float both pass when kind is 'number'
  const tn = typeName(v);
  const ok = kind === 'number' ? (tn === 'int' || tn === 'float') : tn === kind;
  if (!ok) {
    throw runtimeError(
      CODES.TYPE_ERROR,
      '`' + name + '` expects ' + article(kind === 'number' ? 'number' : kind) + ', got ' + tn + ' ' + brief(v),
      asSpan(callNode),
      null
    );
  }
}

const strArg = (n, v) => (c) => expectType(c, n, v, 'string');
export { expectType };

// `a` or `an`, because "expects a array" reads like a bug.
function article(noun) {
  return (/^[aeiou]/.test(noun) ? 'an ' : 'a ') + noun;
}

// --- stdin plumbing for ask(): buffered so piped multi-line input works ---

let stdinBuf = '';

function readLineStdin() {
  for (;;) {
    const nl = stdinBuf.indexOf('\n');
    if (nl !== -1) {
      const line = stdinBuf.slice(0, nl).replace(/\r$/, '');
      stdinBuf = stdinBuf.slice(nl + 1);
      return line;
    }
    if (stdinBuf.length > 1_000_000) {
      const line = stdinBuf.replace(/\r$/, '');
      stdinBuf = '';
      return line;
    }
    let buf;
    try {
      buf = Buffer.alloc(4096);
      const n = fs.readSync(0, buf, 0, 4096, null);
      if (n === 0) {
        const rest = stdinBuf.replace(/\r$/, '');
        stdinBuf = '';
        return rest === '' ? null : rest;
      }
      stdinBuf += buf.toString('utf8', 0, n);
    } catch {
      return null; // no readable stdin behaves like EOF
    }
  }
}

// --- the registry ---

export function installBuiltins(env) {
  const def = (name, arity, call) => env.define(name, { __native: true, name, arity, call });

  def('len', [1, 1], (node, args) => {
    const [v] = args;
    if (typeof v === 'string') return [...v].length;
    if (Array.isArray(v)) return v.length;
    if (v instanceof Map) return v.size;
    throw typeErr(node, 'len', v, 'a string, array, or map');
  });

  def('print', [0, Infinity], (_node, args) => {
    process.stdout.write(args.map(a => stringify(a)).join(' ') + '\n');
    return null;
  });

  // Like print but without the trailing newline; the adventure example uses
  // it for prompts alongside `ask`.
  def('write', [0, Infinity], (_node, args) => {
    process.stdout.write(args.map(a => stringify(a)).join(' '));
    return null;
  });

  def('push', [2, 2], (node, args) => {
    expectType(node, 'push', args[0], 'array');
    args[0].push(args[1]);
    return args[0];
  });

  def('pop', [1, 1], (node, args) => {
    expectType(node, 'pop', args[0], 'array');
    if (args[0].length === 0) {
      throw runtimeError(CODES.INDEX_OUT_OF_RANGE, 'pop from an empty array', asSpan(node), null);
    }
    return args[0].pop();
  });

  def('keys', [1, 1], (node, args) => {
    expectType(node, 'keys', args[0], 'map');
    return [...args[0].keys()];
  });

  def('values', [1, 1], (node, args) => {
    expectType(node, 'values', args[0], 'map');
    return [...args[0].values()];
  });

  def('get', [2, 3], (node, args) => {
    expectType(node, 'get', args[0], 'map');
    expectType(node, 'get', args[1], 'string');
    return args[0].has(args[1]) ? args[0].get(args[1]) : (args[2] ?? null);
  });

  // True when the map stores `k`, regardless of the stored value —
  // `get(m, k, null)` alone cannot tell a missing key from a stored null.
  def('has', [2, 2], (node, args) => {
    expectType(node, 'has', args[0], 'map');
    expectType(node, 'has', args[1], 'string');
    return args[0].has(args[1]);
  });

  def('str', [1, 1], (_node, args) => stringify(args[0]));

  def('int', [1, 1], (node, args) => {
    const v = args[0];
    if (typeof v === 'number') return Math.trunc(v) + 0; // `+ 0` normalises -0 to 0
    if (typeof v === 'string') {
      const t = v.trim();
      if (/^[+-]?\d+$/.test(t)) return parseInt(t, 10);
      throw badConvert(node, 'int', v);
    }
    throw badConvert(node, 'int', v);
  });

  def('float', [1, 1], (node, args) => {
    const v = args[0];
    if (typeof v === 'number') return v;
    if (typeof v === 'string') {
      const t = v.trim();
      // Decimal literals only: `float("0x10")` is a mistake, not 16.
      if (/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(t) && Number.isFinite(Number(t))) {
        return Number(t);
      }
      throw badConvert(node, 'float', v);
    }
    throw badConvert(node, 'float', v);
  });

  def('type', [1, 1], (_node, args) => typeName(args[0]));

  def('range', [1, 3], (node, args) => {
    for (let i = 0; i < args.length; i++) expectType(node, 'range', args[i], 'number');
    let low = 0, high = 0, step = 1;
    if (args.length === 1) high = Math.trunc(args[0]);
    else {
      low = Math.trunc(args[0]); high = Math.trunc(args[1]);
      if (args.length === 3) step = Math.trunc(args[2]);
    }
    if (step === 0) {
      throw runtimeError(CODES.TYPE_ERROR, '`range` step must not be zero', asSpan(node), null);
    }
    // Count first: refuse oversized ranges before allocating anything.
    const span = high - low;
    const count = step > 0
      ? (span > 0 ? Math.ceil(span / step) : 0)
      : (span < 0 ? Math.ceil(-span / -step) : 0);
    if (count > MAX_RANGE) {
      throw runtimeError(CODES.TYPE_ERROR, '`range` is limited to ' + MAX_RANGE + ' elements', asSpan(node), null);
    }
    const out = new Array(count);
    for (let i = 0; i < count; i++) out[i] = low + i * step;
    return out;
  });

  def('upper', [1, 1], (node, a) => { strArg('upper', a[0])(node); return a[0].toUpperCase(); });
  def('lower', [1, 1], (node, a) => { strArg('lower', a[0])(node); return a[0].toLowerCase(); });
  def('trim', [1, 1], (node, a) => { strArg('trim', a[0])(node); return a[0].trim(); });
  def('chars', [1, 1], (node, a) => { strArg('chars', a[0])(node); return [...a[0]]; });

  def('split', [2, 2], (node, a) => {
    strArg('split', a[0])(node); strArg('split', a[1])(node);
    if (a[1] === '') throw sepEmpty(node, 'split');
    return a[0].split(a[1]);
  });

  def('join', [2, 2], (node, a) => {
    expectType(node, 'join', a[0], 'array');
    strArg('join', a[1])(node);
    return a[0].map(x => stringify(x)).join(a[1]);
  });

  def('replace', [3, 3], (node, a) => {
    strArg('replace', a[0])(node); strArg('replace', a[1])(node); strArg('replace', a[2])(node);
    if (a[1] === '') throw sepEmpty(node, 'replace');
    return a[0].replaceAll(a[1], a[2]);
  });

  def('contains', [2, 2], (node, a) => {
    const [xs, x] = a;
    if (Array.isArray(xs)) return xs.some(item => deepEq(item, x));
    if (typeof xs === 'string') { strArg('contains', x)(node); return xs.includes(x); }
    if (xs instanceof Map) { strArg('contains', x)(node); return xs.has(x); }
    throw typeErr(node, 'contains', xs, 'an array, string, or map');
  });

  def('abs', [1, 1], (node, a) => { numArg(node, 'abs', a[0]); return Math.abs(a[0]); });
  def('floor', [1, 1], (node, a) => { numArg(node, 'floor', a[0]); return Math.floor(a[0]); });
  def('ceil', [1, 1], (node, a) => { numArg(node, 'ceil', a[0]); return Math.ceil(a[0]); });
  def('round', [1, 1], (node, a) => { numArg(node, 'round', a[0]); return Math.round(a[0]); });

  def('min', [1, 1], (node, a) => numericFold(node, 'min', a[0], Math.min));
  def('max', [1, 1], (node, a) => numericFold(node, 'max', a[0], Math.max));

  def('ask', [0, 1], (node, a) => {
    if (a.length === 1) {
      if (typeof a[0] !== 'string') throw typeErr(node, 'ask', a[0], 'a string');
      process.stdout.write(a[0]);
    }
    return readLineStdin();
  });
}

function numArg(node, name, v) {
  expectType(node, name, v, 'number');
}

function numericFold(node, name, arr, fold) {
  expectType(node, name, arr, 'array');
  if (arr.length === 0) {
    throw runtimeError(
      CODES.TYPE_ERROR,
      '`' + name + '` expects a non-empty array',
      asSpan(node), null
    );
  }
  for (const x of arr) numArg(node, name, x);
  // Plain loop: spreading 200k arguments into fold() overflows the stack.
  let best = arr[0];
  for (let i = 1; i < arr.length; i++) best = fold(best, arr[i]);
  return best;
}

function typeErr(node, name, v, expectedPhrase) {
  return runtimeError(
    CODES.TYPE_ERROR,
    '`' + name + '` expects ' + expectedPhrase + ', got ' + typeName(v) + ' ' + brief(v),
    asSpan(node), null
  );
}

function badConvert(node, name, v) {
  return runtimeError(
    CODES.TYPE_ERROR,
    '`' + name + '` cannot convert ' + brief(v),
    asSpan(node),
    null,
    'value must look like a whole ' + (name === 'int' ? 'integer' : 'number') + '.'
  );
}

function sepEmpty(node, name) {
  return runtimeError(
    CODES.TYPE_ERROR,
    '`' + name + '` separator must not be empty',
    asSpan(node), null
  );
}
