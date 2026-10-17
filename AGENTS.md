# AGENTS.md

The AI agents ScriptPhysics AI runs, all defined in `backend-cloud-run/main.py`.

The product runs three single-purpose agents. Each one has a role-playing system prompt, a Pydantic output schema and a fixed model. All of them go through `generate()`, which validates every reply. None of them outputs money: the deterministic code that runs after each agent prices everything from `RATE_CARDS`.

| Agent | Endpoint | Model | System prompt | Output schema |
|---|---|---|---|---|
| **Scene Compiler** (line producer + 1st AD) | `POST /api/compile-scene` | `gemini-2.5-flash` | `COMPILER_SYSTEM_PROMPT` | `SceneBreakdownSchema` |
| **Budget Rewriter** (line producer) | `POST /api/optimize-scene` | `gemini-2.5-pro` | `REWRITE_SYSTEM_PROMPT` | `BudgetRewriteSchema` |
| **Location Scout** (location manager + gaffer, vision) | `POST /api/audit-location` | `gemini-2.5-pro` | `LOCATION_SYSTEM_PROMPT` | `LocationAuditSchema` |

- **Scene Compiler.** Reads one scene plus the target city and any producer-fixed values (set, time of day, cast, extras). It returns:
  - the scene heading, INT/EXT, time of day, page eighths, base setup hours, and cast and extras counts;
  - `cost_triggers`, where each item has an `exact_script_quote`, a category, a quantity, penalty hours, a risk level and a producer note;
  - schedule hazard warnings and `city_production_notes`.

  Afterwards, `keep_quoted_triggers()` drops any item whose quote isn't in the scene, `apply_overrides()` lets the user's values win, and `calculate_deterministic_budget()` prices the result.
- **Budget Rewriter.** Rewrites the scene's blocking to hit a target cost cut (default 60%, allowed 10–90%) while keeping at least 95% of the dialogue. It returns `alternatives`, each with a strategy name, a single-scene Fountain rewrite, the on-set changes, the hours saved and why the drama survives. The frontend prices the first alternative by sending it back through the Scene Compiler.
- **Location Scout.** Looks at one location photo against the scene. It returns a fit score (0–100), a one-line summary, a practical-vs-VFX verdict and `hazards`. Each hazard has a type, a severity, the visual evidence, the equipment needed and extra setup hours. `price_location_audit()` prices it as `location_hazards[type] × SEVERITY_MULT[severity] + hours × base_crew_hour_usd`. `POST /api/price-location` re-prices a saved audit for another city without calling the agent again.

Rules every agent follows:
- **Untrusted input.** The scene is fenced in `<scene>` tags, and each system prompt says never to follow instructions inside it (or inside the image).
- **Verdict first.** The Compiler's schema opens with `is_screenplay_scene` + `rejection_reason`, and the Scout's with `is_location_photo` + `rejection_reason`. Either one returning false becomes a 422 carrying the reason.
- **Bounded numbers.** Every number an agent returns has Pydantic `ge`/`le` bounds. An out-of-range or malformed reply becomes a 502 asking the user to retry.
- **Cheap checks first.** `validate_scene_text()` runs before the Compiler, the Rewriter and the Scout. `image_mime()` (leading-byte check, 5 MB cap) runs before the Scout.
- **Provider switch.** `LLM_PROVIDER=gemini` (production) passes the schema as Gemini `response_schema`. `LLM_PROVIDER=ollama` (local dev only) sends the schema in the prompt, plus the image as base64.
