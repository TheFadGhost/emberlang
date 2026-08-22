// Environment: lexical scope chain. Redefinition is allowed (REPL-friendly);
// assignment walks the chain and fails loudly on undeclared names.

import { runtimeError, CODES } from '../errors.js';

export class Env {
  constructor(parent = null) {
    this.vars = new Map();
    this.parent = parent;
  }

  define(name, value) {
    this.vars.set(name, value);
  }

  has(name) {
    for (let e = this; e; e = e.parent) {
      if (e.vars.has(name)) return true;
    }
    return false;
  }

  get(name, span, filePath) {
    for (let e = this; e; e = e.parent) {
      if (e.vars.has(name)) return e.vars.get(name);
    }
    throw undefinedVariable(name, span, filePath);
  }

  assign(name, value, span, filePath) {
    for (let e = this; e; e = e.parent) {
      if (e.vars.has(name)) {
        e.vars.set(name, value);
        return;
      }
    }
    throw undefinedVariable(name, span, filePath);
  }

  // Sorted binding names including ancestors; used by :env and completion.
  names() {
    const seen = new Set();
    for (let e = this; e; e = e.parent) {
      for (const k of e.vars.keys()) seen.add(k);
    }
    return [...seen].sort();
  }
}

function undefinedVariable(name, span, filePath) {
  return runtimeError(
    CODES.UNDEFINED_VARIABLE,
    'undefined variable `' + name + '`',
    span,
    filePath,
    'variables must be declared before use with `let`'
  );
}
