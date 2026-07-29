#!/bin/sh
#
# Renders the frontend's deployment configuration at CONTAINER START.
#
# Why (issue #73): Vite inlines VITE_* into the bundle at build time, so a
# built image used to be pinned to one API origin — `localhost:3000` — which
# made a Railway deploy impossible, because the API's *.up.railway.app hostname
# only exists after the image does. This script moves that decision to startup.
#
# It writes two things from the same three variables, so they can never drift:
#
#   1. /usr/share/nginx/html/config.js
#      `window.__ONBOARDBUDDY_CONFIG__ = {...}`, loaded by index.html as a
#      plain synchronous script before the app module. Consumed by
#      frontend/src/lib/runtimeConfig.ts.
#
#   2. /etc/nginx/security-headers.conf
#      Rendered from …conf.template by substituting the CSP's connect-src with
#      the origins actually configured. That is how the policy stopped naming
#      http://localhost:3000, and how it tightened from `https://*.supabase.co`
#      to the one Supabase host this deployment uses.
#
# The nginx image runs every executable /docker-entrypoint.d/*.sh before nginx
# starts. The Dockerfile also runs this once at build time with no VITE_*
# set, so the image always contains a valid (strict, unconfigured) pair of
# outputs even if something bypasses the entrypoint.
#
# Design notes worth keeping:
#   * Only the three variables named below are ever published. This is an
#     explicit allow-list, not an `env | grep ^VITE_` scan: a scan would put any
#     future VITE_-prefixed variable into a world-readable file.
#   * Values are validated before use and JS-escaped after. config.js is
#     attacker-visible output built from the environment; a value containing a
#     quote or a newline must not be able to change the file's structure.
#   * A missing or invalid value is NOT fatal. It is logged loudly and the key
#     is emitted empty, which makes the app render its configuration-error page
#     (frontend/src/components/ConfigErrorScreen.tsx) naming the variable —
#     a better failure than a crash-looping container or a blank page.
#
# Overridable paths exist so the test suite can run this script against a
# temporary directory (frontend/src/lib/runtimeConfig.entrypoint.test.ts).

set -u

HTML_DIR="${ONBOARDBUDDY_HTML_DIR:-/usr/share/nginx/html}"
CONFIG_JS="${HTML_DIR}/config.js"
HEADERS_TEMPLATE="${ONBOARDBUDDY_HEADERS_TEMPLATE:-/etc/nginx/security-headers.conf.template}"
HEADERS_OUT="${ONBOARDBUDDY_HEADERS_OUT:-/etc/nginx/security-headers.conf}"

log() { printf '[onboardbuddy-config] %s\n' "$*" >&2; }

# --------------------------------------------------------------------------
# Validation. Each accepted value is restricted to a character set that cannot
# contain a quote, a backslash, an angle bracket or whitespace, which is what
# makes the JS and nginx output below structurally safe.
# --------------------------------------------------------------------------

# Absolute http(s) URL, or a same-origin path ("/api") for a reverse-proxied
# deployment. A path is legitimate and must keep working.
valid_api_url() {
  printf '%s' "$1" |
    grep -Eq '^(https?://[A-Za-z0-9._-]+(:[0-9]{1,5})?(/[A-Za-z0-9._~/-]*)?|/[A-Za-z0-9._~/-]*)$'
}

# Supabase project URL: scheme + host (+ optional port), no path.
valid_supabase_url() {
  printf '%s' "$1" | grep -Eq '^https?://[A-Za-z0-9._-]+(:[0-9]{1,5})?/?$'
}

# Covers both key formats: legacy JWT anon keys and sb_publishable_… keys.
valid_anon_key() {
  printf '%s' "$1" | grep -Eq '^[A-Za-z0-9._~+/=-]+$'
}

# grep matches per line, so a value like "https://ok\nnot-a-url" would pass on
# its first line. Reject anything multi-line before it reaches a validator.
is_single_line() { [ "$(printf '%s' "$1" | wc -l)" -eq 0 ]; }

