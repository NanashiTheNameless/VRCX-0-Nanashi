#!/usr/bin/env bash
set -euo pipefail

directory="${1:?Usage: flatten-release-assets.sh DIRECTORY}"
while IFS= read -r -d '' asset; do
    destination="$directory/$(basename "$asset")"
    if [[ -e "$destination" ]]; then
        if ! cmp -s -- "$asset" "$destination"; then
            echo "Conflicting release assets: $(basename "$asset")" >&2
            exit 1
        fi
        rm -- "$asset"
    else
        mv -- "$asset" "$destination"
    fi
done < <(find "$directory" -mindepth 2 -type f -print0)

find "$directory" -mindepth 1 -type d -empty -delete
