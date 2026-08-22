// Parser tests. Token arrays come from src/lexer.js when it is present;
// until it lands, a contract-shaped fallback tokenizer below stands in so
// the parser is always exercised through realistic token streams.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parse } from '../src/parser.js';
import { astDump } from '../src/ast.js';
import { UnexpectedEOF } from '../src/errors.js';
import { KEYWORDS } from '../src/tokens.js';

let tokenize = null;
try {
  const mod = await import('../src/lexer.js');
  if (typeof mod.tokenize === 'function') tokenize = mod.tokenize;
} catch {
  // src/lexer.js not built in this workspace yet; use the fallback.
}

function toks(src) {
  const ts = tokenize ? tokenize(src, 'test.em') : lexTokens(src);
  assert.equal(ts[ts.length - 1].type, 'EOF');
  return ts;
}

function parseOk(src) {
  return parse(toks(src), 'test.em');
}

// First statement of a program.
function first(src) {
  const p = parseOk(src);
  assert.ok(p.body.length >= 1, 'expected at least one statement');
  return p.body[0];
}

// Expression wrapped in an expression statement.
function exprOf(src) {
  const s = first(src);
  assert.equal(s.kind, 'ExprStmt', 'expected an expression statement, got ' + s.kind);
  return s.expr;
}

function errOf(src) {
  try {
    parseOk(src);
    assert.fail('expected a syntax error for: ' + src);
  } catch (e) {
    assert.equal(e.kind, 'syntax', 'non-syntax error escaped: ' + e.message);
    return e;
  }
}

function expectCode(src, code) {
  const e = errOf(src);
  assert.equal(e.code, code, `expected ${code}, got ${e.code}: ${e.message}`);
  return e;
}

function expectEOFError(src) {
  const e = expectCode(src, 'E0202');
  assert.equal(e.eof, true, 'E0202 must set eof=true for REPL continuation');
  assert.ok(e instanceof UnexpectedEOF);
  return e;
}

// Fallback tokenizer implementing the CONTRACTS.md lexer rules: # comments,
// insignificant whitespace, "..." or '...' strings with escapes, digits with
// _ separators plus fraction/exponent, keyword recognition, two-char
// operators before one-char ones. 1-based code-point columns, endCol
// exclusive, stream ends with EOF.
function lexTokens(src) {
  const cs = Array.from(src);
  const out = [];
  let i = 0;
  let line = 1;
  let col = 1;
  const bump = (ch) => {
    if (ch === '\n') { line++; col = 1; } else { col++; }
  };
  const take = () => {
    const ch = cs[i++];
    bump(ch);
    return ch;
  };
  const push = (type, value, l, c) => out.push({ type, value, line: l, col: c, endCol: col });
  const isDigit = (ch) => ch >= '0' && ch <= '9';
  const isIdStart = (ch) => /[A-Za-z_]/.test(ch) || /\p{L}/u.test(ch);
  const isIdPart = (ch) => isIdStart(ch) || isDigit(ch);
  const TWO = {
    '==': 'EQ', '!=': 'NEQ', '<=': 'LE', '>=': 'GE', '..': 'DOTDOT',
    '+=': 'PLUSEQ', '-=': 'MINUSEQ', '*=': 'STAREQ', '/=': 'SLASHEQ', '%=': 'PERCENTEQ'
  };
  const ONE = {
    '(': 'LPAREN', ')': 'RPAREN', '[': 'LBRACKET', ']': 'RBRACKET',
    '{': 'LBRACE', '}': 'RBRACE', ',': 'COMMA', '.': 'DOT', ':': 'COLON',
    '=': 'ASSIGN', '+': 'PLUS', '-': 'MINUS', '*': 'STAR', '/': 'SLASH',
    '%': 'PERCENT', '<': 'LT', '>': 'GT'
  };

  while (i < cs.length) {
    const ch = cs[i];
    if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n') { take(); continue; }
    if (ch === '#') {
      while (i < cs.length && cs[i] !== '\n') take();
      continue;
    }
    const l = line;
    const c = col;
    if (ch === '"' || ch === "'") {
      const quote = take();
      let val = '';
      for (;;) {
        if (i >= cs.length || cs[i] === '\n') throw new Error('unterminated string in test lexer');
        const sch = take();
        if (sch === quote) break;
        if (sch === '\\') {
          const mapped = { n: '\n', t: '\t', r: '\r', '\\': '\\', '"': '"', "'": "'", '0': '\0' }[take()];
          if (mapped === undefined) throw new Error('bad escape in test lexer');
          val += mapped;
        } else {
          val += sch;
        }
      }
      push('STRING', val, l, c);
      continue;
    }
    if (isDigit(ch)) {
      let text = '';
      while (i < cs.length && (isDigit(cs[i]) || cs[i] === '_')) text += take();
      let isFloat = false;
      if (cs[i] === '.' && isDigit(cs[i + 1] ?? '')) {
        isFloat = true;
        text += take();
        while (i < cs.length && (isDigit(cs[i]) || cs[i] === '_')) text += take();
      }
      if (cs[i] === 'e' || cs[i] === 'E') {
        isFloat = true;
        text += take();
        if (cs[i] === '+' || cs[i] === '-') text += take();
        while (i < cs.length && isDigit(cs[i])) text += take();
      }
      push(isFloat ? 'FLOAT' : 'INT', Number(text.replace(/_/g, '')), l, c);
      continue;
    }
    if (isIdStart(ch)) {
      let name = '';
      while (i < cs.length && isIdPart(cs[i])) name += take();
      push(KEYWORDS.has(name) ? 'KEYWORD' : 'IDENT', name, l, c);
      continue;
    }
    const two = ch + (cs[i + 1] ?? '');
    if (TWO[two]) { take(); take(); push(TWO[two], two, l, c); continue; }
    if (ONE[ch]) { take(); push(ONE[ch], ch, l, c); continue; }
    throw new Error('invalid character reached test lexer: ' + JSON.stringify(ch));
  }
  out.push({ type: 'EOF', value: null, line, col, endCol: col });
  return out;
}

