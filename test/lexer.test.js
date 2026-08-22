import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tokenize } from '../src/lexer.js';
import { T, EOF_TOKEN } from '../src/tokens.js';
import { CODES, EmberError } from '../src/errors.js';

const PROG_LINES = [
  'let limit = 1_000',
  'fn scale(v) { return v * 2.5 }',
  'if limit >= 999 and not quiet {',
  '  total += scale(3)',
  '} elif total == 0.0 {',
  '  while true { break }',
  '} else { continue }',
  'for name in names[..2] { print(name) }'
];

function pairs(src) {
  return tokenize(src).map((t) => [t.type, t.value]);
}

function assertTokens(src, expected) {
  assert.deepStrictEqual(pairs(src), expected);
}

function lastTok(src) {
  const toks = tokenize(src);
  const eof = toks[toks.length - 1];
  assert.equal(eof.type, T.EOF);
  return eof;
}

function assertLexError(src, want, filePath = 'test.em') {
  let err = null;
  try {
    tokenize(src, filePath);
  } catch (e) {
    err = e;
  }
  assert.ok(err instanceof EmberError, 'expected an EmberError, got ' + String(err));
  assert.equal(err.kind, 'syntax');
  assert.equal(err.code, want.code);
  assert.equal(err.line, want.line);
  assert.equal(err.col, want.col);
  assert.equal(err.endCol, want.endCol);
  return err;
}

test('representative program tokenizes to the expected stream', () => {
  const src = PROG_LINES.join('\n');
  assert.deepStrictEqual(pairs(src), [
    [T.KEYWORD, 'let'], [T.IDENT, 'limit'], [T.ASSIGN, '='], [T.INT, 1000],
    [T.KEYWORD, 'fn'], [T.IDENT, 'scale'], [T.LPAREN, '('], [T.IDENT, 'v'], [T.RPAREN, ')'],
    [T.LBRACE, '{'], [T.KEYWORD, 'return'], [T.IDENT, 'v'], [T.STAR, '*'], [T.FLOAT, 2.5], [T.RBRACE, '}'],
    [T.KEYWORD, 'if'], [T.IDENT, 'limit'], [T.GE, '>='], [T.INT, 999],
    [T.KEYWORD, 'and'], [T.KEYWORD, 'not'], [T.IDENT, 'quiet'], [T.LBRACE, '{'],
    [T.IDENT, 'total'], [T.PLUSEQ, '+='], [T.IDENT, 'scale'], [T.LPAREN, '('], [T.INT, 3], [T.RPAREN, ')'],
    [T.RBRACE, '}'], [T.KEYWORD, 'elif'], [T.IDENT, 'total'], [T.EQ, '=='], [T.FLOAT, 0], [T.LBRACE, '{'],
    [T.KEYWORD, 'while'], [T.KEYWORD, 'true'], [T.LBRACE, '{'], [T.KEYWORD, 'break'], [T.RBRACE, '}'],
    [T.RBRACE, '}'], [T.KEYWORD, 'else'], [T.LBRACE, '{'], [T.KEYWORD, 'continue'], [T.RBRACE, '}'],
    [T.KEYWORD, 'for'], [T.IDENT, 'name'], [T.KEYWORD, 'in'], [T.IDENT, 'names'],
    [T.LBRACKET, '['], [T.DOTDOT, '..'], [T.INT, 2], [T.RBRACKET, ']'],
    [T.LBRACE, '{'], [T.IDENT, 'print'], [T.LPAREN, '('], [T.IDENT, 'name'], [T.RPAREN, ')'], [T.RBRACE, '}'],
    [T.EOF, null]
  ]);
});

test('tokens carry exact lines and code-point columns across lines', () => {
  const toks = tokenize(PROG_LINES.join('\n'));
  const at = (pred) => {
    const tok = toks.find(pred);
    assert.ok(tok);
    return [tok.line, tok.col, tok.endCol];
  };
  assert.deepStrictEqual(at((t) => t.type === T.STAR), [2, 24, 25]);
  assert.deepStrictEqual(at((t) => t.type === T.GE), [3, 10, 12]);
  assert.deepStrictEqual(at((t) => t.type === T.PLUSEQ), [4, 9, 11]);
  assert.deepStrictEqual(at((t) => t.type === T.EQ), [5, 14, 16]);
  assert.deepStrictEqual(at((t) => t.type === T.DOTDOT), [8, 19, 21]);
});

