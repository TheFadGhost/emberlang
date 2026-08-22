# PLAN.md

Ember is a small dynamically typed language with a hand-written lexer, a
recursive-descent parser, and a tree-walking interpreter. Its purpose is to be
a legible reference implementation for people learning how languages are made.
Every proposed feature below was judged against three tests:

1. Does it serve the core purpose — a legible language implementation?
2. Can it be finished to the same quality bar as the core?
3. Does it avoid expanding Ember into a second product?

A bytecode VM, a type checker, and a package manager are all second products
and are rejected on sight.

## Accepted

Accepted items are first-class features under the same build loop, testing
rules, and audit as the core.

| Feature | Why accepted |
| --- | --- |
| `--tokens` / `--ast` CLI modes | Mirror the REPL commands so the pipeline can be studied from scripts; a few dozen lines over existing dump code. |
| Colourised diagnostics with `--no-color`, `NO_COLOR`, and TTY detection | Diagnostics are the primary user interface of a language; degradation rules make them safe everywhere (see DESIGN.md). |
| Two themes (dark, light) selected by `--theme` or `EMBER_THEME` | A palette tuned for dark terminals is unreadable on light ones; two themes is the whole honest set, defined as one token table. |
| Tab completion in the REPL | Small with readline's completer hook; helps learners discover builtins and bindings; directly serves exploration. |
| Call tracing via `--trace-calls` | Prints call/return lines indented by depth; makes the evaluation model visible; a tiny hook in one function. Step debugging was rejected, but this reduced form earns its keep. |
| Arity mismatch messages showing expected vs received at the call site | This is the diagnostics quality bar applied to the most common runtime mistake; not a separate product. |
| SPEC.md language specification | Serves legibility directly; the spec is part of teaching what the language is. |
| TextMate grammar for one editor (`editors/ember.tmLanguage.json`) | One static file usable by VS Code and other TextMate hosts; makes Ember feel real without an extension-hosting project. |
| `break` and `continue` | Loops without them force awkward flags; small parser/evaluator cost, big readability gain in examples. |
| Compound assignment `+= -= *= /= %=` | Common expectation, trivial desugaring, keeps example programs idiomatic. |
| `argv` binding for scripts | Scripts need arguments; one array bound before execution. |
| `ask()` builtin reading a line from stdin | The text adventure needs input; also demonstrates embedding I/O through builtins only. |

## Rejected

| Feature | Why rejected |
| --- | --- |
| Bytecode VM / compiler backend | Second product; replaces the tree walker that learners come to read. |
| Type checker or gradual types | Second product; dynamic typing with clear runtime errors is the design point. |
| Package manager, module/import system | Second product; single-file programs keep every part of the pipeline studyable. |
| Formatter (`ember fmt`) | Real quality needs layout decisions, idempotence tests, and opinion wars; a weak formatter teaches bad habits. Deferred until the language itself is stable. |
| Full step-through debugger | Second product; the reduced `--trace-calls` covers the pedagogical need. |
| LSP server | Second product; belongs after v1 if ever. |
| Classes/OOP | Object model via maps plus closures already demonstrates the ideas; classes would double the evaluator surface. |
| String interpolation | Lexer/parser/escape interaction grows sharply for sugar; concatenation with `+` stays explicit. |
| Lambda arrow sugar `fn(x): e` | One grammar for functions keeps the parser honest; block form already works inline. |
| Method-call syntax (`s.upper()`) | Builtins-as-functions keep the evaluator free of method-resolution machinery. |
| Membership operator `x in xs` expression form | Keeps the operator table minimal; `contains()` covers the need. |
| Negative indexing | Explicitness beats cleverness; out-of-range errors stay unambiguous. |
| Ternary operator | `if/else` statements suffice; one conditional syntax. |
| Cross-session REPL history file | Writes user disk state for marginal gain; in-session history suffices. |
| More than two colour themes | A language CLI does not need a theme gallery (see DESIGN.md). |
| Tail-call optimisation | Belongs to a compiler, not a tree walker; the recursion limit error is honest instead. |

## Build loop

Per feature: implement, run, test, fix, commit, push. Done means passing.
Each fix round names the specific defect being fixed before fixing it. If six
consecutive rounds pass with no new concrete defect named, that is logged in
BLOCKERS.md and work moves elsewhere. Regression gate: the full suite plus
every example program re-run before any change is accepted.