// --- precedence and associativity ---

// Partial structural match: checks kind plus any of op/name/value/isInt,
// recursing into left/right when the spec provides them.
function matchesSpec(spec, node) {
  assert.ok(node, 'expected a node, found null');
  assert.equal(node.kind, spec.kind, `kind: wanted ${spec.kind}, got ${node.kind}`);
  for (const k of ['op', 'name', 'value', 'isInt']) {
    if (k in spec) assert.equal(node[k], spec[k], `${spec.kind}.${k}`);
  }
  if ('left' in spec) matchesSpec(spec.left, node.left);
  if ('right' in spec) matchesSpec(spec.right, node.right);
}

function bin(node, op, left, right) {
  assert.equal(node.kind, 'BinOp');
  assert.equal(node.op, op);
  matchesSpec(left, node.left);
  matchesSpec(right, node.right);
}

const id = (n) => ({ kind: 'Ident', name: n });
const num = (v) => ({ kind: 'NumLit', value: v });

test('multiplication nests under addition', () => {
  const e = exprOf('1 + 2 * 3');
  bin(e, '+', num(1), { kind: 'BinOp', op: '*', left: num(2), right: num(3) });
});

test('addition never steals from multiplication', () => {
  const e = exprOf('1 * 2 + 3');
  bin(e, '+', { kind: 'BinOp', op: '*', left: num(1), right: num(2) }, num(3));
});

test('parentheses override precedence', () => {
  const e = exprOf('(1 + 2) * 3');
  bin(e, '*', { kind: 'BinOp', op: '+' }, num(3));
});

test('subtraction is left-associative: a - b - c', () => {
  const e = exprOf('a - b - c');
  bin(e, '-', { kind: 'BinOp', op: '-', left: id('a'), right: id('b') }, id('c'));
});

test('division chain is left-associative', () => {
  const e = exprOf('a / b / c / d');
  let cur = e;
  for (const last of ['d', 'c']) {
    assert.equal(cur.op, '/');
    assert.equal(cur.right.name, last);
    cur = cur.left;
  }
  bin(cur, '/', id('a'), id('b'));
});

test('modulo binds at multiplication level', () => {
  const e = exprOf('7 % 3 + 1');
  bin(e, '+', { kind: 'BinOp', op: '%', left: num(7), right: num(3) }, num(1));
  const f = exprOf('2 * 3 % 4');
  bin(f, '%', { kind: 'BinOp', op: '*', left: num(2), right: num(3) }, num(4));
});

