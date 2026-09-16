/**
 * LobbyProtocol.ts — how hosts advertise games and guests find them.
 *
 * Deliberately separate from Protocol.ts. That file is the SIMULATION wire:
 * inputs, snapshots, damage. This one is discovery and introduction, and it
 * stops at the moment the peer connection opens. Keeping them apart is what
 * lets the backend stay a directory rather than creeping into a game server:
 * nothing in here carries game state, so there is nothing for it to
 * authoritatively decide.
 *
 * The flow:
 *   host  -> hostGame      "I am running a match, list me"
 *   guest -> listGames     "what is out there"
 *   guest <- gameList      the server browser's rows
 *   guest -> joinGame      "introduce me to host X"
 *   host  <- guestArrived  "guest G wants in, here is their id"
 *   ...    signal          SDP offer/answer + ICE, relayed verbatim
 *   (peer connection opens; the backend is no longer involved)
 */

/** One row in the server browser. */
export interface GameListing {
  readonly id: string;
  /** Host-chosen lobby name, already sanitised by the server. */
  readonly name: string;
  readonly levelId: string;
  readonly modeId: string;
  readonly playerCount: number;
  readonly maxPlayers: number;
  /** True once the match is live rather than sitting in the lobby. */
  readonly inProgress: boolean;
  readonly hasPassword: boolean;
  /**
   * Round-trip time from the SIGNALING server to the host, in ms.
   *
   * An honest approximation, and labelled as such: the true figure is
   * guest-to-host, which cannot be known until the peer connection exists.
   * The browser refines it to the real peer RTT once connected.
   */
  readonly pingMs: number;
  /** Seconds since the host last checked in, for stale-row pruning. */
  readonly ageSeconds: number;
}

/** Guest and host both authenticate their signalling with this. */
export type PeerId = string;

export type LobbyC2S =
  | {
    readonly t: 'hostGame';
    readonly name: string;
    readonly levelId: string;
    readonly modeId: string;
    readonly maxPlayers: number;
    readonly password?: string;
  }
  /** Keep the listing alive and refresh its player count. */
  | { readonly t: 'heartbeat'; readonly playerCount: number; readonly inProgress: boolean }
  | { readonly t: 'stopHosting' }
  | { readonly t: 'listGames' }
  | { readonly t: 'joinGame'; readonly gameId: string; readonly password?: string }
  /**
   * Relay a signalling payload to the other peer.
   *
   * `to` is a peer id the server issued; a client cannot invent one, so this
   * cannot be used to spray offers at arbitrary sessions.
   */
  | { readonly t: 'signal'; readonly to: PeerId; readonly payload: unknown }
  | { readonly t: 'ping'; readonly id: number };

export type LobbyS2C =
  | { readonly t: 'lobbyWelcome'; readonly peerId: PeerId }
  | { readonly t: 'hosting'; readonly gameId: string }
  | { readonly t: 'gameList'; readonly games: readonly GameListing[] }
  /** A guest wants in. The host answers by opening a peer connection. */
  | { readonly t: 'guestArrived'; readonly peerId: PeerId }
  /** The introduction succeeded; start signalling with this peer. */
  | { readonly t: 'joinAccepted'; readonly gameId: string; readonly hostPeerId: PeerId }
  | { readonly t: 'joinRejected'; readonly reason: string }
  | { readonly t: 'signal'; readonly from: PeerId; readonly payload: unknown }
  /** The other side went away before the peer connection came up. */
  | { readonly t: 'peerGone'; readonly peerId: PeerId }
  | { readonly t: 'pong'; readonly id: number };

/** Listings older than this are dropped: the host's tab was closed. */
export const LISTING_TIMEOUT_SECONDS = 15;
/** How often a host should check in. Comfortably inside the timeout. */
export const HEARTBEAT_SECONDS = 5;

/**
 * Trim a host-supplied lobby name to something safe to render.
 *
 * Server-side, because a name arrives from a client and ends up in every
 * other player's DOM. Mirrors the game's own NameAuthority rules.
 */
export function sanitiseLobbyName(raw: unknown, fallback = 'UNNAMED LOBBY'): string {
  if (typeof raw !== 'string') return fallback;
  const cleaned = raw
    // Control characters and angle brackets never belong in a display name.
    .replace(/[\u0000-\u001f<>]/g, '')
    .trim()
    .slice(0, 28);
  return cleaned.length > 0 ? cleaned : fallback;
}
