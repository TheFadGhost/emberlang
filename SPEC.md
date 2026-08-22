# SPEC.md — the Ember language specification

This document specifies Ember 0.1.0: a small, dynamically typed language
with C-family syntax, lexical scoping, and first-class functions. It
describes behaviour as implemented; normative references are the source
(`src/lexer.js`, `src/parser.js`, `src/interpreter.js`, `src/builtins.js`)
and the module contracts in CONTRACTS.md. Diagnostic presentation is
specified separately in DESIGN.md.

## Lexical structure

**Comments** start with `#` and run to the end of the line. There are no
block comments.

**Whitespace** (spaces, tabs, newlines) separates tokens but carries no
meaning. Newlines are never terminators; see "Statement self-delimitation".

**Identifiers** start with a letter or underscore and continue with
letters, digits, or underscores. Letters follow Unicode general category
L (so `name`, `_tmp`, and `héllo` are identifiers); classification is
per code point, and columns in diagnostics count code points.

**Keywords** are reserved and cannot be identifiers:

```
let fn if elif else while for in return break continue
true false null and or not
```

**Numbers**: digits with optional `_` separators between digits, an
optional fraction (`.digits`), and an optional exponent `[eE][+-]?digits`.
Underscores must sit between two digits (`1_000_000` is valid; `1_`,
`_1`, and `1__0` are malformed). A trailing dot with no digit after it is
malformed (`1.` fails; `1..2` lexes as integer, range operator, integer).
A number containing a fraction or exponent is a *float*; otherwise it is
an *integer*. Both are stored as one 64-bit binary floating-point value;
see "Types and values".

**String literals** are delimited by `"` or `'`; a string cannot span a
line. Both quote styles accept both escape spellings.

| Escape | Produces |
| --- | --- |
| `\n` | newline (U+000A) |
| `\t` | tab (U+0009) |
| `\r` | carriage return (U+000D) |
| `\\` | backslash |
| `\"` | double quote |
| `\'` | single quote |
| `\0` | NUL (U+0000) |

Any other escape is an error (E0104). A newline or end of file inside a
string is an unterminated-string error (E0102).

**Operators and punctuation**, longest match first:

| Tokens | Notes |
| --- | --- |
| `==` `!=` `<=` `>=` `+=` `-=` `*=` `/=` `%=` `..` | two-character tokens |
| `=` `<` `>` `+` `-` `*` `/` `%` | one-character tokens |
| `( )` `[ ]` `{ }` `,` `:` `.` | punctuation |

`&&` and `||` do not exist; boolean operators are the keywords `and` and
`or`. A lone `&`, `|`, or `!` is an invalid-character error (E0101).

## Grammar

Informal EBNF sketch. `expression` is parsed by precedence climbing over
the table below; braces around statement bodies are mandatory.

```
program     = statement*
statement   = let_stmt | assign | if_stmt | while_stmt | for_stmt
            | fn_decl | return_stmt | "break" | "continue"
            | block | expr_stmt
let_stmt    = "let" IDENT "=" expression
assign      = target ( "=" | "+=" | "-=" | "*=" | "/=" | "%=" ) expression
if_stmt     = "if" expression block { "elif" expression block } [ "else" block ]
while_stmt  = "while" expression block
for_stmt    = "for" IDENT "in" expression block
fn_decl     = "fn" IDENT "(" [ params ] ")" block
return_stmt = "return" [ expression ]
block       = "{" statement* "}"
expr_stmt   = expression

params      = IDENT { "," IDENT } [ "," ]
args        = expression { "," expression } [ "," ]

array_lit   = "[" [ args ] "]"
map_lit     = "{" [ pair { "," pair } [ "," ] ] "}"
pair        = expression ":" expression          // key must be a string
fn_expr     = "fn" "(" [ params ] ")" block

primary     = INT | FLOAT | STRING | IDENT | "true" | "false" | "null"
            | "(" expression ")" | array_lit | map_lit | fn_expr
postfix     = primary { "(" [ args ] ")"                  // call
                      | "[" expression "]"                // index
                      | "[" [ expression ] ":" [ expression ] "]" }  // slice
unary       = ( "-" | "not" ) unary | postfix
binary      = unary { binary_op unary }                   // precedence climbing
```

Precedence, loosest binding first. Every binary level is
left-associative; `..` produces a range value rather than a boolean.

| Level | Operators | Associativity |
| --- | --- | --- |
| 1 | `or` | left |
| 2 | `and` | left |
| 3 | `==` `!=` | left |
| 4 | `<` `<=` `>` `>=` | left |
| 5 | `..` | left |
| 6 | `+` `-` | left |
| 7 | `*` `/` `%` | left |
| 8 | unary `-` `not` | prefix |
| 9 | call `f(x)`, index `xs[i]`, slice `xs[a:b]` | postfix |

