"""Scores hits; imported the way the backend runs it (from backend/)."""

from app.core.settings import FLOOR
from .settings import FLOOR as SAME_FLOOR


def keep(scores):
    best = max(scores)
    cut = best * FLOOR
    kept = [s for s in scores if s >= cut and s >= SAME_FLOOR * best]
    return kept