test('equality operators share level 3 and chain left-assoc', () => {
  const e = exprOf('a == b != c');
  bin(e, '!=', { kind: 'BinOp', op: '==', left: id('a'), right: id('b') }, id('c'));
  const f = exprOf('a != b == c == d');
  assert.equal(f.kind, 'BinOp');
  assert.equal(f.op, '==');
  assert.equal(f.right.name, 'd');
  assert.equal(f.left.op, '==');
  assert.equal(f.left.left.op, '!=');
});

test('comparisons are level 4, below equality', () => {
  const e = exprOf('a < b == c');
  bin(e, '==', { kind: 'BinOp', op: '<', left: id('a'), right: id('b') }, id('c'));
});

test('chained comparisons stay legal and left-assoc: a < b < c', () => {
  const e = exprOf('a < b < c <= d >= e > f');
  let cur = e;
  for (const [op, name] of [['>', 'f'], ['>=', 'e'], ['<=', 'd'], ['<', 'c'], ['<', 'b']]) {
    assert.equal(cur.kind, 'BinOp');
    assert.equal(cur.op, op);
    assert.equal(cur.right.name, name);
    cur = cur.left;
  }
  assert.equal(cur.name, 'a');
});

test('range sits between comparisons and addition: 1..n + 1', () => {
  const e = exprOf('1..n + 1');
  assert.equal(e.kind, 'RangeLit');
  assert.equal(e.low.value, 1);
  bin(e.high, '+', id('n'), num(1));
});

test('range binds tighter than comparisons: 1..n == r', () => {
  const e = exprOf('r == 1..n');
  bin(e, '==', id('r'), { kind: 'RangeLit' });
});

test('comparisons see a whole range on the left', () => {
  const e = exprOf('a < 1..5');
  bin(e, '<', id('a'), { kind: 'RangeLit' });
});

test('range is left-associative: 1..2..3', () => {
  const e = exprOf('1..2..3');
  assert.equal(e.kind, 'RangeLit');
  assert.deepEqual([e.low.low.value, e.low.high.value, e.high.value], [1, 2, 3]);
});

test('and binds tighter than or', () => {
  const e = exprOf('a or b and c');
  bin(e, 'or', id('a'), { kind: 'BinOp', op: 'and', left: id('b'), right: id('c') });
  const f = exprOf('a and b or c');
  bin(f, 'or', { kind: 'BinOp', op: 'and' }, id('c'));
});

test('or chains left-assoc; and chains left-assoc', () => {
  const e = exprOf('a or b or c');
  bin(e, 'or', { kind: 'BinOp', op: 'or' }, id('c'));
  const f = exprOf('a and b and c');
  bin(f, 'and', { kind: 'BinOp', op: 'and' }, id('c'));
});

test('not groups before and: not a and b is (not a) and b', () => {
  const e = exprOf('not a and b');
  assert.equal(e.kind, 'BinOp');
  assert.equal(e.op, 'and');
  assert.equal(e.left.kind, 'UnOp');
  assert.equal(e.left.op, 'not');
  assert.equal(e.left.operand.name, 'a');
  assert.equal(e.right.name, 'b');
});

test('not groups before or too', () => {
  const e = exprOf('not a or b');
  assert.equal(e.op, 'or');
  assert.equal(e.left.kind, 'UnOp');
});

test('double negation nests: not not a', () => {
  const e = exprOf('not not a');
  assert.equal(e.kind, 'UnOp');
  assert.equal(e.operand.kind, 'UnOp');
  assert.equal(e.operand.operand.name, 'a');
});

test('unary minus outranks multiplication but loses to postfix', () => {
  const e = exprOf('-x * y');
  bin(e, '*', { kind: 'UnOp', op: '-', operand: id('x') }, id('y'));
  const f = exprOf('-f(x)');
  assert.equal(f.kind, 'UnOp');
  assert.equal(f.operand.kind, 'Call');
  const g = exprOf('-xs[i][0]');
  assert.equal(g.kind, 'UnOp');
  assert.equal(g.operand.kind, 'Index');
  assert.equal(g.operand.obj.kind, 'Index');
  const h = exprOf('- -x');
  assert.equal(h.kind, 'UnOp');
  assert.equal(h.operand.kind, 'UnOp');
});

