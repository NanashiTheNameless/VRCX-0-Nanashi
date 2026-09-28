import { describe, expect, test } from 'vitest';

import {
    releaseNotesUrl,
    resolvePostUpdateChangelogToastState
} from './changelogService';

describe('changelogService', () => {
    test('links to the GitHub release for a version', () => {
        expect(releaseNotesUrl('3.0.0-Nightly-33ec243')).toBe(
            'https://github.com/NanashiTheNameless/VRCX-0-Nanashi/releases/tag/v3.0.0-Nightly-33ec243'
        );
        expect(releaseNotesUrl(' v3.0.0 ')).toBe(
            'https://github.com/NanashiTheNameless/VRCX-0-Nanashi/releases/tag/v3.0.0'
        );
        expect(releaseNotesUrl('')).toBe(
            'https://github.com/NanashiTheNameless/VRCX-0-Nanashi/releases'
        );
    });

    test('shows the post-update changelog toast only once for an upgraded version', () => {
        expect(
            resolvePostUpdateChangelogToastState({
                currentVersion: '2026.06.02',
                lastStartedVersion: '2026.05.30',
                seenVersion: '',
                enabled: true
            })
        ).toEqual({
            currentVersion: '2026.06.02',
            shouldShow: true,
            shouldRecordStartedVersion: true
        });

        expect(
            resolvePostUpdateChangelogToastState({
                currentVersion: '2026.06.02',
                lastStartedVersion: '2026.05.30',
                seenVersion: '2026.06.02',
                enabled: true
            }).shouldShow
        ).toBe(false);

        expect(
            resolvePostUpdateChangelogToastState({
                currentVersion: '2026.06.02',
                lastStartedVersion: '2026.05.30',
                seenVersion: '',
                enabled: false
            }).shouldShow
        ).toBe(false);

        expect(
            resolvePostUpdateChangelogToastState({
                currentVersion: '2026.06.02',
                lastStartedVersion: '',
                seenVersion: '',
                enabled: true
            }).shouldShow
        ).toBe(false);
    });
});
