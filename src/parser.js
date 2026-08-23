// Recursive-descent parser: token array -> Program AST.
// Precedence climbing for expressions; statements self-delimit by grammar
// (tokens carry no newline information). Diagnostics via src/errors.js.

import { T, EOF_TOKEN, describeToken } from './tokens.js';
import {
  Program, LetStmt, AssignStmt, ExprStmt, IfStmt, WhileStmt, ForStmt,
  FnDecl, ReturnStmt, BreakStmt, ContinueStmt, Block,
  BinOp, UnOp, Call, Index, Slice, RangeLit, ArrLit, MapLit,
  Ident, NumLit, StrLit, BoolLit, NullLit, FnExpr
} from './ast.js';
import { CODES, syntaxError, unexpectedEOF } from './errors.js';

const MAX_DEPTH = 500;

// Binary operator precedence, low binds loosest. `and`/`or` are keywords
// and get their levels in binPrec(); everything else is keyed by type.
const BIN_PREC = {
  [T.EQ]: 3, [T.NEQ]: 3,
  [T.LT]: 4, [T.LE]: 4, [T.GT]: 4, [T.GE]: 4,
  [T.DOTDOT]: 5,
  [T.PLUS]: 6, [T.MINUS]: 6,
  [T.STAR]: 7, [T.SLASH]: 7, [T.PERCENT]: 7
};

const OP_SPELLING = {
  [T.EQ]: '==', [T.NEQ]: '!=', [T.LT]: '<', [T.LE]: '<=',
  [T.GT]: '>', [T.GE]: '>=',
  [T.PLUS]: '+', [T.MINUS]: '-', [T.STAR]: '*', [T.SLASH]: '/', [T.PERCENT]: '%'
};

const ASSIGN_OPS = {
  [T.ASSIGN]: '=', [T.PLUSEQ]: '+=', [T.MINUSEQ]: '-=',
  [T.STAREQ]: '*=', [T.SLASHEQ]: '/=', [T.PERCENTEQ]: '%='
};

// Span from startTok's first column through end's exclusive endCol.
// Tokens ({line, col, endCol}) and AST nodes carry the same fields.
const spanOf = (startTok, end) => ({ line: startTok.line, col: startTok.col, endCol: end.endCol });

// Can this token begin an expression? Decides whether constructs with an
// optional tail (`return`) have one on the same statement.
function startsExpression(tok) {
  switch (tok.type) {
    case T.INT: case T.FLOAT: case T.STRING:
    case T.IDENT: case T.LPAREN: case T.MINUS:
    case T.LBRACKET:
      return true;
    case T.KEYWORD:
      return tok.value === 'true' || tok.value === 'false' || tok.value === 'null'
        || tok.value === 'not' || tok.value === 'fn';
    default:
      return false;
  }
}

class Parser {
  constructor(tokens, filePath) {
    this.filePath = filePath ?? null;
    this.toks = Array.isArray(tokens) ? [...tokens] : [];
    if (this.toks.length === 0 || this.toks[this.toks.length - 1].type !== T.EOF) {
      const last = this.toks[this.toks.length - 1];
      const line = last ? last.line : 1;
      const col = last ? (last.endCol ?? last.col) : 1;
      this.toks.push(EOF_TOKEN(line, col));
    }
    this.i = 0;
    this.depth = 0;      // expression nesting depth, for E0206
    this.blockDepth = 0; // statement/block nesting depth, same limit
  }

  peek(k = 0) {
    return this.toks[Math.min(this.i + k, this.toks.length - 1)];
  }

  get cur() {
    return this.peek();
  }

  next() {
    const t = this.cur;
    if (t.type !== T.EOF) this.i++;
    return t;
  }

  at(type) {
    return this.cur.type === type;
  }

  atKw(word) {
    return this.cur.type === T.KEYWORD && this.cur.value === word;
  }

  eat(type) {
    return this.at(type) ? this.next() : null;
  }

  // E0201 when something concrete was found; E0202 at end of input so the
  // REPL knows the input is merely incomplete.
  failExpected(desc, tok = this.cur) {
    const msg = 'expected ' + desc + ', found ' + describeToken(tok);
    if (tok.type === T.EOF) throw unexpectedEOF(msg, tok, this.filePath);
    throw syntaxError(CODES.EXPECTED_FOUND, msg, tok, this.filePath);
  }

