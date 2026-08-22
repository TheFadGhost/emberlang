# CONTRACTS.md — module interfaces and conventions

This is the binding contract between modules built in parallel. If code
disagrees with this document, this document wins; fix the code.

## Conventions

- Language: JavaScript ESM (`"type": "module"`), Node >= 18, ZERO runtime
  dependencies. Tests use `node:test` + `node:assert/strict`.
- Imports of local files always include the `.js` extension.
- No emoji anywhere in program output strings. No exclamation marks in any
  user-facing string. No ALL-CAPS shouting. Error messages follow DESIGN.md.
- Doc comments on exported functions: one or two lines explaining behaviour
  (this is a teaching implementation — comments that explain *why* are
  welcome; noisy narration is not).
- Positions: `line` is 1-based; `col` is a 1-based **code-point** column;
  spans are `{line, col, endCol}` with `endCol` exclusive. Tabs count as one
  column internally; only the renderer expands them.
- Tokens carry `{type, value, line, col, endCol}` where `value` is the
  cooked value (number, cooked string, identifier name, operator spelling).
- AST nodes are plain objects with a `kind` field plus `line`, `col`,
  `endCol` copied from their first/last token.

## src/tokens.js (exists)

Exports:

- `T` — object mapping names to type strings:
  `INT FLOAT STRING IDENT KEYWORD OP EOF` plus punctuation/operator types:
  `LPAREN RPAREN LBRACKET RBRACKET LBRACE RBRACE COMMA DOT DOTDOT COLON
  ASSIGN PLUS MINUS STAR SLASH PERCENT EQ NEQ LT LE GT GT? ...`
  Full list in file. Keywords: `let fn if else while for in return break
  continue true false null and or not`. Keyword tokens get type `KEYWORD`
  with `value` = spelling. Operators keep distinct types (`EQ` is `==`,
  `ASSIGN` is `=`, `NEQ` is `!=`, `LE` `<=`, `GE` `>=`, `LT` `<`, `GT` `>`).
- `EOF_TOKEN(line, col)` — fresh EOF token factory.
- `describeToken(tok)` — human phrase for messages: `` `let` `` for
  keywords/operators (backticked spelling), `` identifier `x` ``, `` integer
  `42` ``, `` end of input ``. Used by parser errors.

## src/errors.js (exists)

Exports:

- `class EmberError extends Error` with fields
  `{ kind, code, message, filePath, line, col, endCol, help }` where
  `kind` is `'syntax' | 'runtime' | 'internal'`.
- `class UnexpectedEOF extends EmberError` with `eof === true` (parser uses
  it for E0202 so the REPL can detect continuation).
- `syntaxError(code, message, span, filePath, help)` → EmberError(syntax).
  `span` is a token or `{line, col, endCol}`.
- `unexpectedEOF(message, span, filePath, help)` → UnexpectedEOF.
- `runtimeError(code, message, span, filePath, help)` → EmberError(runtime).
  Span may be `null` when no call site applies (then renderer omits the
  excerpt).
- `internalError(message)` → EmberError(internal), code E9901.
- `brief(v)` — short value rendering for embedding in messages: strings
  become `"..."` quoted and truncated at 24 chars with `"..."` appended;
  arrays `[..3 items]`; maps `{..2 keys}`; functions `<fn>`; others via
  `String(v)`.
- `CODES` — the registry constants from DESIGN.md, e.g.
  `CODES.UNDEFINED_VARIABLE = 'E0301'`.

## src/ast.js (exists)

Exports node factories. Each takes `(span, fields)` — span first — and
returns the plain node. Factories:

```
Program(span, body[])                        // span covers whole source used
LetStmt(span, {name, nameTok, value})
AssignStmt(span, {target, op, value})        // target: Ident | Index; op: '=', '+=', ...
ExprStmt(span, {expr})
IfStmt(span, {branches: [{cond, body}], elseBody})   // elseBody: Block|null
WhileStmt(span, {cond, body})
ForStmt(span, {name, iter, body})
FnDecl(span, {name, params[], body})         // params: [{name, tok}]
ReturnStmt(span, {value})                    // value: expr|null
BreakStmt(span) / ContinueStmt(span)
Block(span, {body[]})
BinOp(span, {op, left, right})               // op: + - * / % == != < <= > >= .. and or
UnOp(span, {op, operand})                    // op: - not
Call(span, {callee, args[]})
Index(span, {obj, index})
Slice(span, {obj, low, high})                // low/high: expr|null
RangeLit(span, {low, high})                  // a..b, half-open [a, b)
Ident(span, {name, tok})
NumLit(span, {value, isInt})
StrLit(span, {value})
BoolLit(span, {value}) / NullLit(span)
FnExpr(span, {params[], body})               // anonymous fn(params) block
```

