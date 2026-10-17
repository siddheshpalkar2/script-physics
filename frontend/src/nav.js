// URL ⇄ view, so the browser's back and forward buttons follow the breadcrumbs:
//   /                                   Projects
//   /p/:projectId                       Project
//   /p/:projectId/s/:sceneId            Scene
//   /p/:projectId/new[?season=&episode=] New scene (optionally inside a series episode)
// Firebase Hosting rewrites every path to index.html, and Vite's dev server does the same.

export const HOME = { projectId: null, sceneId: null, episode: null };

export function parseLocation(loc = window.location) {
  const m = loc.pathname.match(/^\/p\/([^/]+)(?:\/(?:s\/([^/]+)|(new)))?\/?$/);
  if (!m) return HOME;
  const q = new URLSearchParams(loc.search);
  const season = Number(q.get("season"));
  const episode = Number(q.get("episode"));
  return {
    projectId: decodeURIComponent(m[1]),
    sceneId: m[2] ? decodeURIComponent(m[2]) : m[3] ? "" : null, // "" = new scene
    episode: m[3] && season > 0 && episode > 0 ? { season, episode } : null,
  };
}

export function urlOf({ projectId, sceneId = null, episode = null }) {
  if (!projectId) return "/";
  const base = `/p/${encodeURIComponent(projectId)}`;
  if (sceneId === null) return base;
  if (sceneId) return `${base}/s/${encodeURIComponent(sceneId)}`;
  return episode ? `${base}/new?season=${episode.season}&episode=${episode.episode}` : `${base}/new`;
}

// For <a href> links that we handle in-app: plain left clicks navigate in place,
// while Cmd/Ctrl/Shift/middle clicks keep the browser's open-in-new-tab behaviour.
export const inAppClick = (onClick) => (e) => {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  e.preventDefault();
  onClick();
};
