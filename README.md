# InstanceSwitcher

A Vencord / Equicord userplugin that lets the Discord desktop client connect to **Discord-compatible servers** (Spacebar, FossCORD, MeowCORD and similar) and switch between them, and real Discord, with one click. Each server keeps its own logins.

It is built for the desktop client. It works by pointing the client's own endpoints at the server you pick, so you keep the same client, themes and plugins on every server.

> **Disclaimer.** Client modifications are against Discord's Terms of Service. On the built-in "Discord" entry the plugin changes nothing about how the client talks to Discord, but the plugin is still a client mod. Use it at your own risk.

---

## Contents

- [Features](#features)
- [Requirements](#requirements)
- [Install](#install)
- [Using it](#using-it)
- [FossCORD/MeowCORD servers and encrypted DMs](#fosscordmeowcord-servers-and-encrypted-dms)
- [Settings](#settings)
- [How it works](#how-it-works)
- [Troubleshooting](#troubleshooting)
- [Security notes](#security-notes)
- [Project layout](#project-layout)

---

## Features

**Switching**
- Instance list with status dots, favicons, reordering and a "Connected" marker
- One-click **Connect**, or Ctrl+Alt+1 to 9 for the Nth instance
- A **separate set of accounts per instance**: switching saves and restores everything account-related, including the account switcher's list
- Add an instance from just its URL, using a template (`/api`, `/gateway`, base URL as CDN), with optional per-field overrides
- Edit, remove, **Log out of this instance**, import and export (endpoints only, never logins)
- Small badge showing which instance you are on, so you never mix it up with real Discord
- Emergency revert to real Discord with Ctrl+Alt+Shift+D

**Making a clone feel like Discord**
- Discord hostnames in settings, boost and invite screens are shown as your instance's host
- Client-side verification shim, so servers without email verification do not lock chat behind "claim your account"
- Server tags such as **OFFICIAL** and **AI** drawn from the account's public flags
- Fallback checks for messages the live connection missed, with optional extras (see [Settings](#settings))

**End-to-end encrypted DMs**
- Per-server **FossCORD/MeowCORD server** switch that loads the server's own E2EE client

---

## Requirements

- Vencord or Equicord **built from source** (userplugins are not supported by the prebuilt installers)
- The Discord **desktop** client
- Node and pnpm, as your Vencord / Equicord checkout already requires

---

## Install

1. Copy this folder to `src/userplugins/InstanceSwitcher/` in your Vencord / Equicord checkout. It must contain:
   - `index.tsx`
   - `native.ts`
   - `e2ee.js` (required to build, even if you never use encrypted DMs)
2. Build and inject:
   ```sh
   pnpm build
   pnpm inject
   ```
3. Fully quit and reopen Discord.
4. Enable **InstanceSwitcher** in Settings, Vencord, Plugins.

Open the switcher with **Ctrl+Alt+I**, or the button in the plugin's settings.

---

## Using it

### Add an instance

Type the server's address (for example `https://my.server`) and press **Add**. Unless you override them, the endpoints come from a template:

| Endpoint | Default |
|---|---|
| API | `https://HOST/api` |
| Gateway | `wss://HOST/gateway` |
| CDN and media | `https://HOST` |
| Invite, gift, template hosts | `HOST/invite`, `HOST/gift`, `HOST/template` |

If a server uses different paths, open **Advanced endpoints** and fill in the ones that differ. The template lives in `templateFor()` and `deriveEnv()` if you want to change the defaults.

**Edit** shows the main endpoints, plus more under **More endpoints**: invite, gift and template hosts, web app, static assets and the QR-login gateway. Leave any of those blank to keep the client's default.

### Switch

Press **Connect** on an instance. The client reloads onto that server. The first time you connect to a host, Vencord asks you to approve its addresses (content-security-policy overrides), then the plugin allows its websocket addresses itself.

### Keyboard shortcuts

| Keys | Action |
|---|---|
| Ctrl+Alt+I | Open the switcher |
| Ctrl+Alt+1 to 9 | Switch to the Nth instance in the list |
| Ctrl+Alt+Shift+D | Revert to real Discord, with no interface needed. Use this if a server leaves the client stuck loading |

### Accounts

Each instance has its own saved accounts. A new instance starts logged out, and real Discord gets its own list back when you return. **Log out** (with a confirmation click) removes an instance's saved accounts from the client. It does not invalidate anything on the server.

### Import and export

**Import / export instances** copies a list of endpoints as text. Logins are never included. Only import lists from people you trust: an imported instance receives your login if you connect to it.

---

## FossCORD/MeowCORD servers and encrypted DMs

Some servers (FossCORD, MeowCORD) end-to-end encrypt DMs. Without help, the stock client shows `🔒 Encrypted message` instead of the text, because the real text is decrypted by the server's own web client.

Turn on **FossCORD/MeowCORD server** for an instance (in Add, or in Edit followed by Save) and the plugin loads that server's own encryption client, `e2ee.js`, into the Discord client on that instance only. You get:

- Decrypted DMs, and encryption of what you send
- A password unlock prompt when the client is locked
- An **Encryption** button on the connected instance's row, opening the script's settings (your devices, backup, reset)
- A green **E2EE** tag on instances that have it on

Things to know:

- The desktop client registers itself as a **new device** on your account. It appears in the web client's "Your devices" list.
- Whether **old** messages open depends on the server's key backup unlocking. Messages sent before the device existed may say "Sent before this browser was set up".
- **Encrypted attachments do not load.** They depend on a service worker that only works on the server's own site. Text works.
- In the server's default trust mode, the server can recover your keys using your password, exactly as in its web client.
- `e2ee.js` is a **pinned copy** of the server's script, with one change: the Node-only `import("crypto")` fallback in `loadSubtleCrypto` is removed, because Vencord's build refuses Node imports. If you update the file, make the same edit: delete the `try { ... import("crypto") ... } catch` block and put `throw new NotSupportedError("Web Crypto is not available");` in its place.
- Troubleshooting: run `__fosscordE2ee.status()` in the console. The `ready`, `failure`, `locked` and `hooks` fields show what is wrong.

---

## Settings

All of these are in Settings, Vencord, Plugins, InstanceSwitcher. Settings marked "clones only" never affect real Discord.

| Setting | Default | What it does |
|---|---|---|
| `spoofVerified` | on | Clones only. Reports the account as verified with an email, so chat is not locked behind verification. Client-side only |
| `spoofPhone` | off | Clones only. Also reports a phone number, for the highest verification level |
| `rewriteText` | on | Clones only. Shows your instance's host in place of discord.com, discord.gg and similar. Chat messages and embeds are left alone |
| `showBadge` | on | Shows the instance badge while on a clone |
| `userTags` | on | Clones only. Shows tags like OFFICIAL and AI next to names in messages and the member list |
| `tagMap` | `28=OFFICIAL*,30=AI*` | Which public-flag bit shows which tag. Format: `bit=LABEL`, comma separated. A `*` after a label adds the verified check, and `\|#hex` after it sets a color |
| `pollMessages` | on | Clones only. Checks the open channel for messages the live connection missed |
| `pollSeconds` | 8 | How often to check, in seconds (minimum 3) |
| `experimental` | off | Master switch for the newer, less-tested features below |
| `pollOtherChannels` | on | Needs `experimental`. Also checks other channels so unread badges stay accurate. Needs the server to report each channel's last message |
| `syncEdits` | on | Needs `experimental`. Applies edits and deletions the live connection missed |
| `autoReconnect` | on | Needs `experimental`. Closes the gateway connection when a check finds missed messages, so the client reconnects. At most once a minute and three times per ten minutes |
| `notifyPrefix` | on | Needs `experimental`. Prefixes notification titles with the instance name, if the client's notification path allows it |
| `notifySound` | off | Clones only. Plays an extra two-tone ping for DMs and mentions |
| `sendCookies` | off | Clones only. Sends requests to the instance's API with credentials. Experimental, and it can stop the client from loading if the server's CORS setup does not allow it |
| `debugFlux` | off | Logs gateway events and websocket connections to the console. Needs a restart |

Profile-popout tags are also under `experimental`. Most changes need a restart of Discord.

---

## How it works

- **Endpoint override.** The Discord client reads its backend addresses from `window.GLOBAL_ENV`. The plugin starts before Discord's own scripts and overlays the active instance's values onto it.
- **Content security policy.** Discord's policy blocks unknown hosts. The plugin asks Vencord's override API to allow each instance's hosts. Websockets need an explicit `wss://` entry, which Vencord's API cannot express, so `native.ts` adds those to Vencord's policy map and remembers them in a file.
- **Per-instance accounts.** The instance list lives in local storage so changes are saved immediately. On a switch, the plugin records which instance you are leaving, and the swap happens at the next startup, before Discord reads its storage: it saves the outgoing instance's account-related keys and restores the incoming one's.
- **Missed-message fallback.** On clones the plugin checks the open channel through the REST API and feeds anything missing into the client as if it had arrived live. The optional extras build on that.
- **Encrypted DMs.** The pinned `e2ee.js` is bundled but only run on instances with the FossCORD/MeowCORD switch on. The plugin gives it the client's webpack require object and a few storage shims, and the script finds the client's HTTP layer, dispatcher and gateway by structure.

---

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Stuck on the loading screen after switching | The server's endpoints are wrong or it is down. Press Ctrl+Alt+Shift+D to go back to Discord, then fix them in Edit |
| Login does nothing, console mentions "Content Security Policy" | A host is not allowed yet. Press Connect again to be asked, or send the console's `CSP blocked` line |
| Websocket errors in the console | Wrong gateway path. Many servers use `/gateway`. Check the server's own web client for the real address |
| Console mentions CORS | The server's API must answer `https://discord.com` with the right headers on every response, including errors |
| Messages missing until a reload | The server's live updates stalled. Keep `pollMessages` on, and turn on `debugFlux` to see whether the connection is silent |
| The client refreshes or crashes by itself | Turn `experimental` off |
| Build fails on `e2ee.js` | See the note about `import("crypto")` above, and keep the file named exactly `e2ee.js` next to `index.tsx` |

For anything else, turn on `debugFlux`, restart, and look for lines beginning `[InstanceSwitcher]` in the console (Ctrl+Shift+I).

---

## Security notes

- Saved logins sit in plain text in the client's local storage and in the plugin's saved state. Treat them like passwords.
- Never share screenshots of the Network tab with the `Authorization` or `Cookie` lines visible. They contain your login token.
- `native.ts` adds `wss://` entries to the content-security policy **without** a confirmation prompt, but it only accepts plain `ws(s)://host[:port]` strings.
- `e2ee.js` runs inside your client. It only talks to the instance's API. It is the server's code, so only enable the switch for servers you trust.
- Importing an instance list from someone else means trusting where it points. Check the addresses before connecting.

---

## Project layout

| File | Purpose |
|---|---|
| `index.tsx` | The plugin: instance list and switcher interface, endpoint override, per-instance accounts, tags, fallback checks and the encrypted-DM loader |
| `native.ts` | Main-process helper that adds `wss://` sources to the content-security policy |
| `e2ee.js` | Pinned copy of the FossCORD/MeowCORD server's E2EE client, with the one edit described above |
