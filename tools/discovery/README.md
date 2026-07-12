# GitHub Discovery Collector

This deterministic collector runs before Codex Automation. It uses the GitHub
API to discover repositories, enumerate concrete skill/rule artifacts, store
daily metrics in local SQLite, and export an Automation-readable evidence pack.

Run it with:

```powershell
npm run discovery:github
```

Rebuild the evidence pack from existing SQLite snapshots without network
access:

```powershell
npm run discovery:export
```

Local outputs, all ignored by Git:

```text
reports/inbox/discovery.sqlite
reports/inbox/github-candidates.json
```

Authentication is optional. Credential priority is the process environment,
`.secrets.local`, then the existing GitHub CLI keyring login:

```text
GITHUB_TOKEN=github_pat_redacted
```

The token needs read-only access to public repositories. Never grant write or
administration permissions. Without a token the collector automatically uses a
smaller repository limit to stay within GitHub's anonymous API allowance.
If collection fails, the previous database and evidence pack remain intact.
All repository searches explicitly include `is:public`; authenticated discovery
does not ingest private repositories.

## Windows Task Scheduler

Create a daily task before Codex Automation, for example 07:10 Beijing time.

- Program: `powershell.exe`
- Arguments: `-NoProfile -ExecutionPolicy Bypass -File "tools\discovery\run-github-discovery.ps1"`
- Start in: the cloned `personal-radar` directory

Codex Automation can then run at 07:30 and read the exported candidate evidence
pack through the normal quality context. The forwarder schedule is unchanged.
