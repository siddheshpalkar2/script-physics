<img src="frontend/public/scriptphysics-logo.svg" alt="ScriptPhysics AI logo" width="96" />

# ScriptPhysics AI: Screenplay Production-Physics & Line-Budget Compiler
### Built for Google Cloud AI Builder Cup 2026 (Track: Media, Content & Digital Experiences)

**ScriptPhysics AI** is an "IDE for Showrunners & Line Producers" that treats screenplays like source code—compiling natural-language scenes into deterministic physical shoot budgets, union schedule penalties, multimodal location scout risk audits, and budget-preserving script rewrites powered by **Gemini 2.5 Flash & Pro** on **Google Cloud Run** and **Firebase**.

---

## Architecture Highlights
1. **Semantic Extraction (`gemini-2.5-flash`) + Deterministic Math Engine:** Eliminates LLM arithmetic hallucinations. Gemini extracts structured physical production multipliers (`SceneBreakdownSchema`), while a deterministic regional rate-card engine computes exact costs across **Mumbai, Singapore, Tokyo, and Seoul**.
2. **Multimodal Location Scout Auditor (`gemini-2.5-pro`):** Users upload up to 3 candidate location photos per scene. Each one is checked against the scene's time of day, action and dialogue to flag hazards such as blackout tenting, HMI rigging and acoustic ADR. The model names each hazard and its severity, and the city rate card prices it. The chosen location's cost is added to the scene budget.
3. **Budget-Preserving Rewrite Engine (`gemini-2.5-pro`):** Rewrites expensive scene blocking using proven filmmaking containment techniques (post-rain wet-downs, tight telephoto compression, off-screen acoustic implication), targeting a **60%** cost cut while keeping at least 95% of the dialogue. Users can edit the rewrite and re-price it.

## Features
- **Google sign-in.** Each user's work is private, and Firestore security rules enforce it.
- **Projects.** Create a **film** or a **web series** with a default shoot city, then add scenes to it. Series scenes carry a **season and episode**. The project page rolls up the budget per episode, per season and for the whole project.
- **Your own scenes.** Paste any scene. Set, time of day, speaking cast and extras are optional: when you fill them in, your values replace the AI's.
- **Local currency.** Budgets are shown in the shoot city's currency (₹, S$, ¥, ₩), with USD as a reference.
- **Input guardrails.** The server checks that the text is one real screenplay scene: a scene heading, sensible length, no prompt injection. Every cost item must quote the script.

---

## Quick Start (Local Development)

### 1. Run the FastAPI + Gemini Backend
```bash
cd backend-cloud-run
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
pip install -r requirements.txt
export GEMINI_API_KEY="your_google_ai_studio_key"
export FIREBASE_PROJECT_ID="your-firebase-project"   # used to verify sign-in tokens
python test_budget.py   # assert-based self-check of the budget, guardrail and location math
uvicorn main:app --reload --port 8080
```

**Local LLM instead of Gemini (dev):** with Ollama running, `export LLM_PROVIDER=ollama` (and optionally `OLLAMA_MODEL`, default `gemma4:31b-cloud`, and `OLLAMA_URL`, default `http://localhost:11434`). You don't need `GEMINI_API_KEY` in this mode. The model must support vision for location scouting; `gemma4` does. Check which model is active at `http://localhost:8080/health`.

### 2. Run the React / Vite Frontend IDE
```bash
cd frontend
npm install
cp .env.example .env   # Firebase console > Project settings > Web app config
npm run dev            # proxies /api to localhost:8080
```

In the Firebase console:
1. Enable **Authentication > Sign-in method > Google**.
2. Create a **Firestore** database.
3. Publish the security rules: paste `frontend/firestore.rules` into **Firestore > Rules** and click **Publish**, or run `firebase deploy --only firestore:rules`. **Without this, saving fails with "Missing or insufficient permissions."** Republish whenever the rules file changes.

---

## One-Command Google Cloud Run & Firebase Deployment

### Deploy Backend to Google Cloud Run
Store the Gemini key in Secret Manager once (the Cloud Run service account needs the *Secret Manager Secret Accessor* role):
```bash
printf "your_gemini_key" | gcloud secrets create gemini-api-key --data-file=-
```

`backend-cloud-run/.gcloudignore` keeps `venv/`, `.env` and tests out of the upload.
```bash
cd backend-cloud-run
gcloud run deploy script-physics-api \
  --source . \
  --region asia-southeast1 \
  --allow-unauthenticated \
  --set-env-vars="FIREBASE_PROJECT_ID=your-firebase-project" \
  --set-secrets="GEMINI_API_KEY=gemini-api-key:latest" \
  --memory 1Gi
```

### Deploy Frontend to Firebase Hosting
This needs the Firebase CLI (`npm i -g firebase-tools && firebase login`). `frontend/.firebaserc` already points at the project.
```bash
cd frontend
npm run build
firebase deploy --only hosting,firestore:rules
```
