.PHONY: dev dev-web dev-extractor test test-web test-extractor \
	typecheck typecheck-web typecheck-extractor lint lint-web lint-extractor

dev:
	$(MAKE) -j2 dev-web dev-extractor

dev-web:
	cd web && npm run dev

dev-extractor:
	cd extractor && uv run uvicorn app.main:app --reload --port 8000

test: test-web test-extractor

test-web:
	cd web && npm run test

test-extractor:
	cd extractor && uv run pytest

typecheck: typecheck-web typecheck-extractor

typecheck-web:
	cd web && npm run typecheck

typecheck-extractor:
	cd extractor && uv run ruff check .

lint: lint-web lint-extractor

lint-web:
	cd web && npm run lint

lint-extractor:
	cd extractor && uv run ruff check .
