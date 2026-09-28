import configRepository from '@/repositories/configRepository';
import { links } from '@/shared/constants/link';

// Fork: after an update the app links to the GitHub release for the running
// version instead of rendering release notes in-app.

export const POST_UPDATE_CHANGELOG_TOAST_CONFIG_KEY =
    'VRCX_showPostUpdateChangelogToast';
const SEEN_POST_UPDATE_CHANGELOG_VERSION_CONFIG_KEY =
    'VRCX_seenPostUpdateChangelogVersion';
const LAST_STARTED_VERSION_CONFIG_KEY = 'VRCX_lastStartedVersion';

type PostUpdateChangelogToastInput = {
    currentVersion?: string;
    lastStartedVersion?: string;
    seenVersion?: string;
    enabled?: boolean;
};

function normalizeVersion(value: string | undefined) {
    return (value ?? '').trim();
}

function getCurrentVersion() {
    return typeof VERSION === 'undefined' ? '' : VERSION || '';
}

/**
 * GitHub release page for `version` (tags are `v<version>`), or the releases
 * list when the version is unknown.
 */
export function releaseNotesUrl(version: string = getCurrentVersion()) {
    const bare = normalizeVersion(version).replace(/^v/i, '');
    return bare
        ? `${links.releases}/tag/v${encodeURIComponent(bare)}`
        : links.releases;
}

export function resolvePostUpdateChangelogToastState({
    currentVersion,
    lastStartedVersion,
    seenVersion,
    enabled
}: PostUpdateChangelogToastInput) {
    const normalizedCurrentVersion = normalizeVersion(currentVersion);
    const normalizedLastStartedVersion = normalizeVersion(lastStartedVersion);
    const normalizedSeenVersion = normalizeVersion(seenVersion);
    const hasPreviousVersion = Boolean(normalizedLastStartedVersion);
    const versionChanged =
        hasPreviousVersion &&
        normalizedLastStartedVersion !== normalizedCurrentVersion;

    return {
        currentVersion: normalizedCurrentVersion,
        shouldShow:
            Boolean(enabled) &&
            Boolean(normalizedCurrentVersion) &&
            versionChanged &&
            normalizedSeenVersion !== normalizedCurrentVersion,
        shouldRecordStartedVersion:
            Boolean(normalizedCurrentVersion) &&
            normalizedLastStartedVersion !== normalizedCurrentVersion
    };
}

export async function markPostUpdateChangelogVersionSeen(
    version: string = getCurrentVersion()
) {
    const normalizedVersion = normalizeVersion(version);
    if (!normalizedVersion) {
        return;
    }
    await configRepository.setString(
        SEEN_POST_UPDATE_CHANGELOG_VERSION_CONFIG_KEY,
        normalizedVersion
    );
    await configRepository.setString(
        LAST_STARTED_VERSION_CONFIG_KEY,
        normalizedVersion
    );
}

export async function loadPostUpdateChangelogToastState(
    version: string = getCurrentVersion()
) {
    const currentVersion = normalizeVersion(version);
    const [enabled, lastStartedVersion, seenVersion] = await Promise.all([
        configRepository.getBool(POST_UPDATE_CHANGELOG_TOAST_CONFIG_KEY, false),
        configRepository.getString(LAST_STARTED_VERSION_CONFIG_KEY, ''),
        configRepository.getString(
            SEEN_POST_UPDATE_CHANGELOG_VERSION_CONFIG_KEY,
            ''
        )
    ]);
    const state = resolvePostUpdateChangelogToastState({
        currentVersion,
        lastStartedVersion,
        seenVersion,
        enabled
    });

    if (state.shouldRecordStartedVersion && !state.shouldShow) {
        await configRepository.setString(
            LAST_STARTED_VERSION_CONFIG_KEY,
            state.currentVersion
        );
    }

    return state;
}
