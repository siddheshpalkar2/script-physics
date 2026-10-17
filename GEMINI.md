# GEMINI.md

This file provides guidance to Gemini CLI and Antigravity when working with code in this repository. The product's AI agents are described in AGENTS.md.

## Project

ScriptPhysics AI is a hackathon entry for the Google Cloud AI Builder Cup 2026. It turns screenplay scenes into production budgets. Gemini pulls structured cost triggers out of the scene text, and a deterministic rate-card engine does the arithmetic, so the LLM never computes money.

## Commands

Backend (FastAPI, Python 3.11, `backend-cloud-run/`):
```bash
cd backend-cloud-run
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
export GEMINI_API_KEY="..." FIREBASE_PROJECT_ID="your-project"
# or, for local dev without Gemini: export LLM_PROVIDER=ollama  (OLLAMA_MODEL defaults to gemma4:31b-cloud)
uvicorn main:app --reload --port 8080
python test_budget.py   # assert-based check of the budget, guardrail and location math
```

Frontend (React 18 + Vite 5 + Tailwind 3, `frontend/`):
```bash
cd frontend
npm install
cp .env.example .env   # fill in the Firebase web config
npm run dev      # http://localhost:5173, proxies /api to :8080
npm run build    # outputs dist/ for Firebase Hosting
```

Deploy: `gcloud run deploy script-physics-api --source . --region asia-southeast1 ...` from `backend-cloud-run/`, then `firebase deploy --only hosting,firestore:rules` from `frontend/`. The full commands are in README.md.

The only test is `backend-cloud-run/test_budget.py`. There's no linter config.

## Architecture

- **Backend** (`backend-cloud-run/main.py`, single file):
  - It is the **only owner of rate cards and budget math** (`RATE_CARDS`, `calculate_deterministic_budget()`). The frontend just renders the `financials` it gets back.
  - All LLM calls go through `generate()`. `LLM_PROVIDER=gemini` (the default) passes the Pydantic schemas as Gemini `response_schema`. `LLM_PROVIDER=ollama` calls `OLLAMA_URL/api/chat` in JSON mode with the schema written into the system prompt, because cloud models ignore a schema in `format`. Either way the reply is validated with Pydantic, and a malformed reply returns 502.
  - `GET /api/rate-cards`: lists cities (name, currency) and needs no auth.
  - `POST /api/compile-scene` (form fields `scene_text`, `region_hub`, plus optional overrides `int_ext`, `time_of_day`, `speaking_cast_count`, `background_extras_count`): `gemini-2.5-flash` extracts the breakdown and the `city_production_notes`, `apply_overrides()` makes the user's values win, then the budget is priced in USD and in the city's local currency. An unknown hub returns 400.
  - `POST /api/optimize-scene`: the rewrite model (`GEMINI_SMART_MODEL`, default `gemini-3.1-pro-preview`) returns rewrite alternatives.
  - Both POST endpoints require `Authorization: Bearer <Firebase ID token>`, which `verify_user` checks. There's no CORS middleware: production is same-origin through the Hosting rewrite, and dev goes through the Vite proxy.
  - `POST /api/audit-location` (multipart `image`, `scene_text`, `region_hub`): a vision model (`GEMINI_SMART_MODEL`, default `gemini-3.1-pro-preview`, or the Ollama model) audits a location photo against the scene. `image_mime()` checks the file's leading bytes and a 5 MB cap. The `is_location_photo` verdict rejects non-locations. It returns `{audit, pricing}`.
  - `POST /api/price-location` (JSON `{audit, region_hub}`): re-prices a saved audit for another city deterministically, with no LLM call.