Because unary binds tighter than every binary operator but looser than
postfix forms, `-f(x)[0]` means `-(f(x)[0])`, and `not 1 == 2` means
`(not 1) == 2`. Slices take `[low]:[high]` with either bound optional and
no step. Calls and array literals allow a trailing comma.

## Statement self-delimitation

Newlines are invisible to the parser: statements delimit themselves by
grammar, Lua-style. `let x = 1 let y = 2` is two statements, and an
expression ends when the next token cannot continue it. Three documented
consequences:

1. **An operator continues the expression across lines, in either
   direction.** Because the lexer discards newlines,

   ```
   let a = 1 +
   2
   ```

   and `let a = 1 \n + 2` are both simply `let a = (1 + 2)`. An
   expression therefore never needs a continuation marker, but a line
   ending mid-expression silently absorbs whatever comes next.

2. **`{` at statement position is always a block.** Bare blocks are
   statements, so a brace after a statement opens a nested scope, never a
   map literal. Map literals belong in expression positions: `let m =
   {...}`, arguments, array elements, return operands.

3. **`return {` therefore does not return a map.** `return` accepts a
   value only when the following token can begin an expression, and `{`
   cannot. `return { "k": 1 }` parses as a valueless `return` followed by
   a block whose contents fail to parse (E0203). Wrap the literal in
   parentheses to return it: `return ({ "k": 1 })`.

## Types and values

Values have types `int`, `float`, `string`, `bool`, `null`, `array`,
`map`, and `function` (reported by `type()`). There is exactly one
number representation: a 64-bit IEEE 754 binary floating-point value.
`int` and `float` are a reporting convention, not distinct storages: a
number reports as `int` precisely when it is mathematically integral
(`Number.isInteger`), so `type(2.0)` is `int` and `type(2.5)` is `float`.
Division `/` is real division (`7 / 2` is `3.5`); it never truncates.
Modulo `%` takes the sign of the dividend (`-7 % 3` is `-1`). Division or
modulo by zero raises E0307.

Equality `==` is deep structural equality: arrays and maps compare
element-wise regardless of container identity, map key order is
irrelevant, and functions compare by identity. Truthiness is exact: only
`false` and `null` are falsy. Everything else is truthy, including `0`,
`""`, and `[]`. Conditions in `if`, `elif`, and `while` use this rule,
and `not` maps any value to a bool by negating it.

Strings are sequences of Unicode code points. Indexing and `len()`
operate on code points, not UTF-16 units.

## Semantics

**Scoping.** Scopes are lexical and nest through a chain of environments.
Blocks, loop bodies, and function bodies create child scopes; inner
declarations may shadow outer ones, and redeclaring an existing name is
allowed (the REPL relies on it). Names must be declared before use:
assignment to an undeclared name is E0301, as is reading one.

**Closures.** Functions are first class; `fn` expressions capture their
defining environment, so a closure keeps access to local variables after
the enclosing call returns. Two counters created from the same factory
have independent state.

**for-in.** Iteration works over arrays (elements), strings (code
points), and maps (keys, insertion order); iterating anything else is
E0308. Each iteration defines a fresh binding of the loop variable, so
closures created inside the body capture that iteration's value, not a
shared cell.

**Mutation.** Arrays are mutable in place: index assignment and `push` /
`pop` change the existing array. Maps are mutable through index
assignment. Strings are immutable: `s[0] = "x"` is E0304. Operations
that appear constructive build new values — `[1] + [2]` yields a third
array, and slicing copies.

**Indexing and slices.** Array and string indices must be integers;
negative indices raise E0305 rather than counting from the end, as does
any out-of-range index. Reading a map with a missing string key raises
E0306. Slices clamp silently: bounds are clamped to `[0, len]` and a
half-open window outside the data yields an empty result.

**Maps.** Keys are strings only; constructing or indexing with another
key type is E0304, and duplicate keys in one literal are E0304.
Iteration and display preserve insertion order.

**Ranges.** `a..b` is a half-open interval materialised immediately into
an array `[a, b)` of integers; reversed or empty bounds yield `[]`.
Materialising more than 5,000,000 elements is refused with E0304 before
allocation. Non-integer bounds are E0304.

**Boolean operators.** `and` and `or` short-circuit and return the
deciding operand, not a coerced bool: `"a" and "b"` is `"b"`, `false or
"x"` is `"x"`. The right operand is evaluated only when needed. `not`
always returns a bool.

**Arithmetic overloads.** `+` adds numbers, concatenates two strings,
and concatenates two arrays into a new array; any other mix is E0304.
`-` `*` `/` `%` accept numbers only, and comparisons `<` `<=` `>` `>=`
accept two numbers or two strings.

**Calls.** Calling a non-function is E0302; wrong argument counts are
E0303 naming expected and received. Recursion deeper than 400 calls
raises E0309. `return`, `break`, and `continue` unwind to the nearest
matching construct; used where none applies, they are E0310.

## Builtin library

