import type { NormalizedRelease } from '@/services/updateService';

/** Older releases offered for downgrading, below the installed one. */
export const MAX_OLDER_VERSIONS = 4;

export type VersionListEntry = {
    release: NormalizedRelease;
    /**
     * Position relative to the installed version: 0 is installed, 1, 2, …
     * are newer, -1 … -4 are older. `null` only when neither the installed
     * version nor this build's time can place it (nightly versions alone
     * carry no order).
     */
    offset: number | null;
};

/**
 * `releases` is newest first. Keeps every newer release, the installed one,
 * and at most `MAX_OLDER_VERSIONS` older ones.
 *
 * When the installed version is not listed (a local build, or a nightly
 * already pruned from GitHub), `buildTimeMs` places it instead: releases
 * published after this build are newer. There is then no 0 row.
 */
export function buildVersionList(
    releases: readonly NormalizedRelease[],
    currentVersion: string,
    buildTimeMs: number | null = null
): VersionListEntry[] {
    const currentIndex = releases.findIndex(
        (release) => release.canonicalVersion === currentVersion
    );
    if (currentIndex >= 0) {
        return releases
            .slice(0, currentIndex + MAX_OLDER_VERSIONS + 1)
            .map((release, index) => ({
                release,
                offset: currentIndex - index
            }));
    }
    if (buildTimeMs !== null) {
        // An unparsable publish date counts as older, which errs toward
        // showing the downgrade warning.
        const isNewer = (release: NormalizedRelease) =>
            Date.parse(release.publishedAt) > buildTimeMs;
        const newer = releases.filter(isNewer);
        const older = releases
            .filter((release) => !isNewer(release))
            .slice(0, MAX_OLDER_VERSIONS);
        return [
            ...newer.map((release, index) => ({
                release,
                offset: newer.length - index
            })),
            ...older.map((release, index) => ({
                release,
                offset: -(index + 1)
            }))
        ];
    }
    return releases
        .slice(0, MAX_OLDER_VERSIONS + 1)
        .map((release) => ({ release, offset: null }));
}

export type InstallKind =
    | 'latest'
    | 'upgrade'
    | 'reinstall'
    | 'downgrade'
    | 'unknown';

/** What installing `entry` (at `index` in the newest-first list) would do. */
export function installKindFor(
    entry: VersionListEntry,
    index: number
): InstallKind {
    if (entry.offset === null) {
        return 'unknown';
    }
    if (entry.offset === 0) {
        return 'reinstall';
    }
    if (entry.offset < 0) {
        return 'downgrade';
    }
    return index === 0 ? 'latest' : 'upgrade';
}
