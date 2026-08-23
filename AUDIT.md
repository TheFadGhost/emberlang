# AUDIT.md

Independent audits performed before v1.0.0 by agents that wrote none of the
code: one cold code review, one cold diagnostics review that triggered every
error code and checked rendering against DESIGN.md. Findings are fixed in
place; status updates below. Suite state at audit time: 263/263 green.

## Round 1 findings

### Crash-class (all confirmed: RangeError escaped as `internal[E9901]`)

| # | Finding | Status |
| --- | --- | --- |
| 1 | `parseUnary` recurses without the depth guard; 100k `-` chain crashes host and is mislabelled "a bug in Ember" | FIXED: unary chains now count against the nesting limit and raise E0206 |
| 2 | Deeply nested blocks/statements (`{`×5000) recurse unguarded in `parseBlock`; same crash | FIXED: statement nesting counts against the limit, E0206 |
| 3 | `values.equals` recurses unguarded; cyclic or 20k-deep structures crash `==`/`contains` | FIXED: iterative worklist with pair-cycle detection |
| 4 | `min`/`max` use argument spread; `min(range(200000))` crashes | FIXED: plain loop |

### Wrong-behaviour

| # | Finding | Status |
| --- | --- | --- |
| 5 | Parser accepts malformed parameter lists (`fn f(a,,b)`), contradicting SPEC | FIXED: comma must be followed by a parameter or `)` |
| 6 | Anonymous function arity error renders empty backticks | FIXED: `<anon>` fallback |
| D2 | Caret collapses onto the elision marker on >120-cell lines (remap applied after clamping) | FIXED: remap raw columns first, then clamp; regression test added |

### Diagnostic-contract drift

| # | Finding | Status |
| --- | --- | --- |
| 7 / D1 | No blank line after diagnostic blocks, violating DESIGN.md | FIXED: renderer emits it; snapshots updated |
| 8 / D6 | `internal[E9901]` severity label never coloured (no such role) | FIXED: internal maps to the error role |
| D5 | Unknown-theme warning written to stdout, DESIGN says stderr | FIXED |
| D3/D4/#16 | Two help lines missing terminal periods (E0301, E0304 conversion) | FIXED |
| 18 | DESIGN showed `internal error[E9901]` while code prints `internal[E9901]` | FIXED: doc aligned to the uniform severity[code] pattern |
| — | DESIGN before/after example had an off-by-one gutter pad | FIXED |
| E0204 rule-6 | "invalid assignment target" said neither what was found nor what is legal | IMPROVED: help now shown for every bad target kind |

### Language/lexer

| # | Finding | Status |
| --- | --- | --- |
| 19 | `9e999` lexed to Infinity silently; sibling string conversion rejects non-finite | FIXED: E0103 on non-finite literals |

### CLI

| # | Finding | Status |
| --- | --- | --- |
| 20 | Meaningless flag combos silently swallowed (`repl --ast`, `run --tokens --ast`) | FIXED: usage errors, exit 2 |
| 7 | Dead `if (!Interpreter)` block after static-import cleanup | REMOVED |

### Dead code and duplication

| # | Finding | Status |
| --- | --- | --- |
| 8 | `firstSpan` identity indirection in ast.js | REMOVED |
| 9 | `Env.has` never called | REMOVED |
| 10 | Ten `callNode.filePath ?? null` lookups that are always null | REMOVED; front-end stamping documented as the convention |
| 11 | `MAX_RANGE` defined twice | SINGLE SOURCE in values.js |
| 12 | Span plumbing implemented four times | CONSOLIDATED: errors.asSpan reused where signatures match |
| 13 | Argument pluralization duplicated | SHARED argWord in errors.js |
| 14 | filePath-backfill duplicated in cli.js and repl.js | SHARED via renderError defaultPath parameter |
| 15 | REPL rebuilt the builtin-name table on every Tab press | FIXED: computed once |

## Round 2

Re-audit after fixes produced zero new findings (see git history for the
verification runs). Suite and golden tests re-run green afterwards.