  expect(type, desc) {
    if (!this.at(type)) this.failExpected(desc);
    return this.next();
  }

  parseProgram() {
    const first = this.cur;
    const body = [];
    while (!this.at(T.EOF)) body.push(this.parseStatement());
    const eof = this.cur;
    const span = body.length > 0 ? spanOf(first, body[body.length - 1]) : eof;
    return Program(span, body);
  }

  parseStatement() {
    const t = this.cur;
    if (t.type === T.LBRACE) return this.parseBlock();
    if (t.type === T.KEYWORD) {
      switch (t.value) {
        case 'let': return this.parseLet();
        case 'fn':
          // `fn name(...)` declares; bare `fn(...)` opens a function
          // expression and may start an ordinary expression statement.
          if (this.peek(1).type === T.IDENT) return this.parseFnDecl();
          break;
        case 'if': return this.parseIf();
        case 'while': return this.parseWhile();
        case 'for': return this.parseFor();
        case 'return': return this.parseReturn();
        case 'break': this.next(); return BreakStmt(t);
        case 'continue': this.next(); return ContinueStmt(t);
      }
    }
    return this.parseExprOrAssign();
  }

  parseExprOrAssign() {
    const target = this.parseExpression();
    const op = ASSIGN_OPS[this.cur.type];
    if (op !== undefined) {
      if (target.kind !== 'Ident' && target.kind !== 'Index') this.invalidTarget(target);
      const opTok = this.next();
      const value = this.parseExpression();
      return AssignStmt(spanOf(target, value), { target, op, value });
    }
    return ExprStmt(target, { expr: target });
  }

  invalidTarget(expr) {
    const help = expr.kind === 'Call'
      ? 'a call result cannot be assigned into; assign to a variable or an indexed element instead.'
      : null;
    throw syntaxError(CODES.INVALID_ASSIGN_TARGET, 'invalid assignment target', expr, this.filePath, help);
  }

  parseLet() {
    const kw = this.next();
    if (!this.at(T.IDENT)) this.failExpected('a name after `let`');
    const nameTok = this.next();
    this.expect(T.ASSIGN, '`=`');
    const value = this.parseExpression();
    return LetStmt(spanOf(kw, value), { name: nameTok.value, nameTok, value });
  }

  parseIf() {
    const kw = this.next();
    const branches = [{ cond: this.parseExpression(), body: this.parseBlock('after the `if` condition') }];
    while (this.atKw('elif')) {
      this.next();
      branches.push({ cond: this.parseExpression(), body: this.parseBlock('after the `elif` condition') });
    }
    let elseBody = null;
    if (this.atKw('else')) {
      this.next();
      elseBody = this.parseBlock('after `else`');
    }
    const lastBody = elseBody ?? branches[branches.length - 1].body;
    return IfStmt(spanOf(kw, lastBody), { branches, elseBody });
  }

  parseWhile() {
    const kw = this.next();
    const cond = this.parseExpression();
    const body = this.parseBlock('after the `while` condition');
    return WhileStmt(spanOf(kw, body), { cond, body });
  }

  parseFor() {
    const kw = this.next();
    if (!this.at(T.IDENT)) this.failExpected('a loop variable name after `for`');
    const nameTok = this.next();
    if (!this.atKw('in')) this.failExpected('`in`');
    this.next();
    const iter = this.parseExpression();
    const body = this.parseBlock('after the `for` collection');
    return ForStmt(spanOf(kw, body), { name: nameTok.value, iter, body });
  }

  parseReturn() {
    const kw = this.next();
    const value = startsExpression(this.cur) ? this.parseExpression() : null;
    return ReturnStmt(value ? spanOf(kw, value) : kw, { value });
  }

  // Braces are mandatory and never implied. `hint` phrases where the `{`
  // was expected so E0201 messages stay specific. Block nesting counts
  // against the same limit as expressions so hostile input dies with E0206
  // instead of a host stack overflow.
  parseBlock(hint) {
    if (++this.blockDepth > MAX_DEPTH) {
      throw syntaxError(CODES.NESTING_TOO_DEEP,
        'blocks nested more than ' + MAX_DEPTH + ' levels deep', this.cur, this.filePath,
        'restructure the code so blocks do not nest so deeply.');
    }
    try {
      const open = this.expect(T.LBRACE, hint ? '`{` ' + hint : '`{`');
      const body = [];
      while (!this.at(T.RBRACE)) {
        if (this.at(T.EOF)) this.failExpected('`}`');
        body.push(this.parseStatement());
      }
      const close = this.next();
      return Block(spanOf(open, close), body);
    } finally {
      this.blockDepth--;
    }
  }

