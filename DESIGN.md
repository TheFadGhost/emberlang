# DESIGN.md

Ember's interface is a terminal. Its primary user interface is not the happy
path — it is the diagnostic shown when something goes wrong, and the REPL in
which most learning happens. This document defines how both look and behave,
before feature code, so that every module emits through one renderer instead
of printing its own strings.

## Influences

Rust and Elm are the reference points for compiler diagnostics, and the
structural ideas are taken deliberately: a labelled severity with an error
code, a machine-parsable location line pointing at file:line:column, the
offending source line reproduced under a numbered gutter, a caret that spans
exactly the offending token rather than approximately, and one optional help
line that suggests a fix instead of restating the problem. What is *not*
taken from Rust is its stacked multi-note layouts and its house voice; Ember
diagnostics are one block, one sentence, optionally one help line. From Elm
comes the conviction that an error should read like advice from a careful
colleague; what is *not* taken is Elm's conversational length — Ember never
spends four paragraphs where one sentence works.

## Diagnostic anatomy

Every diagnostic is rendered as exactly this block:

```
<severity>[<CODE>]: <message>
  --> <file>:<line>:<col>
   |
<L> | <source line, tabs expanded>
   | <caret row>
   |
help: <help line>
```

- **severity** — the lowercase word `error` or `warning`. The word is always
  present; colour is never the only carrier of severity.
- **CODE** — stable registry code such as `E0301`, shown in brackets.
- **message** — one sentence, no trailing period, no exclamation marks, first
  word lowercase unless it starts with a proper noun. Code terms (variable
  names, types, operators) appear in backticks; when colour is enabled the
  renderer paints backticked spans in the `literal` role.
- **location** — `-->` then `path:line:col`, columns 1-based in code points.
- **excerpt** — the single offending source line, gutter-aligned.
- **caret span** — carets covering exactly the display width of the token's
  code-point range (minimum one). Not approximate; see alignment rules.
