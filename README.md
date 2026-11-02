# Paralax Verse Companion

An in-game companion overlay for Star Citizen, from [Paralax Verse](https://paralaxverse.com).
Press a hotkey in game and a panel slides in over Star Citizen. Press it again and it's gone.

**Unofficial fan project. Not affiliated with Cloud Imperium Games.** Free and non-commercial.

## What it does

| Tab | What you get |
| --- | --- |
| **Light** | The light at any place right now, when golden hour comes next, and today's sunrise, golden hour and sunset times. |
| **Spots** | Scenic spots on the planet or moon you pick, straight from paralaxverse.com, with photo, best light and the scout's tip. |
| **Trade** | Search any commodity: the cheapest places to buy, the best places to sell, and the margin. Data from [UEX](https://uexcorp.space), reported by players. Needs a free UEX key. |
| **Photo** | Photo mode keys and tips, a button to open your screenshots folder, and a quick link to post a spot. |
| **Settings** | Hotkey, light strip on or off and which corner, golden hour warning, UEX key, screenshots folder, start with Windows. |

There's also a **light strip**: a small bar in a corner of your screen showing the light where you are. It glows yellow when golden hour is close. Clicks go straight through it to the game.

## Using it

1. Run Star Citizen in **Borderless** window mode (Graphics settings). Nothing can appear over true full screen.
2. Start **Paralax Verse Companion**. It sits in the Windows tray (bottom right).
3. In game, press **Insert** to show or hide the panel. You can change the key in Settings.
4. For trade prices: sign in at uexcorp.space, go to **API → My Apps**, create an app, and paste its key into **Settings → Trade data**.

## Safe with Easy Anti-Cheat?

The companion never touches the game. It doesn't read the game's memory or files, doesn't inject anything and never presses keys or moves the mouse for you. It only draws its own windows on top. It has **not** been officially approved by Cloud Imperium Games; we've asked them and will post their answer here.

## Privacy: exactly what it looks at

- **Running programs:** every 5 seconds it checks whether `StarCitizen.exe` is running (just the name).
- **Keyboard:** only while Star Citizen is running, it listens for your one hotkey (and the arrow keys while the panel is open), like push-to-talk in Discord. It never records or sends key presses. When the game isn't running, the listener is switched off.
- **Clipboard:** only while Star Citizen is running, it checks for a `/showlocation` line once a second. It never keeps your clipboard: only a fingerprint (hash) to notice changes, and the three coordinates if it was a `/showlocation` line. Off switch in Settings.
- **Feedback data:** a random ID, the version and Windows/Linux, so we can count users. Nothing about you or your game. Off switch in Settings.
- **Downloads** come with a SHA-256 fingerprint on the release page, so you can check yours is genuine.

All the code is here for anyone to read.

## How it was made

Designed by Paralax and built with help from AI (Claude). Every change is in this repository's history.

## For developers

- Built with [Electron](https://www.electronjs.org/). `main.js` makes the windows, the hotkey and the tray icon; `preload.js` is the small, safe bridge; `app/` is the panel (`index.html`, `app.js`, `style.css`) and the light strip (`hud.html`, `hud.js`).
- `app/dn.js` is the day and night maths copied from the Paralax Verse website. Day and night data comes from the game's files, collated by Murphy Exploration Group and shared by the VerseTime project.
- Windows installers are built automatically by GitHub (see `.github/workflows/build.yml`). Each new version in `package.json` is published to the download page automatically.
- Run it locally: `npm install`, then `npm start`.

## Licence

GPL-3.0-or-later (see `LICENSE`). The day and night data comes from the VerseTime project, which is GPL-3.
Star Citizen®, Roberts Space Industries® and Cloud Imperium® are registered trademarks of Cloud Imperium Rights LLC.
