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
3. In game, press **Ctrl + Shift + P** to show or hide the panel. You can change the key in Settings.
4. For trade prices: sign in at uexcorp.space, go to **API → My Apps**, create an app, and paste its key into **Settings → Trade data**.

## Safe with Easy Anti-Cheat?

The companion never touches the game. It doesn't read the game's memory or files and doesn't inject anything. It only draws its own windows on top, like Discord or Steam pop-ups. No one outside CIG can guarantee their rules won't change, but this is the safest way an overlay can work.

## For developers

- Built with [Electron](https://www.electronjs.org/). `main.js` makes the windows, the hotkey and the tray icon; `preload.js` is the small, safe bridge; `app/` is the panel (`index.html`, `app.js`, `style.css`) and the light strip (`hud.html`, `hud.js`).
- `app/dn.js` is the day and night maths copied from the Paralax Verse website. Day and night data comes from the game's files, collated by Murphy Exploration Group and shared by the VerseTime project.
- Windows installers are built automatically by GitHub (see `.github/workflows/build.yml`). Push a tag like `v0.1.0` to publish a release.
- Run it locally: `npm install`, then `npm start`.
