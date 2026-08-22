#!/bin/sh
set -eu

install -d -m 0700 /work/home /work/tmp

/usr/bin/soffice --version | grep -F '26.2.5'
pandoc --version | head -n 1 | grep -F '3.10.2'
ocrmypdf --version 2>&1 | grep -F '17.10.0'
tesseract --version 2>&1 | head -n 1 | grep -F '5.5.3'
qpdf --version | grep -F '12.4.0'
pdftoppm -v 2>&1 | grep -F '26.08.0'
vips --version | grep -F '8.18.5'

if test "${OPENTRAD_VERIFY_ONLY:-false}" = true; then
  exec node --input-type=module -e \
    'const { verifyToolchain } = await import("/app/toolchain.js"); await verifyToolchain();'
fi
exec node /app/main.js
