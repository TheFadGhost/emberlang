// Tree-walking interpreter. Executes a parsed Program against chained
// Environments; every diagnostic carries the span of the smallest offending
// node and the file path supplied to run(). Return/break/continue unwind as
// exceptions caught by the nearest matching construct, so stray ones surface
// as E0310 at the top level.

import { runtimeError, internalError, CODES, brief } from './errors.js';
import { Env } from './interp/env.js';
import { truthy, typeName, equals, repr } from './interp/values.js';
import { installBuiltins, expectArgs } from './builtins.js';

// Element cap for a materialised `low..high`, matching the `range` builtin.
const MAX_RANGE = 5_000_000;

// Non-local control flow. Each signal remembers the statement that raised it
// so top-level misuse can point its E0310 diagnostic at the keyword.
export class ReturnSignal {
  constructor(value, node) {
    this.value = value;
    this.node = node;
  }
}

export class BreakSignal {
  constructor(node) {
    this.node = node;
  }
}

export class ContinueSignal {
  constructor(node) {
    this.node = node;
  }
}

const isInt = (v) => typeof v === 'number' && Number.isInteger(v);
const isNum = (v) => typeof v === 'number';
const argWord = (n) => (n === 1 ? 'argument' : 'arguments');

export class Interpreter {
  constructor({ trace = false, traceSink = () => {}, maxDepth = 400 } = {}) {
    this.trace = trace;
    this.traceSink = traceSink;
    this.maxDepth = maxDepth;
    this.depth = 0;
    this.filePath = null;
    this.globals = new Env(null);
    installBuiltins(this.globals);
  }

  // Execute statements in a child scope of globals; returns the last
  // statement's value (null for declarations/assignments/empty programs).
  // `opts.env` runs against an explicit environment instead of a fresh child —
  // the REPL passes its persistent globals so top-level bindings accumulate.
  run(program, { filePath = null, env = null } = {}) {
    this.filePath = filePath ?? null;
    this.depth = 0;
    const scope = env ?? new Env(this.globals);
    let last = null;
    try {
      for (const stmt of program.body) last = this.execStmt(stmt, scope);
    } catch (err) {
      throw this.misuseError(err);
    }
    return last;
  }

  // Convert an escaped control-flow signal into E0310; anything else passes.
  misuseError(err) {
    if (err instanceof ReturnSignal) {
      return runtimeError(CODES.MISUSED_STATEMENT, '`return` outside a function', err.node, this.filePath,
        'move the `return` inside a `fn` body.');
    }
    if (err instanceof BreakSignal) {
      return runtimeError(CODES.MISUSED_STATEMENT, '`break` outside a loop', err.node, this.filePath,
        'use `break` inside a `while` or `for` loop.');
    }
    if (err instanceof ContinueSignal) {
      return runtimeError(CODES.MISUSED_STATEMENT, '`continue` outside a loop', err.node, this.filePath,
        'use `continue` inside a `while` or `for` loop.');
    }
    return err;
  }

  // --- statements ---

  execStmt(stmt, env) {
    switch (stmt.kind) {
      case 'LetStmt':
        env.define(stmt.name, this.evalExpr(stmt.value, env));
        return null;
      case 'AssignStmt':
        this.execAssign(stmt, env);
        return null;
      case 'ExprStmt':
        return this.evalExpr(stmt.expr, env);
      case 'IfStmt': {
        for (const branch of stmt.branches) {
          if (truthy(this.evalExpr(branch.cond, env))) return this.execBlock(branch.body, env);
        }
        return stmt.elseBody ? this.execBlock(stmt.elseBody, env) : null;
      }
      case 'WhileStmt': {
        let last = null;
        while (truthy(this.evalExpr(stmt.cond, env))) {
          try {
            last = this.execBlock(stmt.body, env);
          } catch (err) {
            if (err instanceof BreakSignal) break;
            if (err instanceof ContinueSignal) continue;
            throw err;
          }
        }
        return last;
      }
      case 'ForStmt':
        return this.execFor(stmt, env);
      case 'FnDecl':
        env.define(stmt.name, makeFn(stmt.name, stmt.params, stmt.body, env));
        return null;
      case 'ReturnStmt':
        throw new ReturnSignal(stmt.value ? this.evalExpr(stmt.value, env) : null, stmt);
      case 'BreakStmt':
        throw new BreakSignal(stmt);
      case 'ContinueStmt':
        throw new ContinueSignal(stmt);
      case 'Block':
        return this.execBlock(stmt, env);
      default:
        throw internalError('unknown statement kind ' + stmt.kind);
    }
  }

