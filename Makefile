.PHONY: install dev-api dev-worker dev-web test build

install:
	npm install
	npm run install:api

dev-api:
	cd apps/api && uv run uvicorn app.main:app --reload --port 8000

dev-worker:
	cd apps/api && uv run huey_consumer.py app.worker.huey -w 1 -k thread

dev-web:
	npm run dev:web

test:
	npm test

build:
	npm run build