test('every token stream ends with an EOF token at the right position', () => {
  assert.deepStrictEqual(tokenize(''), [EOF_TOKEN(1, 1)]);
  assert.deepStrictEqual(lastTok('let x = 1'), EOF_TOKEN(1, 10));
  assert.deepStrictEqual(lastTok('let x = 1\n'), EOF_TOKEN(2, 1));
  assert.deepStrictEqual(lastTok('# only a comment'), EOF_TOKEN(1, 17));
});

test('range edge 1..2 lexes INT DOTDOT INT with exact spans', () => {
  const toks = tokenize('1..2');
  assert.deepStrictEqual(toks.map((t) => [t.type, t.value]),
    [[T.INT, 1], [T.DOTDOT, '..'], [T.INT, 2], [T.EOF, null]]);
  assert.deepStrictEqual(toks.slice(0, -1).map((t) => [t.line, t.col, t.endCol]),
    [[1, 1, 2], [1, 2, 4], [1, 4, 5]]);
});

test('x.5 lexes IDENT DOT INT because numbers need a leading digit', () => {
  const toks = tokenize('x.5');
  assert.deepStrictEqual(toks.map((t) => [t.type, t.value]),
    [[T.IDENT, 'x'], [T.DOT, '.'], [T.INT, 5], [T.EOF, null]]);
  assert.deepStrictEqual(toks.slice(0, -1).map((t) => [t.col, t.endCol]),
    [[1, 2], [2, 3], [3, 4]]);
});

test('chained dots after identifiers each become their own DOT token', () => {
  assertTokens('a.b.c', [
    [T.IDENT, 'a'], [T.DOT, '.'], [T.IDENT, 'b'], [T.DOT, '.'],
    [T.IDENT, 'c'], [T.EOF, null]
  ]);
});

test('floats, exponents, and underscore grouping carry cooked numeric values', () => {
  const src = '3.25 1e-3 2e3 1_000 0.5 42 1E2';
  const toks = tokenize(src);
  assert.deepStrictEqual(toks.slice(0, -1).map((t) => [t.type, t.value]), [
    [T.FLOAT, 3.25], [T.FLOAT, 0.001], [T.FLOAT, 2000],
    [T.INT, 1000], [T.FLOAT, 0.5], [T.INT, 42], [T.FLOAT, 100]
  ]);
  assert.deepStrictEqual(toks.slice(0, -1).map((t) => [t.col, t.endCol]), [
    [1, 5], [6, 10], [11, 14], [15, 20], [21, 24], [25, 27], [28, 31]
  ]);
});

test('misplaced underscore in a number is E0103 spanning through it', () => {
  const err = assertLexError('1__0',
    { code: CODES.MALFORMED_NUMBER, line: 1, col: 1, endCol: 3 });
  assert.ok(err.message.includes('between digits'));
  assert.ok(err.help.includes('`1_000`'));
});

test('trailing underscore is E0103', () => {
  assertLexError('12_', { code: CODES.MALFORMED_NUMBER, line: 1, col: 1, endCol: 4 });
});

test('a leading underscore starts an identifier, not a number error', () => {
  assertTokens('_9 lives', [
    [T.IDENT, '_9'], [T.IDENT, 'lives'], [T.EOF, null]
  ]);
});

test('trailing dot without a digit is E0103 and help names the range operator', () => {
  const err = assertLexError('let x = 1.',
    { code: CODES.MALFORMED_NUMBER, line: 1, col: 9, endCol: 11 });
  assert.ok(err.help.includes('..'));
});

test('trailing dot before punctuation is E0103 pointing at the dot', () => {
  assertLexError('f(1.)',
    { code: CODES.MALFORMED_NUMBER, line: 1, col: 3, endCol: 5 });
});

test('exponent without digits is E0103 covering the whole literal', () => {
  assertLexError('1e', { code: CODES.MALFORMED_NUMBER, line: 1, col: 1, endCol: 3 });
  assertLexError('7.5e+', { code: CODES.MALFORMED_NUMBER, line: 1, col: 1, endCol: 6 });
});

test('double-quoted string cooks nested escapes to the right value', () => {
  // Ember source: "a\"b\\c"
  const toks = tokenize('"a\\"b\\\\c"');
  assert.equal(toks.length, 2);
  assert.equal(toks[0].type, T.STRING);
  assert.equal(toks[0].value, 'a"b\\c');
  assert.deepStrictEqual([toks[0].line, toks[0].col, toks[0].endCol], [1, 1, 10]);
});

