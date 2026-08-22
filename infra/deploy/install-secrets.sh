#!/bin/sh
set -eu

test "$(id -u)" -eq 0 || {
  printf '%s\n' "PAUSE_SECRETS:ROOT_REQUIRED" >&2
  exit 78
}

secrets_dir=/opt/opentrad/secrets
install -d -o root -g root -m 0700 "$secrets_dir"
umask 077

restore_tty() {
  if test -t 0; then stty echo 2>/dev/null || true; fi
}
trap restore_tty EXIT HUP INT TERM

read_hidden() {
  prompt=$1
  printf '%s' "$prompt" >&2
  if test -t 0; then stty -echo; fi
  IFS= read -r hidden_value
  restore_tty
  printf '\n' >&2
  test -n "$hidden_value" || {
    printf '%s\n' "PAUSE_SECRETS:EMPTY_VALUE" >&2
    exit 78
  }
}

write_secret() {
  target_name=$1
  target_value=$2
  case "$target_name" in
    better_auth_secret | github_client_id | github_client_secret | acme_email) ;;
    *) printf '%s\n' "PAUSE_SECRETS:NAME_REJECTED" >&2; exit 78 ;;
  esac
  test ! -e "$secrets_dir/$target_name" || {
    printf '%s\n' "PAUSE_SECRETS:ALREADY_INSTALLED:$target_name" >&2
    exit 78
  }
  secret_temp="$(mktemp "$secrets_dir/.${target_name}.XXXXXX")"
  printf '%s' "$target_value" >"$secret_temp"
  if test "$target_name" = acme_email; then
    chown root:root "$secret_temp"
    chmod 0400 "$secret_temp"
  else
    getent group opentrad-runtime >/dev/null 2>&1 || {
      printf '%s\n' "PAUSE_SECRETS:RUNTIME_GROUP_MISSING" >&2
      exit 78
    }
    chown root:opentrad-runtime "$secret_temp"
    chmod 0440 "$secret_temp"
  fi
  mv -f "$secret_temp" "$secrets_dir/$target_name"
  printf '%s\n' "INSTALLED_SECRET:$target_name"
}

better_auth_secret=
github_client_id=
github_client_secret=
acme_email=
if test ! -e "$secrets_dir/better_auth_secret"; then
  better_auth_secret="$(openssl rand -base64 32 | tr -d '\n')"
  test -n "$better_auth_secret" || {
    printf '%s\n' "PAUSE_SECRETS:RANDOM_UNAVAILABLE" >&2
    exit 78
  }
fi
if test ! -e "$secrets_dir/github_client_id"; then
  read_hidden "GitHub OAuth Client ID: "
  github_client_id=$hidden_value
  hidden_value=
fi
if test ! -e "$secrets_dir/github_client_secret"; then
  read_hidden "GitHub OAuth Client Secret: "
  github_client_secret=$hidden_value
  hidden_value=
fi
if test ! -e "$secrets_dir/acme_email"; then
  printf '%s' "ACME email: " >&2
  IFS= read -r acme_email
  printf '\n' >&2
  printf '%s\n' "$acme_email" | grep -Eq '^[^[:space:]@]+@[^[:space:]@]+$' || {
    printf '%s\n' "PAUSE_TLS:ACME_EMAIL_INVALID" >&2
    exit 78
  }
fi
test -z "$better_auth_secret" || write_secret better_auth_secret "$better_auth_secret"
test -z "$github_client_id" || write_secret github_client_id "$github_client_id"
test -z "$github_client_secret" || write_secret github_client_secret "$github_client_secret"
test -z "$acme_email" || write_secret acme_email "$acme_email"
printf '%s\n' "SECRETS_READY"

better_auth_secret=
github_client_id=
github_client_secret=
acme_email=
hidden_value=
trap - EXIT HUP INT TERM
