---
name: Bug report
about: Report a problem with InstanceSwitcher
title: "[BUG]"
labels: bug
assignees: ''
type: Bug

---

**Before you post**
- [ ] I'm on the latest version of the plugin
- [ ] I searched the existing issues
- [ ] If the client refreshes or crashes by itself: I turned the `experimental` setting off and tried again

**Describe the bug**
A clear and concise description of what the bug is.

**To reproduce**
Steps to reproduce the behavior:
1. Go to '...'
2. Click on '...'
3. See the problem

**Expected behavior**
What you expected to happen.

**Which server?**
- Server software: (Discord / FossCORD / MeowCORD / Spacebar / other)
- Server address: (or "private")
- "FossCORD/MeowCORD server" switch for this instance: on / off
- Does it also happen on real Discord? yes / no

**Environment**
- OS and version:
- Discord build: (shown as `[BUILD INFO]` near the top of the console, for example `Build Number: 632301`)
- Vencord or Equicord version:
- InstanceSwitcher version or commit:

**Settings changed from the defaults**
List any plugin settings you've changed, such as `experimental`, `sendCookies` or `pollSeconds`.

**Console output**
Open the console with Ctrl+Shift+I. Paste any red errors and any lines starting with `[InstanceSwitcher]`. Turning on `debugFlux` and restarting gives more detail for missing messages or connection problems.

```
paste logs here
```

For encrypted DM problems, also run `__fosscordE2ee.status()` in the console and paste only these fields: `ready`, `failure`, `locked`, `hooks`.

**Screenshots**
If it helps, add screenshots to explain the problem.

**Please remove secrets before posting**
Never post any of these, in logs, screenshots or the Network tab:
- the `Authorization` header or your login token
- `Cookie` or `Set-Cookie` values
- your password, a recovery phrase, or key backup data

**Additional context**
Anything else that might help, such as when it started or whether it worked before.
