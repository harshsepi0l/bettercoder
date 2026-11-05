"""A tiny to-do list. Kept in memory while the app runs."""


class TodoList:
    def __init__(self):
        self.items = []

    def add(self, title):
        title = title.strip()
        if not title:
            raise ValueError("A to-do needs a title.")
        self.items.append({"title": title, "done": False})

    def all(self):
        return self.items

    def complete(self, number):
        # TODO: mark the to-do with this number (1 = first) as done.
        raise NotImplementedError("complete() is not written yet")

    def remove(self, number):
        """Remove the to-do with this number (1 = first)."""
        if number < 1 or number > len(self.items):
            raise IndexError("No to-do with that number.")
        del self.items[number]
