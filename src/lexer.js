// Hand-written tokenizer for Ember. Turns source text into a flat array of
// tokens {type, value, line, col, endCol} ending with an EOF token, throwing
// the first lexical error (E0101-E0104) as a syntax EmberError with a precise
// span. Newlines are insignificant; columns are 1-based code-point columns
// and tabs count as one column. Message style follows DESIGN.md.

import { T, KEYWORDS, EOF_TOKEN } from './tokens.js';
import { syntaxError, CODES } from './errors.js';

const WS = /\s/u;
const DIGIT = /[0-9]/;
const IDENT_START = /[_\p{L}]/u;
const IDENT_CONT = /[_\p{L}\p{N}]/u;

// Longest-match operator tables: two-character spellings are tried first,
// so `==` beats `=`, `..` beats `.`, and so on.
const TWO_CHAR = new Map([
  ['==', T.EQ], ['!=', T.NEQ], ['<=', T.LE], ['>=', T.GE],
  ['+=', T.PLUSEQ], ['-=', T.MINUSEQ], ['*=', T.STAREQ],
  ['/=', T.SLASHEQ], ['%=', T.PERCENTEQ], ['..', T.DOTDOT]
]);

const ONE_CHAR = new Map([
  ['(', T.LPAREN], [')', T.RPAREN], ['[', T.LBRACKET], [']', T.RBRACKET],
  ['{', T.LBRACE], ['}', T.RBRACE], [',', T.COMMA], ['.', T.DOT],
  [':', T.COLON], ['=', T.ASSIGN], ['+', T.PLUS], ['-', T.MINUS],
  ['*', T.STAR], ['/', T.SLASH], ['%', T.PERCENT], ['<', T.LT], ['>', T.GT]
]);

// String escapes; `\"` and `\'` are accepted under either quote style.
const ESCAPES = { n: '\n', t: '\t', r: '\r', '\\': '\\', '"': '"', "'": "'", '0': '\0' };

// Printable form of a character for diagnostics: control characters become
// `\u{...}`, pictographic characters become `U+XXXX` so that no emoji ever
// reaches program output, everything else is echoed verbatim.
function showChar(ch) {
  const cp = ch.codePointAt(0);
  if (cp < 0x20 || cp === 0x7f) return '\\u{' + cp.toString(16) + '}';
  if (cp > 0x7e && /\p{Extended_Pictographic}/u.test(ch)) {
    return 'U+' + cp.toString(16).toUpperCase();
  }
  return ch;
}