test('single-quoted strings support the same escapes', () => {
  // Ember source: 'a\tb' then 'it\'s'
  assertTokens("'a\\tb'", [[T.STRING, 'a\tb'], [T.EOF, null]]);
  assertTokens("'it\\'s'", [[T.STRING, "it's"], [T.EOF, null]]);
});

test('null and carriage-return escapes cook correctly under both quotes', () => {
  assert.equal(tokenize('"\\0"')[0].value, '\0');
  assert.equal(tokenize('"x\\ry"')[0].value, 'x\ry');
  assertTokens("''", [[T.STRING, ''], [T.EOF, null]]);
});

test('unknown escape raises E0104 spanning backslash plus escaped char', () => {
  // Ember source: "a\qb"
  const err = assertLexError('"a\\qb"',
    { code: CODES.INVALID_ESCAPE, line: 1, col: 3, endCol: 5 });
  assert.ok(err.message.includes('\\q'));
  assert.ok(err.help.includes('\\n'));
});

test('unknown escape inside single quotes behaves identically', () => {
  assertLexError("'\\q'", { code: CODES.INVALID_ESCAPE, line: 1, col: 2, endCol: 4 });
});

test('newline inside a string raises E0102 starting at the opening quote', () => {
  const src = 'let s = "abc\n+ 1';
  const err = assertLexError(src,
    { code: CODES.UNTERMINATED_STRING, line: 1, col: 9, endCol: 13 });
  assert.ok(err.message.includes('unterminated'));
  assert.ok(err.help.length > 0);
});

test('EOF inside a string raises E0102 ending one past the last char', () => {
  assertLexError('"abc', { code: CODES.UNTERMINATED_STRING, line: 1, col: 1, endCol: 5 });
});

test('dangling backslash at EOF reports the unterminated string', () => {
  assertLexError('"ab\\', { code: CODES.UNTERMINATED_STRING, line: 1, col: 1, endCol: 5 });
});

test('unicode letter identifiers are supported with code-point columns', () => {
  const toks = tokenize('let 名字 = 5');
  assert.deepStrictEqual(toks.map((t) => [t.type, t.value]), [
    [T.KEYWORD, 'let'], [T.IDENT, '名字'], [T.ASSIGN, '='], [T.INT, 5], [T.EOF, null]
  ]);
  assert.deepStrictEqual([toks[1].col, toks[1].endCol], [5, 7]);
});

test('accented latin letters work in identifiers', () => {
  assertTokens('café', [[T.IDENT, 'café'], [T.EOF, null]]);
});

test('emoji as identifier start is E0101 and never echoed into output', () => {
  // Ember source: let 🎉 = 1
  const src = 'let \u{1F389} = 1';
  const err = assertLexError(src,
    { code: CODES.INVALID_CHARACTER, line: 1, col: 5, endCol: 6 });
  assert.ok(!err.message.includes('\u{1F389}'));
  assert.ok(err.message.includes('U+1F389'));
});

test('emoji mid-identifier is E0101 at the correct code-point column', () => {
  assertLexError('ab\u{1F389}cd',
    { code: CODES.INVALID_CHARACTER, line: 1, col: 3, endCol: 4 });
});

test('comments run from # to end of line and are skipped entirely', () => {
  const src = 'let a = 1 # trailing note\n# whole line\nlet b = 2';
  assertTokens(src, [
    [T.KEYWORD, 'let'], [T.IDENT, 'a'], [T.ASSIGN, '='], [T.INT, 1],
    [T.KEYWORD, 'let'], [T.IDENT, 'b'], [T.ASSIGN, '='], [T.INT, 2], [T.EOF, null]
  ]);
});

test('a hash inside a string is string content, not a comment', () => {
  assertTokens('"a#b"', [[T.STRING, 'a#b'], [T.EOF, null]]);
});

test('comparison operators lex with longest match', () => {
  assertTokens('a == b != c <= d >= e < f > g', [
    [T.IDENT, 'a'], [T.EQ, '=='], [T.IDENT, 'b'], [T.NEQ, '!='], [T.IDENT, 'c'],
    [T.LE, '<='], [T.IDENT, 'd'], [T.GE, '>='], [T.IDENT, 'e'],
    [T.LT, '<'], [T.IDENT, 'f'], [T.GT, '>'], [T.IDENT, 'g'], [T.EOF, null]
  ]);
});

