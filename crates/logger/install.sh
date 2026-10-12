#!/bin/sh
set -eu

COMPOSE_URL="${VRCX0_LOGGER_COMPOSE_URL:-https://raw.githubusercontent.com/Map1en/VRCX-0/master/crates/logger/compose.yaml}"

fail() {
    echo "error: $*" >&2
    exit 1
}

ANSWERS="${VRCX0_LOGGER_ANSWERS:-/dev/tty}"
INTERACTIVE=""
if (exec 3<"$ANSWERS") 2>/dev/null; then
    exec 3<"$ANSWERS"
    INTERACTIVE=1
fi

restore_echo() {
    [ -z "$INTERACTIVE" ] || stty echo <&3 2>/dev/null || true
}
trap restore_echo EXIT
trap 'restore_echo; exit 130' INT TERM

ask() {
    if [ -n "$INTERACTIVE" ]; then
        printf '%s [%s]: ' "$1" "${3:-$2}" >&2
        read -r answer <&3 || true
        printf '%s' "${answer:-$2}"
    else
        printf '%s' "$2"
    fi
}

ask_secret() {
    if [ -n "$INTERACTIVE" ]; then
        printf '%s [%s]: ' "$1" "$3" >&2
        stty -echo <&3 2>/dev/null || true
        read -r answer <&3 || true
        restore_echo
        printf '\n' >&2
        printf '%s' "${answer:-$2}"
    else
        printf '%s' "$2"
    fi
}

positive_or_empty() {
    case "$2" in
        "") ;;
        *[!0-9]* | 0*) fail "$1 must be a whole number greater than 0, or empty" ;;
    esac
}

check_channel() {
    case "$1" in
        latest | beta) return ;;
        *[!0-9a-z.-]*) ;;
        [0-9]*.[0-9]*.[0-9]*) return ;;
    esac
    fail "the release channel must be latest, beta or a version such as 2.32.0"
}

setting() {
    sed -n "s/^$1=//p" .env | tail -n 1 | tr -d "\r\"'"
}

write_settings() {
    printf 'VRCX0_LOGGER_TAG=%s\nVRCX0_LOGGER_PORT=%s\nVRCX0_LOGGER_BIND=%s\nVRCX0_LOGGER_RETENTION_DAYS=%s\nVRCX0_LOGGER_MAX_STORAGE_MB=%s\n' \
        "$1" "$2" "$3" "$4" "$5" >.env
}

command -v docker >/dev/null 2>&1 || fail "Docker is required: https://docs.docker.com/engine/install/"
docker compose version >/dev/null 2>&1 ||
    fail "Docker Compose v2 (the docker compose command) is required: https://docs.docker.com/compose/install/"

if command -v curl >/dev/null 2>&1; then
    download() { curl -fsSL -o "$2" "$1"; }
    probe() { curl -fs -o /dev/null "$1"; }
elif command -v wget >/dev/null 2>&1; then
    download() { wget -qO "$2" "$1"; }
    probe() { wget -q -O /dev/null "$1"; }
else
    fail "curl or wget is required"
fi

DIR=$(ask "Install directory" "${VRCX0_LOGGER_DIR:-vrcx-0-logger}")

if [ "${1:-}" = down ]; then
    [ -f "$DIR/compose.yaml" ] || fail "no recorder is installed in $DIR"
    cd "$DIR"
    docker compose down
    echo "The recorder is stopped. Its data and password are kept in $(pwd)."
    exit 0
fi

mkdir -p "$DIR/data"
cd "$DIR"

NEW_PASSWORD=""
UPDATE=""
if [ -s password ]; then
    UPDATE=1
    if [ ! -f .env ]; then
        write_settings "${VRCX0_LOGGER_TAG:-latest}" "${VRCX0_LOGGER_PORT:-8787}" \
            "${VRCX0_LOGGER_BIND:-0.0.0.0}" "${VRCX0_LOGGER_RETENTION_DAYS:-}" \
            "${VRCX0_LOGGER_MAX_STORAGE_MB:-1024}"
    fi
    CURRENT_TAG=$(setting VRCX0_LOGGER_TAG)
    TAG=$(ask "Release channel: latest (stable), beta or a version" "${CURRENT_TAG:-latest}")
    check_channel "$TAG"
    cp .env .env.previous
    { tr -d '\r' <.env.previous | grep -v '^VRCX0_LOGGER_TAG=' || true; printf 'VRCX0_LOGGER_TAG=%s\n' "$TAG"; } >.env
    echo "Updating the recorder in $(pwd); other settings stay as they are in .env."