  execBlock(block, env) {
    const child = new Env(env);
    let last = null;
    for (const s of block.body) last = this.execStmt(s, child);
    return last;
  }

  execFor(stmt, env) {
    const iterable = this.evalExpr(stmt.iter, env);
    let items;
    if (Array.isArray(iterable)) items = [...iterable];
    else if (typeof iterable === 'string') items = [...iterable];
    else if (iterable instanceof Map) items = [...iterable.keys()];
    else {
      throw runtimeError(
        CODES.NOT_ITERABLE,
        '`for` cannot iterate over ' + typeName(iterable) + ' ' + brief(iterable),
        stmt.iter,
        this.filePath,
        null
      );
    }
    let last = null;
    for (const item of items) {
      // A fresh binding per iteration: closures made here capture this
      // iteration's value, not a shared loop variable.
      const iterEnv = new Env(env);
      iterEnv.define(stmt.name, item);
      try {
        last = this.execBlock(stmt.body, iterEnv);
      } catch (err) {
        if (err instanceof BreakSignal) break;
        if (err instanceof ContinueSignal) continue;
        throw err;
      }
    }
    return last;
  }

  execAssign(stmt, env) {
    const { target, op, value } = stmt;
    if (target.kind === 'Ident') {
      let next = this.evalExpr(value, env);
      if (op !== '=') {
        const current = env.get(target.name, target, this.filePath);
        next = this.binValues(op.slice(0, -1), current, next, stmt);
      }
      env.assign(target.name, next, target, this.filePath);
      return;
    }

    // Index target: object and index are evaluated exactly once. Strings
    // reject mutation outright before their index expression matters.
    const obj = this.evalExpr(target.obj, env);
    if (typeof obj === 'string') {
      throw this.typeErr('strings are immutable', target.obj);
    }
    const key = this.evalExpr(target.index, env);
    if (Array.isArray(obj)) {
      const i = this.arrayIndex(obj, key, target.index);
      let next = this.evalExpr(value, env);
      if (op !== '=') next = this.binValues(op.slice(0, -1), obj[i], next, stmt);
      obj[i] = next;
      return;
    }
    if (obj instanceof Map) {
      if (typeof key !== 'string') {
        throw this.typeErr('map key must be a string, got ' + typeName(key) + ' ' + brief(key), target.index);
      }
      let next = this.evalExpr(value, env);
      if (op !== '=') {
        const current = obj.has(key) ? obj.get(key) : null;
        next = this.binValues(op.slice(0, -1), current, next, stmt);
      }
      obj.set(key, next);
      return;
    }
    throw this.typeErr('cannot assign into ' + typeName(obj) + ' ' + brief(obj), target.obj);
  }

  // --- expressions ---

  evalExpr(node, env) {
    switch (node.kind) {
      case 'NumLit':
      case 'StrLit':
      case 'BoolLit':
        return node.value;
      case 'NullLit':
        return null;
      case 'Ident':
        return env.get(node.name, node, this.filePath);
      case 'UnOp':
        return this.evalUnOp(node, env);
      case 'BinOp':
        return this.evalBinOp(node, env);
      case 'RangeLit':
        return this.evalRange(node, env);
      case 'ArrLit':
        return node.items.map((it) => this.evalExpr(it, env));
      case 'MapLit': {
        const m = new Map();
        for (const en of node.entries) {
          const k = this.evalExpr(en.key, env);
          if (typeof k !== 'string') {
            throw this.typeErr('map keys must be strings, got ' + typeName(k) + ' ' + brief(k), en.key);
          }
          if (m.has(k)) {
            throw this.typeErr('duplicate map key `' + k + '`', en.key);
          }
          m.set(k, this.evalExpr(en.value, env));
        }
        return m;
      }
      case 'FnExpr':
        return makeFn('', node.params, node.body, env);
      case 'Call':
        return this.evalCall(node, env);
      case 'Index': {
        const obj = this.evalExpr(node.obj, env);
        const key = this.evalExpr(node.index, env);
        return this.readIndex(obj, key, node.obj, node.index);
      }
      case 'Slice':
        return this.evalSlice(node, env);
      default:
        throw internalError('unknown expression kind ' + node.kind);
    }
  }

