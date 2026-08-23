# Ember

Ember is a small dynamically typed programming language with a hand-written
lexer, recursive-descent parser, tree-walking interpreter, and REPL, built as a
legible reference implementation for people learning how languages are made.

## Install

Ember needs Node >= 18 and has no dependencies. Clone the repository and run
everything through `node bin/ember.js`:

```
git clone <your-fork-url> emberlang
cd emberlang
node bin/ember.js help
```

Optionally run `npm link` inside the clone to get an `ember` command on your
PATH.

## A first program

Save this as `tmp/demo.em`:

```
let temps = [21, 14, 30, 18]

fn mean(xs) {
  let total = 0
  for t in xs { total += t }
  return total / len(xs)
}

print("readings:", len(temps), "values")
print("mean:", mean(temps))
```

Running it:

```
$ node bin/ember.js run tmp/demo.em
readings: 4 values
mean: 20.75
```

## The REPL

Pipe three lines into the REPL (input is not a terminal here, so prompts are
omitted from the transcript):

```
let double = fn(n) { n * 2 }
double(21)
:env
```

```
Ember 0.1.0 — type :help for commands
= 42
argv = []
double = <fn>
```

Results echo after `=`; declarations echo nothing; `:env` lists bindings in
scope (`double` shows as `<fn>` because function expressions carry no name).
Run `node bin/ember.js repl` interactively for prompts, tab completion, and
`:tokens` / `:ast` inspection commands.

## Errors

Diagnostics point at the exact token and offer one help line. This program
misspells a variable:

```
let greeting = "hi"
print(gretng)
```

Captured stderr with colour disabled (`--no-color`; `NO_COLOR` and non-TTY
output also disable it):

```
$ node bin/ember.js run --no-color tmp/broken.em
error[E0301]: undefined variable `gretng`
  --> tmp/broken.em:2:7
  |
2 | print(gretng)
  |       ^^^^^^
  |
help: variables must be declared before use with `let`.

```

The location line echoes the path exactly as you passed it, separator and
all. Exit codes:
0 success, 2 usage error or unreadable file, 65 syntax error, 70 runtime error.

## Language tour

**Bindings.** `let` declares; plain assignment updates an existing binding,
and assigning to an undeclared name is an error.

```
let x = 10
x = x + 5
let s = "a" + "b"
print(x, s)
```

```
15 ab
```

**Control flow.** Braces are mandatory, conditions take no parentheses, and
`for ... in` iterates arrays, strings, maps (keys), and ranges. `1..4` is the
half-open range `[1, 2, 3]`.

```
let n = 7
if n % 2 == 0 {
  print("even")
} elif n > 0 {
  print("odd and positive")
} else {
  print("negative")
}
for i in 1..4 { print(i) }
```

```
odd and positive
1
2
3
```

**Functions and closures.** Functions are values; a `fn` expression captures
its defining environment, so state survives between calls.

```
fn makeCounter() {
  let n = 0
  return fn() {
    n += 1
    return n
  }
}
let tick = makeCounter()
tick()
print(tick())
```

```
2
```

**Collections.** Arrays and maps mutate in place through indexing plus
`push`, `pop`, and the rest of the builtin library.

```
let xs = [3, 1, 2]
push(xs, 9)
let m = {"name": "ember", "stars": 2}
m["stars"] += 1
print(xs[1:], m["name"], len(m))
```

```
[1, 2, 9] ember 2
```

**Strings.** Immutable, indexed by code points, worked on with the string
builtins.

```
let s = " Ember "
print(trim(s) + "-lang")
print(upper("lang"), chars("ab"), join(split("a-b", "-"), "."))
```

```
Ember-lang
LANG ["a", "b"] a.b
```

One rule surprises people coming from C-family languages: only `false` and
`null` are falsy. Everything else is truthy, including `0` and `""`.

```
if 0 or "" {
  print("only false and null are falsy")
}
```

```
only false and null are falsy
```

## How it fits together

A program moves through three passes. `src/lexer.js` turns source text into
tokens, `src/parser.js` builds the syntax tree by recursive descent with
precedence climbing, and the interpreter in `src/interpreter.js` walks that
tree against chained environments (`src/interp/env.js`) holding the value
model of `src/interp/values.js`. Every failure becomes an `EmberError`
carrying a stable code and source span (`src/errors.js`), which flows through
the renderer in `src/diag/render.js` and the single theme table in
`src/diag/theme.js` to produce the blocks shown above; the same path serves
the CLI (`src/cli.js`) and the REPL (`src/repl.js`). DESIGN.md specifies the
diagnostic format and colours, SPEC.md specifies the language, and PLAN.md
records which features were accepted or rejected and why. Tests sit in
`test/` and run with `node --test`; golden-file tests compare full stdout of
program runs and diagnostic snapshots byte for byte.

## Examples

Runnable programs live in `examples/`:

- `hello.em` — a first program
- `fizzbuzz.em` — ranges and branching
- `fibonacci.em` — recursion and a memoized map
- `closures.em` — factory functions and loop capture
- `mapfilterreduce.em` — map/filter/reduce written in Ember itself
- `adventure.em` — a small text adventure driven by `ask()`

Every one is executed by the golden tests in `test/golden.test.js`, which
compare full stdout byte for byte.

## License

MIT. See LICENSE.