- **help** — optional single line, prefixed `help:`. Suggestions ("did you
  mean") belong here, never in the message.

A blank line follows the block. Nothing else is printed: no frames, no
internal stack traces. If the interpreter itself has a bug, the user sees

```
internal[E9901]: <what failed>

this is a bug in Ember, not in your program
```

with severity `internal` (rendered in the error role) and exit code 70, and
the JS stack stays out of sight unless `--debug-crash` is passed.

### Before / after

What other tools print, and what we refuse to print:

```
SyntaxError: Unexpected token ')'
    at Parser.parseExpr (parser.js:188:11)
```

The same mistake through Ember's renderer:

```
error[E0203]: unexpected `)`
  --> examples/calc.em:1:18
  |
1 | let total = (a + b))
  |                  ^
  |
help: remove the extra `)` or open a new `(` before this expression.

```

(The caret row above points at the stray `)` token; spans always cover real
tokens, never guesses wider than the evidence.)

## Error code registry

Codes are part of the public contract; tests snapshot them. Ranges group by
pipeline stage so a code tells you where to look in the source tree.

| Code | Stage | Meaning |
| --- | --- | --- |
| E0101 | lexer | invalid character in source |
| E0102 | lexer | unterminated string |
| E0103 | lexer | malformed number |
| E0104 | lexer | invalid escape sequence |
| E0201 | parser | expected one thing, found another (`expected X, found Y`) |
| E0202 | parser | unexpected end of input (incomplete; REPL continues) |
| E0203 | parser | unexpected token |
| E0204 | parser | invalid assignment target |
| E0205 | parser | duplicate parameter name |
| E0206 | parser | expression nested too deeply |
| E0301 | runtime | undefined variable |
| E0302 | runtime | value is not callable |
| E0303 | runtime | wrong argument count |
| E0304 | runtime | type error (wrong operand/argument type) |
| E0305 | runtime | index out of range |
| E0306 | runtime | missing map key |
| E0307 | runtime | division or modulo by zero |
| E0308 | runtime | value is not iterable |
| E0309 | runtime | recursion limit exceeded |
| E0310 | runtime | return/break/continue used outside its construct |
| E9901 | internal | bug in Ember |

## Message style rules

1. One sentence, imperative-free, no trailing period.
2. Backticks around every term that appears in the program or the builtin
   library; the renderer colours them.
3. Values embedded in messages go through `brief()` — strings quoted and
   truncated at 24 characters, containers summarised with their length.
4. Help lines are full sentences ending with a period.
5. No emoji, no ALL-CAPS shouting, no exclamation marks, no box-drawing
   frames. Ever.
6. Never "unexpected token" alone; say what was found and, where the parser
   can know, what would have been legal.

## Source excerpt and alignment rules

- Line numbers in the gutter are right-aligned to the width of the widest
  number displayed, then padded with one space either side of `|`.
- Tabs are expanded to 4-column stops for rendering only; token positions
  remain 1-based code-point columns internally.
- East Asian Wide and Fullwidth characters count as 2 display cells;
  combining marks count as 0; everything else counts as 1. The renderer owns
  this width function and applies it identically to the excerpt and the
  caret row, which is what makes the caret exact on tabbed or CJK lines.
- If the offending token crosses a line boundary (unterminated string), the
  excerpt shows the opening line and the caret runs to the end of that line.
- Lines longer than 120 display cells are elided in the middle with `...`
  before rendering; caret arithmetic happens on the elided text so excerpt
  and caret stay aligned.

Example with a tab and a wide character (caret under `名`, two cells wide;
the tab before it expands to four cells and the caret still lands exactly
under the token):

```
error[E0304]: `+` cannot add int 1 and string "one"
  --> examples/wide.em:1:5
  |
1 |     名 + "one"
  |         ^

```

## REPL design

```
Ember 0.1.0 — type :help for commands
>> 1 + 2
= 3
>> let double = fn(n) { n * 2 }
>> double(21)
= 42
>> print("hi")
hi
>> let xs = [1, 
.. 2]
```

- Input prompt `>> `, continuation prompt `.. `. Both use the `prompt`
  role; the continuation prompt uses the dimmer `promptCont` variant.
- Evaluation results are echoed on their own line prefixed `= ` in the
  `result` role, using repr formatting (strings quoted). A result of `null`
  echoes nothing — declarations and assignments stay quiet.
- Output from `print()` is plain, unprefixed, so captured program output is
  copy-paste honest.
- Multi-line: input buffers until it parses. Only the `unexpected end of
  input` error (E0202) triggers continuation; any other error flushes the
  buffer and renders the diagnostic against the whole buffered text so
  line numbers are correct. An empty line clears the buffer; Ctrl-C cancels
  it without leaving the REPL.
- History is per-session (arrow keys); Ember does not write files outside
  its invocation.
- Commands, colon-prefixed: `:help`, `:tokens CODE`, `:ast CODE`,
  `:env`, `:reset`, `:exit` (`:quit` alias, Ctrl-D equivalent).
- Tab completion offers identifiers in scope, builtin names, and commands
  when the word starts with `:`.
- Errors render through the same renderer as script mode with filename
  `<repl>`.
- Banner states the version and points at `:help`; no emoji, no exclamation.

## Colour system

Colour encodes meaning only — severity, location, the caret, prompts,
results. It is never decorative. Severity is always also carried by the
word itself.

Semantic roles mapped to SGR codes (16-colour palette only; Ember never
emits truecolor sequences, so output degrades cleanly on 16-colour and
legacy terminals):

| Role | dark theme | light theme | Used for |
| --- | --- | --- | --- |
| `error` | `\e[1;31m` bold red | `\e[31m` red | severity label, internal errors |
| `warning` | `\e[1;33m` bold yellow | `\e[33m` yellow | future warnings |
| `help` | `\e[32m` green | `\e[32m` green | help lines |
| `literal` | `\e[36m` cyan | `\e[34m` blue | backticked terms in messages |
| `caret` | `\e[31m` red | `\e[31m` red | the caret row |
| `gutter` | `\e[90m` bright black | `\e[90m` bright black | line numbers, `|`, `-->` |
| `result` | `\e[96m` bright cyan | `\e[94m` bright blue | REPL `= value` echo |
| `prompt` | `\e[35m` magenta | `\e[35m` magenta | `>> ` |
| `promptCont` | `\e[90m` bright black | `\e[90m` bright black | `.. ` |

Both themes are defined in ONE token table (`src/diag/theme.js`); no ANSI
codes appear anywhere else in the codebase. Exactly two themes exist because
there are exactly two common terminal backgrounds; a language CLI does not
need a theme gallery.

### Selection and degradation

First match wins:

1. `--no-color` flag — colour off.
2. `NO_COLOR` present and non-empty in the environment — colour off.
3. `TERM=dumb` — colour off.
4. Output stream is not a TTY (pipe, redirect, CI capture) — colour off.
5. Otherwise colour on, theme chosen by `--theme`, else `EMBER_THEME`,
   else `dark`.

Unknown `--theme` values fall back to `dark` with a one-line warning on
stderr naming the valid choices. Colour-off mode still renders excerpts and
carets — structure survives, decoration does not.