  parseParams() {
    this.expect(T.LPAREN, '`(`');
    const params = [];
    const seen = new Set();
    while (!this.at(T.RPAREN)) {
      if (this.at(T.EOF)) this.failExpected('a parameter name');
      if (!this.at(T.IDENT)) {
        this.failExpected(this.at(T.COMMA)
          ? 'a parameter name (a `,` must be followed by another parameter or `)`)'
          : 'a parameter name');
      }
      const p = this.next();
      if (seen.has(p.value)) {
        throw syntaxError(CODES.DUPLICATE_PARAM, 'duplicate parameter name `' + p.value + '`', p,
          this.filePath, 'rename one of the parameters so every name in the list is distinct.');
      }
      seen.add(p.value);
      params.push({ name: p.value, tok: p });
      if (!this.eat(T.COMMA)) break;
    }
    this.expect(T.RPAREN, '`)`');
    return params;
  }

  parseFnDecl() {
    const kw = this.next();
    const nameTok = this.expect(T.IDENT, 'a function name after `fn`');
    const params = this.parseParams();
    const body = this.parseBlock('after the parameter list');
    return FnDecl(spanOf(kw, body), { name: nameTok.value, params, body });
  }

  parseFnExpr() {
    const kw = this.next();
    const params = this.parseParams();
    const body = this.parseBlock('after the parameter list');
    return FnExpr(spanOf(kw, body), { params, body });
  }

  // --- expressions ---
  //
  // Precedence climbing: parseBinary(minPrec) absorbs operators whose
  // binding power reaches minPrec. Right operands recurse at prec+1,
  // which makes every operator left-associative.

  binPrec(tok) {
    if (tok.type === T.KEYWORD) {
      if (tok.value === 'or') return 1;
      if (tok.value === 'and') return 2;
      return 0;
    }
    return BIN_PREC[tok.type] ?? 0;
  }

  parseExpression() {
    if (++this.depth > MAX_DEPTH) {
      throw syntaxError(CODES.NESTING_TOO_DEEP,
        'expression nested more than ' + MAX_DEPTH + ' levels deep', this.cur, this.filePath,
        'simplify the expression or split it across intermediate variables.');
    }
    try {
      return this.parseBinary(1);
    } finally {
      this.depth--;
    }
  }

  parseBinary(minPrec) {
    let left = this.parseUnary();
    for (;;) {
      const prec = this.binPrec(this.cur);
      if (prec === 0 || prec < minPrec) return left;
      const opTok = this.next();
      const right = this.parseBinary(prec + 1);
      left = opTok.type === T.DOTDOT
        ? RangeLit(spanOf(left, right), { low: left, high: right })
        : BinOp(spanOf(left, right), { op: OP_SPELLING[opTok.type] ?? opTok.value, left, right });
    }
  }

  // Unary binds at level 8: tighter than every binary operator, looser
  // than postfix call/index/slice (level 9), so `-f(x)[0]` is `-(f(x)[0])`.
  // Chains of `-`/`not` recurse here, so they count against the nesting
  // limit too.
  parseUnary() {
    const t = this.cur;
    if (t.type === T.MINUS || (t.type === T.KEYWORD && t.value === 'not')) {
      if (++this.depth > MAX_DEPTH) {
        throw syntaxError(CODES.NESTING_TOO_DEEP,
          'expression nested more than ' + MAX_DEPTH + ' levels deep', t, this.filePath,
          'simplify the expression or split it across intermediate variables.');
      }
      try {
        this.next();
        const operand = this.parseUnary();
        return UnOp(spanOf(t, operand), { op: t.type === T.MINUS ? '-' : 'not', operand });
      } finally {
        this.depth--;
      }
    }
    return this.parsePostfix();
  }

