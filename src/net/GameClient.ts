/**
 * GameClient.ts — the client half of the seam.
 *
 * Owns the connection, sends intent, and holds the latest authoritative
 * state. It does NOT decide anything: it has no opinion on whether a shot
 * hit, whether a killstreak was available, or whether the player is alive.
 * Every one of those answers arrives from the server.
 *
 * This is also where the client's rendering state is kept separate from the
 * server's truth. `snapshot` is what the server said; the renderer
 * interpolates toward it rather than snapping, because snapshots arrive at
 * the tick rate and frames are drawn faster than that. Snapping produces
 * visible stutter on every entity the moment there is any latency at all —
 * including, eventually, zero-latency local play, because the tick rate and
 * the frame rate are still different numbers.
 */
import {
  PROTOCOL_VERSION,
  type ClientTransport, type EntityState, type FxEvent, type InputFrame,
  type DeathWire, type KillfeedWire, type KillstreakSlotState, type LoadoutSpec,
  type MatchStateWire, type PlayerPublicState,
  type S2C, type Snapshot, type Vec3,
} from './Protocol';

export interface GameClientEvents {
  onMatchReady?: (levelId: string, spawn: Vec3, spawnYaw: number) => void;
  onMatchEnded?: (reason: string) => void;
  onFx?: (events: readonly FxEvent[]) => void;
  onPlayerState?: (state: PlayerPublicState) => void;
  onKillstreaks?: (slots: readonly KillstreakSlotState[]) => void;
  onSimulationState?: (running: boolean, reason: string) => void;
  onRejected?: (reason: string) => void;
  /** The server accepted us and assigned an identity. */
  onWelcome?: (playerId: string) => void;
  /** Scoreboard, clock and phase changed. */
  onMatchState?: (state: MatchStateWire) => void;
  /**
   * You died. The death cam runs off this, and a killcam will too: the
   * payload already identifies the killer and both positions.
   */
  onDied?: (death: DeathWire, respawnIn: number) => void;
  /** You are alive again at this spawn. */
  onRespawned?: (pos: Vec3, yaw: number) => void;
  /** Somebody died — killfeed row. */
  onKillfeed?: (entry: KillfeedWire) => void;
}

export class GameClient {
  private unsubscribe: (() => void) | null = null;
  private inputSeq = 0;
  private lastAckSeq = -1;

  /** Latest authoritative snapshot. Read by the renderer, never written. */
  private matchState: MatchStateWire | null = null;
  private latest: Snapshot | null = null;
  /** Previous snapshot, kept so the renderer can interpolate between them. */
  private previous: Snapshot | null = null;
  /** Entity state indexed for O(1) lookup during rendering. */
  private readonly byId = new Map<string, EntityState>();

  private playerId: string | null = null;
  private welcomed = false;
  private connectedAt = 0;
  private simulationRunning = false;

  constructor(
    private readonly transport: ClientTransport,
    private readonly events: GameClientEvents = {},
  ) {}

  async connect(name?: string): Promise<void> {
    await this.transport.connect();
    this.unsubscribe = this.transport.onMessage((msg) => this.receive(msg));
    this.transport.send({ t: 'hello', version: PROTOCOL_VERSION, name });
    this.connectedAt = performance.now();
  }

  /**
   * A live SESSION: the socket is open AND the server has welcomed us. An
   * open-but-unanswered socket is not a session.
   */
  get isConnected(): boolean { return this.transport.connected && this.welcomed; }

  disconnect(): void {
    this.welcomed = false;
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.transport.close();
    this.latest = null;
    this.previous = null;
    this.byId.clear();
  }

  // --- outbound intent -----------------------------------------------------

  joinMatch(
    levelId: string,
    loadout?: LoadoutSpec,
    options: { name?: string; modeId?: string } = {},
  ): void {
    this.transport.send({
      t: 'joinMatch', levelId, loadout, name: options.name, modeId: options.modeId,
    });
  }

  leaveMatch(): void {
    this.transport.send({ t: 'leaveMatch' });
  }

