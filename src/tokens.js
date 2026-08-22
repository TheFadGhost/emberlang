// Token types and token helpers shared by the lexer and parser.
// A token is {type, value, line, col, endCol}: line is 1-based; col is a
// 1-based code-point column; endCol is exclusive. Tabs count as one column
// here — only the diagnostics renderer expands them for display.

export const T = {
  INT: 'INT',
  FLOAT: 'FLOAT',
  STRING: 'STRING',
  IDENT: 'IDENT',
  KEYWORD: 'KEYWORD',
  EOF: 'EOF',

  LPAREN: 'LPAREN',     // (
  RPAREN: 'RPAREN',     // )
  LBRACKET: 'LBRACKET', // [
  RBRACKET: 'RBRACKET', // ]
  LBRACE: 'LBRACE',     // {
  RBRACE: 'RBRACE',     // }
  COMMA: 'COMMA',       // ,
  DOT: 'DOT',           // .
  DOTDOT: 'DOTDOT',     // ..
  COLON: 'COLON',       // :
  ASSIGN: 'ASSIGN',     // =
  PLUS: 'PLUS',         // +
  MINUS: 'MINUS',       // -
  STAR: 'STAR',         // *
  SLASH: 'SLASH',       // /
  PERCENT: 'PERCENT',   // %
  EQ: 'EQ',             // ==
  NEQ: 'NEQ',           // !=
  LT: 'LT',             // <
  LE: 'LE',             // <=
  GT: 'GT',             // >
  GE: 'GE',             // >=
  PLUSEQ: 'PLUSEQ',     // +=
  MINUSEQ: 'MINUSEQ',   // -=
  STAREQ: 'STAREQ',     // *=
  SLASHEQ: 'SLASHEQ',   // /=
  PERCENTEQ: 'PERCENTEQ' // %=
};

export const KEYWORDS = new Set([
  'let', 'fn', 'if', 'elif', 'else', 'while', 'for', 'in',
  'return', 'break', 'continue', 'true', 'false', 'null', 'and', 'or', 'not'
]);

export function EOF_TOKEN(line, col) {
  return { type: T.EOF, value: null, line, col, endCol: col };
}

const OP_SPELLING = {
  [T.LPAREN]: '(', [T.RPAREN]: ')', [T.LBRACKET]: '[', [T.RBRACKET]: ']',
  [T.LBRACE]: '{', [T.RBRACE]: '}', [T.COMMA]: ',', [T.DOT]: '.',
  [T.DOTDOT]: '..', [T.COLON]: ':', [T.ASSIGN]: '=', [T.PLUS]: '+',
  [T.MINUS]: '-', [T.STAR]: '*', [T.SLASH]: '/', [T.PERCENT]: '%',
  [T.EQ]: '==', [T.NEQ]: '!=', [T.LT]: '<', [T.LE]: '<=',
  [T.GT]: '>', [T.GE]: '>=', [T.PLUSEQ]: '+=', [T.MINUSEQ]: '-=',
  [T.STAREQ]: '*=', [T.SLASHEQ]: '/=', [T.PERCENTEQ]: '%='
};

function backtick(s) {
  return '`' + s + '`';
}

// Human-readable phrase for parser error messages ("expected X, found Y").
export function describeToken(tok) {
  switch (tok.type) {
    case T.EOF:
      return 'end of input';
    case T.IDENT:
      return 'identifier ' + backtick(tok.value);
    case T.KEYWORD:
      return 'keyword ' + backtick(tok.value);
    case T.INT:
      return 'integer ' + backtick(String(tok.value));
    case T.FLOAT:
      return 'float ' + backtick(String(tok.value));
    case T.STRING:
      return 'string ' + backtick(JSON.stringify(tok.value));
    default:
      return backtick(OP_SPELLING[tok.type] || tok.type);
  }
}