// Tokenize `source` into an array of tokens ending with an EOF token.
// Throws the first lexical error (codes E0101-E0104) with a precise span,
// the given `filePath`, and an optional help line.
export function tokenize(source, filePath) {
  const cps = Array.from(source); // iterate by code points, not UTF-16 units
  const n = cps.length;
  const toks = [];
  let i = 0;
  let line = 1;
  let col = 1;

  function fail(code, message, atLine, atCol, endAtCol, help) {
    throw syntaxError(code, message, { line: atLine, col: atCol, endCol: endAtCol }, filePath, help);
  }

  function lexString(quote) {
    const startCol = col;
    i++; col++; // opening quote
    let value = '';
    const unterminated = (endAtCol) => fail(
      CODES.UNTERMINATED_STRING,
      'unterminated string, expected a closing `' + quote + '` before the end of the line',
      line, startCol, endAtCol,
      'Close the string with `' + quote + '` on the same line; Ember strings cannot span lines.'
    );
    while (i < n) {
      const c = cps[i];
      if (c === '\n' || c === '\r') unterminated(col);
      if (c === quote) {
        i++; col++;
        toks.push({ type: T.STRING, value, line, col: startCol, endCol: col });
        return;
      }
      if (c === '\\') {
        const escCol = col;
        i++; col++; // backslash
        if (i >= n) unterminated(col);
        const e = cps[i];
        if (e === '\n' || e === '\r') unterminated(col);
        // hasOwn guards against prototype names like `constructor`
        if (!Object.hasOwn(ESCAPES, e)) {
          fail(CODES.INVALID_ESCAPE,
            'invalid escape sequence `\\' + showChar(e) + '`',
            line, escCol, escCol + 2,
            "Supported escapes are `\\n` `\\t` `\\r` `\\\\` `\\\"` `\\'` and `\\0`.");
        }
        value += ESCAPES[e];
        i++; col++;
        continue;
      }
      value += c;
      i++; col++;
    }
    unterminated(col); // EOF inside the string
  }

  function lexNumber() {
    const startCol = col;
    let text = '';
    let isFloat = false;

    // Consume digits; `_` is legal only when another digit follows, so
    // `1_000` groups but `1__0` and `1_` are malformed.
    function takeDigits() {
      for (;;) {
        const c = cps[i];
        if (c !== undefined && DIGIT.test(c)) { text += c; i++; col++; continue; }
        if (c === '_') {
          const nx = cps[i + 1];
          if (nx === undefined || !DIGIT.test(nx)) {
            fail(CODES.MALFORMED_NUMBER,
              'malformed number, `_` may appear only between digits',
              line, startCol, col + 1,
              'Group digits as in `1_000`; remove underscores that are not between two digits.');
          }
          text += c; i++; col++;
          continue;
        }
        return;
      }
    }

    takeDigits();
    if (cps[i] === '.') {
      const nx = cps[i + 1];
      if (nx !== undefined && DIGIT.test(nx)) {
        text += '.'; i++; col++; isFloat = true;
        takeDigits();
      } else if (nx !== '.') {
        // A dot that starts neither a fraction nor a range operator.
        fail(CODES.MALFORMED_NUMBER,
          'malformed number, a fraction needs digits after `.`',
          line, startCol, col + 1,
          'Use `..` for ranges, as in `1..5`, or write the fraction as in `1.5`.');
      }
      // nx === '.': stop cleanly so `1..2` lexes INT DOTDOT INT
    }
    const e = cps[i];
    if (e === 'e' || e === 'E') {
      text += e; i++; col++; isFloat = true;
      if (cps[i] === '+' || cps[i] === '-') { text += cps[i]; i++; col++; }
      if (cps[i] === undefined || !DIGIT.test(cps[i])) {
        fail(CODES.MALFORMED_NUMBER,
          'malformed number, an exponent needs digits after `' + e + '`',
          line, startCol, col,
          'Write the exponent with digits, as in `1e6` or `2.5e-3`.');
      }
      takeDigits();
    }

    const value = Number(text.replace(/_/g, ''));
    toks.push({ type: isFloat ? T.FLOAT : T.INT, value, line, col: startCol, endCol: col });
  }

  function lexWord() {
    const startCol = col;
    let name = cps[i];
    i++; col++;
    while (i < n && IDENT_CONT.test(cps[i])) { name += cps[i]; i++; col++; }
    toks.push({
      type: KEYWORDS.has(name) ? T.KEYWORD : T.IDENT,
      value: name, line, col: startCol, endCol: col
    });
  }

  function lexOperator() {
    const startCol = col;
    const pair = i + 1 < n ? cps[i] + cps[i + 1] : '';
    if (TWO_CHAR.has(pair)) {
      toks.push({ type: TWO_CHAR.get(pair), value: pair, line, col: startCol, endCol: col + 2 });
      i += 2; col += 2;
      return;
    }
    const ch = cps[i];
    const single = ONE_CHAR.get(ch);
    if (single) {
      toks.push({ type: single, value: ch, line, col: startCol, endCol: col + 1 });
      i++; col++;
      return;
    }
    let help = null;
    if (ch === '!') help = 'Use `!=` to test two values for inequality.';
    else if (ch === '&' || ch === '|') help = 'Use `and` and `or` for boolean logic.';
    fail(CODES.INVALID_CHARACTER, 'invalid character `' + showChar(ch) + '`',
      line, startCol, startCol + 1, help);
  }

  while (i < n) {
    const ch = cps[i];
    if (ch === '\n') { i++; line++; col = 1; continue; }
    if (WS.test(ch)) { i++; col++; continue; }
    if (ch === '#') { while (i < n && cps[i] !== '\n') { i++; col++; } continue; }
    if (ch === '"' || ch === "'") { lexString(ch); continue; }
    if (DIGIT.test(ch)) { lexNumber(); continue; }
    if (IDENT_START.test(ch)) { lexWord(); continue; }
    lexOperator();
  }
  toks.push(EOF_TOKEN(line, col));
  return toks;
}
