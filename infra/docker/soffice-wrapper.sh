#!/bin/sh
set -eu

if test "$#" -eq 1 && test "$1" = --version; then
  observed="$(/opt/libreoffice26.2/program/soffice --version)"
  test "$observed" = 'LibreOffice 26.2.5.2 cd7284b4cbbfeb507e630c1aac019f4157393acb'
  printf '%s\n' 'LibreOffice 26.2.5'
  exit 0
fi

exec /opt/libreoffice26.2/program/soffice "$@"
