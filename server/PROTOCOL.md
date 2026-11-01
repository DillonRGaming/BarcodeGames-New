# BarcodeGames room protocol

One server for every game. It knows nothing about game rules: it only creates rooms,
lets players join them by code, and routes JSON messages between the host app and players.

- WebSocket: `wss://api.barcodegames.fun` (dev: `ws://localhost:8787`)
- HTTP: `GET /rooms/:code` returns `{ code, game, players, maxPlayers, locked, reconnectable[] }`, or 404
  (`reconnectable` = names of players who dropped out and can rejoin)

Every message is JSON with a `type`.

## Host app → server

| type | fields | reply |
|---|---|---|
| `host:create` | `game` (id like `dying-to-know`), `maxPlayers` | `room:created { code, hostToken, game, maxPlayers }` |
| `host:resume` | `code`, `hostToken` | `room:resumed { ...room, players[] }` (rejoin after a disconnect, within 3s) |
| `room:lock` | `locked` (default true) | none; new players are refused, but reconnects still work |
| `player:kick` | `playerId` | `player:removed { playerId }` |
| `room:close` | none | everyone gets `room:closed` |
| `send` | `to` (`playerId` or `'all'`), `data` | players get `msg { data }` |

## Player (website) → server

| type | fields | reply |
|---|---|---|
| `player:join` | `code`, `name`, optional `playerToken` | `room:joined { code, game, player, playerToken, reconnected, hostConnected }` |
| `send` | `data` | host gets `msg { from: playerId, data }` |

Save `playerToken` (the site keeps it in sessionStorage). Sending it back with `player:join`
rejoins as the same player, even if the room is locked or full. Joining with the same name as a
player who is currently disconnected also rejoins as them (`reconnected: true`).

## Server → host

`player:joined { player }`, `player:reconnected { player }`, `player:left { playerId }`, `msg { from, data }`

## Server → players

`msg { data }`, `host:away`, `host:back`, `room:kicked`, `room:closed { reason }`

## Errors

`{ type: 'error', code, message }`, where `code` is one of `ROOM_NOT_FOUND`, `ROOM_FULL`,
`ROOM_LOCKED`, `NAME_TAKEN` or `BAD_REQUEST`. `message` is safe to show players.

## Game messages (`data`)

Each game defines its own `data` shapes between its host app and its web controller.
The server never reads them.
