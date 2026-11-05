from pydantic import BaseModel


class Patent(BaseModel):
    title: str
    year: int


class Article(BaseModel):
    title: str
