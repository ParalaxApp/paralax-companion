# Notes for Claude

- Electron app (main.js = main process, preload.js = bridge, app/ = windows). Keep code commented in plain English: the owner designs and is learning to code.
- It must NEVER touch Star Citizen: no reading game memory or files, no injecting, no sending keys or mouse input to the game (Easy Anti-Cheat). It only draws its own windows.
- SECURITY FIRST (owner's standing rule, Nov 2026): raise privacy/security risks before building. The keyboard listener and clipboard check only run while StarCitizen.exe is running; clipboard text is never kept; the UEX key is encrypted (safeStorage) and never sent to the windows; usage data is opt-in only; windows are locked down (no navigation, new windows, permissions; IPC checked; links allowlisted). Don't weaken any of this.
- Before every release: run an independent security + privacy review with a fresh agent, fix findings, update README's "Privacy: exactly what it looks at" section.
- Releases: bump package.json version; GitHub Actions builds and publishes to ParalaxApp/paralax-companion-download with SHA-256 checksums. Dependencies are pinned (package-lock.json + npm ci); keep it that way.
