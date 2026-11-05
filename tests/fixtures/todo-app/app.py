"""Run with: python3 app.py"""

from todos import TodoList

HELP = """Commands:
  add <title>     add a to-do
  list            show all to-dos
  done <number>   mark a to-do as done
  remove <number> delete a to-do
  quit            exit"""


def show(todos):
    if not todos.all():
        print("Nothing to do!")
        return
    for i, item in enumerate(todos.all(), start=1):
        mark = "x" if item["done"] else " "
        print(f"{i}. [{mark}] {item['title']}")


def main():
    todos = TodoList()
    print("To-do app. Type 'help' for commands.")
    while True:
        line = input("> ").strip()
        command, _, rest = line.partition(" ")
        try:
            if command == "add":
                todos.add(rest)
            elif command == "list":
                show(todos)
            elif command == "done":
                todos.complete(int(rest))
            elif command == "remove":
                todos.remove(int(rest))
            elif command == "help":
                print(HELP)
            elif command == "quit":
                break
            else:
                print("Unknown command. Type 'help'.")
        except (ValueError, IndexError) as error:
            print(f"Oops: {error}")


if __name__ == "__main__":
    main()
