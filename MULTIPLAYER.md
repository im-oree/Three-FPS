# Multiplayer architecture

The game is structurally multiplayer whether or not anyone else is connected.
Single player is not a separate mode — it is a match with one participant,
running the same authoritative server, reached through the same protocol.

## The shape of it

```
          ┌─────────────────────────────┐
          │      src/net/Protocol.ts    │   the ONLY shared surface
          │  C2S / S2C messages, Transport
          └──────────────┬──────────────┘
                         │
      ┌──────────────────┴──────────────────┐
      │                                     │
  GameClient                            GameServer
  (renders, predicts)                   (decides everything)
      │                                     │
      └── Transport ────────────────────────┘
             │
    ┌────────┴─────────┐
    │                  │
LocalTransport   WebSocketTransport
(server in-tab)  (dedicated backend)
```

The client and the server share `Protocol.ts` and nothing else. A change that
does not appear in that file cannot desync them; a change that does appear
there fails the build on whichever side has not handled it.

## Why the local transport pretends to be a socket

`LocalTransport` runs the server in the same tab for single player, and could
have simply called the receiver's handler directly. It does not. Every message
is deep-frozen and delivery is deferred to a microtask.

Both restrictions exist to forbid shortcuts that are only available in-process:

- **Freezing** stops a receiver mutating the sender's object. Over a socket the
  receiver holds a private parse of the JSON, so this bug is impossible there —
  which means in-process code that relied on the shared reference would work
  perfectly until the day a real backend was attached.
- **Deferral** stops the server re-entering a client function synchronously
  mid-call, for the same reason: a socket can never deliver a reply inside the
  send that caused it.

If it works locally, it works remotely. That is the property being bought.

## Purity, enforced

`src/server/**` and `src/net/Protocol.ts` may not import `three`, touch the
DOM, or reach into client directories. This is checked by
`tools/verify/server-purity.mjs` (`npm run verify:purity`), not by convention —
a comment asking for discipline lasts until the first person in a hurry.

Server vectors are plain `[x, y, z]` triples and entities store loose scalars,
so the simulation cannot quietly acquire a renderer type.

## Pause

Pause is a **request**, never a command:

| Players connected | Request honoured | Simulation |
|---|---|---|
| 1 | yes | halts |
| 2+ | no | keeps running |

The server replies with `simulationState` either way and the client renders the
reply. The pause *menu* always opens — a player can always reach settings and
quit — but whether the world stops is not the client's decision.

The server is driven from the engine's **always-updatables** list, not the
state-gated one. The gated list only ticks in `PLAYING`, which would have made
pausing stop the world.

## Rooms

A room owns exactly one `GameServer`. Rooms are a layer *above* the simulation,
not a feature inside it, so the simulation never learns it might be one of
many and nothing written for a single match needs changing to support rooms.

Empty rooms are reaped after 30 seconds; the room count is capped at 64 and
`maxPlayers` is clamped server-side, because both arrive from clients.

## Running the backend

```bash
npm start              # or: npm run backend
PORT=9000 npm start    # hosts inject PORT; default is 8080
```

Endpoints:

- `GET /health` → `{ ok, rooms, protocol, uptime }` (used by Render/Railway)
- `GET /rooms` → the public room list, inspectable with `curl`
- `WS /` → game traffic

`server/index.mjs` contains **no game logic**. It is a socket adapter and a
clock; it imports `src/server/**` unchanged, exactly as the browser does. There
is no server-side copy of any rule to keep in sync, which is what makes a
feature added to a `ServerSystem` live on both sides the moment it is written.

The TypeScript is compiled at boot by esbuild (~50 ms), so there is no build
artifact that can go stale against source.

### Deploying

Blueprints are committed for both hosts: `render.yaml` and `railway.json`. Both
run `npm start` and health-check `/health`. Point the client at the deployment
with `VITE_SERVER_URL=wss://your-host` — `createRemoteSession(url)` then
replaces `createLocalSession()` with no other change.

## Tests

| Command | What it proves |
|---|---|
| `npm run verify:purity` | the server has no renderer/DOM/client dependencies |
| `npm run verify:server` | 24 checks: fixed timestep, pooling, resets, input bounding — **no browser** |
| `npm run verify:session` | 14 checks: the server is really wired into the running game |
| `npm run verify:backend` | 13 checks: rooms and matches over real WebSockets |

`verify:server` running in plain Node is itself the portability claim under
test: the day it needs a browser is the day the server stopped being portable.

## Extending it

Add a `ServerSystem` (`tick`, plus optional `attach` / `onMatchStart` /
`onMatchEnd` / `reset` / `dispose`) and register it with `addSystem`. It runs
identically in the tab and on the backend. `GameServer` deliberately knows
nothing about bullets or helicopters — systems are the only extension point.

Effects are **events**, not objects: the server emits `tracer`, `impact`,
`explosion`, `muzzleFlash`, `sound`, `hitMarker`, `damage`, and the client owns
how they look. The server decides what happened; the client decides how it
appears.
