from app.domain import Patent
from app import domain


def list_patents():
    return [Patent(title="x", year=2020)]


def first_article():
    return domain.Article(title="y")


def unfinished():
    raise NotImplementedError