Also exports `astDump(node)` → indented tree text (no trailing newline),
one node per line: `Kind detail` with two-space indent per depth, e.g.

```
Program
  LetStmt name=x
    BinOp +
      NumLit 1
      NumLit 2
```

## src/diag/theme.js (exists)

- `THEMES = { dark: {...}, light: {...} }` — role → SGR prefix string,
  roles: error warning help literal caret gutter result prompt promptCont.
- `resolveTheme({noColorFlag, themeName, stream})` →
  `{enabled, themeName, paint(role, text)}` implementing the degradation
  order from DESIGN.md. `paint` returns text unchanged when disabled.

## src/diag/render.js (exists)

- `renderDiagnostic(d, sourceText, colorInfo)` → string ending in `\n`.
  `d = {severity, kind, code, message, filePath, line, col, endCol, help}`;
  `colorInfo = resolveTheme(...)` result. Renders the full block from
  DESIGN.md; omits excerpt/caret/help when absent; elides >120 display
  cells; expands tabs to 4 stops; CJK wide = 2 cells.
- `renderError(err, sourceText, colorInfo)` — convenience wrapper reading an
  `EmberError`; internal errors render the internal block without stack.
- `displayWidth(text)` and `expandLine(rawLine)` (→ `{text, colMap}`)
  exported for tests.

## Pipeline modules (to be built)

### src/lexer.js

- `tokenize(source, filePath)` → array of tokens ending with an EOF token.
  Throws the first lexical EmberError (E0101–E0104) with precise spans.
- Rules: `#` comment to end of line. Whitespace including newlines skipped
  (newlines are insignificant). Strings `"..."` or `'...'` with escapes
  `\n \t \r \\ \" \' \0`; any other escape is E0104; newline inside a string
  is E0102 unterminated (span = opening quote to end of that line). Numbers:
  digits with `_` between digits, optional `.digits` fraction (a trailing
  dot with no digit after is E0103), optional exponent `[eE][+-]?digits`;
  `1..2` lexes INT DOTDOT INT. Identifiers start with an ASCII letter, `_`,
  or any Unicode letter (`/\p{L}/u`), then letters/digits/`_`; other
  non-ASCII characters are E0101. `..` → DOTDOT; single `.` → DOT.

### src/parser.js

- `parse(tokens, filePath)` → Program. Recursive descent, precedence
  climbing for expressions. Precedence low→high:
  `or(1) and(2) ==(3) !=(3) <(4) <=(4) >(4) >=(4) ..(5) +(6) -(6)
   *(7) /(7) %(7) unary(8) postfix/call/index/slice(9)`
  All binary operators left-associative. Unary: `-`, `not`.
- Statements: let / assignment / if / while / for-in / fn decl / return /
  break / continue / bare block / expression statement. Newlines are not
  statement terminators; statements self-delimit by grammar (Lua-style):
  `let x = 1 let y = 2` on one line parses as two statements.
- Assignment: parse an expression; accept as target only Ident or Index,
  else E0204 pointing at the expression start. Compound ops desugar at AST
  level (`x += y` becomes AssignStmt with op `'+='`).
- `if cond { } elif cond { } else { }`: braces mandatory; `elif` chains
  into `branches`. Conditions unparenthesised.
- Calls/args, index `xs[i]`, slice `xs[a:b]` / `xs[:b]` / `xs[a:]` (step not
  supported), range literal `a..b` at its precedence level producing a
  RangeLit node; array `[a, b]` and map `{"k": v}` literals (keys are
  expressions, runtime-checked to be strings).
- Errors: E0201 with expected/found via describeToken, E0203 unexpected
  token, E0204 target, E0205 duplicate param, E0206 nesting depth > 500.
  Incomplete input at EOF → unexpectedEOF (E0202).

### src/interp/env.js, src/interp/values.js, src/interpreter.js

- `Env` class: `{vars: Map, parent}`; methods `define(name, v)` (redefinition
  allowed), `get(name, span, filePath)` throws E0301 naming the variable,
  `assign(name, v, span, filePath)` walks chain, throws E0301 if undeclared,
  `names()` sorted list (REPL completion/:env).
- Values: JS `number` (int vs float by `Number.isInteger`),
  `string`, `boolean`, `null`, `Array`, `Map` (map keys are strings only),
  function objects `{__fn: true, name, params, body, closure}` for Ember
  functions and `{__native: true, name, arity:[min,max], call}` for
  builtins.
- `truthy(v)` — ONLY `false` and `null` are falsy. Everything else truthy.
- `typeName(v)` → one of `int float string bool null array map function`.
- `equals(a, b)` — deep structural equality (arrays/maps recursed, map key
  order irrelevant); number equality numeric.
- `stringify(v)` — print semantics: top-level strings raw; nested strings
  inside containers quoted; arrays `[1, "a"]`; maps `{"k": 1}` insertion
  order; functions `<fn name>` / `<fn>`; cycles render as `[cyclic]`.
