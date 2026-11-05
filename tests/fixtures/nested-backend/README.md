Backend lives in `backend/` and imports itself as `app.*` (absolute) and `.settings` (relative),
like a FastAPI project run from `backend/`. Regression fixture for "No module named 'app'".
