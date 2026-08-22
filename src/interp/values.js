// Value model: truthiness, type names, deep equality, and the two display
// formats. `stringify` is print semantics (top-level strings raw); `repr`
// is inspect semantics (strings quoted) used by the REPL echo.

export function truthy(v) {
  return !(v === false || v === null);
}

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

// Deep structural equality; functions compare by identity.
export function equals(a, b) {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== typeof b && !(typeof a === 'object' && typeof b === 'object')) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!equals(a[i], b[i])) return false;
    }
    return true;
  }
  if (a instanceof Map && b instanceof Map) {
    if (a.size !== b.size) return false;
    for (const [k, v] of a) {
      if (!b.has(k) || !equals(v, b.get(k))) return false;
    }
    return true;
  }
  return false;
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
