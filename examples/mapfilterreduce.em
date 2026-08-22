# mapfilterreduce.em — building the classic list tools in Ember itself.
#
# Ember has no built-in map/filter/reduce, but arrays, for-in loops and
# first-class functions are enough to write them. Each higher-order
# function takes its callback as an ordinary parameter.

fn map(xs, f) {
  let out = []
  for x in xs {
    push(out, f(x))
  }
  return out
}

fn filter(xs, keep) {
  let out = []
  for x in xs {
    if keep(x) {
      push(out, x)
    }
  }
  return out
}

fn reduce(xs, f, init) {
  let acc = init
  for x in xs {
    acc = f(acc, x)
  }
  return acc
}

# A small dataset: words go in, lengths come out, the total comes last.
let words = ["pear", "fig", "plum", "cherry", "kiwi"]
print("words:", words)

let lengths = map(words, fn(w) { len(w) })
print("lengths:", lengths)

# Anonymous fns are expressions: fn(params) { body }.
let longWords = filter(words, fn(w) { len(w) > 3 })
print("long words:", longWords)

let total = reduce(lengths, fn(acc, n) { acc + n }, 0)
print("total letters:", total)

# Chaining them reads like a pipeline.
let shoutyLong = map(filter(words, fn(w) { len(w) > 3 }), upper)
print("shouty:", shoutyLong)