- `repr(v)` — inspect semantics: like stringify but quotes top-level
  strings too (REPL echo).
- `Interpreter` class: `constructor({trace = false, traceSink = line => {},
   maxDepth = 400} = {})`; property `globals: Env` pre-loaded with builtins;
  `run(program, {filePath})` executes and returns the last statement's
  value (or null); `opts.env` runs against an explicit environment instead
  of a fresh child of globals (the REPL passes its persistent globals so
  bindings accumulate). Catches stray Return/Break/Continue signals at top
  level → runtimeError E0310. Call depth exceeded → E0309. Trace mode emits
  `call name(args...)` / `ret name -> value` lines indented `2*depth` spaces
  via traceSink.
- Signals exported: `BreakSignal`, `ContinueSignal`, `ReturnSignal(value)`.
- Semantics pinned by tests: lexical env-chain scoping; closures capture the
  environment; `for` defines a FRESH binding per iteration (loop-capture
  safe); assignment to undeclared is E0301; `/` `%` by zero → E0307; `+`
  concatenates strings, concats arrays, otherwise numbers only (mixed →
  E0304 with `brief()` values); comparisons on numbers and strings; `==`
  deep; `and`/`or` short-circuit returning the deciding operand; `not`
  returns bool; indexing arrays/strings bounds-checked E0305 (negative →
  E0305), maps keyed by strings, missing key → E0306; slices clamp silently;
  assigning into a string → E0304; iterating anything but array/string/map/
  range-array → E0308; `..` materialises an array, length cap 5_000_000 else
  E0304.

### src/builtins.js

- `installBuiltins(env)` binds natives listed below. Native signature:
  `call(callNode, args)` returning a value; throw via
  `runtimeError(...)` with the CALL SITE span from `callNode` so diagnostics
  point at the caller.
- Shared helpers exported for consistency:
  `expectArgs(node, name, args, min, max)` → E0303 message
  "`len` expects 1 argument, got 2";
  `expectType(node, name, v, kind)` → E0304
  message "`upper` expects a string, got int" (with a/an article).
- Registry (name: signature):
  `len(x)`; `print(...args)` (space-joined + newline, returns null);
  `push(arr, x)` mutates, returns arr; `pop(arr)` returns last or E0305
  "pop from an empty array"; `keys(m)`, `values(m)` insertion order;
  `str(x)`; `int(x)` (floats truncate toward zero; strings parse fully,
  garbage → E0304); `float(x)` similar; `type(x)`; 
  `range(n)` / `range(a, b)` / `range(a, b, step≠0)` → array;
  `upper(s) lower(s) trim(s) split(s, sep≠"") join(arr, sep) chars(s)
  replace(s, a≠"", b) contains(xs, x) (array member / substring / map key);
  abs(n) floor(n) ceil(n) round(n) min(arr) max(arr);
  get(m, k, default=null); has(m, k) (true when the key is stored, even if
  the value is null); write(...args) like print without the trailing
  newline; ask(prompt?) reads one line from stdin (null at EOF)`.
- Arity enforcement for natives happens interpreter-side via `expectArgs`
  before the native `call` runs; the stored `[min,max]` tuples document and
  drive that.

### src/repl.js, src/cli.js, bin/ember.js

- `startRepl(opts)` interactive loop per DESIGN.md. Pure helpers exported
  for tests: `needsContinuation(err)`, `extractCommand(line)`
  (→ `{name, arg}|null`), `makeCompleter(names, builtins)`.
- `cliMain(argv)` → exit code number. Commands: `run FILE [-- args...]`,
  `tokens FILE`, `ast FILE`, `repl` (default with no args), `help`,
  `version`. Flags: `--no-color`, `--theme=X|Y`, `--trace-calls`,
  `--ast`, `--tokens` (on run: dump instead of execute), `--version/-V`,
  `--help/-h`. Exit codes: 0 clean; 2 usage/file-not-found; 65 syntax
  (lex/parse); 70 runtime/internal. Reads source as utf8, strips BOM.
- Token dump format (stable, tested): one token per line,
  `TYPE` padded to 9, backticked value, then `@ L.C-L.C`, e.g.
  `INT      `1` @ 1.1-1.2`. AST dump: `astDump(program)`.
- `argv` builtin: CLI binds script args (after `--`) as array named `argv`
  before running; REPL binds `[]`.

## Testing rules

- Every module has `test/<module>.test.js`. Run one file:
  `node --test test/lexer.test.js`. Run all: `npm test`.
- Never delete tests, weaken assertions, or skip cases to get green.
- Golden-file tests spawn `node bin/ember.js run examples/*.em` and compare
  stdout exactly. Diagnostic snapshot tests compare rendered blocks exactly
  (both themes, colour off, tabs/CJK cases).
