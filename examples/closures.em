# closures.em — functions carry their birth environment with them.
#
# A function value remembers the scope where it was created, so a factory
# can hand out private counters: each call to makeCounter makes a new `n`.

fn makeCounter(start) {
  let n = start
  return fn() {
    n += 1
    return n
  }
}

let ticks = makeCounter(0)
let chimes = makeCounter(100)

# The two counters never see each other's `n`.
print("ticks:", ticks(), ticks(), ticks())
print("chimes:", chimes())

# for-in defines a FRESH binding per iteration, so every closure below
# captures its own copy of i. (One shared binding would make them all
# report the final value instead.)
let fns = []
for i in 1..4 {
  push(fns, fn() { i * i })
}

# Call each stored closure and collect the answers.
let squares = []
for f in fns {
  push(squares, f())
}
print("squares:", squares)
