# Project Management MVP

Kanban board with an AI chat sidebar. FastAPI serves the API and the static NextJS site from one container.

## Requirements

- Docker with Compose
- An `.env` in the project root containing `OPENROUTER_API_KEY`

## Run

Windows:

```powershell
.\scripts\start.ps1
```

Mac and Linux:

```bash
./scripts/start.sh
```

Then open http://localhost:8000

## Stop

```powershell
.\scripts\stop.ps1
```

```bash
./scripts/stop.sh
```

Pass `--volumes` to also delete the database.

## Tests

Backend, runs in a container so no local Python is needed:

```powershell
.\scripts\test-backend.ps1
```

Frontend. The e2e tests run against the served app, so start the container first:

```bash
cd frontend
npm install
npx playwright install chromium
npm run test:unit
npm run test:e2e
```

## Local development

Hot reload for both halves. Requires Node and [uv](https://docs.astral.sh/uv/getting-started/installation/) installed locally. Backend on 8000, frontend on 3000.

```powershell
.\scripts\dev.ps1
```

```bash
./scripts/dev.sh
```

## Notes

The AI uses OpenRouter with `nvidia/nemotron-3.5-lightning:free`. Free-tier models are rate limited, so the test suites mock the AI call and only opt-in tests hit the live API.

Planning documents are in `docs/`. The database design is in `docs/DATABASE.md`.
