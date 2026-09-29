import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    fetchGithubReleases: vi.fn()
}));

vi.mock('@/platform/tauri/bindings', () => ({
    commands: {
        appExternalApiGithubReleasesGet: mocks.fetchGithubReleases
    }
}));

import { fetchBranchReleases, fetchLatestBranchRelease } from './updateService';

function release({ publishedAt }: { publishedAt: string }) {
    return {
        tag_name: 'v2.7.0',
        assets: Array<unknown>(),
        html_url:
            'https://github.com/NanashiTheNameless/VRCX-0-Nanashi/releases/tag/v2.7.0',
        name: 'VRCX-0 2.7.0',
        prerelease: false,
        published_at: publishedAt,
        body: ''
    };
}

describe('updateService branch release fetching', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('fetches and normalizes releases for the stable branch', async () => {
        mocks.fetchGithubReleases.mockResolvedValue({
            status: 200,
            data: [release({ publishedAt: '2026-06-21T07:00:00Z' })]
        });

        const releases = await fetchBranchReleases('stable');

        expect(releases).toHaveLength(1);
        expect(releases[0].canonicalVersion).toBe('2.7.0');
    });

    it('throws when the GitHub release request fails', async () => {
        mocks.fetchGithubReleases.mockResolvedValue({
            status: 500,
            data: []
        });

        await expect(fetchLatestBranchRelease('stable')).rejects.toThrow(
            'GitHub release request failed (500).'
        );
    });

    it('keeps only matching GitHub prereleases in the beta branch', async () => {
        mocks.fetchGithubReleases.mockResolvedValue({
            status: 200,
            data: [
                release({ publishedAt: '2026-06-21T07:00:00Z' }),
                {
                    ...release({ publishedAt: '2026-06-22T07:00:00Z' }),
                    tag_name: 'v2.8.0-Nightly-0000002',
                    prerelease: true
                }
            ]
        });

        const releases = await fetchBranchReleases('beta');

        expect(releases.map((item) => item.canonicalVersion)).toEqual([
            '2.8.0-Nightly-0000002'
        ]);
    });
});