test('compound assignment operators lex with longest match', () => {
  assertTokens('a += 1 b -= 2 c *= 3 d /= 4 e %= 6', [
    [T.IDENT, 'a'], [T.PLUSEQ, '+='], [T.INT, 1],
    [T.IDENT, 'b'], [T.MINUSEQ, '-='], [T.INT, 2],
    [T.IDENT, 'c'], [T.STAREQ, '*='], [T.INT, 3],
    [T.IDENT, 'd'], [T.SLASHEQ, '/='], [T.INT, 4],
    [T.IDENT, 'e'], [T.PERCENTEQ, '%='], [T.INT, 6], [T.EOF, null]
  ]);
});

test('punctuation lexes to distinct single-character tokens', () => {
  assertTokens('( ) [ ] { } , : .', [
    [T.LPAREN, '('], [T.RPAREN, ')'], [T.LBRACKET, '['], [T.RBRACKET, ']'],
    [T.LBRACE, '{'], [T.RBRACE, '}'], [T.COMMA, ','], [T.COLON, ':'],
    [T.DOT, '.'], [T.EOF, null]
  ]);
});

test('bare = stays ASSIGN while == wins when adjacent', () => {
  assertTokens('x = 1', [[T.IDENT, 'x'], [T.ASSIGN, '='], [T.INT, 1], [T.EOF, null]]);
  assertTokens('x==1', [[T.IDENT, 'x'], [T.EQ, '=='], [T.INT, 1], [T.EOF, null]]);
});

test('bare ! is E0101 with help naming !=; ampersand suggests and/or', () => {
  const bang = assertLexError('a ! b',
    { code: CODES.INVALID_CHARACTER, line: 1, col: 3, endCol: 4 });
  assert.ok(bang.help.includes('!='));
  const amp = assertLexError('a & b',
    { code: CODES.INVALID_CHARACTER, line: 1, col: 3, endCol: 4 });
  assert.ok(amp.help.includes('`and`'));
});

test('every keyword becomes KEYWORD; near-misses stay identifiers', () => {
  assertTokens('let fn if elif else while for in return break continue true false null and or not', [
    [T.KEYWORD, 'let'], [T.KEYWORD, 'fn'], [T.KEYWORD, 'if'], [T.KEYWORD, 'elif'],
    [T.KEYWORD, 'else'], [T.KEYWORD, 'while'], [T.KEYWORD, 'for'], [T.KEYWORD, 'in'],
    [T.KEYWORD, 'return'], [T.KEYWORD, 'break'], [T.KEYWORD, 'continue'],
    [T.KEYWORD, 'true'], [T.KEYWORD, 'false'], [T.KEYWORD, 'null'],
    [T.KEYWORD, 'and'], [T.KEYWORD, 'or'], [T.KEYWORD, 'not'], [T.EOF, null]
  ]);
  assertTokens('letx iff _if', [
    [T.IDENT, 'letx'], [T.IDENT, 'iff'], [T.IDENT, '_if'], [T.EOF, null]
  ]);
});

test('CRLF line endings produce identical tokens and unshifted columns', () => {
  const lf = PROG_LINES.join('\n');
  const crlf = PROG_LINES.join('\r\n');
  assert.deepStrictEqual(pairs(crlf), pairs(lf));
  const eof = lastTok(crlf);
  assert.equal(eof.line, 8);
  assert.equal(eof.col, PROG_LINES[7].length + 1);
});

test('unterminated-string span stops before the CR of a CRLF pair', () => {
  assertLexError('"abc\r\nlet x = 1',
    { code: CODES.UNTERMINATED_STRING, line: 1, col: 1, endCol: 5 });
});

test('tabs count as exactly one code-point column', () => {
  const toks = tokenize('\tx');
  assert.deepStrictEqual([toks[0].line, toks[0].col, toks[0].endCol], [1, 2, 3]);
  assert.deepStrictEqual(lastTok('\tx'), EOF_TOKEN(1, 3));
});

test('errors carry kind syntax and the supplied filePath', () => {
  try {
    tokenize('@', 'examples/bad.em');
    assert.fail('expected tokenize to throw');
  } catch (e) {
    assert.ok(e instanceof EmberError);
    assert.equal(e.kind, 'syntax');
    assert.equal(e.filePath, 'examples/bad.em');
  }
});
