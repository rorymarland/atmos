#!/bin/sh
# Runs before nginx starts (the official nginx image runs /docker-entrypoint.d/*.sh).
# Builds the hill data from the mounted DoBIH CSV and writes the display defaults.
set -eu

HTML=/usr/share/nginx/html

echo "atmos: building hill data from the CSV in /data"
if ! node /opt/atmos/build-data.mjs --raw /data --config /opt/atmos/config --out "$HTML/data"; then
  echo "atmos: ERROR: couldn't build the hill data. Put the DoBIH CSV (e.g. DoBIH_v18_6.csv)" >&2
  echo "atmos: next to docker-compose.yml; it's mounted at /data. /data contains:" >&2
  ls -la /data >&2 || true
  exit 1
fi

theme="${ATMOS_DEFAULT_THEME:-light}"
wind="${ATMOS_DEFAULT_WIND_UNIT:-kmh}"
case "$theme" in light | dark) ;; *) echo "atmos: ATMOS_DEFAULT_THEME must be light or dark; using light" >&2; theme=light ;; esac
case "$wind" in kmh | mph) ;; *) echo "atmos: ATMOS_DEFAULT_WIND_UNIT must be kmh or mph; using kmh" >&2; wind=kmh ;; esac

cat > "$HTML/defaults.js" <<EOF
window.__ATMOS_DEFAULTS__ = { theme: '$theme', wind: '$wind' };
EOF
# The build precompressed the original; nginx's gzip_static would serve that copy instead.
rm -f "$HTML/defaults.js.gz" "$HTML/defaults.js.br"

echo "atmos: ready (theme $theme, wind $wind)"
