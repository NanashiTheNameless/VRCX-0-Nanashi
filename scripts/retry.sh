#!/usr/bin/env bash
# Runs a command until it succeeds, for CI steps that download from or
# upload to GitHub, whose release downloads and API answer 5xx now and then.
#
#   bash scripts/retry.sh [-n attempts] [-d first-delay-seconds] -- command [args...]
#
# Waits double after each failure (15, 30, 60, 120 seconds by default) and
# exits with the command's last status when every attempt fails.
set -uo pipefail

attempts=5
delay=15
while [[ $# -gt 0 ]]; do
    case "$1" in
        -n) attempts="$2"; shift 2 ;;
        -d) delay="$2"; shift 2 ;;
        --) shift; break ;;
        *) break ;;
    esac
done
if [[ $# -eq 0 ]]; then
    echo "usage: retry.sh [-n attempts] [-d first-delay-seconds] -- command [args...]" >&2
    exit 2
fi

for ((attempt = 1; ; attempt++)); do
    "$@"
    status=$?
    if [[ $status -eq 0 ]]; then
        exit 0
    fi
    if ((attempt >= attempts)); then
        echo "::error::Failed after $attempts attempts (exit $status): $*" >&2
        exit "$status"
    fi
    echo "::warning::Attempt $attempt of $attempts failed (exit $status), retrying in ${delay}s: $*" >&2
    sleep "$delay"
    delay=$((delay * 2))
done