test('postfix binds tightest: xs[i + 1](z) calls the indexed element', () => {
  const e = exprOf('xs[i + 1](z)');
  assert.equal(e.kind, 'Call');
  assert.equal(e.callee.kind, 'Index');
  bin(e.callee.index, '+', id('i'), num(1));
  assert.deepEqual(e.args.map((a) => a.name), ['z']);
});

test('call/index/slice chains stack outward', () => {
  const e = exprOf('m[k](a, b)[0]');
  assert.equal(e.kind, 'Index');
  assert.equal(e.obj.kind, 'Call');
  assert.equal(e.obj.callee.kind, 'Index');
  const f = exprOf('xs[1][2][3]');
  assert.equal(f.kind, 'Index');
  assert.equal(f.index.value, 3);
  const g = exprOf('(-x)(z)');
  assert.equal(g.kind, 'Call');
  assert.equal(g.callee.kind, 'UnOp');
  const h = exprOf('f()(g())');
  assert.equal(h.kind, 'Call');
  assert.equal(h.callee.kind, 'Call');
});

test('astDump shows the precedence tree for 1 + 2 * 3', () => {
  assert.equal(astDump(parseOk('1 + 2 * 3')), [
    'Program',
    '  ExprStmt',
    '    BinOp +',
    '      NumLit 1',
    '      BinOp *',
    '        NumLit 2',
    '        NumLit 3'
  ].join('\n'));
});

// --- postfix forms ---

test('call with trailing comma keeps two args', () => {
  const e = exprOf('f(1, 2,)');
  assert.equal(e.kind, 'Call');
  assert.equal(e.args.length, 2);
});

test('empty and nested call args', () => {
  assert.equal(exprOf('f()').args.length, 0);
  const e = exprOf('f(g(), 1 + 2)');
  assert.equal(e.args.length, 2);
  assert.equal(e.args[0].kind, 'Call');
});

test('slice variants: both sides, low only, high only, neither', () => {
  const both = exprOf('xs[a:b]');
  assert.equal(both.kind, 'Slice');
  assert.equal(both.low.name, 'a');
  assert.equal(both.high.name, 'b');
  const lowOnly = exprOf('xs[a:]');
  assert.equal(lowOnly.low.name, 'a');
  assert.equal(lowOnly.high, null);
  const highOnly = exprOf('xs[:b]');
  assert.equal(highOnly.low, null);
  assert.equal(highOnly.high.name, 'b');
  const none = exprOf('xs[:]');
  assert.equal(none.low, null);
  assert.equal(none.high, null);
});

test('slice result indexes again', () => {
  const e = exprOf('xs[1:3][0]');
  assert.equal(e.kind, 'Index');
  assert.equal(e.obj.kind, 'Slice');
  assert.deepEqual([e.obj.low.value, e.obj.high.value], [1, 3]);
});

test('range expression is allowed inside brackets', () => {
  const e = exprOf('xs[1..3]');
  assert.equal(e.index.kind, 'RangeLit');
});

// --- literals and spans ---

test('literal nodes carry cooked values', () => {
  const one = exprOf('42');
  assert.deepEqual({ kind: one.kind, value: one.value, isInt: one.isInt }, { kind: 'NumLit', value: 42, isInt: true });
  const half = exprOf('3.14');
  assert.deepEqual({ value: half.value, isInt: half.isInt }, { value: 3.14, isInt: false });
  assert.equal(exprOf('true').kind, 'BoolLit');
  assert.equal(exprOf('true').value, true);
  assert.equal(exprOf('false').kind, 'BoolLit');
  assert.equal(exprOf('false').value, false);
  assert.equal(exprOf('null').kind, 'NullLit');
  assert.equal(exprOf('"a\\tb\\n"').value, 'a\tb\n');
  const x = exprOf('x');
  assert.equal(x.tok.type, 'IDENT');
});

test('nodes span their first through last token', () => {
  const s = first('let x = 1');
  assert.deepEqual({ line: s.line, col: s.col, endCol: s.endCol }, { line: 1, col: 1, endCol: 10 });
  const e = exprOf('12 + 345');
  assert.deepEqual({ line: e.line, col: e.col, endCol: e.endCol }, { line: 1, col: 1, endCol: 9 });
  assert.equal(e.left.endCol, 3);
});