  evalUnOp(node, env) {
    if (node.op === 'not') return !truthy(this.evalExpr(node.operand, env));
    const v = this.evalExpr(node.operand, env); // op === '-'
    if (!isNum(v)) {
      throw this.typeErr('`-` expects a number, got ' + typeName(v) + ' ' + brief(v), node.operand);
    }
    return -v;
  }

  evalBinOp(node, env) {
    if (node.op === 'and') {
      const left = this.evalExpr(node.left, env);
      return truthy(left) ? this.evalExpr(node.right, env) : left;
    }
    if (node.op === 'or') {
      const left = this.evalExpr(node.left, env);
      return truthy(left) ? left : this.evalExpr(node.right, env);
    }
    const left = this.evalExpr(node.left, env);
    const right = this.evalExpr(node.right, env);
    return this.binValues(node.op, left, right, node);
  }

  // Operator semantics shared by BinOp and compound assignment. Errors point
  // at the whole binary expression (or assignment statement).
  binValues(op, l, r, spanNode) {
    switch (op) {
      case '+':
        if (isNum(l) && isNum(r)) return l + r;
        if (typeof l === 'string' && typeof r === 'string') return l + r;
        if (Array.isArray(l) && Array.isArray(r)) return [...l, ...r];
        throw this.typeErr('`+` cannot add ' + pair(l, r), spanNode);
      case '-':
      case '*':
        if (isNum(l) && isNum(r)) return op === '-' ? l - r : l * r;
        throw this.typeErr('`' + op + '` expects numbers, got ' + pair(l, r), spanNode);
      case '/':
        if (!isNum(l) || !isNum(r)) throw this.typeErr('`/` expects numbers, got ' + pair(l, r), spanNode);
        if (r === 0) throw this.divZero('`/` division by zero', spanNode);
        return l / r;
      case '%':
        if (!isNum(l) || !isNum(r)) throw this.typeErr('`%` expects numbers, got ' + pair(l, r), spanNode);
        if (r === 0) throw this.divZero('`%` modulo by zero', spanNode);
        return l % r;
      case '==':
        return equals(l, r);
      case '!=':
        return !equals(l, r);
      case '<':
      case '<=':
      case '>':
      case '>=': {
        const ok = (isNum(l) && isNum(r)) || (typeof l === 'string' && typeof r === 'string');
        if (!ok) throw this.typeErr('`' + op + '` expects two numbers or two strings, got ' + pair(l, r), spanNode);
        return op === '<' ? l < r : op === '<=' ? l <= r : op === '>' ? l > r : l >= r;
      }
      default:
        throw internalError('unknown operator ' + op);
    }
  }

  evalRange(node, env) {
    const low = this.evalExpr(node.low, env);
    const high = this.evalExpr(node.high, env);
    if (!isInt(low) || !isInt(high)) {
      throw this.typeErr(
        '`..` expects integer bounds, got ' + pair(low, high),
        node
      );
    }
    const count = high - low;
    if (count > MAX_RANGE) {
      throw this.typeErr('`..` range exceeds the limit of ' + MAX_RANGE + ' elements', node);
    }
    if (count <= 0) return [];
    const out = new Array(count);
    for (let i = 0; i < count; i++) out[i] = low + i;
    return out;
  }

  evalCall(node, env) {
    const fn = this.evalExpr(node.callee, env);
    const args = node.args.map((a) => this.evalExpr(a, env));
    if (fn && fn.__fn) {
      if (args.length !== fn.params.length) {
        throw runtimeError(
          CODES.WRONG_ARG_COUNT,
          '`' + fn.name + '` expects ' + fn.params.length + ' ' + argWord(fn.params.length) +
            ', got ' + args.length,
          node,
          this.filePath,
          null
        );
      }
      return this.callEmber(fn, args, node);
    }
    if (fn && fn.__native) {
      expectArgs(node, fn.name, args, fn.arity[0], fn.arity[1]);
      return fn.call(node, args);
    }
    throw runtimeError(CODES.NOT_CALLABLE, brief(fn) + ' is not callable', node.callee, this.filePath, null);
  }

