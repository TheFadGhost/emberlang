// Value model: truthiness, type names, deep equality, and the two display
// formats. `stringify` is print semantics (top-level strings raw); `repr`
// is inspect semantics (strings quoted) used by the REPL echo.

export function truthy(v) {
  return !(v === false || v === null);
}

// Element cap for materialised ranges (`a..b` and the `range` builtin);
// single source shared by interpreter and builtins.
export const MAX_RANGE = 5_000_000;

export function typeName(v) {
  if (v === null) return 'null';
  if (typeof v === 'boolean') return 'bool';
  if (typeof v === 'number') return Number.isInteger(v) ? 'int' : 'float';
  if (typeof v === 'string') return 'string';
  if (Array.isArray(v)) return 'array';
  if (v instanceof Map) return 'map';
  if (v && (v.__fn || v.__native)) return 'function';
  return 'unknown';
}

// Deep structural equality; functions compare by identity. Iterative on
// purpose: cyclic or very deep structures must compare (or differ) without
// overflowing the host stack. Revisiting a pair inside one comparison means
// the two cycles agree so far and is treated as equal.
export function equals(a, b) {
  const stack = [[a, b]];
  const seenPairs = new Map();
  while (stack.length > 0) {
    const [x, y] = stack.pop();
    if (x === y) continue;
    if (x === null || y === null) return false;
    const tx = typeof x;
    if (tx !== typeof y) return false;
    if (tx !== 'object') {
      if (x !== y) return false;
      continue;
    }
    const ax = Array.isArray(x);
    const ay = Array.isArray(y);
    const mx = x instanceof Map;
    const my = y instanceof Map;
    if (ax !== ay || mx !== my || (!ax && !mx)) {
      // Different container kinds, or a non-container object (function):
      // identity was the only chance and it already failed.
      return false;
    }
    let ysForX = seenPairs.get(x);
    if (ysForX === undefined) {
      ysForX = new Set();
      seenPairs.set(x, ysForX);
    } else if (ysForX.has(y)) {
      continue; // cycle revisited with everything so far equal
    }
    ysForX.add(y);
    if (ax) {
      if (x.length !== y.length) return false;
      for (let i = 0; i < x.length; i++) stack.push([x[i], y[i]]);
    } else {
      if (x.size !== y.size) return false;
      for (const [k, v] of x) {
        if (!y.has(k)) return false;
        stack.push([v, y.get(k)]);
      }
    }
  }
  return true;
}

const MAX_STRINGIFY_DEPTH = 20;

function fmt(v, quoteTop, seen, depth) {
  if (v === null) return 'null';
  if (typeof v === 'boolean') return String(v);
  if (typeof v === 'number') return String(v);
  if (typeof v === 'string') return quoteTop ? JSON.stringify(v) : v;
  if (depth > MAX_STRINGIFY_DEPTH) return '[...]';
  if (seen.has(v)) return '[cyclic]';
  if (Array.isArray(v)) {
    seen.add(v);
    const parts = v.map(x => fmt(x, true, seen, depth + 1));
    seen.delete(v);
    return '[' + parts.join(', ') + ']';
  }
  if (v instanceof Map) {
    seen.add(v);
    const parts = [...v.entries()].map(([k, x]) => JSON.stringify(k) + ': ' + fmt(x, true, seen, depth + 1));
    seen.delete(v);
    return '{' + parts.join(', ') + '}';
  }
  if (v && (v.__fn || v.__native)) return v.name ? '<fn ' + v.name + '>' : '<fn>';
  return String(v);
}

// print/str() semantics: top-level strings appear raw.
export function stringify(v) {
  return fmt(v, false, new Set(), 0);
}

// REPL echo semantics: top-level strings quoted so `'hi'` echoes as "hi".
export function repr(v) {
  return fmt(v, true, new Set(), 0);
}
