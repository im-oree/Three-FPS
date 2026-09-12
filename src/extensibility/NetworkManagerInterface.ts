/**
 * NetworkManagerInterface.js — CONTRACT ONLY. No behaviour lives here.
 *
 * This interface exists so a future multiplayer document can implement network
 * synchronisation as new files against this contract, without modifying
 * player, weapon, or combat code. State snapshots flow through the same
 * EventBus/updatable seams the single-player game already uses.
 */

/** Opaque per-tick snapshot of locally-authoritative state. */
export interface StateSnapshot {
  tick: number;
  [key: string]: unknown;
}

export type RemoteStateHandler = (snapshot: StateSnapshot) => void;

export abstract class NetworkManagerInterface {
  /** Open a connection to a game server. */
  abstract connect(serverUrl: string): void;

  /** Close the connection and release resources. */
  abstract disconnect(): void;

  /** Push our authoritative snapshot for the current tick. */
  abstract sendLocalState(stateSnapshot: StateSnapshot): void;

  /** Register the handler invoked for each remote snapshot received. */
  abstract onRemoteStateReceived(handler: RemoteStateHandler): void;
}

export default NetworkManagerInterface;