  callEmber(fn, args, callNode) {
    this.depth++;
    const name = fn.name || '<anon>';
    if (this.trace) this.emit('call ' + name + '(' + args.map(repr).join(', ') + ')');
    try {
      if (this.depth > this.maxDepth) {
        throw runtimeError(
          CODES.RECURSION_LIMIT,
          'recursion limit exceeded (' + this.maxDepth + ' calls)',
          callNode,
          this.filePath,
          'recursive functions need a base case that stops the calls.'
        );
      }
      const local = new Env(fn.closure);
      fn.params.forEach((p, i) => local.define(p.name, args[i]));
      let last = null;
      for (const s of fn.body.body) last = this.execStmt(s, local);
      if (this.trace) this.emit('ret ' + name + ' -> ' + repr(last));
      return last;
    } catch (err) {
      if (err instanceof ReturnSignal) {
        if (this.trace) this.emit('ret ' + name + ' -> ' + repr(err.value));
        return err.value;
      }
      throw err;
    } finally {
      this.depth--;
    }
  }

  readIndex(obj, key, objNode, keyNode) {
    if (Array.isArray(obj)) return obj[this.arrayIndex(obj, key, keyNode)];
    if (typeof obj === 'string') {
      if (!isInt(key)) {
        throw this.typeErr('string index must be an integer, got ' + typeName(key) + ' ' + brief(key), keyNode);
      }
      const chars = [...obj];
      if (key < 0 || key >= chars.length) {
        throw this.outOfRange(key, chars.length, 'a string', keyNode);
      }
      return chars[key];
    }
    if (obj instanceof Map) {
      if (typeof key !== 'string') {
        throw this.typeErr('map key must be a string, got ' + typeName(key) + ' ' + brief(key), keyNode);
      }
      if (!obj.has(key)) {
        throw runtimeError(CODES.MISSING_KEY, 'map has no key `' + key + '`', keyNode, this.filePath, null);
      }
      return obj.get(key);
    }
    throw this.typeErr('cannot index ' + typeName(obj) + ' ' + brief(obj), objNode);
  }

  // Integer index into an array, bounds-checked; negative counts as out of
  // range rather than from-the-end.
  arrayIndex(arr, key, keyNode) {
    if (!isInt(key)) {
      throw this.typeErr('array index must be an integer, got ' + typeName(key) + ' ' + brief(key), keyNode);
    }
    if (key < 0 || key >= arr.length) {
      throw this.outOfRange(key, arr.length, 'an array', keyNode);
    }
    return key;
  }

  evalSlice(node, env) {
    const obj = this.evalExpr(node.obj, env);
    const low = node.low ? this.evalExpr(node.low, env) : null;
    const high = node.high ? this.evalExpr(node.high, env) : null;
    if (Array.isArray(obj)) {
      const [lo, hi] = this.clampBounds(low, high, obj.length, node);
      return obj.slice(lo, hi);
    }
    if (typeof obj === 'string') {
      const chars = [...obj];
      const [lo, hi] = this.clampBounds(low, high, chars.length, node);
      return chars.slice(lo, hi).join('');
    }
    throw this.typeErr('cannot slice ' + typeName(obj) + ' ' + brief(obj), node.obj);
  }

  clampBounds(low, high, len, node) {
    let lo = 0;
    let hi = len;
    if (low !== null) {
      if (!isInt(low)) throw this.typeErr('slice bounds must be integers, got ' + typeName(low) + ' ' + brief(low), node.low ?? node);
      lo = Math.max(0, Math.min(low, len));
    }
    if (high !== null) {
      if (!isInt(high)) throw this.typeErr('slice bounds must be integers, got ' + typeName(high) + ' ' + brief(high), node.high ?? node);
      hi = Math.max(0, Math.min(high, len));
    }
    return [lo, hi];
  }

  emit(line) {
    this.traceSink('  '.repeat(this.depth) + line);
  }

  typeErr(message, span) {
    return runtimeError(CODES.TYPE_ERROR, message, span, this.filePath, null);
  }

  divZero(message, span) {
    return runtimeError(CODES.DIV_BY_ZERO, message, span, this.filePath, null);
  }

  outOfRange(index, length, kind, span) {
    return runtimeError(
      CODES.INDEX_OUT_OF_RANGE,
      'index ' + index + ' out of range for ' + kind + ' of length ' + length,
      span,
      this.filePath,
      null
    );
  }
}

function makeFn(name, params, body, closure) {
  return { __fn: true, name, params, body, closure };
}

function pair(l, r) {
  return typeName(l) + ' ' + brief(l) + ' and ' + typeName(r) + ' ' + brief(r);
}