else
    TAG=$(ask "Release channel: latest (stable) or beta" "${VRCX0_LOGGER_TAG:-latest}")
    check_channel "$TAG"
    PORT=$(ask "Port" "${VRCX0_LOGGER_PORT:-8787}")
    case "$PORT" in
        "" | *[!0-9]*) fail "the port must be a number" ;;
    esac
    [ "$PORT" -ge 1 ] && [ "$PORT" -le 65535 ] || fail "the port must be between 1 and 65535"
    BIND=$(ask "Listen address (0.0.0.0 for all networks; on a VPS use its VPN address)" "${VRCX0_LOGGER_BIND:-0.0.0.0}")
    case "$BIND" in
        "" | *[!0-9.]*) fail "the listen address must be an IPv4 address" ;;
    esac
    DAYS=$(ask "Delete records older than this many days" "${VRCX0_LOGGER_RETENTION_DAYS:-}" "keep all")
    positive_or_empty "the number of days" "$DAYS"
    MAX_MB=$(ask "Storage limit in MB (0 for no limit)" "${VRCX0_LOGGER_MAX_STORAGE_MB:-1024}")
    case "$MAX_MB" in
        "" | *[!0-9]*) fail "the storage limit must be a whole number of MB, or 0 for no limit" ;;
    esac
    NEW_PASSWORD=$(ask_secret "Recorder password, at least 8 characters" "${VRCX0_LOGGER_PASSWORD:-}" "generate one")
    if [ -z "$NEW_PASSWORD" ]; then
        NEW_PASSWORD=$(LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c 20)
    fi
    [ "${#NEW_PASSWORD}" -ge 8 ] || fail "the password needs at least 8 characters"
    (umask 077 && printf '%s' "$NEW_PASSWORD" >password)
    write_settings "$TAG" "$PORT" "$BIND" "$DAYS" "$MAX_MB"
fi

if [ ! -f compose.yaml ]; then
    download "$COMPOSE_URL" compose.yaml.new || fail "could not download compose.yaml"
    mv compose.yaml.new compose.yaml
fi

if ! docker compose pull || ! docker compose up -d; then
    if [ -n "$UPDATE" ]; then
        mv .env.previous .env
        docker compose up -d || true
        fail "could not update the recorder; it keeps running with the previous release channel"
    fi
    rm -f .env password
    fail "could not start the recorder; check the release channel and your network"
fi
rm -f .env.previous

PORT=$(setting VRCX0_LOGGER_PORT)
BIND=$(setting VRCX0_LOGGER_BIND)
case "${BIND:-0.0.0.0}" in
    0.0.0.0)
        HOST=127.0.0.1
        ADDRESS=$(hostname -I 2>/dev/null | cut -d' ' -f1) || true
        if [ -z "$ADDRESS" ]; then
            ADDRESS=$(ip route get 1.1.1.1 2>/dev/null | sed -n 's/.* src \([0-9.]*\).*/\1/p') || true
        fi
        ;;
    *)
        HOST=$BIND
        ADDRESS=$BIND
        ;;
esac

attempt=0
until probe "http://$HOST:${PORT:-8787}/health"; do
    attempt=$((attempt + 1))
    [ "$attempt" -lt 15 ] || fail "the recorder did not start; check: cd $(pwd) && docker compose logs"
    sleep 2
done

echo
echo "The recorder is running in $(pwd)"
echo "  Address:  http://${ADDRESS:-<this machine's IP>}:${PORT:-8787}"
if [ -n "$NEW_PASSWORD" ]; then
    echo "  Password: $NEW_PASSWORD"
else
    echo "  Password: unchanged, stored in $(pwd)/password"
fi