- **Gemini models are environment settings.** `GEMINI_FAST_MODEL` (Scene Compiler, default `gemini-2.5-flash`) and `GEMINI_SMART_MODEL` (Rewriter and Scout, default `gemini-3.1-pro-preview`). Pro needs a credit-funded key, and `gemini-2.5-pro` is closed to new keys. Without credits, set `GEMINI_SMART_MODEL=gemini-2.5-flash` with `--set-env-vars`. `gemini_client()` keeps one lock-guarded client per process, because `genai.Client.__del__` closes the connection. Gemini 402 (credits depleted), 429 and 5xx errors become clear 503/429 responses.
- **Frontend** (`frontend/src/App.jsx`, `src/Projects.jsx`, `src/firebase.js`):
  - Google sign-in (Firebase Auth) gates the app. There are three views, held in state with no router: **Projects** (`ProjectList`) → **Project** (`ProjectOverview`: budget rollups, with Season › Episode › Scene nesting for series, with add, rename and delete at each level) → **Scene** (`SceneWorkspace` in App.jsx).
  - In the scene view, the user pastes a scene, sets optional overrides and a city (the project's default city is preselected), then selects Estimate. Changing the city recompiles, because the notes are city-specific. If only the season or episode changes, the scene is re-saved without an LLM call.
  - `EXAMPLE_SCENES` are script-only starters. The Location scout tab uploads up to 3 candidate photos per scene, compressed in the browser by `compressImage()`, and the chosen one is added to the scene budget.
- **Firestore layout** (rules in `frontend/firestore.rules`, owner-only):
  - `users/{uid}/projects/{pid}`: `{title, type: FILM|SERIES, defaultHub, seasons, createdAt, updatedAt}`. The type can't change after creation.
  - For a series, `seasons: [{number, title, episodes: [{number, title}]}]` is the hierarchy the user builds (Add season → Add episode → Add scene), so empty seasons and episodes persist. Scenes point into it through their `season`/`episode` ints. `seasonsOf()` in Projects.jsx merges the array with any numbers found only on scenes (series created before seasons were explicit). Numbers are never reused or compacted after a delete. Deleting a season or episode deletes its scenes and their locations through `deleteScenes()`.
  - `users/{uid}/projects/{pid}/scenes/{sid}`: `{title, season, episode (ints for SERIES, null for FILM), form, hub, result, revised, appliedRewrite, totalUsd, createdAt, updatedAt}`.
  - `totalUsd` is the total of the version that counts (the applied rewrite, else the original, via `countedOf()`) **plus `locationUsd`**, the chosen location's prep cost. Project cards `sum()` it server-side, so every scene write has to keep it in sync through `persist()`.
  - `.../scenes/{sid}/locations/{lid}`: `{name, image (1024px JPEG data URL, about 150 KB), audit, pricing, createdAt}`, with at most 3 per scene. The scene doc holds `chosenLocationId`, `locationName` and `locationUsd`. Firestore doesn't cascade deletes, so `deleteScene()` and project delete remove these explicitly.
- **Firebase Hosting** (`frontend/firebase.json`) rewrites `/api/**` to the Cloud Run service `script-physics-api` in `asia-southeast1`. Always call relative `/api/...` paths.

### Invariants to keep in sync

- **The enum values are shared:** cost-trigger `category`, `risk_level`, `time_of_day`, `int_ext` and `hazard_type` are Pydantic `Literal`s in the backend and plain string keys in the frontend (`CATEGORY_STYLE`, `INT_EXT_LABEL`, `TIME_LABEL`, ...).
- **Script highlighting depends on exact quotes.** `exact_script_quote` must be an exact substring of the scene text. `splitByQuotes()` splits the script on each quote to draw clickable spans, so a quote that doesn't match exactly is never highlighted.
- **Scene-input guardrails run in layers, all on the server:**
  - `validate_scene_text()` runs before any LLM call: 60 to 12,000 characters, the text starts with a slugline, only one slugline, real action or dialogue below it, no control characters, mostly letters.
  - The LLM's `is_screenplay_scene` / `rejection_reason` verdict rejects prose, recipes and prompt injection. The scene is fenced in `<scene>` tags and marked as untrusted.
  - Pydantic `ge`/`le` bounds apply to every LLM number and to the override fields.
  - `keep_quoted_triggers()` drops cost items whose quote isn't in the scene, and adds a visible note when it does.
  - The limits `SCENE_MIN_CHARS`, `SCENE_MAX_CHARS`, `MAX_CAST` and `MAX_EXTRAS` are mirrored as constants at the top of `App.jsx`, but only for the textarea and input attributes. Change both together.
- **Location money comes from the rate card, not the LLM.** The model returns only `hazard_type`, `severity` and `extra_setup_hours`. `price_location_audit()` computes each hazard as `location_hazards[type] × SEVERITY_MULT[severity] + hours × base_crew_hour_usd`. The `location_hazards` rates are placeholders scaled from Mumbai.
- **Saved scenes store server output.** In scene docs, `result` and `revised` are the raw `/api/compile-scene` responses (plus `scene_text`, and `alt` for the rewrite). If you rename response fields, old saved scenes will render with gaps. All scene writes go through `persist()` in `SceneWorkspace`.
