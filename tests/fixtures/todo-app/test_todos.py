"""Run with: python3 -m unittest"""

import unittest

from todos import TodoList


class TodoListTests(unittest.TestCase):
    def test_add_and_list(self):
        todos = TodoList()
        todos.add("buy milk")
        self.assertEqual(todos.all(), [{"title": "buy milk", "done": False}])

    def test_empty_title_is_rejected(self):
        with self.assertRaises(ValueError):
            TodoList().add("   ")

    def test_complete_marks_done(self):
        todos = TodoList()
        todos.add("buy milk")
        todos.complete(1)
        self.assertTrue(todos.all()[0]["done"])

    def test_remove_first(self):
        todos = TodoList()
        todos.add("buy milk")
        todos.add("walk dog")
        todos.remove(1)
        self.assertEqual([t["title"] for t in todos.all()], ["walk dog"])

    def test_remove_last(self):
        todos = TodoList()
        todos.add("buy milk")
        todos.add("walk dog")
        todos.remove(2)
        self.assertEqual([t["title"] for t in todos.all()], ["buy milk"])


if __name__ == "__main__":
    unittest.main()