# Echoes the value when acceptable, nothing when not. Never echoes the value
# into a log line: an operator pasting the wrong secret into the wrong variable
# should not have it copied into container logs.
accept() {
  _name="$1"
  _value="$2"
  _validator="$3"
  if [ -z "$_value" ]; then
    log "MISSING ${_name} — the app will show its configuration-error page."
    return 0
  fi
  if ! is_single_line "$_value"; then
    log "INVALID ${_name} — value spans multiple lines. Ignoring it."
    return 0
  fi
  if ! "$_validator" "$_value"; then
    log "INVALID ${_name} — not in the expected form. Ignoring it."
    return 0
  fi
  printf '%s' "$_value"
}

API_URL="$(accept VITE_API_URL "${VITE_API_URL:-}" valid_api_url)"
SUPABASE_URL="$(accept VITE_SUPABASE_URL "${VITE_SUPABASE_URL:-}" valid_supabase_url)"
SUPABASE_ANON_KEY="$(accept VITE_SUPABASE_ANON_KEY "${VITE_SUPABASE_ANON_KEY:-}" valid_anon_key)"

# --------------------------------------------------------------------------
# 1. config.js
# --------------------------------------------------------------------------

# Belt and braces on top of validation: neither `"` nor `\` nor a raw angle
# bracket can survive into the emitted string literal.
js_escape() {
  printf '%s' "$1" |
    sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' -e 's/</\\u003c/g' -e 's/>/\\u003e/g'
}

if [ ! -d "$HTML_DIR" ]; then
  log "FATAL ${HTML_DIR} does not exist — cannot write config.js."
  exit 1
fi

{
  echo "/* Generated at container start by 10-onboardbuddy-runtime-config.sh."
  echo "   Do not edit, and do not cache: nginx serves this no-store. */"
  echo "window.__ONBOARDBUDDY_CONFIG__ = {"
  printf '  apiUrl: "%s",\n' "$(js_escape "$API_URL")"
  printf '  supabaseUrl: "%s",\n' "$(js_escape "$SUPABASE_URL")"
  printf '  supabaseAnonKey: "%s"\n' "$(js_escape "$SUPABASE_ANON_KEY")"
  echo "};"
} >"$CONFIG_JS" || {
  log "FATAL could not write ${CONFIG_JS}."
  exit 1
}

# --------------------------------------------------------------------------
# 2. Content-Security-Policy connect-src, derived from the same values
# --------------------------------------------------------------------------

# scheme://host[:port], dropping any path/query/fragment. `|` is the sed
# delimiter here because the pattern contains both `/` and `#`.
origin_of() {
  printf '%s' "$1" | sed -E 's|^([A-Za-z][A-Za-z0-9+.-]*://[^/?#]+).*$|\1|'
}

CONNECT_SRC="'self'"
add_source() {
  [ -n "$1" ] || return 0
  case " ${CONNECT_SRC} " in
    *" $1 "*) return 0 ;; # already listed
  esac
  CONNECT_SRC="${CONNECT_SRC} $1"
}

# 'self' already covers a same-origin path such as VITE_API_URL=/api, so only
# an absolute URL contributes an extra source.
case "$API_URL" in
  http://* | https://*) add_source "$(origin_of "$API_URL")" ;;
esac

if [ -n "$SUPABASE_URL" ]; then
  sb_origin="$(origin_of "$SUPABASE_URL")"
  add_source "$sb_origin"
  # supabase-js opens a realtime WebSocket to the same host.
  add_source "$(printf '%s' "$sb_origin" | sed -e 's#^https://#wss://#' -e 's#^http://#ws://#')"
fi

if [ -f "$HEADERS_TEMPLATE" ]; then
  # Restricted to `add_header` lines so the template's own commentary about the
  # placeholder survives into the rendered file — that comment is the only
  # explanation an operator reading the file inside a container will get. The
  # validators above exclude `|` and `&` from every accepted value, so the
  # substitution cannot break out of the sed expression or re-inject the match.
  sed -e "/add_header/ s|__CSP_CONNECT_SRC__|${CONNECT_SRC}|g" "$HEADERS_TEMPLATE" >"$HEADERS_OUT" || {
    log "FATAL could not render ${HEADERS_OUT}."
    exit 1
  }
else
  log "FATAL security-headers template missing at ${HEADERS_TEMPLATE}."
  exit 1
fi

log "config.js written to ${CONFIG_JS}"
log "CSP connect-src ${CONNECT_SRC}"

exit 0
