# hello.em — the smallest interesting Ember program.
# `print` space-joins its arguments and finishes the line for you.

print("Hello from Ember")

# Statements self-delimit, so two `let`s can sit side by side with no
# separator; newlines are purely for humans.
let a = 6 let b = 7

# + - * / work on numbers, and string + string glues strings together.
print(a, "*", b, "=", a * b)
print("a + b is " + str(a + b))
