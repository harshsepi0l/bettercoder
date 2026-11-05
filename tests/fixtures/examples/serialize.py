import json

person = {"name": "Ada", "age": 36}
text = json.dumps(person)
back = json.loads(text)
print(text)
