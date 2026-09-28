import { describe, expect, it } from 'vitest';

import type { NormalizedRelease } from '@/services/updateService';

import {
    buildVersionList,
    installKindFor,
    MAX_OLDER_VERSIONS
} from './updaterVersionList';

function releases(...versions: string[]): NormalizedRelease[] {
    return versions.map(
        (canonicalVersion) => ({ canonicalVersion }) as NormalizedRelease
    );
}

function summarize(list: ReturnType<typeof buildVersionList>) {
    return list.map(({ release, offset }) => [
        release.canonicalVersion,
        offset
    ]);
}

describe('buildVersionList', () => {
    it('numbers newer releases up and older ones down from the installed 0', () => {
        const list = buildVersionList(
            releases('2.9', '2.8', '2.7', '2.6', '2.5', '2.4', '2.3', '2.2'),
            '2.7'
        );
        expect(summarize(list)).toEqual([
            ['2.9', 2],
            ['2.8', 1],
            ['2.7', 0],
            ['2.6', -1],
            ['2.5', -2],
            ['2.4', -3],
            ['2.3', -4]
        ]);
    });

    it('keeps every newer release but at most four older ones', () => {
        const newer = Array.from({ length: 12 }, (_, i) => `3.${20 - i}`);
        const list = buildVersionList(
            releases(...newer, '3.0', '2.9', '2.8', '2.7', '2.6', '2.5'),
            '3.0'
        );
        expect(list).toHaveLength(12 + 1 + MAX_OLDER_VERSIONS);
        expect(list[0].offset).toBe(12);
        expect(list.at(-1)?.offset).toBe(-4);
    });

    it('lists what exists when there are fewer older releases', () => {
        expect(
            summarize(buildVersionList(releases('2.1', '2.0'), '2.0'))
        ).toEqual([
            ['2.1', 1],
            ['2.0', 0]
        ]);
    });

    it('places a pruned installed build by its build time: newer count up, no 0 row', () => {
        // 91d5f6a was built on Sep 24 and has since been pruned from GitHub.
        const published = (version: string, day: number) =>
            ({
                canonicalVersion: version,
                publishedAt: `2026-10-${String(day).padStart(2, '0')}T12:00:00Z`
            }) as NormalizedRelease;
        const list = buildVersionList(
            [
                published('3.1.0-Nightly-0c4d8e2', 4),
                published('3.1.0-Nightly-e7b2f01', 3),
                published('3.1.0-Nightly-a93d4c8', 2)
            ],
            '3.0.0-Nightly-91d5f6a',
            Date.parse('2026-09-24T12:00:00Z')
        );
        expect(summarize(list)).toEqual([
            ['3.1.0-Nightly-0c4d8e2', 3],
            ['3.1.0-Nightly-e7b2f01', 2],
            ['3.1.0-Nightly-a93d4c8', 1]
        ]);
    });

    it('counts releases published before the build as older, capped at four', () => {
        const at = (version: string, iso: string) =>
            ({
                canonicalVersion: version,
                publishedAt: iso
            }) as NormalizedRelease;
        const list = buildVersionList(
            [
                at('new', '2026-10-05T00:00:00Z'),
                at('o1', '2026-10-01T00:00:00Z'),
                at('o2', '2026-09-30T00:00:00Z'),
                at('o3', '2026-09-29T00:00:00Z'),
                at('o4', '2026-09-28T00:00:00Z'),
                at('o5', '2026-09-27T00:00:00Z'),
                at('bad-date', 'not a date')
            ],
            'local-build',
            Date.parse('2026-10-02T00:00:00Z')
        );
        expect(summarize(list)).toEqual([
            ['new', 1],
            ['o1', -1],
            ['o2', -2],
            ['o3', -3],
            ['o4', -4]
        ]);
    });

    it('shows the five newest without numbers when the installed version is unknown', () => {
        const list = buildVersionList(
            releases('2.9', '2.8', '2.7', '2.6', '2.5', '2.4'),
            'dev-build'
        );
        expect(summarize(list)).toEqual([
            ['2.9', null],
            ['2.8', null],
            ['2.7', null],
            ['2.6', null],
            ['2.5', null]
        ]);
    });

    it('labels each entry as latest, upgrade, reinstall or downgrade', () => {
        const list = buildVersionList(
            releases('2.9', '2.8', '2.7', '2.6'),
            '2.7'
        );
        expect(
            list.map((entry, index) => installKindFor(entry, index))
        ).toEqual(['latest', 'upgrade', 'reinstall', 'downgrade']);
    });

    it('calls the top entry a reinstall, not latest, when it is installed', () => {
        const list = buildVersionList(releases('2.9', '2.8'), '2.9');
        expect(installKindFor(list[0], 0)).toBe('reinstall');
    });

    it('does not guess when the list cannot be numbered', () => {
        const list = buildVersionList(releases('2.9', '2.8'), 'dev-build');
        expect(installKindFor(list[0], 0)).toBe('unknown');
    });
});
