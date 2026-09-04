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

The live OpenRouter tests are excluded from that run. To make a real API call:

```powershell
.\scripts\test-ai.ps1
```

```bash
./scripts/test-ai.sh
```

Frontend. The e2e tests run against the served app, so start the container first:

```bash
cd frontend
npm install
npx playwright install chromium
npm run test:unit
npm run test:e2e
```

The live chat e2e is tagged `@live` and skipped unless `LIVE_AI=1`. On Windows the `@` has to be quoted:

```powershell
$env:LIVE_AI=1; npm run test:e2e -- --grep '@live'
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

The AI uses OpenRouter with `nvidia/nemotron-3.5-lightning:free`.

Free model variants are rate limited per account: 20 requests a minute, and 50 a day unless the account has bought at least 10 dollars of credits at some point, which raises the daily cap to 1000. Exceeding either returns a 429. Because of that the test suites mock the AI call, and only the opt-in `test-ai` scripts hit the live API.

Asking the AI to change the board is slow, around 90 seconds, because it rewrites the whole board to make one change. Questions that do not change anything come back in a few seconds.

Planning documents are in `docs/`. The database design is in `docs/DATABASE.md`.