test('line numbers follow multi-line sources', () => {
  const p = parseOk('let a = 1\nlet bb = 2\nbb');
  assert.equal(p.body.length, 3);
  assert.equal(p.body[1].name, 'bb');
  assert.equal(p.body[1].line, 2);
  assert.equal(p.body[2].expr.line, 3);
  assert.equal(p.line, 1);
});

// --- statements ---

test('statements self-delimit: two lets on one line', () => {
  const p = parseOk('let x = 1 let y = 2');
  assert.equal(p.body.length, 2);
  assert.deepEqual([p.body[0].name, p.body[1].name], ['x', 'y']);
});

test('expression statements split without terminators', () => {
  const p = parseOk('1 2 3');
  assert.equal(p.body.length, 3);
  const calls = parseOk('f(x) g(y)');
  assert.equal(calls.body.length, 2);
  assert.equal(calls.body[1].expr.kind, 'Call');
  const nots = parseOk('not x not y');
  assert.equal(nots.body.length, 2);
});

test('let requires a name and an initializer', () => {
  const e = expectCode('let = 3', 'E0201');
  assert.equal(e.message, 'expected a name after `let`, found `=`');
  expectCode('let x', 'E0202');
  expectCode('let if = 1', 'E0201');
});

test('assignment targets Ident or Index; compound ops keep their spelling', () => {
  const simple = first('x = 1');
  assert.equal(simple.kind, 'AssignStmt');
  assert.equal(simple.op, '=');
  assert.equal(simple.target.name, 'x');
  const indexed = first('xs[i + 1] = y');
  assert.equal(indexed.target.kind, 'Index');
  for (const [srcOp] of [['+='], ['-=' ], ['*='], ['/='], ['%=']]) {
    const s = first(`x ${srcOp} 1`);
    assert.equal(s.kind, 'AssignStmt');
    assert.equal(s.op, srcOp);
    assert.equal(s.target.name, 'x');
  }
});

test('invalid assignment targets raise E0204 at the expression start', () => {
  const call = expectCode('f() = 1', 'E0204');
  assert.deepEqual({ line: call.line, col: call.col, endCol: call.endCol }, { line: 1, col: 1, endCol: 4 });
  assert.ok(call.help && call.help.includes('variable'), 'help should suggest an alternative');
  expectCode('(a + b) = 2', 'E0204');
  expectCode('1 = 2', 'E0204');
});

test('if/elif/else shape', () => {
  const src = [
    'if a {',
    '  let x = 1',
    '} elif b > 2 {',
    '  let y = 2',
    '} elif c {',
    '} else {',
    '  let z = 3',
    '}'
  ].join('\n');
  const s = first(src);
  assert.equal(s.kind, 'IfStmt');
  assert.equal(s.branches.length, 3);
  assert.equal(s.branches[0].cond.name, 'a');
  assert.equal(s.branches[1].cond.op, '>');
  assert.equal(s.branches[2].cond.name, 'c');
  assert.equal(s.branches.every((b) => b.body.kind === 'Block'), true);
  assert.equal(s.elseBody.kind, 'Block');
  assert.equal(s.elseBody.body.length, 1);
});

test('if without else has null elseBody', () => {
  const s = first('if x { }');
  assert.equal(s.branches.length, 1);
  assert.equal(s.elseBody, null);
  assert.equal(s.body === undefined, true);
});

test('while and for-in shapes', () => {
  const w = first('while n < 10 { n += 1 }');
  assert.equal(w.kind, 'WhileStmt');
  assert.equal(w.cond.op, '<');
  assert.equal(w.body.body[0].op, '+=');
  const f = first('for i in xs { print(i) }');
  assert.equal(f.kind, 'ForStmt');
  assert.equal(f.name, 'i');
  assert.equal(f.iter.name, 'xs');
  expectCode('for i xs { }', 'E0201');
});

