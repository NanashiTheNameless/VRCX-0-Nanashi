import { describe, expect, it } from 'vitest';

import en from '@/localization/en.json';
import { ConfigKeys } from '@/repositories/configKeys';

import { syncSettingLabels } from './syncSettingLabels';

function text(path: string) {
    return path
        .split('.')
        .reduce<unknown>(
            (node, part) =>
                node && typeof node === 'object'
                    ? (node as Record<string, unknown>)[part]
                    : undefined,
            en
        );
}

describe('labels for settings that can sync', () => {
    it('every label and section is a string in the locale file', () => {
        const missing = Object.values(syncSettingLabels)
            .flat()
            .filter((path) => !path || typeof text(path) !== 'string');

        expect(missing).toEqual([]);
    });

    it('every entry names a config key the app has', () => {
        const known = new Set(
            Object.keys(ConfigKeys).map((name) =>
                name.replace(/^VRCX_/, '').toLowerCase()
            )
        );

        expect(
            Object.keys(syncSettingLabels).filter((name) => !known.has(name))
        ).toEqual([]);
    });
});
