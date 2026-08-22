# adventure.em — a tiny text adventure.
#
# Shows maps holding maps: rooms[id]["exits"]["north"] names another room.
# ask(prompt) reads one line from stdin and returns null at end of input,
# so piping a script of commands into this file works just as well as
# typing them.

let rooms = {
  "clearing": {
    "name": "a sunlit clearing",
    "desc": "Soft grass and birdsong. Paths lead north and east.",
    "exits": {"north": "cave", "east": "bridge"}
  },
  "cave": {
    "name": "a cold cave",
    "desc": "Water drips in the dark. The clearing is back south.",
    "exits": {"south": "clearing"}
  },
  "bridge": {
    "name": "an old rope bridge",
    "desc": "The planks creak. A grove lies north, the clearing west.",
    "exits": {"north": "grove", "west": "clearing"}
  },
  "grove": {
    "name": "a hidden grove",
    "desc": "On the moss sits a stone that glows like an ember.",
    "exits": {"south": "bridge"}
  }
}

let current = "clearing"
let won = false
let wandering = true

print("Find the ember stone. Commands: look, go <way>, quit.")

while wandering {
  let room = rooms[current]
  print(room["name"])
  print(room["desc"])

  # Entering the grove is the win condition; leave the loop at once.
  if current == "grove" {
    print("You lift the ember stone. The quest is complete.")
    won = true
    break
  }

  let exits = room["exits"]
  print("Exits:", join(keys(exits), ", "))

  let line = ask("> ")
  if line == null {
    print("The mist closes in. Farewell.")
    break
  }

  # split on spaces, lowercase, dispatch on the first word.
  let parts = split(trim(line), " ")
  let cmd = lower(parts[0])

  if cmd == "" {
    continue
  } elif cmd == "quit" {
    print("Farewell.")
    break
  } elif cmd == "look" {
    continue
  } elif cmd == "go" {
    if len(parts) < 2 {
      print("Go where?")
    } else {
      let way = lower(parts[1])
      if contains(exits, way) {
        current = exits[way]
      } else {
        print("You cannot go that way.")
      }
    }
  } else {
    print("Try look, go <way>, or quit.")
  }
}

if not won {
  print("The stone remains unfound.")
}
