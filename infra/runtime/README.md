# OpenTrad production runtime contract

The Compose project name is always `opentrad`. It must not join, modify, or reuse another
application's Compose project or Docker network. Only the API publishes a host port, at
`127.0.0.1:13300`.

## Persistent volume ownership

Before the first start, an operator must initialize the named `auth_data` volume so
`/var/lib/opentrad` is owned by numeric UID/GID `10001:10001` with mode `0700`. The
`clam_db` volume remains owned according to the digest-pinned ClamAV image contract. Do
not solve ownership failures by running the API or worker as root.

Job inputs and outputs use only `job_ram`, a 2 GiB tmpfs volume owned by UID `10001` and
supplemental GID `10100`. API UID `10001` and worker UID `10002` receive only that shared
supplemental group. `/work` and `/run/opentrad` are per-container tmpfs mounts. Never bind
a host job directory or the Docker socket.

## Secret files

Install these non-empty files outside the release directory under
`/opt/opentrad/secrets`, owned by root and mode `0400`:

- `better_auth_secret`
- `github_client_id`
- `github_client_secret`

The API entrypoint reads them from Compose secrets and fails closed with exit code 78 if
any file is unreadable or empty. Secret values must never be copied into images, env
examples, release artifacts, logs, or SQLite backups.

## Non-secret configuration

The checked-in `.env.example` files are exact production defaults, not secret stores.
When `OPENTRAD_TRUSTED_PROXY_CIDR` is unset, the API entrypoint derives the container's
exact default IPv4 gateway from `/proc/net/route` and exports that single address as a
`/32`. Derivation failure pauses startup with exit code 78. An operator may override it
only with the exact source IP or narrow CIDR observed by the API for host Nginx; a hop
count or broad private range is forbidden.