  /**
   * Send one frame of intent.
   *
   * Returns the sequence number so a future client-side prediction layer can
   * keep the frame around and replay it if the server disagrees.
   */
  sendInput(frame: Omit<InputFrame, 'seq'>): number {
    const seq = ++this.inputSeq;
    this.transport.send({ t: 'input', frame: { ...frame, seq } });
    return seq;
  }

  setLoadout(loadout: LoadoutSpec): void {
    this.transport.send({ t: 'setLoadout', loadout });
  }

  callKillstreak(slot: number): void {
    this.transport.send({ t: 'callKillstreak', slot });
  }

  enterVehicle(vehicle: string, seat: string): void {
    this.transport.send({ t: 'enterVehicle', vehicle, seat });
  }

  exitVehicle(): void {
    this.transport.send({ t: 'exitVehicle' });
  }

  /**
   * Ask the server to pause.
   *
   * Deliberately named `request`: the server decides, and in multiplayer it
   * will refuse. UI must react to onSimulationState, never assume this worked.
   */
  requestPause(paused: boolean): void {
    this.transport.send({ t: 'requestPause', paused });
  }

  // --- inbound authority ---------------------------------------------------

  private receive(msg: S2C): void {
    switch (msg.t) {
      case 'welcome':
        this.playerId = msg.playerId;
        // Connected means the SERVER acknowledged us, not that a socket
        // opened. An unanswered socket is not a session.
        this.welcomed = true;
        this.events.onWelcome?.(msg.playerId);
        break;

      case 'rejected':
        this.events.onRejected?.(msg.reason);
        break;

      case 'matchReady':
        this.events.onMatchReady?.(msg.levelId, msg.spawn, msg.spawnYaw);
        break;

      case 'matchEnded':
        this.latest = null;
        this.previous = null;
        this.byId.clear();
        this.events.onMatchEnded?.(msg.reason);
        break;

      case 'snapshot': {
        this.previous = this.latest;
        this.latest = msg.snapshot;
        this.lastAckSeq = msg.snapshot.ackSeq;

        this.byId.clear();
        for (const entity of msg.snapshot.entities) this.byId.set(entity.id, entity);

        if (msg.snapshot.fx?.length) this.events.onFx?.(msg.snapshot.fx);
        break;
      }

      case 'playerState':
        this.events.onPlayerState?.(msg.state);
        break;

      case 'killstreakState':
        this.events.onKillstreaks?.(msg.slots);
        break;

      case 'simulationState':
        this.simulationRunning = msg.running;
        this.events.onSimulationState?.(msg.running, msg.reason);
        break;

      case 'matchState':
        this.matchState = msg.state;
        this.events.onMatchState?.(msg.state);
        break;

      case 'died':
        this.events.onDied?.(msg.death, msg.respawnIn);
        break;

      case 'respawned':
        this.events.onRespawned?.(msg.pos, msg.yaw);
        break;

      case 'killfeed':
        this.events.onKillfeed?.(msg.entry);
        break;

      default:
        break;
    }
  }

  // --- read side, for the renderer -----------------------------------------

  get id(): string | null { return this.playerId; }
  get connected(): boolean { return this.transport.connected; }
  get running(): boolean { return this.simulationRunning; }
  get rttMs(): number { return this.transport.rttMs; }
  get tick(): number { return this.latest?.tick ?? 0; }
  get serverTime(): number { return this.latest?.time ?? 0; }
  get snapshot(): Snapshot | null { return this.latest; }
  /** Latest scoreboard/clock/phase, or null before the first one arrives. */
  get match(): MatchStateWire | null { return this.matchState; }
  get previousSnapshot(): Snapshot | null { return this.previous; }
  get entities(): readonly EntityState[] { return this.latest?.entities ?? []; }
  get removedEntities(): readonly string[] { return this.latest?.removed ?? []; }

  getEntity(id: string): EntityState | undefined { return this.byId.get(id); }

  /** How many inputs are still unacknowledged — the prediction backlog. */
  get pendingInputs(): number { return this.inputSeq - Math.max(0, this.lastAckSeq); }
  /** Highest input sequence the server has confirmed consuming. */
  get acknowledgedSeq(): number { return this.lastAckSeq; }

  get uptimeSeconds(): number {
    return this.connectedAt ? (performance.now() - this.connectedAt) / 1000 : 0;
  }
}
