import React, { useEffect, useState } from "react";
import { ChevronRight, Clapperboard, FolderOpen, LogOut, MapPin, Pencil, Plus, Trash2, Tv } from "lucide-react";
import { signOut } from "firebase/auth";
import {
  addDoc, collection, count, deleteDoc, doc, getAggregateFromServer, getDocs, orderBy, query,
  serverTimestamp, sum, updateDoc, writeBatch,
} from "firebase/firestore";
import { auth, db } from "./firebase";
import { inAppClick } from "./nav";

export const usd = (n) => `$${Math.round(n).toLocaleString()}`;
export const TYPE_LABEL = { FILM: "Film", SERIES: "Web series" };
export const projectsRef = (uid) => collection(db, "users", uid, "projects");
export const scenesRefOf = (uid, projectId) => collection(db, "users", uid, "projects", projectId, "scenes");
export const cityOf = (hubs, id) => hubs[id]?.name.split(" (")[0] ?? id;
// Firestore Timestamp → ms; docs written this session still hold a pending sentinel, so they sort as newest.
export const millis = (t) => t?.toMillis?.() ?? Infinity;

// The version of a scene that counts toward rollups: the applied rewrite, else the original draft.
export const countedOf = (s) => (s.appliedRewrite && s.revised ? s.revised : s.result);

const localMoney = (hubs, hubId, amountUsd) => {
  const h = hubs[hubId];
  return h?.fx_from_usd ? `${h.currency}${Math.round(amountUsd * h.fx_from_usd).toLocaleString()}` : usd(amountUsd);
};

