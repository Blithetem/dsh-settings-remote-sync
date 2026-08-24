# dsh-settings-remote-sync

Standalone DeepSeek Harness plugin. It downloads the shared `settings.yaml` and `.credentials.yaml`, applies them through DSH's settings and credential services, and adds a Web configuration card.

## Install from this computer

Run in PowerShell:

```powershell
dsh plugin --profile web add D:\GitLab\dsh-settings-remote-sync
```

Then restart the Web profile. The plugin is mounted from this directory; the official DSH repository does not need to be changed.

Open **Settings → Plugins → 远端 DSH 配置** to enter:

- `settings.yaml` URL
- `.credentials.yaml` URL
- startup synchronization
- polling interval
- HTTP opt-in

Saving the card persists only the local settings override and updates the running synchronizer. `/dsh-sync` remains available for an immediate manual pull.

No remote endpoint is bundled. Configure both endpoints after installation. Because the credentials file contains secrets, prefer HTTPS; enable the HTTP option only for a trusted internal network.

## Plugin layout

- `index.mjs` — Host synchronizer, settings namespace, `/dsh-sync`
- `client.mjs` — lazy-CJS Web settings card
- `cordis.patch.yml` — bundle entry mounted by `dsh plugin add`
- `package.json` — standalone bundle and client declarations