test('fn declarations, nesting, and closures', () => {
  const d = first('fn add(a, b) { return a + b }');
  assert.equal(d.kind, 'FnDecl');
  assert.deepEqual(d.params.map((p) => p.name), ['a', 'b']);
  assert.equal(d.body.body[0].value.op, '+');
  const nested = parseOk([
    'fn outer(n) {',
    '  fn inner(x) { return x + n }',
    '  return inner',
    '}'
  ].join('\n'));
  assert.equal(nested.body[0].body.body.length, 2);
  const closure = first('let make = fn(n) { return fn(x) { return x + n } }');
  assert.equal(closure.kind, 'LetStmt');
  assert.equal(closure.value.kind, 'FnExpr');
  const inner = closure.value.body.body[0].value;
  assert.equal(inner.kind, 'FnExpr');
  assert.equal(inner.params[0].name, 'x');
});

test('return is optional-valued; break and continue exist', () => {
  assert.equal(first('return').value, null);
  assert.equal(first('return 1 + 2').value.op, '+');
  assert.equal(first('return').endCol, 7);
  assert.equal(first('break').kind, 'BreakStmt');
  assert.equal(first('continue').kind, 'ContinueStmt');
  assert.equal(first('return fn(x) { x }').value.kind, 'FnExpr');
});

test('bare blocks are statements', () => {
  const s = first('{ let x = 1 x }');
  assert.equal(s.kind, 'Block');
  assert.equal(s.body.length, 2);
  const nested = first('{ { 1 } { 2 } }');
  assert.equal(nested.body.length, 2);
});

test('empty programs and comment-only programs', () => {
  const empty = parseOk('');
  assert.equal(empty.kind, 'Program');
  assert.deepEqual(empty.body, []);
  assert.deepEqual({ line: empty.line, col: empty.col }, { line: 1, col: 1 });
  const comments = parseOk('# nothing here\n\n# more notes');
  assert.deepEqual(comments.body, []);
  assert.deepEqual({ line: comments.line, col: comments.col }, { line: 3, col: 13 });
});

// --- error cases ---

test('unclosed constructs report E0202 with eof=true', () => {
  expectEOFError('{ 1');
  expectEOFError('(1 + 2');
  expectEOFError('if x { 1');
  expectEOFError('fn f(a');
  expectEOFError('f(');
  expectEOFError('f(1,');
  expectEOFError('xs[');
  expectEOFError('xs[1:');
  expectEOFError('"abc" +');
  expectEOFError('1 +');
  expectEOFError('let x = ');
});

test('E0201 messages name what was expected and found', () => {
  const e = expectCode('let x = 1 let = 2', 'E0201');
  assert.equal(e.message, 'expected a name after `let`, found `=`');
  assert.equal(e.line, 1);
  assert.equal(e.col, 15);
  assert.equal(e.endCol, 16);
  expectCode('xs[1:2:3]', 'E0201');
  expectCode('f(a b)', 'E0201');
});

test('stray closers are E0203 unexpected tokens', () => {
  const e = expectCode('}', 'E0203');
  assert.match(e.message, /^unexpected `}`/);
  expectCode(')', 'E0203');
  expectCode(',', 'E0203');
  expectCode('else { }', 'E0203');
  expectCode('let x = ', 'E0202');
  expectCode('x[', 'E0202');
});

test('duplicate parameter names raise E0205', () => {
  const e = expectCode('fn f(a, b, a) { }', 'E0205');
  assert.match(e.message, /duplicate parameter name `a`/);
  assert.equal(e.col, 12);
  expectCode('fn f(x, x) { }', 'E0205');
  expectCode('let g = fn(p, p) { }', 'E0205');
  assert.equal(parseOk('fn f(a, b) { }').body[0].params.length, 2);
});

test('deep nesting raises E0206 instead of crashing', () => {
  const deep = '('.repeat(600) + '1' + ')'.repeat(600);
  const e = expectCode(deep, 'E0206');
  assert.match(e.message, /nested/);
});

test('nesting just under the limit still parses', () => {
  const ok = '('.repeat(400) + '1' + ')'.repeat(400);
  const p = parseOk(ok);
  assert.equal(p.kind, 'Program');
});

// --- tokenizer provenance sanity ---

test('fallback and real lexer (if present) agree on token shapes used here', () => {
  const ts = toks('let x = "hi" # note');
  assert.deepEqual(
    ts.slice(0, 4).map((t) => [t.type, t.value]),
    [['KEYWORD', 'let'], ['IDENT', 'x'], ['ASSIGN', '='], ['STRING', 'hi']]
  );
});
