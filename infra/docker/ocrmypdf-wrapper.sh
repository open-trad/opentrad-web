#!/bin/sh
set -eu

export PYTHONPATH=/opt/opentrad-tools/local/lib/python3.11/dist-packages
exec /opt/opentrad-tools/local/bin/ocrmypdf "$@"
