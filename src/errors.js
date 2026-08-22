// EmberError and constructors. Every diagnostic in the pipeline is built
// here so spans, codes, and kinds stay consistent across parallel modules.
// Rendering lives in src/diag/render.js; nothing in this file prints.

export const CODES = {
  INVALID_CHARACTER: 'E0101',
  UNTERMINATED_STRING: 'E0102',
  MALFORMED_NUMBER: 'E0103',
  INVALID_ESCAPE: 'E0104',

  EXPECTED_FOUND: 'E0201',
  UNEXPECTED_EOF: 'E0202',
  UNEXPECTED_TOKEN: 'E0203',
  INVALID_ASSIGN_TARGET: 'E0204',
  DUPLICATE_PARAM: 'E0205',
  NESTING_TOO_DEEP: 'E0206',

  UNDEFINED_VARIABLE: 'E0301',
  NOT_CALLABLE: 'E0302',
  WRONG_ARG_COUNT: 'E0303',
  TYPE_ERROR: 'E0304',
  INDEX_OUT_OF_RANGE: 'E0305',
  MISSING_KEY: 'E0306',
  DIV_BY_ZERO: 'E0307',
  NOT_ITERABLE: 'E0308',
  RECURSION_LIMIT: 'E0309',
  MISUSED_STATEMENT: 'E0310',

  INTERNAL: 'E9901'
};

export class EmberError extends Error {
  constructor(kind, code, message, span, filePath, help) {
    super(message);
    this.name = kind === 'syntax' ? 'SyntaxError' : kind === 'runtime' ? 'RuntimeError' : 'InternalError';
    this.kind = kind;                 // 'syntax' | 'runtime' | 'internal'
    this.code = code;
    this.message = message;
    this.filePath = filePath ?? null;
    this.line = span ? span.line : null;
    this.col = span ? span.col : null;
    this.endCol = span ? (span.endCol ?? span.col) : null;
    this.help = help ?? null;
  }
}

// Parser-only marker: the REPL continues buffering when it catches this.
export class UnexpectedEOF extends EmberError {
  constructor(message, span, filePath, help) {
    super('syntax', CODES.UNEXPECTED_EOF, message, span, filePath, help);
    this.eof = true;
  }
}

function asSpan(tokOrSpan) {
  if (!tokOrSpan) return null;
  return { line: tokOrSpan.line, col: tokOrSpan.col, endCol: tokOrSpan.endCol ?? tokOrSpan.col };
}

export function syntaxError(code, message, span, filePath, help) {
  return new EmberError('syntax', code, message, asSpan(span), filePath, help);
}

export function unexpectedEOF(message, span, filePath, help) {
  return new UnexpectedEOF(message, asSpan(span), filePath, help);
}

export function runtimeError(code, message, span, filePath, help) {
  return new EmberError('runtime', code, message, asSpan(span), filePath, help);
}

export function internalError(message) {
  return new EmberError('internal', CODES.INTERNAL, message, null, null, null);
}

const MAX_BRIEF = 24;

// Short value rendering for embedding inside diagnostic messages.
export function brief(v) {
  if (v === null) return 'null';
  if (typeof v === 'boolean') return String(v);
  if (typeof v === 'number') return String(v);
  if (typeof v === 'string') {
    const q = JSON.stringify(v.length > MAX_BRIEF ? v.slice(0, MAX_BRIEF) : v);
    return v.length > MAX_BRIEF ? q + '...' : q;
  }
  if (Array.isArray(v)) return '[..' + v.length + ' items]';
  if (v instanceof Map) return '{..' + v.size + ' keys}';
  if (v && (v.__fn || v.__native)) return '<fn>';
  return String(v);
}
