# BarcodeGames

Jackbox-style party games. The host runs the **app** on the TV, and players join on their phones at **barcodegames.fun**.

```
app/                  The host app (Electron): what runs on the TV
  core/               Shared by every platform
    main.js           Window + barcode:// file protocol
    preload.js        Gives games window.barcode (server URL, platform)
    shared/           Code every game uses (room-host.js = room server connection)
    games/<id>/       One folder per game (dying-to-know/ = the trivia game)
    electron-builder.base.yml   Build settings shared by all platforms
  linux/              Linux build config + build.sh  →  linux/dist/*.AppImage
  windows/            Windows build config + build.sh / build.bat  →  windows/dist/

web/                  barcodegames.fun (Vercel deploys only this folder)
  index.html          Join page: room code + name (shared by every game)
  shared/             Join shell + room-client.js (phone side of the room server)
  games/games.js      List of games the site knows
  games/<id>/         Each game's phone controller: controller.js, controller.css, assets/

server/               Room server shared by every game (runs on Dillon's PC)
  server.js           Public at wss://api.barcodegames.fun through Cloudflare Tunnel
  PROTOCOL.md         The messages between the app, server and phones

tools/share.sh        Temporary public link to web/ for testing
```

## Running

| What | Command |
|---|---|
| App, using the live server | `cd app/core && npm start` |
| App, using a server on this PC | `cd app/core && npm run start:local` |
| Join site locally | `cd web && python3 -m http.server 8080`, then open http://localhost:8080 |
| Restart the live room server after editing it | `systemctl --user restart barcode-api` |
| Build for Linux | `app/linux/build.sh` |
| Build for Windows | `app/windows/build.sh` (zip; the installer needs wine) or `app\windows\build.bat` on Windows |

Pushing to `main` redeploys barcodegames.fun.

## Adding a game

1. `app/core/games/<id>/`: the TV side. Create a `new RoomHost({ game: '<id>' })`.
2. `web/games/<id>/controller.js` + `controller.css`: the phone side. Register it with
   `BarcodeJoin.registerController('<id>', ...)`.
3. Add `<id>` to `web/games/games.js`.

Room codes work for every game, so players always type the code at barcodegames.fun and get that game's phone screen.
