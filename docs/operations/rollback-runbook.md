# OpenTrad rollback runbook

Rollback changes only the OpenTrad static release and exact API/worker image digests. It must not run `down -v`, prune Docker state, restore SQLite implicitly, or mutate an existing service.

## Application rollback

Choose a previously verified release directory. The following SHA is a syntactically valid example only:

```bash
sudo /usr/local/libexec/opentrad/rollback-release.sh 0123456789abcdef0123456789abcdef01234567
```

The rollback script must require `/opt/opentrad/releases/<SHA>`, verify its manifest/signatures/digests, switch the static symlink, recreate only project `opentrad` from the prior digest references, test and reload Nginx, and pass canary. A `PAUSE_*` exit 78 means stop without guessing a substitute.

After rollback, compare inventory:

```bash
sudo /usr/local/libexec/opentrad/capture-baseline.sh acceptance
node /usr/local/libexec/opentrad/compare-baseline.mjs /opt/opentrad/baselines/manual-preflight.json /opt/opentrad/baselines/acceptance.json
```

If rollback canary fails, stop and pause. Do not proceed to database restore merely because application rollback failed.

## Break-glass SQLite restore

SQLite restore is separately authorized because it discards account and job metadata created after the selected backup. Record the approver, exact backup path, and recovery point before proceeding. Never restore source or result file bytes; those do not belong in SQLite or backups.

First verify the selected backup and create a recoverable live copy:

```bash
opentrad_db_root=$(docker volume inspect opentrad_auth_data --format '{{.Mountpoint}}')
sudo sqlite3 /opt/opentrad/backups/opentrad-0123456789abcdef0123456789abcdef01234567.sqlite 'PRAGMA integrity_check;'
sudo sqlite3 "$opentrad_db_root/opentrad.sqlite" 'PRAGMA integrity_check;'
sudo sqlite3 "$opentrad_db_root/opentrad.sqlite" ".backup '/opt/opentrad/backups/pre-restore-live.sqlite'"
sudo sqlite3 /opt/opentrad/backups/pre-restore-live.sqlite 'PRAGMA integrity_check;'
```

Every integrity result must be exactly `ok`. Then stop only the two application containers, restore, and start only those containers:

```bash
docker stop opentrad-api-1 opentrad-worker-1
sudo sqlite3 "$opentrad_db_root/opentrad.sqlite" ".restore '/opt/opentrad/backups/opentrad-0123456789abcdef0123456789abcdef01234567.sqlite'"
sudo sqlite3 "$opentrad_db_root/opentrad.sqlite" 'PRAGMA integrity_check;'
docker start opentrad-api-1 opentrad-worker-1
sudo /usr/local/libexec/opentrad/run-canary.sh 0123456789abcdef0123456789abcdef01234567
```

Replace the syntax-only SHA only after verifying the exact backup and release. If any command fails, stop; do not start unrelated containers or restore a different backup by inference.
