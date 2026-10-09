<div align="center">

# 🔄 InstanceSwitcher

### *The definitive multi-instance workspace engine for Vencord & Equicord.*

Connect your native Discord client to **Spacebar, FossCORD, MeowCORD**, and self-hosted Discord-compatible instances — without sacrificing your client mods, custom themes, or core settings.

[![Vencord Compatible](https://img.shields.io/badge/Vencord-Userplugin-5865F2?style=for-the-badge&logo=discord&logoColor=white)](https://vencord.dev)
[![Equicord Compatible](https://img.shields.io/badge/Equicord-Userplugin-7289DA?style=for-the-badge&logo=discord&logoColor=white)](https://equicord.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![License](https://img.shields.io/badge/License-MIT-blue.svg?style=for-the-badge)](LICENSE)

[Overview](#-overview) • [Features](#-features) • [Installation](#-installation) • [Usage Guide](#️-usage-guide) • [E2EE](#-end-to-end-encryption-fosscord--meowcord) • [Configuration](#️-configuration) • [Architecture](#️-architecture) • [Troubleshooting](#️-troubleshooting)

</div>

---

> [!WARNING]
> **ToS Disclaimer:** Client modifications violate Discord's Terms of Service. While **InstanceSwitcher** does not alter payload behavior on official Discord endpoints, running any client mod carries inherent risk. Use responsibly.

---

## 📌 Overview

**InstanceSwitcher** decouples your client binary from official Discord endpoints. By overlaying dynamic backend routes early in the startup lifecycle, you can run a single client across any number of custom networks while keeping:

- 🎨 Custom CSS themes and client modifications
- 🔐 Independent, isolated session keys per instance
- ⚡ Low-latency socket connections with fallback message polling

---

## ✨ Features

### 🔀 Multi-Instance Management

- **One-Click Hot-Swapping** — Jump between networks instantly via the UI or global hotkeys (`Ctrl+Alt+1` – `9`).
- **Isolated Account Vaults** — Every instance keeps its own login state, multi-account switcher list, and session tokens.
- **Smart Endpoint Templating** — Enter a base domain (`https://my.server`) and the engine derives `/api`, `/gateway`, and CDN paths automatically.
- **Context Badge** — A floating badge shows your active host so you never mistake a test server for live Discord. It turns green when the connection is healthy and red when it drops.
- **Start on Launch** — Press **Start here** on any instance (including Discord) to have the app open on it every time.
- **Panic Fail-Safe** — Press `Ctrl+Alt+Shift+D` anywhere to force-revert to official Discord if a server stalls.

### 🎭 Discord Native Parity

- **Hostname Spoofing** — Rebinds settings screens, boost menus, and invite overlays to show your instance's domain.
- **Verification Shim** — Bypasses client-side account claim locks on local/self-hosted dev servers without an email setup.
- **Public Flag Rendering** — Renders custom user badges like `OFFICIAL` and `AI` in member lists and chat.
- **Missed-Message Healing** — REST polling catches gateway packets dropped during server hiccups or socket reconnects.

### 🔐 Native E2EE Integration

- Support for the **FossCORD/MeowCORD** `e2ee.js` script, downloaded from a URL you control, so encrypted DMs decrypt natively inside the desktop app.

---

## 📋 Prerequisites

- **Discord Desktop App** — web builds are unsupported due to process-level network isolation.
- **Vencord** or **Equicord**, cloned and **built from source** — prebuilt installers don't load local userplugins.
- **Node.js v18+** and **pnpm**, matching your Vencord workspace setup.

---

## ⚡ Installation

### 1. Place the plugin files

Clone or symlink this directory into your Vencord/Equicord `userplugins` folder:

```text
src/userplugins/InstanceSwitcher/
├── index.tsx    # Main switcher UI & engine hooks
└── native.ts    # Main-process CSP helper and script downloader
```

### 2. Build & inject

From your main Vencord/Equicord directory:

```bash
# Compile client plugins and main process binaries
pnpm build

# Inject into your installed Discord client
pnpm inject
```

### 3. Activate in Discord

1. Fully restart Discord (killing it from Task Manager / Activity Monitor is recommended).
2. Go to **Settings → Vencord → Plugins**.
3. Toggle **InstanceSwitcher** on.
4. Press `Ctrl+Alt+I` to open the instance switcher.

---

## 🕹️ Usage Guide

### Adding an instance

Click **Add Instance** and enter your server's base URL. Standard routes resolve automatically:

| Service | Default Target |
| --- | --- |
| REST API | `https://<HOST>/api` |
| Gateway Socket | `wss://<HOST>/gateway` |
| CDN & Media | `https://<HOST>` |
| Invite / Gift / Template | `<HOST>/invite`, `<HOST>/gift`, `<HOST>/template` |

> [!TIP]
> Need custom routes? Expand **Advanced Endpoints** when creating an instance to override web app paths, QR gateway sockets, or static asset hosts individually.

### Hotkeys

| Shortcut | Action |
| --- | --- |
| `Ctrl+Alt+I` | Open/close the instance switcher |
| `Ctrl+Alt+1` – `9` | Quick-switch to instance *N* in your list |
| `Ctrl+Alt+Shift+D` | **Emergency escape** — force-revert to official Discord |

### Account isolation & portability

- **No cross-contamination** — Logging out of an instance purges its saved tokens locally without invalidating server-side sessions.
- **Safe import/export** — Export configuration profiles as plain JSON. Tokens and credentials are **never** included in exports.

---

## 🔐 End-to-End Encryption (FossCORD / MeowCORD)

Servers that use end-to-end encryption normally show `🔒 Encrypted message` on standard clients. Enabling the **FossCORD/MeowCORD** toggle on an instance downloads the `e2ee.js` layer from the address in the `e2eeUrl` setting and loads it into the client. Nothing is downloaded for instances with the toggle off.

**What you get:**

- 🔓 Real-time encryption and decryption of DM text channels
- 🔑 On-demand key unlock prompt at startup
- ⚙️ Device key manager, opened via the **Encryption** button on the active instance row
- 🏷️ Green **E2EE** status tag on compatible instances

> [!NOTE]
> - **Device registration:** The desktop app registers as its own crypto device on your server account.
> - **Attachments:** Encrypted file attachments need a web-worker scope that only exists in the server's official web client, so they're skipped.
> - **Hosted, not bundled:** `e2ee.js` is no longer part of the plugin. Host it yourself and point `e2eeUrl` at it. The download happens in the main process through `native.ts`, so your host needs no CORS headers.
> - **Which copy to host:** the modified one, with the Node-only `import("crypto")` fallback in `loadSubtleCrypto` replaced by `throw new NotSupportedError("Web Crypto is not available");`. In a browser it behaves the same as the original.
> - **If the script isn't live yet:** the plugin shows an error toast, and everything else keeps working.
> - **Trust:** the script runs inside your client with access to your login. Only host it somewhere you control, and pin it with `e2eeHash`.

### Diagnostics

If encrypted channels fail to resolve, check the engine state in DevTools (`Ctrl+Shift+I`):

```js
__fosscordE2ee.status()
```

---

## ⚙️ Configuration

Open **Settings → Vencord → Plugins → InstanceSwitcher**.

Options scoped to **Clones Only** automatically disengage while connected to official Discord.

| Option | Default | Scope | Description |
| --- | --- | --- | --- |
| `spoofVerified` | `on` | Clones Only | Mocks email verification state to unlock restricted channels. |
| `spoofPhone` | `off` | Clones Only | Mocks phone verification for high-security guild restrictions. |
| `rewriteText` | `on` | Clones Only | Replaces `discord.com` / `discord.gg` references in the UI with your host. |
| `showBadge` | `on` | UI | Shows the active-instance badge on screen. |
| `userTags` | `on` | Feature | Displays public-flag user tags (`OFFICIAL`, `AI`) in chat and member lists. |
| `tagMap` | `28=OFFICIAL*,30=AI*` | Config | Flag-bit mapping. Syntax: `bit=LABEL[*][\|#hex]` — `*` adds a checkmark. |
| `pollMessages` | `on` | Sync | Polls the REST API for messages the WebSocket missed. |
| `pollSeconds` | `8` | Numeric | Polling interval in seconds (minimum `3`). |
| `experimental` | `off` | Master | Unlocks the experimental sync features below. |
| `pollOtherChannels` | `on` | Experimental | Background-polls unread channels to keep notifications accurate. |
| `syncEdits` | `on` | Experimental | Captures edits/deletes missed during connection drops. |
| `autoReconnect` | `on` | Experimental | Resets the gateway socket automatically when message drift is detected. |
| `e2eeUrl` | `https://iambrdn.com/project/switcher/e2ee.js` | Encryption | https address the E2EE script is downloaded from, only for instances with the FossCORD/MeowCORD toggle on. |
| `e2eeHash` | empty | Encryption | Optional SHA-256 (hex) of the script. When set, a script that doesn't match is refused. |
| `sendCookies` | `off` | Network | Forwards cookies with API requests (requires CORS support on the server). |
| `debugFlux` | `off` | Developer | Logs verbose gateway/socket diagnostics to the console under `[InstanceSwitcher]`. |

---

## 🏗️ Architecture

### Core modules

| File | Responsibility |
| --- | --- |
| `index.tsx` | State persistence, UI rendering, local account key swapping, and DOM text rewriting. |
| `native.ts` | Talks to the Electron main process to allow WebSocket origins outside the standard CSP, and downloads the E2EE script over https. |
| `e2ee.js` *(hosted, not in this repo)* | Self-contained crypto engine that hooks the client's HTTP dispatchers to encrypt/decrypt message bodies transparently. Downloaded from `e2eeUrl` at runtime. |

---

## 🛠️ Troubleshooting

| Issue | Cause | Fix |
| --- | --- | --- |
| Stuck on the loading splash screen | Invalid endpoints or server offline | Press `Ctrl+Alt+Shift+D` to revert to Discord, then check the instance's endpoints via **Edit**. |
| Console: `CSP blocked` | Gateway WebSocket origin not approved | Click **Connect** again to trigger the approval dialog, or check network permissions. |
| `WebSocket Connection Failed` | Wrong gateway URL pattern | Make sure the server serves the gateway at `/gateway` (e.g. `wss://host/gateway`), not the root. |
| Requests blocked by CORS | Missing `Access-Control-*` headers | Configure the backend to allow the `https://discord.com` origin. |
| `Couldn't start end-to-end encryption` toast | `e2eeUrl` isn't live yet, isn't https, or the file doesn't match `e2eeHash`. |
| Client crashes or reloads unexpectedly | Unstable experimental features | Turn the `experimental` setting off. |

---

## 📄 License

Distributed under the [MIT License](LICENSE).

Built for custom Discord software research, self-hosted networks, and protocol development. **Not affiliated with, maintained by, or endorsed by Discord Inc.**
