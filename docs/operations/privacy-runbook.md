# OpenTrad privacy incident runbook

The sentinel searches for operator-generated marker IDs across OpenTrad logs, SQLite main/WAL/SHM and controlled dump, release evidence, backups, job tmpfs, Nginx logs, and relevant host journal exports. It reports only artifact kind, sanitized relative path, and marker ID. It must never print matched bytes.

## Freeze

On a suspected leak, stop new OpenTrad conversion work while preserving evidence:

```bash
sudo install -d -o root -g root -m 0700 /run/opentrad/privacy-incident
sudo docker stop opentrad-api-1 opentrad-worker-1
sudo find /run/opentrad -xdev -printf '%y %P %s\n'
sudo sh -c 'docker logs opentrad-api-1 > /run/opentrad/privacy-incident/opentrad-api.log 2>&1'
sudo sh -c 'docker logs opentrad-worker-1 > /run/opentrad/privacy-incident/opentrad-worker.log 2>&1'
sudo sh -c 'journalctl --unit=nginx --output=short-iso --since=-1h > /run/opentrad/privacy-incident/nginx-journal.log'
```

Do not stop, restart, inspect inside, or copy data from any existing service. Do not run a global Docker, journal, filesystem, or backup export.

## Run the sentinel without command-line marker disclosure

For the production host, create `privacy-markers.json` as a mode `0600` file on tmpfs. Each filename, body, and metadata marker must be copied exactly from a real fixture uploaded and accepted during this same run. Never use a random or unuploaded marker, because it cannot prove that processed content was erased. Never place marker values on the command line, in shell history, or in the ticket. The fixed production profile discovers the two OpenTrad volume roots and captures container/Nginx journal output into tmpfs before scanning.

```bash
sudo chmod 0600 /run/opentrad/privacy-incident/privacy-markers.json
sudo sh -c 'node /opt/opentrad/current/scripts/release/privacy-sentinel.mjs --remote-profile production --markers-fd 3 3</run/opentrad/privacy-incident/privacy-markers.json'
```

For a non-production forensic fixture only, the generic FD interface remains available as `OPENTRAD_PRIVACY_ROOTS_FD=3 OPENTRAD_PRIVACY_MARKERS_FD=4 node scripts/release/privacy-sentinel.mjs 3<roots.json 4<markers.json`. Production operators must use the fixed remote profile.

Missing, unreadable, symlinked, or outside-allowlist roots stop with `PAUSE_PRIVACY:*` and exit 78. Fix inspection access; never omit a required scope to obtain a pass.

## Required scope

Inspect all of the following for filename, body, and metadata markers:

- API, worker, ClamAV, Nginx, and OpenTrad host-journal logs;
- SQLite main, WAL, SHM, integrity-checked text dump, and every selected backup;
- release manifest, all SPDX SBOMs, Trivy reports, baselines, acceptance reports, and release archives;
- running, queued, cancelled, failed, downloaded, expired, and restart-recovered job tmpfs paths;
- retained release directories and sanitized incident evidence.

For every SQLite database, require:

```bash
sqlite3 /path/to/opentrad.sqlite 'PRAGMA integrity_check;'
```

For job tmpfs, the sentinel root must set `mustBeEmpty: true` after download, cancellation, failure, timeout, expiry, and the 15-minute retention window. Restart only `opentrad-api-1` and `opentrad-worker-1` with `sudo docker start`, wait for the retention window, rerun the same scope, and prove no job is resurrected or replayed to ClamAV.

## Evidence and remediation

- Record only `artifact kind + sanitized path + marker ID`, numeric counts, timestamps, release SHA, and opaque job IDs.
- Never copy a user's file, filename, document text, extracted metadata, secret, cookie, or matched byte sequence into an incident ticket.
- Quarantine only the affected OpenTrad artifact. Do not collect unrelated host or existing-service data.
- If a credential may have entered an affected artifact, rotate it at its owning system, reinstall it through the no-echo secret path, and record only the rotation completion time and secret name.
- Delete affected OpenTrad logs/backups/artifacts only after evidence approval and retention/legal checks. Re-run the full sentinel scope to verify deletion.

If privacy fails, stop and pause release/rollback decisions until the incident owner authorizes the next action. A canary or load pass cannot override a privacy failure.
