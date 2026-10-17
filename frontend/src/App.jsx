import React, { useState, useEffect } from "react";
import { AlertTriangle, Check, ImagePlus, MapPin, Pencil, RotateCcw, Trash2 } from "lucide-react";
import { onAuthStateChanged, signInWithPopup } from "firebase/auth";
import { addDoc, collection, deleteDoc, doc, getDoc, getDocs, orderBy, query, serverTimestamp, updateDoc } from "firebase/firestore";
import { HOME, parseLocation, urlOf } from "./nav";
import { auth, db, googleProvider } from "./firebase";
import {
  AppHeader, LogoMark, ProjectList, ProjectOverview, Wordmark, countedOf, episodeLabel, seasonsOf, deleteScene, millis, projectsRef, scenesRefOf, usd,
} from "./Projects";

// Starter scenes for "Load example"; budgets always come from the backend.
const EXAMPLE_SCENES = [
  {
    title: "Mumbai Monsoon Motorcycle Crash (High Weather & Stunt Risk)",
    hub: "MUMBAI_OTT",
    script: `EXT. MUMBAI MARINE DRIVE - NIGHT (HEAVY MONSOON)

Torrential monsoon rain lashes the seaside promenade. A crowd of 60 panicked commuters scrambles for cover as police sirens wail.

KABIR (30s, soaked, bleeding) weaves a vintage Royal Enfield motorcycle through stalled luxury sedans at 80 km/h.

KABIR
(screaming into comms)
If the drive leaves Nariman Point tonight, we lose the witness!

VOICE OVER COMMS (V.O.)
Cut the engine, Kabir! The seawall road is flooded!

Suddenly, a municipal water tanker jackknifes across the wet asphalt. Kabir locks his brakes—the vintage motorcycle fishtails and crashes violently through a glowing neon fruit stall, sending glass and mangoes flying into the street.`,
  },
  {
    title: "Tokyo Shibuya Golden-Hour Walk & Talk (Permit & Daylight Hazard)",
    hub: "TOKYO_OTT",
    script: `EXT. SHIBUYA SCRAMBLE CROSSING - SUNSET (GOLDEN HOUR)

The dying orange sun slices between giant 3D digital billboards. 150 Tokyo office workers surge across the intersection as the pedestrian light turns green.

KENJI (40s) and YUNA (20s) walk against the tide of the crowd, speaking in hushed, urgent tones as a golden retriever puppy pulls on Yuna's leash.

YUNA
The board voted at four o'clock. Your patent belongs to the conglomerate now.

KENJI
They bought the shell code, Yuna. Not the decryption key.

Above them, the giant billboard glitches—flashing Kenji's confidential biometric dossier across all five screens.`,
  },
];

// Industry breakdown-sheet colours, so a producer reads the highlights at a glance.
const CATEGORY_STYLE = {
  STUNTS_PYRO: { label: "Stunts & pyro", color: "#F59E42" },
  CROWD_EXTRAS: { label: "Extras", color: "#5DBB63" },
  VEHICLES_PICTURE_CARS: { label: "Picture vehicles", color: "#EC6FA8" },
  PROPS_CUSTOM: { label: "Props", color: "#9B7BDB" },
  WEATHER_FX: { label: "Weather effects", color: "#5B9BD5" },
  ANIMAL_WRANGLING: { label: "Animals", color: "#A47148" },
  VFX_CGI: { label: "Visual effects", color: "#3BB3B0" },
  PERMIT_LOCKDOWN: { label: "Permits & lockdown", color: "#8796A8" },
  NIGHT_PENALTY: { label: "Night premium", color: "#8796A8" },
};
const FALLBACK_CATEGORY = { label: "Other", color: "#8796A8" };

const RISK_LABEL = { LOW: "Low risk", MEDIUM: "Medium risk", HIGH: "High risk", CRITICAL: "Critical risk" };
const RISK_TEXT = {
  LOW: "text-graphite",
  MEDIUM: "text-graphite",
  HIGH: "text-amber-deep",
  CRITICAL: "text-[#BA1A1A] font-semibold",
};
const HAZARD_LABEL = {
  SET_DRESSING_CONVERSION: "Set dressing conversion",
  POWER_DISTRIBUTION: "Power distribution",
  LIGHTING_BLACKOUT: "Lighting blackout",
  ACOUSTIC_ADR: "Sound and ADR risk",
  LOAD_IN_ACCESS: "Load-in access",
  PERMIT_CROWD_CONTROL: "Permits and crowd control",
  WEATHER_EXPOSURE: "Weather exposure",
};
const INT_EXT_LABEL = { INT: "Int", EXT: "Ext", INT_EXT: "Int / Ext" };
const TIME_LABEL = { DAY: "Day", NIGHT: "Night", DUSK_DAWN: "Dusk / dawn", CONTINUOUS: "Continuous" };

// Stripboard convention: white INT day, yellow EXT day, blue INT night, green EXT night.
function stripColor(bd) {
  const ext = bd.int_ext !== "INT";
  if (bd.time_of_day === "NIGHT") return ext ? "#A7DBA7" : "#A9C9EE";
  if (bd.time_of_day === "DUSK_DAWN") return "#F6C8A0";
  return ext ? "#F7E58C" : "#FFFFFF";
}

const categoryOf = (t) => CATEGORY_STYLE[t.category] || FALLBACK_CATEGORY;

// minimal Fountain classifier (heading / cue / parenthetical / dialogue / action), swap for a real Fountain parser if scripts get transitions, dual dialogue or notes.
function classifyLines(text) {
  let afterCue = false;
  return text.split("\n").map((raw) => {
    const t = raw.trim();
    if (!t) {
      afterCue = false;
      return { text: t, kind: "blank" };
    }
    if (/^(INT|EXT)[.\s/]/.test(t)) return { text: t, kind: "heading" };
    if (afterCue) return { text: t, kind: /^\(.*\)$/.test(t) ? "paren" : "dialogue" };
    if (t === t.toUpperCase() && /[A-Z]/.test(t) && t.length < 40) {
      afterCue = true;
      return { text: t, kind: "cue" };
    }
    return { text: t, kind: "action" };
  });
}

function splitByQuotes(text, triggers) {
  let segs = [{ text, idx: -1 }];
  triggers.forEach((t, idx) => {
    const q = t.exact_script_quote;
    if (!q) return;
    segs = segs.flatMap((s) => {
      if (s.idx !== -1) return [s];
      const parts = s.text.split(q);
      return parts.flatMap((p, i) => [
        ...(p ? [{ text: p, idx: -1 }] : []),
        ...(i < parts.length - 1 ? [{ text: q, idx }] : []),
      ]);
    });
  });
  return segs;
}

const LINE_CLASS = {
  heading: "font-bold",
  action: "",
  cue: "ml-[6ch] sm:ml-[20ch]",
  paren: "ml-[4ch] sm:ml-[15ch]",
  dialogue: "ml-[3ch] sm:ml-[10ch] max-w-[36ch]",
};

const TABS = [
  ["BREAKDOWN", "Breakdown"],
  ["REWRITE", "Rewrite"],
  ["LOCATION", "Location scout"],
];


