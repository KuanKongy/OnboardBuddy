#!/usr/bin/env bash
# Regenerates public/og.png from og-template.html.
#
# The template uses the footer tagline and the dark-theme --node-* palette
# from styles.css. If either changes, update the template to match, then
# rerun this script.
#
# Renders at 2x and ships the full 2400x1260 PNG (same 1.91:1 ratio): sharper
# on retina previews, and at ~1MB still well under the scrapers' 8MB cap.
# index.html's og:image:width/height declare these dimensions — keep in sync.
set -euo pipefail
cd "$(dirname "$0")"

CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

python3 - "$WORK/og.html" <<'EOF'
import base64, pathlib, sys
font = pathlib.Path("../../public/fonts/InterVariable.woff2").read_bytes()
check = (
    '<svg viewBox="0 0 24 24" fill="none">'
    '<circle cx="12" cy="12" r="10" fill="rgba(75,120,255,.14)" stroke="#4b78ff" stroke-width="1.7"/>'
    '<path d="M8 12.2 L10.8 15 L16 9.6" stroke="#4b78ff" stroke-width="2.1" '
    'stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>'
)
html = pathlib.Path("og-template.html").read_text()
shield = (
    '<svg viewBox="0 0 24 24" fill="none">'
    '<path d="M12 3 L19.5 6 V11.5 C19.5 16 16.5 19.6 12 21 C7.5 19.6 4.5 16 4.5 11.5 V6 Z" '
    'fill="rgba(52,199,123,.14)" stroke="#34c77b" stroke-width="1.7" stroke-linejoin="round"/>'
    '<path d="M8.6 12 L11.2 14.6 L15.6 9.6" stroke="#34c77b" stroke-width="2" '
    'stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>'
)
html = html.replace("@@FONT_B64@@", base64.b64encode(font).decode())
html = html.replace("@@CHECK@@", check)
html = html.replace("@@SHIELD@@", shield)
pathlib.Path(sys.argv[1]).write_text(html)
EOF

# New headless writes the screenshot, then sometimes never exits; run it in the
# background, wait for the file and kill what is left.
"$CHROME" --headless=new --no-first-run --no-default-browser-check \
  --disable-gpu --disable-extensions --hide-scrollbars \
  --force-device-scale-factor=2 --window-size=1200,630 \
  --user-data-dir="$WORK/profile" \
  --screenshot="$WORK/og-2x.png" "file://$WORK/og.html" &
CHROME_PID=$!
for _ in $(seq 1 60); do
  [ -s "$WORK/og-2x.png" ] && break
  sleep 1
done
sleep 2
kill "$CHROME_PID" 2>/dev/null || true
[ -s "$WORK/og-2x.png" ] || { echo "render failed" >&2; exit 1; }

cp "$WORK/og-2x.png" ../../public/og.png
sips -g pixelWidth -g pixelHeight ../../public/og.png | tail -2
