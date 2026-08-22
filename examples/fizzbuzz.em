# fizzbuzz.em — if/elif/else chains and for-in over a range.
#
# A range a..b is half-open: 1..16 counts 1 through 15. Ranges are
# materialised into plain arrays, so they work with any array tool.

for n in 1..16 {
  # % is remainder. Checking 15 first keeps "FizzBuzz" out of the
  # branches that only match 3 or 5 alone.
  if n % 15 == 0 {
    print(n, "FizzBuzz")
  } elif n % 3 == 0 {
    print(n, "Fizz")
  } elif n % 5 == 0 {
    print(n, "Buzz")
  } else {
    print(n)
  }
}