// Keep in sync with SCENE_MIN_CHARS / SCENE_MAX_CHARS / MAX_CAST / MAX_EXTRAS in main.py; the server re-checks everything.
const SCENE_MIN_CHARS = 60;
const SCENE_MAX_CHARS = 12000;
const MAX_CAST = 200;
const MAX_EXTRAS = 5000;
const FIELD_LABEL = { speaking_cast_count: "Speaking cast", background_extras_count: "Extras", int_ext: "Set", time_of_day: "Time of day" };

const EMPTY_FORM = { season: "", episode: "", scene_text: "", int_ext: "", time_of_day: "", speaking_cast_count: "", background_extras_count: "" };
const OVERRIDE_FIELDS = ["int_ext", "time_of_day", "speaking_cast_count", "background_extras_count"];

// POST form fields to the backend with the signed-in user's ID token; blank fields are omitted (= let Gemini decide).
async function postForm(path, fields) {
  const body = new FormData();
  Object.entries(fields).forEach(([k, v]) => v !== "" && v != null && body.append(k, v));
  const res = await fetch(path, {
    method: "POST",
    headers: { Authorization: `Bearer ${await auth.currentUser.getIdToken()}` },
    body,
  });
  if (!res.ok) {
    const { detail } = await res.json().catch(() => ({}));
    // FastAPI field errors arrive as [{loc: [..., field], msg}]; name the field so the user knows what to fix.
    const first = Array.isArray(detail) ? detail[0] : null;
    const field = first?.loc?.at(-1);
    throw new Error(
      typeof detail === "string"
        ? detail
        : first
          ? `${FIELD_LABEL[field] ?? field}: ${first.msg}`
          : `Request failed (${res.status}). Please try again.`
    );
  }
  return res.json();
}

async function postJson(path, payload) {
  const res = await fetch(path, {
    method: "POST",
    headers: { Authorization: `Bearer ${await auth.currentUser.getIdToken()}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail ?? `Request failed (${res.status}).`);
  return res.json();
}

const MAX_LOCATIONS = 3;
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

// Shrink a photo to 1024px JPEG in the browser: the blob goes to the vision model, the data URL into Firestore.
async function compressImage(file) {
  if (file.size > MAX_UPLOAD_BYTES) throw new Error("That photo is over 25 MB. Choose a smaller one.");
  let bmp;
  try {
    bmp = await createImageBitmap(file);
  } catch {
    throw new Error("Couldn't read that image. Use a JPEG, PNG or WebP photo.");
  }
  const scale = Math.min(1, 1024 / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext("2d").drawImage(bmp, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.8));
  const dataUrl = await new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.readAsDataURL(blob);
  });
  return { blob, dataUrl };
}

const priced = (p, amountUsd) => `${p.currency}${Math.round(amountUsd * p.fx_from_usd).toLocaleString()}`;

async function compileScene(sceneText, hub, overrides = {}) {
  const r = await postForm("/api/compile-scene", { scene_text: sceneText, region_hub: hub, ...overrides });
  return { ...r, scene_text: sceneText };
}

function SignIn() {
  const [error, setError] = useState("");
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 px-5 py-10">
      <div className="card w-full max-w-[440px] px-6 py-10 text-center sm:px-10">
        <h1>
          <Wordmark stacked className="text-[32px] sm:text-[36px]" markClassName="h-16 w-16 shadow-lift rounded-[15px]" />
        </h1>
        <p className="mx-auto mt-4 max-w-[30ch] text-[15px] leading-relaxed text-graphite">
          Turn your screenplay scenes into city-priced shoot budgets.
        </p>
        <button
          type="button"
          className="btn-primary mt-6 w-full"
          onClick={() => signInWithPopup(auth, googleProvider).catch((e) => setError(e.message))}
        >
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white" aria-hidden>
            <GoogleG />
          </span>
          Sign in with Google
        </button>
        {error && (
          <p role="alert" className="mt-4 rounded-lg bg-[#FFDAD6]/60 px-3 py-2 text-[13px] text-[#93000A]">
            {error}
          </p>
        )}
        <p className="mt-6 border-t border-desk pt-5 text-[12px] text-graphite">Your projects stay private to your Google account.</p>
      </div>
      <ul className="flex flex-wrap justify-center gap-2" aria-label="What you get">
        {["Gemini scene breakdowns", "Deterministic rate cards", "Mumbai · Singapore · Tokyo · Seoul"].map((t) => (
          <li key={t} className="chip bg-page">
            <span className="h-1.5 w-1.5 rounded-full bg-amber" aria-hidden /> {t}
          </li>
        ))}
      </ul>
    </div>
  );
}

// Google's four-colour "G", for the sign-in button.
function GoogleG() {
  return (
    <svg viewBox="0 0 48 48" className="h-4 w-4">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

const LOADER_STRIPS = ["#5DBB63", "#F59E42", "#5B9BD5", "#EC6FA8", "#9B7BDB", "#3BB3B0"];

// Shown in place of the breakdown sheet while the LLM works; steps advance on a timer and hold on the last one.
function EstimatingSheet({ steps }) {
  const [step, setStep] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setStep((s) => Math.min(s + 1, steps.length - 1)), 1600);
    return () => clearInterval(id);
  }, [steps.length]);
  return (
    <section
      role="status"
      aria-live="polite"
      aria-label="Estimating"
      className="overflow-hidden card lg:sticky lg:top-6"
    >
      <div className="space-y-1.5 border-b border-line bg-mist px-5 py-6 sm:px-6" aria-hidden>
        {LOADER_STRIPS.map((color, i) => (
          <div key={color} className="h-3 rounded-full bg-desk">
            <div
              className="strip-in h-full rounded-full"
              style={{ background: color, width: `${92 - ((i * 17) % 40)}%`, animationDelay: `${i * 0.18}s` }}
            />
          </div>
        ))}
      </div>
      <ol className="space-y-3 px-5 py-5 text-[15px] sm:px-6">
        {steps.map((label, i) => (
          <li
            key={label}
            className={`flex items-center gap-3 transition-colors duration-300 ${
              i < step ? "text-graphite" : i === step ? "font-semibold text-ink" : "text-line-strong"
            }`}
          >
            <span
              className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
                i < step ? "border-[#2E7D32] bg-[#2E7D32] text-white" : i === step ? "border-amber" : "border-line-strong"
              }`}
              aria-hidden
            >
              {i < step ? (
                <Check className="h-3 w-3" />
              ) : i === step ? (
                <span className="h-2 w-2 rounded-full bg-amber motion-safe:animate-pulse" />
              ) : null}
            </span>
            {label}
          </li>
        ))}
      </ol>
    </section>
  );
}

export default function App() {
  const [user, setUser] = useState(undefined); // undefined = still checking session
  useEffect(() => onAuthStateChanged(auth, setUser), []);
  // Session check: a quiet splash instead of a blank page.
  if (user === undefined)
    return (
      <div className="flex min-h-screen items-center justify-center" role="status" aria-label="Loading ScriptPhysics">
        <LogoMark className="h-14 w-14 motion-safe:animate-pulse" />
      </div>
    );
  return user ? <ScriptPhysicsApp user={user} /> : <SignIn />;
}

