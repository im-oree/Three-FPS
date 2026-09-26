/**
 * lobbyUrl.ts — where the signalling backend lives, for this page.
 *
 * One place, because getting it wrong produces the single most confusing
 * failure in a P2P game: the browser shows an empty list and the host never
 * appears, with nothing in the console to say why.
 *
 * Resolution order:
 *   1. `?lobby=` in the query string. How the acceptance suite points two
 *      browsers at one backend, and how a player joins a friend's relay.
 *   2. `VITE_LOBBY_URL` at build time, for a real deployment.
 *   3. Same origin as the page, path `/lobby`. The dev server proxies this
 *      to the backend, which means the sandbox preview works with no
 *      configuration: the browser is not the sandbox, so it cannot dial
 *      localhost, but it CAN always reach the origin it loaded from.
 */
/**
 * The HTTP origin of the directory, derived from the websocket URL.
 *
 * Kept next to the resolver so the two can never drift onto different hosts,
 * which would show an empty browser while the socket worked perfectly.
 */
export function resolveLobbyHttpBase(): string {
  const ws = resolveLobbyUrl();
  if (ws.startsWith('ws://') || ws.startsWith('wss://')) {
    const url = new URL(ws.replace(/^ws/, 'http'));
    // The dev-server proxy mounts the directory under /lobby; its REST
    // endpoints sit at the origin root.
    return url.pathname === '/lobby' ? url.origin : url.origin;
  }
  return '';
}

export function resolveLobbyUrl(): string {
  if (typeof window === 'undefined') return 'ws://127.0.0.1:8137';

  const fromQuery = new URLSearchParams(window.location.search).get('lobby');
  if (fromQuery) return fromQuery;

  const configured = (import.meta as { env?: Record<string, string> }).env?.VITE_LOBBY_URL;
  if (configured) return configured;

  const scheme = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${scheme}//${window.location.host}/lobby`;
}