All builtins are ordinary global bindings (shadowable, listed by the
REPL's `:env`) implemented in `src/builtins.js`. Errors raised inside
builtins point at the call site. Signatures below match the source
exactly; arity is fixed unless given as a range.

| Function | Signature | Behaviour |
| --- | --- | --- |
| `len` | `len(x)` | Code-point length of a string, element count of an array, or entry count of a map; other types are E0304 |
| `print` | `print(...args)` | Writes arguments space-joined followed by a newline to stdout; returns 
`null` |
| `write` | `write(...args)` | Like `print` without the trailing newline; returns `null` |
| `push` | `push(arr, x)` | Appends `x` to `arr` in place and returns `arr` |
| `pop` | `pop(arr)` | Removes and returns the last element; popping an empty array is E0305 |
| `keys` | `keys(m)` | Array of the map's keys in insertion order |
| `values` | `values(m)` | Array of the map's values in insertion order |
| `get` | `get(m, k, d = null)` | Value at string key `k`, else `d`; a non-string key is E0304 |
| `has` | `has(m, k)` | True when the map stores string key `k`, even if the stored value is null |
| `str` | `str(x)` | Print formatting as a string (top-level strings unquoted, nested ones quoted) |
| `int` | `int(x)` | Truncates a number toward zero (`-0` normalises to `0`); a trimmed string of optional sign and digits converts; anything else is E0304 |
| `float` | `float(x)` | Numbers pass through; a string in decimal-literal form (optional exponent) converts; anything else is E0304 |
| `type` | `type(x)` | One of the eight type-name strings |
| `range` | `range(n)` / `range(a, b)` / `range(a, b, s)` | Half-open integer array; `s` must not be zero; bounds truncate toward zero; more than 5,000,000 elements is E0304 |
| `upper` | `upper(s)` | Uppercased copy |
| `lower` | `lower(s)` | Lowercased copy |
| `trim` | `trim(s)` | Copy without leading and trailing whitespace |
| `split` | `split(s, sep)` | Split on a non-empty separator |
| `join` | `join(arr, sep)` | Elements stringified and joined |
| `chars` | `chars(s)` | Array of the string's code points |
| `replace` | `replace(s, a, b)` | Replaces every occurrence of non-empty `a` with `b` |
| `contains` | `contains(xs, x)` | Deep-equality membership for arrays, substring test for strings, key test for maps (last two require a string `x`) |
| `abs` | `abs(n)` | Absolute value |
| `floor` | `floor(n)` | Largest integer not greater than `n` |
| `ceil` | `ceil(n)` | Smallest integer not less than `n` |
| `round` | `round(n)` | Nearest integer; exact halves round up, toward positive infinity (`2.5` to `3`, `-2.5` to `-2`) |
| `min` | `min(arr)` | Smallest element of a non-empty numeric array |
| `max` | `max(arr)` | Largest element of a non-empty numeric array |
| `ask` | `ask(prompt?)` | Writes `prompt` without a newline, then returns the next stdin line stripped of its terminator; `null` at end of input |

Scripts receive their command-line arguments after `--` as the array
`argv`; the REPL binds `argv` to `[]`.

## Diagnostics

Every failure renders as one block — severity with a stable code, a
`file:line:col` location, the offending source line, a caret spanning
exactly the token, and optionally one `help:` line — as specified in
DESIGN.md, which owns the format and the colour system. Codes group by
pipeline stage; the registry:

| Code | Stage | Meaning |
| --- | --- | --- |
| E0101 | lexer | invalid character in source |
| E0102 | lexer | unterminated string |
| E0103 | lexer | malformed number |
| E0104 | lexer | invalid escape sequence |
| E0201 | parser | expected one thing, found another |
| E0202 | parser | unexpected end of input (incomplete; the REPL buffers on) |
| E0203 | parser | unexpected token |
| E0204 | parser | invalid assignment target |
| E0205 | parser | duplicate parameter name |
| E0206 | parser | expression nested too deeply |
| E0301 | runtime | undefined variable |
| E0302 | runtime | value is not callable |
| E0303 | runtime | wrong argument count |
| E0304 | runtime | type error |
| E0305 | runtime | index out of range |
| E0306 | runtime | missing map key |
| E0307 | runtime | division or modulo by zero |
| E0308 | runtime | value is not iterable |
| E0309 | runtime | recursion limit exceeded |
| E0310 | runtime | `return` / `break` / `continue` outside its construct |
| E9901 | internal | bug in Ember |

CLI exit codes: `0` success, `2` usage error or unreadable file, `65`
syntax error (lexing or parsing), `70` runtime or internal error.

## Numbers caveat

Ember inherits JavaScript's single number type, so integers are exact
only within the 53-bit significand of IEEE 754 doubles. Values beyond
2^53 lose precision silently — `9007199254740993` evaluates equal to
`9007199254740992` — and decimal fractions obey binary rounding
(`0.1 + 0.2` is not `0.3`). Programs needing exact big-integer arithmetic
must avoid magnitudes near 2^53; the language offers no separate wide
type.