// Projects → Project → Scene. view state, no router; add one if deep links or the back button matter.
function ScriptPhysicsApp({ user }) {
  const [hubs, setHubs] = useState({});
  // Which page is showing comes from the URL (see nav.js), so back/forward and refresh follow the breadcrumbs.
  const [view, setView] = useState(parseLocation);
  const [project, setProject] = useState(null);
  const [scenes, setScenes] = useState([]);
  const [loadedFor, setLoadedFor] = useState(null); // project id whose scenes are in `scenes`
  const [error, setError] = useState("");

  const go = (next, { replace = false } = {}) => {
    const url = urlOf(next);
    if (url !== window.location.pathname + window.location.search) window.history[replace ? "replaceState" : "pushState"](null, "", url);
    setError("");
    setView(next);
    window.scrollTo(0, 0);
  };

  useEffect(() => {
    const onPop = () => {
      setError("");
      setView(parseLocation());
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  useEffect(() => {
    fetch("/api/rate-cards")
      .then((r) => r.json())
      .then(setHubs)
      .catch(() => setError("Could not reach the budget server."));
  }, []);

  // Load the project and its scenes whenever the URL points at one we don't have yet (deep link, back, forward).
  useEffect(() => {
    const pid = view.projectId;
    if (!pid || loadedFor === pid) return;
    let live = true;
    const projectP =
      project?.id === pid
        ? Promise.resolve(project)
        : getDoc(doc(projectsRef(user.uid), pid)).then((d) => (d.exists() ? { id: d.id, ...d.data() } : null));
    Promise.all([projectP, getDocs(query(scenesRefOf(user.uid, pid)))])
      .then(([p, snap]) => {
        if (!live) return;
        if (!p) {
          go(HOME, { replace: true });
          setError("That project isn't available any more.");
          return;
        }
        setProject(p);
        setScenes(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
        setLoadedFor(pid);
      })
      .catch((e) => live && setError(`Could not load the project: ${e.message}`));
    return () => {
      live = false;
    };
  }, [view.projectId, loadedFor]);

  const ready = view.projectId && loadedFor === view.projectId && project?.id === view.projectId;
  const scene = ready && view.sceneId ? scenes.find((x) => x.id === view.sceneId) : null;

  // A scene URL that no longer matches a scene (deleted, or a stale link): fall back to its project.
  useEffect(() => {
    if (ready && view.sceneId && !scene) {
      go({ projectId: view.projectId, sceneId: null, episode: null }, { replace: true });
      setError("That scene isn't available any more.");
    }
  }, [ready, view.sceneId, scene]);

  useEffect(() => {
    const parts = [scene?.title ?? (view.sceneId === "" ? "New scene" : null), ready ? project.title : null, "ScriptPhysics"];
    document.title = parts.filter(Boolean).join(" · ");
  }, [ready, project?.title, scene?.title, view.sceneId]);

  const toProjects = () => go(HOME);
  const toProject = () => go({ projectId: view.projectId, sceneId: null, episode: null });
  const openProject = (p) => {
    if (loadedFor === p.id) setProject(p);
    else {
      setProject(p);
      setLoadedFor(null);
    }
    go({ projectId: p.id, sceneId: null, episode: null });
  };
  const openScene = (id, episode = null) => go({ projectId: view.projectId, sceneId: id, episode });

  const banner = error && (
    <p role="alert" className="mx-auto mt-4 max-w-[1440px] px-4 text-[15px] text-[#BA1A1A] sm:px-8">
      {error}
    </p>
  );

  if (!view.projectId) return <>{banner}<ProjectList user={user} hubs={hubs} onOpen={openProject} /></>;
  if (!ready || (view.sceneId && !scene))
    return (
      <>
        {banner}
        <div className="flex min-h-[60vh] items-center justify-center" role="status" aria-label="Loading project">
          <LogoMark className="h-12 w-12 motion-safe:animate-pulse" />
        </div>
      </>
    );
  if (view.sceneId === null)
    return (
      <>
        {banner}
        <ProjectOverview
          user={user}
          hubs={hubs}
          project={project}
          scenes={scenes}
          onBack={toProjects}
          onOpenScene={openScene}
          onProjectChange={setProject}
          onScenesDeleted={(ids) => setScenes((list) => list.filter((x) => !ids.includes(x.id)))}
          onDeleted={() => {
            setLoadedFor(null);
            setProject(null);
            go(HOME, { replace: true });
          }}
        />
      </>
    );
  return (
    <SceneWorkspace
      key={view.sceneId || "new"}
      user={user}
      hubs={hubs}
      project={project}
      scenes={scenes}
      scene={scene}
      newSceneEpisode={view.episode}
      onOpenScene={openScene}
      onBackToProject={toProject}
      onBackToProjects={toProjects}
      onSaved={(saved) => {
        setScenes((list) => [...list.filter((x) => x.id !== saved.id), saved]);
        // A new scene gets its own URL; replace so Back doesn't return to the empty form.
        if (view.sceneId !== saved.id) go({ projectId: view.projectId, sceneId: saved.id, episode: null }, { replace: true });
      }}
      onDeleted={(id) => {
        setScenes((list) => list.filter((x) => x.id !== id));
        go({ projectId: view.projectId, sceneId: null, episode: null }, { replace: true });
      }}
    />
  );
}

function SceneWorkspace({ user, hubs, project, scenes, scene, newSceneEpisode, onOpenScene, onBackToProject, onBackToProjects, onSaved, onDeleted }) {
  const isSeries = project.type === "SERIES";
  const seasons = isSeries ? seasonsOf(project, scenes) : [];
  // Every episode a series scene can sit in, as select options "season-episode".
  const episodeOptions = seasons.flatMap((s) => s.episodes.map((e) => ({ value: `${s.number}-${e.number}`, label: episodeLabel(s, e), season: s, episode: e })));
  const [hub, setHub] = useState(scene?.hub ?? project.defaultHub);
  const [form, setForm] = useState(() => {
    if (scene?.form) return scene.form;
    const ep = newSceneEpisode ?? (isSeries && episodeOptions.at(-1) && { season: episodeOptions.at(-1).season.number, episode: episodeOptions.at(-1).episode.number });
    return { ...EMPTY_FORM, ...(ep ? { season: String(ep.season), episode: String(ep.episode) } : {}) };
  });
  const currentEpisode = episodeOptions.find((o) => o.value === `${form.season}-${form.episode}`);
  const [editing, setEditing] = useState(!scene);
  const [result, setResult] = useState(scene?.result ?? null); // {breakdown, financials, scene_text} for the original draft
  const [revised, setRevised] = useState(scene?.revised ?? null); // {alt, breakdown, financials, scene_text} for the rewrite
  const [showRevised, setShowRevised] = useState(!!(scene?.appliedRewrite && scene?.revised));
  const [rewriteDraft, setRewriteDraft] = useState(null); // non-null while the user edits the rewrite text
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState("BREAKDOWN");
  const [selectedTriggerIndex, setSelectedTriggerIndex] = useState(0);
  const [locations, setLocations] = useState([]); // candidate location docs: {id, name, image, audit, pricing}
  const [chosenLocationId, setChosenLocationId] = useState(scene?.chosenLocationId ?? null);
  const [viewedLocationId, setViewedLocationId] = useState(scene?.chosenLocationId ?? null);
  const [scoutFile, setScoutFile] = useState(null);
  const [scoutName, setScoutName] = useState("");
  const docId = scene?.id ?? "";

  const scenesRef = scenesRefOf(user.uid, project.id);
  const locationsRef = docId ? collection(scenesRef, docId, "locations") : null;

  useEffect(() => {
    if (!locationsRef) return;
    getDocs(query(locationsRef, orderBy("createdAt")))
      .then((snap) => setLocations(snap.docs.map((d) => ({ id: d.id, ...d.data() }))))
      .catch((e) => setError(`Could not load location photos: ${e.message}`));
  }, [docId]);

  const chosenLocation = locations.find((l) => l.id === chosenLocationId) ?? null;
  const viewedLocation = locations.find((l) => l.id === viewedLocationId) ?? locations[0] ?? null;
  const locationSummary = (list, id) => {
    const l = list.find((x) => x.id === id);
    return l ? { id: l.id, name: l.name, usd: l.pricing.total_extra_usd } : null;
  };

  const active = showRevised && revised ? revised : result;
  const financials = active?.financials;
  const triggers = financials?.annotated_triggers ?? [];
  const savingUsd = revised ? result.financials.total_estimated_cost_usd - revised.financials.total_estimated_cost_usd : 0;
  const savingPct = revised ? Math.round((savingUsd / result.financials.total_estimated_cost_usd) * 100) : 0;
  const cityName = hubs[hub]?.name.split(" (")[0] ?? "the city";
  // Show amounts in the scene's city currency at the server's rate; scenes saved before fx_from_usd fall back to USD.
  const money = (amountUsd) =>
    financials?.fx_from_usd
      ? `${financials.currency}${Math.round(amountUsd * financials.fx_from_usd).toLocaleString()}`
      : usd(amountUsd);
  const overrides = Object.fromEntries(OVERRIDE_FIELDS.map((k) => [k, form[k]]));

  // Create or update this scene's Firestore doc; Firestore rejects undefined, so absent parts are null.
  // totalUsd is the version that counts (applied rewrite, else original) so project cards can sum() it server-side.
  // `location` = the chosen scout location {id, name, usd} or null; omitted means "keep the current choice".
  const persist = async ({ form, hub, result, revised, appliedRewrite = false, location }) => {
    const counted = countedOf({ result, revised, appliedRewrite });
    const loc = location !== undefined ? location : locationSummary(locations, chosenLocationId);
    const data = {
      title: result.breakdown.scene_heading,
      season: isSeries ? Number(form.season) : null,
      episode: isSeries ? Number(form.episode) : null,
      form, hub, result, revised, appliedRewrite,
      chosenLocationId: loc?.id ?? null,
      locationName: loc?.name ?? null,
      locationUsd: loc?.usd ?? 0,
      totalUsd: counted.financials.total_estimated_cost_usd + (loc?.usd ?? 0),
      updatedAt: serverTimestamp(),
    };
    try {
      let id = docId;
      if (id) await updateDoc(doc(scenesRef, id), data);
      else {
        data.createdAt = serverTimestamp();
        id = (await addDoc(scenesRef, data)).id;
      }
      await updateDoc(doc(projectsRef(user.uid), project.id), { updatedAt: serverTimestamp() });
      onSaved({ ...scene, ...data, id });
    } catch (e) {
      setError(`Budget ready, but saving failed: ${e.message}`);
    }
  };

  const run = async (kind, fn) => {
    setBusy(kind);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy("");
    }
  };

  const showResult = (r, rev = null, onRevised = false) => {
    setResult(r);
    setRevised(rev);
    setShowRevised(onRevised);
    setSelectedTriggerIndex(0);
  };

  const sameInputs = (a, b) => ["scene_text", ...OVERRIDE_FIELDS].every((k) => (a?.[k] ?? "") === (b?.[k] ?? ""));

  const handleEstimate = (e) => {
    e.preventDefault();
    // Only season/episode changed: move the scene without paying for another LLM call.
    if (result && scene && sameInputs(form, scene.form) && hub === scene.hub) {
      setEditing(false);
      return run("save", () => persist({ form, hub, result, revised, appliedRewrite: showRevised }));
    }
    run("compile", async () => {
      const r = await compileScene(form.scene_text, hub, overrides);
      showResult(r);
      setEditing(false);
      setActiveTab("BREAKDOWN");
      await persist({ form, hub, result: r, revised: null });
    });
  };

  // City notes and rates are city-specific, so a new city means a fresh compile; the rewrite is dropped.
  const handleHubChange = (newHub) => {
    if (!result || editing) return setHub(newHub);
    run("compile", async () => {
      const r = await compileScene(result.scene_text, newHub, overrides);
      // Location audits stay valid in a new city; only their price changes, so re-price without the LLM.
      const repriced = await Promise.all(
        locations.map(async (l) => ({ ...l, pricing: await postJson("/api/price-location", { audit: l.audit, region_hub: newHub }) }))
      );
      await Promise.all(repriced.map((l) => updateDoc(doc(locationsRef, l.id), { pricing: l.pricing })));
      setLocations(repriced);
      setHub(newHub);
      showResult(r);
      await persist({ form, hub: newHub, result: r, revised: null, location: locationSummary(repriced, chosenLocationId) });
    });
  };

  const handleScout = (e) => {
    e.preventDefault();
    run("scout", async () => {
      const { blob, dataUrl } = await compressImage(scoutFile);
      const { audit, pricing } = await postForm("/api/audit-location", {
        image: blob,
        scene_text: active.scene_text,
        region_hub: hub,
      });
      const name = scoutName.trim() || scoutFile.name.replace(/\.[^.]+$/, "") || "Location";
      const data = { name: name.slice(0, 80), image: dataUrl, audit, pricing, createdAt: serverTimestamp() };
      const id = (await addDoc(locationsRef, data)).id;
      const list = [...locations, { id, ...data }];
      setLocations(list);
      setViewedLocationId(id);
      setScoutFile(null);
      setScoutName("");
      // The first candidate goes into the budget automatically; later ones wait for the user to choose.
      if (!chosenLocationId) {
        setChosenLocationId(id);
        await persist({ form, hub, result, revised, appliedRewrite: showRevised, location: locationSummary(list, id) });
      }
    });
  };

  const chooseLocation = (id) => {
    const next = chosenLocationId === id ? null : id;
    setChosenLocationId(next);
    run("save", () => persist({ form, hub, result, revised, appliedRewrite: showRevised, location: locationSummary(locations, next) }));
  };

  const removeLocation = (id) => {
    if (!confirm("Remove this location photo and its audit?")) return;
    run("save", async () => {
      await deleteDoc(doc(locationsRef, id));
      const list = locations.filter((l) => l.id !== id);
      setLocations(list);
      if (chosenLocationId === id) {
        setChosenLocationId(null);
        await persist({ form, hub, result, revised, appliedRewrite: showRevised, location: null });
      }
    });
  };

  // Which version counts toward the project rollup is saved with the scene.
  const setApplied = (applied) => {
    setShowRevised(applied);
    run("save", () => persist({ form, hub, result, revised, appliedRewrite: applied }));
  };

  const handleApplyRewrite = () => {
    if (revised) return setApplied(true);
    run("rewrite", async () => {
      const { alternatives } = await postForm("/api/optimize-scene", { scene_text: result.scene_text });
      if (!alternatives?.length) throw new Error("Gemini returned no rewrite. Try again.");
      const alt = alternatives[0];
      const rev = { alt, ...(await compileScene(alt.rewritten_scene_fountain, hub)) };
      showResult(result, rev, true);
      setActiveTab("BREAKDOWN");
      await persist({ form, hub, result, revised: rev, appliedRewrite: true });
    });
  };

  // Re-price the user's edited rewrite; the original draft stays the baseline for the saving.
  const handleEstimateRewrite = (e) => {
    e.preventDefault();
    run("compile", async () => {
      const rev = { alt: revised.alt, ...(await compileScene(rewriteDraft, hub)) };
      showResult(result, rev, true);
      setRewriteDraft(null);
      setActiveTab("BREAKDOWN");
      await persist({ form, hub, result, revised: rev, appliedRewrite: true });
    });
  };

  const handleDelete = () => {
    if (!confirm(`Delete "${scene.title}"? This can't be undone.`)) return;
    run("save", async () => {
      await deleteScene(user.uid, project.id, scene.id);
      onDeleted(scene.id);
    });
  };

  const selectTrigger = (idx) => {
    setSelectedTriggerIndex(idx);
    setActiveTab("BREAKDOWN");
  };

  const setField = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const renderScriptLine = ({ text, kind }, i) => {
    if (kind === "blank") return <div key={i} className="h-[1.6em]" aria-hidden />;
    const segs = splitByQuotes(text, triggers);
    const noteIdxs = [...new Set(segs.filter((s) => s.idx !== -1).map((s) => s.idx))];
    return (
      <div key={i} className="sm:grid sm:grid-cols-[minmax(0,1fr)_5.5rem] sm:gap-x-6">
        <p className={LINE_CLASS[kind]}>
          {segs.map((seg, j) => {
            if (seg.idx === -1) return <span key={j}>{seg.text}</span>;
            const { color, label } = categoryOf(triggers[seg.idx]);
            const selected = selectedTriggerIndex === seg.idx;
            return (
              <mark
                key={j}
                role="button"
                tabIndex={0}
                title={label}
                onClick={() => selectTrigger(seg.idx)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    selectTrigger(seg.idx);
                  }
                }}
                className="cursor-pointer rounded-[2px] px-0.5 text-ink [box-decoration-break:clone] [-webkit-box-decoration-break:clone]"
                style={{
                  background: `${color}${selected ? "70" : "3A"}`,
                  boxShadow: selected ? `inset 0 -2px 0 ${color}` : "none",
                }}
              >
                {seg.text}
              </mark>
            );
          })}
        </p>
        {noteIdxs.length > 0 && (
          <div className="hidden sm:block border-l border-dashed border-line-strong pl-3 font-sans text-[13px] italic text-graphite tabular-nums">
            {noteIdxs.map((idx) => (
              <p key={idx} className="flex items-center gap-1.5">
                <span
                  className="h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{ background: categoryOf(triggers[idx]).color }}
                  aria-hidden
                />
                {money(triggers[idx].calculated_cost_usd)}
              </p>
            ))}
          </div>
        )}
      </div>
    );
  };

  const optimizeButton = showRevised ? (
    <button type="button" onClick={() => setApplied(false)} disabled={!!busy} className="btn-secondary">
      <RotateCcw className="h-4 w-4" aria-hidden /> Restore original
    </button>
  ) : (
    <button type="button" onClick={handleApplyRewrite} disabled={!!busy} className="btn-primary">
      {busy === "rewrite" ? "Rewriting…" : revised ? "Show cost-cutting rewrite" : "Apply cost-cutting rewrite"}
    </button>
  );

  const notesList = (title, items, tone) =>
    items?.length > 0 && (
      <div>
        <h2 className="mb-2 text-[15px] font-bold">{title}</h2>
        <ul className="space-y-2">
          {items.map((w, i) => (
            <li
              key={i}
              className={`flex gap-2.5 rounded-lg px-3 py-2.5 text-[13px] leading-relaxed ${tone === "warn" ? "bg-amber-soft/60" : "bg-mist"}`}
            >
              {tone === "warn" ? (
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber" aria-hidden />
              ) : (
                <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-ledger" aria-hidden />
              )}
              <span>{w}</span>
            </li>
          ))}
        </ul>
      </div>
    );

  return (
    <div className="min-h-screen">
      <AppHeader
        user={user}
        width="max-w-[1440px]"
        crumbs={[
          { label: "Projects", onClick: onBackToProjects, href: "/" },
          { label: project.title, onClick: onBackToProject, href: urlOf({ projectId: project.id }) },
          ...(currentEpisode ? [{ label: currentEpisode.label, onClick: onBackToProject, href: urlOf({ projectId: project.id }) }] : []),
          { label: scene?.title ?? "New scene" },
        ]}
      >
        <label className="flex w-full flex-col gap-1 text-[13px] text-graphite sm:w-auto">
          Scene
          <select
            value={docId}
            onChange={(e) => onOpenScene(e.target.value)}
            disabled={!!busy}
            className="field w-full min-w-0 sm:max-w-[22rem]"
          >
            <option value="">+ New scene</option>
            {isSeries
              ? episodeOptions
                  .filter((o) => o.episode.scenes.length > 0)
                  .map((o) => (
                    <optgroup key={o.value} label={o.label}>
                      {o.episode.scenes.map((x) => (
                        <option key={x.id} value={x.id}>
                          {x.title}
                        </option>
                      ))}
                    </optgroup>
                  ))
              : [...scenes]
                  .sort((a, b) => millis(a.createdAt) - millis(b.createdAt))
                  .map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.title}
                    </option>
                  ))}
          </select>
        </label>
        <label className="flex w-full flex-col gap-1 text-[13px] text-graphite sm:w-auto">
          Shoot city
          <select
            value={hub}
            onChange={(e) => handleHubChange(e.target.value)}
            disabled={!!busy || rewriteDraft !== null}
            className="field w-full min-w-0 sm:max-w-[18rem]"
          >
            {Object.entries(hubs).map(([id, h]) => (
              <option key={id} value={id}>
                {h.name} · {h.currency_code}
              </option>
            ))}
          </select>
        </label>
      </AppHeader>

      {error && (
        <p role="alert" className="mx-auto mt-4 max-w-[1440px] px-4 text-[15px] text-[#BA1A1A] sm:px-8">
          {error}
        </p>
      )}

      <main className="mx-auto grid max-w-[1440px] grid-cols-[minmax(0,1fr)] items-start gap-8 px-5 py-8 sm:px-8 sm:py-10 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        {rewriteDraft !== null ? (
          <form aria-label="Edit rewrite" onSubmit={handleEstimateRewrite} className="space-y-4">
            <p className="text-[15px]">
              <span className="font-semibold">Editing revised draft</span>{" "}
              <span className="text-graphite px-4">Savings are compared with the original draft.</span>
            </p>
            <textarea
              required
              aria-label="Revised scene text"
              value={rewriteDraft}
              onChange={(e) => setRewriteDraft(e.target.value)}
              rows={22}
              minLength={SCENE_MIN_CHARS}
              maxLength={SCENE_MAX_CHARS}
              className="field w-full bg-[#EAF1FA] font-script text-[15px] leading-[1.6]"
            />
            <div className="flex flex-wrap justify-end gap-3">
              <button type="button" onClick={() => setRewriteDraft(null)} className="btn-secondary">
                Cancel
              </button>
              <button type="submit" disabled={!!busy} className="btn-primary">
                {busy === "compile" ? "Estimating…" : `Re-estimate rewrite in ${hubs[hub]?.name.split(" (")[0] ?? "city"}`}
              </button>
            </div>
          </form>
        ) : editing ? (
          <form aria-label="Scene input" onSubmit={handleEstimate} className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-[18px] font-bold tracking-[-0.01em]">Your scene</p>
              <div className="flex flex-wrap gap-2">
                {EXAMPLE_SCENES.map((ex) => (
                  <button
                    key={ex.title}
                    type="button"
                    onClick={() => {
                      setForm((f) => ({ ...EMPTY_FORM, season: f.season, episode: f.episode, scene_text: ex.script }));
                    }}
                    className="rounded-full border border-line bg-page px-3 py-1.5 text-[12px] font-semibold text-slatechip transition-colors hover:border-amber hover:bg-amber-soft hover:text-amber-deep"
                  >
                    Example: {ex.title.split(" (")[0]}
                  </button>
                ))}
              </div>
            </div>
            {isSeries &&
              (episodeOptions.length === 0 ? (
                <p className="rounded-lg bg-amber-soft px-4 py-3 text-[15px] text-[#6E3900]">
                  Add a season and an episode on the{" "}
                  <button type="button" onClick={onBackToProject} className="font-semibold underline">
                    project page
                  </button>{" "}
                  first, then add scenes to an episode.
                </p>
              ) : (
                <label className="block max-w-md text-[13px] text-graphite">
                  Episode
                  <select
                    required
                    value={currentEpisode?.value ?? ""}
                    onChange={(e) => {
                      const [season, episode] = e.target.value.split("-");
                      setForm((f) => ({ ...f, season, episode }));
                    }}
                    className="field mt-1 w-full"
                  >
                    <option value="" disabled>
                      Choose an episode
                    </option>
                    {seasons.map((s) => (
                      <optgroup key={s.number} label={`Season ${s.number}${s.title ? ` · ${s.title}` : ""}`}>
                        {s.episodes.map((e) => (
                          <option key={e.number} value={`${s.number}-${e.number}`}>
                            {episodeLabel(s, e)}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </label>
              ))}
            <label className="block text-[13px] text-graphite">
              Scene text (paste from your screenplay)
              <textarea
                required
                minLength={SCENE_MIN_CHARS}
                maxLength={SCENE_MAX_CHARS}
                value={form.scene_text}
                onChange={setField("scene_text")}
                aria-describedby="scene-hint"
                rows={18}
                placeholder={"EXT. MARINE DRIVE - NIGHT\n\nRain lashes the promenade..."}
                className="field mt-1 w-full font-script text-[15px] leading-[1.6]"
              />
              <span id="scene-hint" className="mt-1 flex justify-between gap-3 text-[13px]">
                <span>One scene at a time, starting with its heading (INT. or EXT.).</span>
                <span className="tabular-nums">
                  {form.scene_text.length.toLocaleString()} / {SCENE_MAX_CHARS.toLocaleString()}
                </span>
              </span>
            </label>
            <fieldset className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <legend className="mb-1 text-[13px] text-graphite">
                Optional. Leave blank and Gemini reads them from the scene.
              </legend>
              <label className="flex flex-col gap-1 text-[13px] text-graphite">
                Set
                <select value={form.int_ext} onChange={setField("int_ext")} className="field">
                  <option value="">Auto (detect)</option>
                  {Object.entries(INT_EXT_LABEL).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-[13px] text-graphite">
                Time of day
                <select value={form.time_of_day} onChange={setField("time_of_day")} className="field">
                  <option value="">Auto (detect)</option>
                  {Object.entries(TIME_LABEL).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-[13px] text-graphite">
                Speaking cast
                <input type="number" min="0" max={MAX_CAST} step="1" placeholder="Auto" value={form.speaking_cast_count} onChange={setField("speaking_cast_count")} className="field" />
              </label>
              <label className="flex flex-col gap-1 text-[13px] text-graphite">
                Extras
                <input type="number" min="0" max={MAX_EXTRAS} step="1" placeholder="Auto" value={form.background_extras_count} onChange={setField("background_extras_count")} className="field" />
              </label>
            </fieldset>
            <div className="flex flex-wrap justify-end gap-3">
              <button
                type="button"
                onClick={() => (result ? (setForm(scene.form), setHub(scene.hub), setEditing(false)) : onBackToProject())}
                className="btn-secondary"
              >
                Cancel
              </button>
              <button type="submit" disabled={!!busy || (isSeries && !currentEpisode)} className="btn-primary">
                {busy === "compile" ? "Estimating…" : `Estimate budget in ${hubs[hub]?.name.split(" (")[0] ?? "city"}`}
              </button>
            </div>
          </form>
        ) : (
          <section aria-label="Script">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <p className="text-[15px]">
                <span className="text-[18px] font-bold tracking-[-0.01em]">{showRevised ? "Revised draft" : "Original draft"}</span>{" "}
                {/* <span className="text-graphite">{showRevised ? "on blue pages" : "on white pages"}</span> */}
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => (showRevised ? setRewriteDraft(revised.scene_text) : setEditing(true))}
                  disabled={!!busy}
                  className="btn-secondary"
                >
                  <Pencil className="h-4 w-4" aria-hidden /> {showRevised ? "Edit rewrite" : "Edit scene"}
                </button>
                {scene && (
                  <button type="button" onClick={handleDelete} disabled={!!busy} className="btn-secondary" aria-label="Delete scene" title="Delete scene">
                    <Trash2 className="h-4 w-4" aria-hidden />
                  </button>
                )}
                {optimizeButton}
              </div>
            </div>

            <article
              className={`rounded-card border border-line px-5 py-8 font-script text-[13px] leading-[1.6] text-ink shadow-sheet transition-colors duration-500 sm:px-14 sm:py-14 sm:text-[15px] ${
                showRevised ? "bg-page" : "bg-page"
              }`}
            >
              {classifyLines(active.scene_text).map(renderScriptLine)}
            </article>

            <p className="mt-3 text-[13px] text-graphite">
              Select a highlight to open its line item. Costs in the margin are in {financials.currency_code}.
            </p>
          </section>
        )}

        {/* The breakdown sheet. */}
        {busy === "compile" || busy === "rewrite" || busy === "scout" ? (
          <EstimatingSheet
            key={busy}
            steps={
              busy === "scout"
                ? ["Looking at the photo", "Matching it to the scene", "Spotting rigging hazards", `Pricing at ${cityName} rates`]
                : busy === "rewrite"
                ? ["Studying the scene's blocking", "Rewriting for a cheaper shoot", "Keeping the dialogue intact", `Re-pricing in ${cityName}`]
                : ["Reading the scene", "Spotting cost triggers", `Pricing at ${cityName} rates`, `Converting to ${hubs[hub]?.currency_code ?? "local currency"}`, "Adding city production notes"]
            }
          />
        ) : !active ? (
          <section aria-label="Breakdown sheet" className="card px-6 py-12 text-center">
            <LogoMark className="mx-auto mb-4 h-12 w-12" />
            <p className="mx-auto max-w-[36ch] text-[15px] text-graphite">
              Paste a scene, pick a shoot city and select Estimate budget. Your breakdown sheet appears here.
            </p>
          </section>
        ) : (
          <section aria-label="Breakdown sheet" className="overflow-hidden card lg:sticky lg:top-6">
            <div className="border-b border-line text-[13px]" style={{ background: stripColor(active.breakdown) }}>
              <p className="truncate border-b border-line px-4 py-2 font-semibold sm:px-6">
                {active.breakdown.scene_heading}
              </p>
              <dl className="flex divide-x divide-ink/10">
                {[
                  ["Set", INT_EXT_LABEL[active.breakdown.int_ext]],
                  ["Time", TIME_LABEL[active.breakdown.time_of_day]],
                  ["Cast", active.breakdown.speaking_cast_count],
                  ["Extras", active.breakdown.background_extras_count],
                ].map(([k, v]) => (
                  <div key={k} className="min-w-0 flex-1 px-3 py-2 first:pl-4 sm:first:pl-6">
                    <dt className="text-ink/60">{k}</dt>
                    <dd className="font-semibold tabular-nums">{v}</dd>
                  </div>
                ))}
              </dl>
            </div>

            <div className="border-b border-line px-5 py-5 sm:px-6">
              <p className="text-[13px] text-graphite">Scene total, {financials.hub_name.split(" (")[0]}</p>
              <p className="text-[40px] font-extrabold leading-[48px] tracking-[-0.03em] text-ledger tabular-nums">
                {financials.currency}
                {(financials.total_local + (chosenLocation?.pricing.total_local ?? 0)).toLocaleString()}
              </p>
              {chosenLocation && (
                <p className="text-[13px] text-graphite">Includes {chosenLocation.name} location prep</p>
              )}
              <dl className="mt-2 grid grid-cols-3 gap-4 text-[13px]">
                {[
                  ["In USD", usd(financials.total_estimated_cost_usd + (chosenLocation?.pricing.total_extra_usd ?? 0))],
                  ["Shoot time", `${financials.total_shoot_hours} hrs`],
                  ["Shoot days", financials.shoot_days_required],
                ].map(([k, v]) => (
                  <div key={k}>
                    <dt className="text-graphite">{k}</dt>
                    <dd className="text-[15px] tabular-nums">{v}</dd>
                  </div>
                ))}
              </dl>
              {showRevised && savingUsd > 0 && (
                <p className="mt-4 rounded-lg bg-[#E8F5E9] px-3 py-2.5 text-[13px] font-semibold text-[#1E5E2A]">
                  The rewrite saves {money(savingUsd)} ({savingPct}%) against the original draft.
                </p>
              )}
            </div>

            <div role="tablist" aria-label="Breakdown views" className="flex border-b border-line px-3 sm:px-4">
              {TABS.map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={activeTab === id}
                  onClick={() => setActiveTab(id)}
                  className={`-mb-px border-b-2 px-3 py-3.5 text-[14px] font-semibold transition-colors ${
                    activeTab === id
                      ? "border-amber text-ink"
                      : "border-transparent text-graphite hover:text-ink"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <div role="tabpanel" className="space-y-6 px-5 py-5 sm:px-6">
              {activeTab === "BREAKDOWN" && (
                <>
                  {notesList(
                    `Shooting in ${financials.hub_name.split(" (")[0]}`,
                    active.breakdown.city_production_notes,
                    "city"
                  )}
                  {notesList("Scheduling notes", active.breakdown.schedule_hazard_warnings, "warn")}

                  <div>
                    <h2 className="mb-1 text-[15px] font-bold">Line items</h2>
                    <ul className="divide-y divide-line">
                      {triggers.map((item, idx) => {
                        const cat = categoryOf(item);
                        const selected = selectedTriggerIndex === idx;
                        return (
                          <li key={idx}>
                            <button
                              type="button"
                              aria-pressed={selected}
                              onClick={() => setSelectedTriggerIndex(idx)}
                              className="-mx-3 grid w-[calc(100%+1.5rem)] grid-cols-[minmax(0,1fr)_auto] gap-x-4 rounded-lg px-3 py-3 text-left transition-colors hover:bg-mist"
                              style={selected ? { background: `${cat.color}22` } : undefined}
                            >
                              <div className="min-w-0">
                                <p className="flex flex-wrap items-center gap-x-2 text-[13px]">
                                  <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: cat.color }} aria-hidden />
                                  <span className="font-semibold">{cat.label}</span>
                                  <span className={RISK_TEXT[item.risk_level]}>{RISK_LABEL[item.risk_level]}</span>
                                </p>
                                <p className="mt-1 text-[15px]">{item.item_description}</p>
                                <p className="mt-1 text-[13px] leading-relaxed text-graphite">{item.line_producer_note}</p>
                                {selected && (
                                  <p className="mt-2 font-script text-[13px] text-ink/80">“{item.exact_script_quote}”</p>
                                )}
                              </div>
                              <div className="text-right tabular-nums">
                                <p className="text-[15px] font-semibold">{money(item.calculated_cost_usd)}</p>
                                <p className="text-[13px] text-graphite">+{item.shoot_time_penalty_hours} hrs</p>
                              </div>
                            </button>
                          </li>
                        );
                      })}
                    </ul>

                    <dl className="mt-2 space-y-1.5 border-t border-line-strong pt-3 text-[13px] tabular-nums">
                      {[
                        [
                          `Crew, ${financials.total_shoot_hours} hrs${financials.is_night ? ` at ${financials.time_mult}× night rate` : ""}`,
                          financials.crew_cost_usd,
                        ],
                        ["Cast and extras", financials.cast_cost_usd],
                        ["Production elements", financials.triggers_total_usd],
                        ...(chosenLocation ? [[`Location: ${chosenLocation.name}`, chosenLocation.pricing.total_extra_usd]] : []),
                      ].map(([k, v]) => (
                        <div key={k} className="flex justify-between gap-4">
                          <dt className="text-graphite">{k}</dt>
                          <dd>{money(v)}</dd>
                        </div>
                      ))}
                      <div className="mt-2 flex justify-between gap-4 border-t border-ink pt-2 text-[15px] font-semibold">
                        <dt>Total</dt>
                        <dd>
                          {financials.currency}
                          {(financials.total_local + (chosenLocation?.pricing.total_local ?? 0)).toLocaleString()}
                        </dd>
                      </div>
                    </dl>
                  </div>
                </>
              )}

              {activeTab === "REWRITE" &&
                (revised ? (
                  <>
                    <div className="rounded-xl border border-[#BFDBFE] bg-[#EFF6FF] px-4 py-4">
                      <p className="text-[13px] text-graphite">
                        Blue revision, saves {revised.alt.estimated_hours_saved} shoot hours
                      </p>
                      <h2 className="mt-1 text-[18px] font-semibold leading-snug">{revised.alt.strategy_name}</h2>
                      <p className="mt-2 text-[15px] leading-relaxed">{revised.alt.dramatic_preservation_explanation}</p>
                    </div>

                    <div>
                      <h3 className="mb-2 text-[15px] font-semibold">What changes on set</h3>
                      <ul className="space-y-2">
                        {revised.alt.production_changes_summary.map((chg, i) => (
                          <li key={i} className="flex gap-2 text-[15px] leading-relaxed">
                            <Check className="mt-1 h-4 w-4 shrink-0 text-[#2E7D32]" aria-hidden />
                            <span>{chg}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <p className="text-[15px]">{showRevised ? "Rewrite applied to the script." : "Original draft shown."}</p>
                      {optimizeButton}
                    </div>
                  </>
                ) : (
                  <>
                    <p className="text-[15px] leading-relaxed">
                      Gemini rewrites the scene's blocking to cut shoot cost while keeping the dialogue, then the rewrite is priced
                      in the same city.
                    </p>
                    <div className="[&>button]:w-full">{optimizeButton}</div>
                  </>
                ))}

              {activeTab === "LOCATION" &&
                (!scene ? (
                  <p className="text-[15px] text-graphite">Save the scene first, then upload location photos to scout them.</p>
                ) : (
                  <>
                    <p className="text-[15px] leading-relaxed">
                      Upload photos of up to {MAX_LOCATIONS} candidate locations. Each is checked against this scene, and the rigging it
                      needs is priced at {cityName} rates. The location you choose is added to the scene budget.
                    </p>

                    {locations.length < MAX_LOCATIONS ? (
                      <form
                        key={locations.length /* remount clears the file picker after each upload */}
                        onSubmit={handleScout}
                        className="space-y-3 rounded-xl border border-dashed border-line-strong bg-mist p-4"
                      >
                        <label className="block text-[13px] text-graphite">
                          Location photo (JPEG, PNG or WebP)
                          <input
                            required
                            type="file"
                            accept="image/jpeg,image/png,image/webp"
                            onChange={(e) => setScoutFile(e.target.files?.[0] ?? null)}
                            className="mt-1 block w-full text-[13px] text-ink file:mr-3 file:rounded-lg file:border file:border-solid file:border-line file:bg-page file:px-3 file:py-2 file:text-[13px] file:font-semibold file:text-ink"
                          />
                        </label>
                        <label className="block text-[13px] text-graphite">
                          Name (optional)
                          <input
                            maxLength={80}
                            value={scoutName}
                            onChange={(e) => setScoutName(e.target.value)}
                            placeholder="e.g. Worli seaface, north end"
                            className="field mt-1 w-full"
                          />
                        </label>
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-[13px] text-graphite tabular-nums">
                            {locations.length} of {MAX_LOCATIONS} used
                          </span>
                          <button type="submit" disabled={!!busy || !scoutFile} className="btn-primary">
                            <ImagePlus className="h-4 w-4" aria-hidden /> Scout this location
                          </button>
                        </div>
                      </form>
                    ) : (
                      <p className="text-[13px] text-graphite">
                        {MAX_LOCATIONS} of {MAX_LOCATIONS} candidates used. Remove one to scout another.
                      </p>
                    )}

                    {locations.length > 0 && (
                      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3" aria-label="Candidate locations">
                        {locations.map((l) => {
                          const chosen = l.id === chosenLocationId;
                          return (
                            <li key={l.id}>
                              <button
                                type="button"
                                aria-pressed={viewedLocation?.id === l.id}
                                onClick={() => setViewedLocationId(l.id)}
                                className={`w-full overflow-hidden rounded-xl border bg-page text-left transition ${
                                  viewedLocation?.id === l.id ? "border-ledger ring-2 ring-ledger/15" : "border-line hover:border-line-strong"
                                }`}
                              >
                                <img src={l.image} alt={l.name} className="aspect-[4/3] w-full object-cover" />
                                <span className="block px-2 py-2">
                                  <span className="block truncate text-[13px] font-semibold">{l.name}</span>
                                  <span className="flex justify-between gap-2 text-[13px] tabular-nums">
                                    <span className="text-graphite">Fit {l.audit.compatibility_score}</span>
                                    <span>{priced(l.pricing, l.pricing.total_extra_usd)}</span>
                                  </span>
                                  {chosen && (
                                    <span className="mt-1 inline-flex items-center gap-1 text-[13px] font-semibold text-[#2E7D32]">
                                      <Check className="h-3.5 w-3.5" aria-hidden /> In budget
                                    </span>
                                  )}
                                </span>
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    )}

                    {viewedLocation && (
                      <div className="space-y-4">
                        <div className="grid items-start gap-5 sm:grid-cols-[13rem_minmax(0,1fr)]">
                          <figure className="mx-auto w-full max-w-[16rem] rounded-xl border border-line bg-page p-2 pb-3 shadow-sheet sm:w-52">
                            <img src={viewedLocation.image} alt={viewedLocation.name} className="aspect-[4/3] w-full rounded-lg object-cover" />
                            <figcaption className="mt-2 text-center text-[13px] italic text-graphite">{viewedLocation.name}</figcaption>
                          </figure>
                          <div>
                            <p className="text-[13px] text-graphite">Fit for this scene</p>
                            <p className="text-[40px] font-extrabold leading-[48px] tracking-[-0.03em] tabular-nums">
                              {viewedLocation.audit.compatibility_score}
                              <span className="text-[18px] font-normal text-graphite">/100</span>
                            </p>
                            <p className="mt-1 text-[15px] leading-relaxed">{viewedLocation.audit.location_summary}</p>
                            <p className="mt-2 text-[13px] leading-relaxed text-graphite">{viewedLocation.audit.practical_vs_vfx_verdict}</p>
                          </div>
                        </div>

                        <div>
                          <h3 className="mb-1 text-[15px] font-semibold">Hazards and rigging</h3>
                          {viewedLocation.pricing.hazards.length === 0 ? (
                            <p className="text-[15px] text-graphite">No extra rigging needed.</p>
                          ) : (
                            <ul className="divide-y divide-line">
                              {viewedLocation.pricing.hazards.map((h, i) => (
                                <li key={i} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 py-3">
                                  <div className="min-w-0">
                                    <p className="flex flex-wrap items-center gap-x-2">
                                      <span className="text-[15px] font-semibold">{HAZARD_LABEL[h.hazard_type] || h.hazard_type}</span>
                                      <span className={`text-[13px] ${RISK_TEXT[h.severity]}`}>{RISK_LABEL[h.severity]}</span>
                                    </p>
                                    <p className="mt-1 text-[13px] leading-relaxed">
                                      <span className="text-graphite">Seen: </span>
                                      {h.visual_evidence}
                                    </p>
                                    <p className="mt-1 text-[13px] leading-relaxed">
                                      <span className="text-graphite">Needs: </span>
                                      {h.mitigation_equipment_needed}
                                    </p>
                                  </div>
                                  <div className="text-right tabular-nums">
                                    <p className="text-[15px] font-semibold">{priced(viewedLocation.pricing, h.cost_usd)}</p>
                                    {h.extra_setup_hours > 0 && <p className="text-[13px] text-graphite">+{h.extra_setup_hours} hrs</p>}
                                  </div>
                                </li>
                              ))}
                            </ul>
                          )}
                          <div className="mt-2 flex justify-between gap-4 border-t border-ink pt-2 text-[15px] font-semibold tabular-nums">
                            <span>Location prep total</span>
                            <span>{priced(viewedLocation.pricing, viewedLocation.pricing.total_extra_usd)}</span>
                          </div>
                        </div>

                        <div className="flex flex-wrap justify-between gap-3">
                          <button type="button" onClick={() => removeLocation(viewedLocation.id)} disabled={!!busy} className="btn-secondary">
                            <Trash2 className="h-4 w-4" aria-hidden /> Remove
                          </button>
                          <button
                            type="button"
                            onClick={() => chooseLocation(viewedLocation.id)}
                            disabled={!!busy}
                            className={viewedLocation.id === chosenLocationId ? "btn-secondary" : "btn-primary"}
                          >
                            {viewedLocation.id === chosenLocationId ? "Remove from budget" : "Use this location in the budget"}
                          </button>
                        </div>
                      </div>
                    )}
                  </>
                ))}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