// Logo mark: a clapperboard (the film) carrying an amber trajectory (the physics). Same drawing as public/favicon.svg.
export function LogoMark({ className = "h-8 w-8" }) {
  return (
    <svg viewBox="0 0 64 64" className={`shrink-0 ${className}`} aria-hidden focusable="false">
      <rect width="64" height="64" rx="15" fill="#1E3A8A" />
      <g transform="rotate(-10 13 24)">
        <rect x="13" y="13" width="38" height="9" rx="2" fill="#FFFFFF" />
        <path d="M21 13h6l-4 9h-6zM33 13h6l-4 9h-6zM45 13h6v1.5L47.5 22h-5.5z" fill="#D97706" />
      </g>
      <rect x="13" y="26" width="38" height="26" rx="3.5" fill="#FFFFFF" />
      <path d="M18.5 46.5C24 31 33 29.5 44.5 40.5" fill="none" stroke="#D97706" strokeWidth="3.6" strokeLinecap="round" />
      <circle cx="44.5" cy="40.5" r="3.6" fill="#1E3A8A" />
      <path d="M18 46.5h28" stroke="#CBD5E1" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

// Brand lockup: the mark, then "Script" in ink and "Physics" in amber. `stacked` puts the mark above the name.
export function Wordmark({ className = "text-[24px]", markClassName = "h-8 w-8", stacked = false }) {
  return (
    <span
      className={`inline-flex items-center font-extrabold leading-none tracking-[-0.025em] ${
        stacked ? "flex-col gap-4" : "gap-2.5"
      } ${className}`}
    >
      <LogoMark className={markClassName} />
      <span>
        Script<span className="text-amber">Physics</span>
      </span>
    </span>
  );
}

// Breadcrumb labels are capped at 25 characters (24 + "…"); the full text stays in the tooltip.
const CRUMB_MAX = 25;
const crumbText = (label = "") => (label.length > CRUMB_MAX ? `${label.slice(0, CRUMB_MAX - 1).trimEnd()}…` : label);

const initialsOf = (name = "") =>
  name.split(" ").filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join("") || "?";

// `width` matches the page body below it, so the header lines up with the content.
export function AppHeader({ user, crumbs = [], children, width = "max-w-[1100px]" }) {
  return (
    <header className="relative border-b border-line bg-page">
      <div className={`mx-auto flex ${width} flex-wrap items-end justify-between gap-x-6 gap-y-4 px-5 py-4 sm:px-8`}>
        <div className="min-w-0 max-sm:pr-12">
          <h1>
            <Wordmark />
          </h1>
          <nav aria-label="Breadcrumb" className="mt-2">
            <ol className="-ml-2 flex flex-wrap items-center gap-1 text-[14px] leading-5">
              {crumbs.length === 0 && <li className="text-graphite">Screenplay breakdown and line budget</li>}
              {crumbs.map((c, i) => (
                <li key={i} className="flex min-w-0 items-center gap-1">
                  {i > 0 && <ChevronRight className="h-4 w-4 shrink-0 text-graphite/60" aria-hidden />}
                  {c.onClick ? (
                    <a
                      href={c.href ?? "#"}
                      onClick={inAppClick(c.onClick)}
                      title={c.label.length > CRUMB_MAX ? c.label : undefined}
                      className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 font-semibold text-ledger underline-offset-4 transition-colors hover:bg-ledger/5 hover:underline"
                    >
                      {i === 0 && <FolderOpen className="h-4 w-4" aria-hidden />}
                      {crumbText(c.label)}
                    </a>
                  ) : (
                    <span
                      className="inline-flex min-w-0 items-center gap-1.5 rounded-md bg-amber-soft px-2 py-1 font-semibold text-amber-deep"
                      aria-current="page"
                      title={c.label.length > CRUMB_MAX ? c.label : undefined}
                    >
                      {i === 0 && <FolderOpen className="h-4 w-4 shrink-0" aria-hidden />}
                      <span className="whitespace-nowrap">{crumbText(c.label)}</span>
                    </span>
                  )}
                </li>
              ))}
            </ol>
          </nav>
        </div>
        {/* Page controls and sign-out stay in one group so the header never re-wraps as data loads. */}
        <div className={`flex w-full flex-wrap items-end justify-end gap-3 sm:ml-auto sm:w-auto ${children ? "" : "max-sm:contents"}`}>
          {children}
          {/* On phones the sign-out collapses to an avatar in the top-right corner. */}
          <button
            type="button"
            onClick={() => signOut(auth)}
            className="btn-secondary pl-2 max-sm:absolute max-sm:right-4 max-sm:top-3.5 max-sm:min-h-0 max-sm:border-transparent max-sm:p-1"
            title={`Sign out ${user.email ?? ""}`}
          >
            <span
              className="flex h-7 w-7 items-center justify-center rounded-full bg-ledger text-[11px] font-bold text-white"
              aria-hidden
            >
              {initialsOf(user.displayName)}
            </span>
            <span className="max-sm:sr-only">Sign out</span>
            <LogOut className="h-4 w-4 text-graphite max-sm:hidden" aria-hidden />
          </button>
        </div>
      </div>
    </header>
  );
}

const ErrorLine = ({ error }) =>
  error ? (
    <p role="alert" className="text-[15px] text-[#BA1A1A]">
      {error}
    </p>
  ) : null;

function ProjectForm({ hubs, initial, onSubmit, onCancel, submitLabel }) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [type, setType] = useState(initial?.type ?? "FILM");
  const [defaultHub, setDefaultHub] = useState(initial?.defaultHub ?? "MUMBAI_OTT");
  const [saving, setSaving] = useState(false);
  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setSaving(true);
        await onSubmit({ title: title.trim(), type, defaultHub }).finally(() => setSaving(false));
      }}
    >
      <label className="block text-[13px] text-graphite">
        Title
        <input
          required
          autoFocus
          maxLength={120}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Monsoon Run"
          className="field mt-1 w-full"
        />
      </label>
      {!initial && (
        <fieldset>
          <legend className="mb-1 text-[13px] text-graphite">Type</legend>
          <div className="grid grid-cols-2 gap-2">
            {[
              ["FILM", "Film", Clapperboard],
              ["SERIES", "Web series", Tv],
            ].map(([id, label, Icon]) => (
              <label
                key={id}
                className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2.5 text-[15px] font-semibold transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ledger-ring ${
                  type === id
                    ? "border-ledger bg-ledger/5 text-ledger ring-1 ring-ledger"
                    : "border-line-strong text-ink hover:bg-mist"
                }`}
              >
                <input type="radio" name="type" value={id} checked={type === id} onChange={() => setType(id)} className="sr-only" />
                <Icon className="h-4 w-4" aria-hidden /> {label}
              </label>
            ))}
          </div>
        </fieldset>
      )}
      <label className="block text-[13px] text-graphite">
        Default shoot city
        <select value={defaultHub} onChange={(e) => setDefaultHub(e.target.value)} className="field mt-1 w-full">
          {Object.entries(hubs).map(([id, h]) => (
            <option key={id} value={id}>
              {h.name} · {h.currency_code}
            </option>
          ))}
        </select>
        <span className="mt-1 block">New scenes start here; any scene can be priced elsewhere.</span>
      </label>
      <div className="flex justify-end gap-3">
        {onCancel && (
          <button type="button" onClick={onCancel} className="btn-secondary">
            Cancel
          </button>
        )}
        <button type="submit" disabled={saving || !title.trim()} className="btn-primary">
          {saving ? "Saving…" : submitLabel}
        </button>
      </div>
    </form>
  );
}

export function ProjectList({ user, hubs, onOpen }) {
  const [projects, setProjects] = useState(null);
  const [stats, setStats] = useState({});
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    getDocs(query(projectsRef(user.uid), orderBy("updatedAt", "desc")))
      .then((snap) => {
        const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        setProjects(list);
        setCreating(list.length === 0);
        // One aggregation query per project: scene count and summed USD, without downloading the scenes.
        list.forEach((p) =>
          getAggregateFromServer(scenesRefOf(user.uid, p.id), { scenes: count(), totalUsd: sum("totalUsd") })
            .then((agg) => setStats((s) => ({ ...s, [p.id]: agg.data() })))
            .catch(() => {})
        );
      })
      .catch((e) => setError(`Could not load your projects: ${e.message}`));
  }, [user.uid]);

  const create = async (fields) => {
    try {
      const data = { ...fields, createdAt: serverTimestamp(), updatedAt: serverTimestamp() };
      const ref = await addDoc(projectsRef(user.uid), data);
      onOpen({ id: ref.id, ...data });
    } catch (e) {
      setError(`Could not create the project: ${e.message}`);
    }
  };

  return (
    <>
      <AppHeader user={user} crumbs={[{ label: "Projects" }]} />
      <main className="mx-auto max-w-[1100px] space-y-8 px-5 py-8 sm:px-8 sm:py-12">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="text-[26px] font-extrabold leading-[34px] tracking-[-0.02em] sm:text-[32px] sm:leading-[40px] sm:tracking-[-0.025em]">
              Your projects
            </h2>
            <p className="mt-1 text-[15px] text-graphite">Each film or web series holds its scenes and rolls up their budgets.</p>
          </div>
          {!creating && projects?.length > 0 && (
            <button type="button" onClick={() => setCreating(true)} className="btn-primary">
              <Plus className="h-4 w-4" aria-hidden /> New project
            </button>
          )}
        </div>
        <ErrorLine error={error} />

        {creating && (
          <section aria-label="New project" className="card max-w-lg p-6 sm:p-8">
            <h3 className="mb-5 text-[18px] font-bold tracking-[-0.01em]">
              {projects?.length ? "New project" : "Create your first project"}
            </h3>
            <ProjectForm
              hubs={hubs}
              onSubmit={create}
              onCancel={projects?.length ? () => setCreating(false) : null}
              submitLabel="Create project"
            />
          </section>
        )}

        {projects === null && !error && <p className="text-[15px] text-graphite">Loading projects…</p>}

        <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {projects?.map((p) => {
            const st = stats[p.id];
            const Icon = p.type === "SERIES" ? Tv : Clapperboard;
            return (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => onOpen(p)}
                  className="card group flex h-full w-full flex-col gap-4 p-6 text-left transition duration-150 hover:-translate-y-px hover:border-line-strong hover:shadow-paper"
                >
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="chip">
                      <Icon className="h-3.5 w-3.5" aria-hidden /> {TYPE_LABEL[p.type]}
                    </span>
                    <span className="chip">{cityOf(hubs, p.defaultHub)}</span>
                  </span>
                  <span className="text-[18px] font-bold leading-[26px] tracking-[-0.01em] group-hover:text-ledger">{p.title}</span>
                  <span className="mt-auto flex items-end justify-between gap-3 border-t border-desk pt-4 tabular-nums">
                    <span className="text-[13px] text-graphite">
                      {st ? `${st.scenes} scene${st.scenes === 1 ? "" : "s"}` : "…"}
                    </span>
                    <span className="text-[20px] font-extrabold tracking-[-0.02em] text-ledger">
                      {st ? localMoney(hubs, p.defaultHub, st.totalUsd ?? 0) : ""}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </main>
    </>
  );
}

export const episodeLabel = (season, episode) =>
  `S${season.number} · E${episode.number}${episode.title ? ` · ${episode.title}` : ""}`;

// Seasons → episodes → scenes for a series: the project's saved structure, plus any season/episode
// numbers found only on scenes (series created before seasons were explicit), so no scene is orphaned.
export function seasonsOf(project, scenes) {
  const seasons = new Map();
  const seasonAt = (n, title = "") => {
    if (!seasons.has(n)) seasons.set(n, { number: n, title, episodes: new Map() });
    return seasons.get(n);
  };
  const episodeAt = (season, n, title = "") => {
    if (!season.episodes.has(n)) season.episodes.set(n, { number: n, title, scenes: [] });
    return season.episodes.get(n);
  };
  (project.seasons ?? []).forEach((s) => {
    const season = seasonAt(s.number, s.title ?? "");
    (s.episodes ?? []).forEach((e) => episodeAt(season, e.number, e.title ?? ""));
  });
  [...scenes]
    .filter((sc) => sc.season != null)
    .sort((a, b) => millis(a.createdAt) - millis(b.createdAt))
    .forEach((sc) => episodeAt(seasonAt(sc.season), sc.episode).scenes.push(sc));
  return [...seasons.values()]
    .sort((a, b) => a.number - b.number)
    .map((s) => ({ ...s, episodes: [...s.episodes.values()].sort((a, b) => a.number - b.number) }));
}

// The shape stored on the project doc: structure and titles only, never scenes.
const seasonsDoc = (seasons) =>
  seasons.map((s) => ({ number: s.number, title: s.title, episodes: s.episodes.map((e) => ({ number: e.number, title: e.title })) }));
const nextNumber = (items) => Math.max(0, ...items.map((x) => x.number)) + 1;
const totalOf = (scenes) => scenes.reduce((acc, s) => acc + (s.totalUsd ?? 0), 0);

// "Season 2 · Neon Nights" with a pencil to rename in place; Enter or blur saves, Escape cancels.
function EditableTitle({ label, title, onSave, className = "" }) {
  const [draft, setDraft] = useState(null);
  if (draft === null)
    return (
      <span className={`inline-flex items-center gap-2 ${className}`}>
        {label}
        {title ? ` · ${title}` : ""}
        <button type="button" onClick={() => setDraft(title)} aria-label={`Rename ${label}`} className="text-graphite hover:text-ink">
          <Pencil className="h-3.5 w-3.5" aria-hidden />
        </button>
      </span>
    );
  const commit = () => {
    const next = draft.trim();
    setDraft(null);
    if (next !== title) onSave(next);
  };
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      {label} ·
      <input
        autoFocus
        maxLength={80}
        value={draft}
        placeholder="Title (optional)"
        aria-label={`${label} title`}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          }
          if (e.key === "Escape") setDraft(null);
        }}
        className="field py-1 text-[13px] font-normal"
      />
    </span>
  );
}

function SceneRow({ s, hubs, onOpenScene, nested = false }) {
  const f = countedOf(s)?.financials;
  return (
    <tr className="border-t border-desk transition-colors hover:bg-mist">
      <td className={`${nested ? "pl-14" : "pl-6"} pr-3 py-3.5`}>
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <button type="button" onClick={() => onOpenScene(s.id)} className="text-left font-semibold transition-colors hover:text-ledger">
            {s.title}
          </button>
          {s.appliedRewrite && <span className="chip chip-amber">Revised</span>}
          {s.locationUsd > 0 && (
            <span className="chip" title="Total includes the chosen location's prep cost">
              <MapPin className="h-3 w-3" aria-hidden /> {s.locationName ?? "location"}
            </span>
          )}
        </span>
      </td>
      <td className="px-3 py-3.5 text-graphite">{cityOf(hubs, s.hub)}</td>
      <td className="px-3 py-3.5 text-right font-semibold">{f ? `${f.currency}${f.total_local.toLocaleString()}` : "—"}</td>
      <td className="px-6 py-3.5 text-right text-graphite">{usd(s.totalUsd ?? 0)}</td>
    </tr>
  );
}

export function ProjectOverview({ user, hubs, project, scenes, onBack, onOpenScene, onProjectChange, onScenesDeleted, onDeleted }) {
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const isSeries = project.type === "SERIES";
  const seasons = isSeries ? seasonsOf(project, scenes) : [];
  const films = isSeries ? [] : [...scenes].sort((a, b) => millis(a.createdAt) - millis(b.createdAt));
  const pm = (amountUsd) => localMoney(hubs, project.defaultHub, amountUsd);
  const subtotal = (list) => `${pm(totalOf(list))} · ${usd(totalOf(list))}`;
  const projectDoc = doc(projectsRef(user.uid), project.id);

  const guarded = async (what, fn) => {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(`Could not ${what}: ${e.message}`);
    } finally {
      setBusy(false);
    }
  };

  const save = (fields) =>
    guarded("save the project", async () => {
      const data = { title: fields.title, defaultHub: fields.defaultHub, updatedAt: serverTimestamp() };
      await updateDoc(projectDoc, data);
      onProjectChange({ ...project, ...data });
      setEditing(false);
    });

  // Seasons and episodes live on the project doc, so empty ones persist.
  const saveSeasons = async (next) => {
    const data = { seasons: seasonsDoc(next), updatedAt: serverTimestamp() };
    await updateDoc(projectDoc, data);
    onProjectChange({ ...project, ...data });
  };

  // numbers aren't reused or compacted after a delete (that would mean rewriting scene docs), so gaps are allowed.
  const addSeason = () =>
    guarded("add a season", () => saveSeasons([...seasons, { number: nextNumber(seasons), title: "", episodes: [] }]));
  const addEpisode = (sn) =>
    guarded("add an episode", () =>
      saveSeasons(
        seasons.map((s) =>
          s.number === sn ? { ...s, episodes: [...s.episodes, { number: nextNumber(s.episodes), title: "", scenes: [] }] } : s
        )
      )
    );
  const rename = (sn, en, title) =>
    guarded("rename", () =>
      saveSeasons(
        seasons.map((s) =>
          s.number !== sn
            ? s
            : en == null
              ? { ...s, title }
              : { ...s, episodes: s.episodes.map((e) => (e.number === en ? { ...e, title } : e)) }
        )
      )
    );

  const deleteSeason = (season) => {
    const ids = season.episodes.flatMap((e) => e.scenes.map((x) => x.id));
    if (!confirm(`Delete Season ${season.number} with ${season.episodes.length} episode(s) and ${ids.length} scene(s)? This can't be undone.`)) return;
    guarded("delete the season", async () => {
      await deleteScenes(user.uid, project.id, ids);
      onScenesDeleted(ids);
      await saveSeasons(seasons.filter((s) => s.number !== season.number));
    });
  };
  const deleteEpisode = (season, episode) => {
    const ids = episode.scenes.map((x) => x.id);
    if (!confirm(`Delete Season ${season.number} · Episode ${episode.number} and its ${ids.length} scene(s)? This can't be undone.`)) return;
    guarded("delete the episode", async () => {
      await deleteScenes(user.uid, project.id, ids);
      onScenesDeleted(ids);
      await saveSeasons(
        seasons.map((s) => (s.number === season.number ? { ...s, episodes: s.episodes.filter((e) => e.number !== episode.number) } : s))
      );
    });
  };

  const remove = () => {
    if (!confirm(`Delete "${project.title}" and its ${scenes.length} scene(s)? This can't be undone.`)) return;
    guarded("delete the project", async () => {
      await deleteScenes(user.uid, project.id, scenes.map((s) => s.id));
      await deleteDoc(projectDoc);
      onDeleted();
    });
  };

  const tableHead = (
    <thead className="border-b border-line bg-mist text-[12px] tracking-[0.01em] text-graphite">
      <tr>
        <th className="px-6 py-3 font-semibold">Scene</th>
        <th className="px-3 py-3 font-semibold">Shoot city</th>
        <th className="px-3 py-3 text-right font-semibold">Cost</th>
        <th className="px-6 py-3 text-right font-semibold">USD</th>
      </tr>
    </thead>
  );
  const tableFoot = (
    <tfoot>
      <tr className="border-t border-line bg-mist text-[15px] font-bold">
        <td colSpan={2} className="px-6 py-4">
          Project total
        </td>
        <td className="px-3 py-4 text-right text-ledger">{pm(totalOf(scenes))}</td>
        <td className="px-6 py-4 text-right text-graphite">{usd(totalOf(scenes))}</td>
      </tr>
    </tfoot>
  );
  const emptyRow = (text) => (
    <tr>
      <td colSpan={4} className="border-t border-desk px-6 py-3 pl-12 text-[13px] italic text-graphite">
        {text}
      </td>
    </tr>
  );
  const iconDelete = (label, onClick) => (
    <button type="button" onClick={onClick} disabled={busy} aria-label={label} title={label} className="rounded p-1 text-graphite transition-colors hover:bg-[#FFDAD6] hover:text-[#BA1A1A]">
      <Trash2 className="h-4 w-4" aria-hidden />
    </button>
  );

  return (
    <>
      <AppHeader user={user} crumbs={[{ label: "Projects", onClick: onBack, href: "/" }, { label: project.title }]} />
      <main className="mx-auto max-w-[1100px] space-y-6 px-5 py-8 sm:px-8 sm:py-12">
        <section className="card flex flex-wrap items-end justify-between gap-6 p-6 sm:p-8">
          <div className="min-w-0">
            <p className="flex flex-wrap items-center gap-2">
              <span className="chip">
                {project.type === "SERIES" ? <Tv className="h-3.5 w-3.5" aria-hidden /> : <Clapperboard className="h-3.5 w-3.5" aria-hidden />}
                {TYPE_LABEL[project.type]}
              </span>
              <span className="chip">Default city · {cityOf(hubs, project.defaultHub)}</span>
            </p>
            <h2 className="mt-3 text-[26px] font-extrabold leading-[34px] tracking-[-0.02em] sm:text-[32px] sm:leading-[40px] sm:tracking-[-0.025em]">
              {project.title}
            </h2>
            <p className="eyebrow mt-5">Project budget</p>
            <p className="text-[40px] font-extrabold leading-[48px] tracking-[-0.03em] text-ledger tabular-nums">{pm(totalOf(scenes))}</p>
            <p className="text-[13px] text-graphite tabular-nums">
              {usd(totalOf(scenes))} across {scenes.length} scene{scenes.length === 1 ? "" : "s"}
              {isSeries && ` in ${seasons.length} season${seasons.length === 1 ? "" : "s"}`}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setEditing((v) => !v)} className="btn-secondary">
              <Pencil className="h-4 w-4" aria-hidden /> Edit project
            </button>
            <button type="button" onClick={remove} disabled={busy} className="btn-secondary text-[#BA1A1A] hover:border-[#FFDAD6] hover:bg-[#FFDAD6]/40">
              <Trash2 className="h-4 w-4" aria-hidden /> Delete
            </button>
            {isSeries ? (
              <button type="button" onClick={addSeason} disabled={busy} className="btn-primary">
                <Plus className="h-4 w-4" aria-hidden /> Add season
              </button>
            ) : (
              <button type="button" onClick={() => onOpenScene("")} className="btn-primary">
                <Plus className="h-4 w-4" aria-hidden /> Add scene
              </button>
            )}
          </div>
        </section>
        <ErrorLine error={error} />

        {editing && (
          <section aria-label="Edit project" className="card max-w-lg p-6 sm:p-8">
            <ProjectForm hubs={hubs} initial={project} onSubmit={save} onCancel={() => setEditing(false)} submitLabel="Save" />
          </section>
        )}

        {isSeries && seasons.length === 0 && (
          <section className="card border-dashed border-line-strong px-6 py-12 text-center shadow-none">
            <Tv className="mx-auto mb-3 h-6 w-6 text-graphite" aria-hidden />
            <p className="text-[15px] text-graphite">No seasons yet. Add Season 1, then its episodes, then their scenes.</p>
          </section>
        )}
        {!isSeries && films.length === 0 && (
          <section className="card border-dashed border-line-strong px-6 py-12 text-center shadow-none">
            <Clapperboard className="mx-auto mb-3 h-6 w-6 text-graphite" aria-hidden />
            <p className="text-[15px] text-graphite">No scenes yet. Add a scene to start budgeting this film.</p>
          </section>
        )}

        {!isSeries && films.length > 0 && (
          <section aria-label="Scenes" className="card overflow-x-auto">
            <table className="w-full min-w-[36rem] text-left text-[15px] tabular-nums">
              {tableHead}
              <tbody>
                {films.map((s) => (
                  <SceneRow key={s.id} s={s} hubs={hubs} onOpenScene={onOpenScene} />
                ))}
              </tbody>
              {tableFoot}
            </table>
          </section>
        )}

        {isSeries && seasons.length > 0 && (
          <section aria-label="Seasons" className="card overflow-x-auto">
            <table className="w-full min-w-[40rem] text-left text-[15px] tabular-nums">
              {tableHead}
              {seasons.map((season) => {
                const seasonScenes = season.episodes.flatMap((e) => e.scenes);
                return (
                  <tbody key={season.number} className="border-b border-line">
                    <tr className="bg-desk/70">
                      <th colSpan={4} className="px-6 py-3.5">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <EditableTitle
                            label={`Season ${season.number}`}
                            title={season.title}
                            onSave={(t) => rename(season.number, null, t)}
                            className="text-[18px] font-bold tracking-[-0.01em]"
                          />
                          <span className="flex items-center gap-3 text-[13px] font-normal">
                            <span className="font-bold text-ink tabular-nums">{subtotal(seasonScenes)}</span>
                            <button type="button" onClick={() => addEpisode(season.number)} disabled={busy} className="btn-secondary btn-sm">
                              <Plus className="h-3.5 w-3.5" aria-hidden /> Add episode
                            </button>
                            {iconDelete(`Delete Season ${season.number}`, () => deleteSeason(season))}
                          </span>
                        </div>
                      </th>
                    </tr>
                    {season.episodes.length === 0 && emptyRow("No episodes yet. Add Episode 1.")}
                    {season.episodes.map((episode) => (
                      <React.Fragment key={episode.number}>
                        <tr className="border-t border-line bg-mist">
                          <th colSpan={4} className="py-2.5 pl-9 pr-6">
                            <div className="flex flex-wrap items-center justify-between gap-3">
                              <EditableTitle
                                label={`Episode ${episode.number}`}
                                title={episode.title}
                                onSave={(t) => rename(season.number, episode.number, t)}
                                className="text-[15px] font-semibold"
                              />
                              <span className="flex items-center gap-3 text-[13px] font-normal">
                                <span className="font-semibold text-slatechip tabular-nums">{subtotal(episode.scenes)}</span>
                                <button
                                  type="button"
                                  onClick={() => onOpenScene("", { season: season.number, episode: episode.number })}
                                  className="btn-secondary btn-sm"
                                >
                                  <Plus className="h-3.5 w-3.5" aria-hidden /> Add scene
                                </button>
                                {iconDelete(`Delete Episode ${episode.number}`, () => deleteEpisode(season, episode))}
                              </span>
                            </div>
                          </th>
                        </tr>
                        {episode.scenes.length === 0 && emptyRow("No scenes yet.")}
                        {episode.scenes.map((s) => (
                          <SceneRow key={s.id} s={s} hubs={hubs} onOpenScene={onOpenScene} nested />
                        ))}
                      </React.Fragment>
                    ))}
                  </tbody>
                );
              })}
              {tableFoot}
            </table>
          </section>
        )}
      </main>
    </>
  );
}

// Deletes scenes and their location photos (Firestore doesn't cascade to subcollections).
// one batch caps at 500 writes; chunk it if a season ever holds more than that.
export async function deleteScenes(uid, projectId, sceneIds) {
  if (!sceneIds.length) return;
  const batch = writeBatch(db);
  for (const id of sceneIds) {
    const sceneRef = doc(scenesRefOf(uid, projectId), id);
    (await getDocs(collection(sceneRef, "locations"))).forEach((l) => batch.delete(l.ref));
    batch.delete(sceneRef);
  }
  await batch.commit();
}

export const deleteScene = (uid, projectId, sceneId) => deleteScenes(uid, projectId, [sceneId]);