  // Postfix loop, level 9. Calls allow a trailing comma; brackets hold an
  // index or a colon-slice (`xs[a:b]`, `xs[:b]`, `xs[a:]`; no step).
  parsePostfix() {
    let e = this.parsePrimary();
    for (;;) {
      if (this.at(T.LPAREN)) {
        this.next();
        const args = [];
        while (!this.at(T.RPAREN)) {
          if (this.at(T.EOF)) this.failExpected('an argument');
          args.push(this.parseExpression());
          if (!this.eat(T.COMMA)) break;
        }
        const close = this.expect(T.RPAREN, '`)`');
        e = Call(spanOf(e, close), { callee: e, args });
      } else if (this.at(T.LBRACKET)) {
        this.next();
        let node;
        if (this.eat(T.COLON)) {
          const high = startsExpression(this.cur) ? this.parseExpression() : null;
          const close = this.expect(T.RBRACKET, '`]`');
          node = Slice(spanOf(e, close), { obj: e, low: null, high });
        } else {
          if (this.at(T.EOF) || this.at(T.RBRACKET)) this.failExpected('an index');
          const low = this.parseExpression();
          if (this.eat(T.COLON)) {
            const high = startsExpression(this.cur) ? this.parseExpression() : null;
            const close = this.expect(T.RBRACKET, '`]`');
            node = Slice(spanOf(e, close), { obj: e, low, high });
          } else {
            const close = this.expect(T.RBRACKET, '`]`');
            node = Index(spanOf(e, close), { obj: e, index: low });
          }
        }
        e = node;
      } else {
        return e;
      }
    }
  }

  // Array literal: `[expr, expr, ...]`, trailing comma allowed, `[]` empty.
  parseArrLit() {
    const open = this.expect(T.LBRACKET, '`[`');
    const items = [];
    while (!this.at(T.RBRACKET)) {
      if (this.at(T.EOF)) this.failExpected('an element or `]`');
      items.push(this.parseExpression());
      if (!this.eat(T.COMMA)) break;
    }
    const close = this.expect(T.RBRACKET, '`,` or `]`');
    return ArrLit(spanOf(open, close), { items });
  }

  // Map literal: `{"key": expr, ...}`, trailing comma allowed. Keys are
  // expressions; the interpreter requires them to evaluate to strings.
  // Note `{` at STATEMENT position is a block — map literals belong in
  // expression positions (`let m = {...}`, arguments, elements).
  parseMapLit() {
    const open = this.expect(T.LBRACE, '`{`');
    const entries = [];
    while (!this.at(T.RBRACE)) {
      if (this.at(T.EOF)) this.failExpected('a key or `}`');
      const key = this.parseExpression();
      this.expect(T.COLON, '`:` after the map key');
      const value = this.parseExpression();
      entries.push({ key, value });
      if (!this.eat(T.COMMA)) break;
    }
    const close = this.expect(T.RBRACE, '`,` or `}`');
    return MapLit(spanOf(open, close), { entries });
  }

  parsePrimary() {
    const t = this.cur;
    switch (t.type) {
      case T.INT:
        this.next();
        return NumLit(t, { value: t.value, isInt: true });
      case T.FLOAT:
        this.next();
        return NumLit(t, { value: t.value, isInt: false });
      case T.STRING:
        this.next();
        return StrLit(t, { value: t.value });
      case T.IDENT:
        this.next();
        return Ident(t, { name: t.value, tok: t });
      case T.LPAREN: {
        this.next();
        const e = this.parseExpression();
        this.expect(T.RPAREN, '`)`');
        return e;
      }
      case T.LBRACKET:
        return this.parseArrLit();
      case T.LBRACE:
        return this.parseMapLit();
      case T.KEYWORD:
        switch (t.value) {
          case 'true': this.next(); return BoolLit(t, { value: true });
          case 'false': this.next(); return BoolLit(t, { value: false });
          case 'null': this.next(); return NullLit(t);
          case 'fn': return this.parseFnExpr();
        }
        break;
    }
    if (t.type === T.EOF) {
      throw unexpectedEOF('expected an expression, found end of input', t, this.filePath);
    }
    throw syntaxError(CODES.UNEXPECTED_TOKEN,
      'unexpected ' + describeToken(t) + ', expected an expression', t, this.filePath);
  }
}

export function parse(tokens, filePath) {
  return new Parser(tokens, filePath).parseProgram();
}
