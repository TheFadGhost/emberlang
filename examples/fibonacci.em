# fibonacci.em — recursion vs memoisation.
#
# Plain recursion recomputes the same values over and over; keeping a map
# of finished answers makes each subproblem run once.

# Naive: exponential blow-up past n = 35 or so.
fn fib(n) {
  if n < 2 {
    return n
  }
  return fib(n - 1) + fib(n - 2)
}

# Memoised: a map keyed by str(n), because Ember map keys are strings.
# get(m, k, default) returns a default instead of raising on a miss.
let cache = {}

fn fibm(n) {
  let hit = get(cache, str(n), null)

  # Only false and null are falsy in Ember, and fib(0) is 0, so we
  # compare against null explicitly instead of trusting truthiness.
  if hit != null {
    return hit
  }

  let v = 0
  if n < 2 {
    v = n
  } else {
    v = fibm(n - 1) + fibm(n - 2)
  }

  # Index assignment works on maps too: cache["10"] stores under that key.
  cache[str(n)] = v
  return v
}

print("fib(20) =", fib(20))
print("fibm(40) =", fibm(40))
