import { describe, expect, it } from 'vitest';

import { DEFAULT_PREFERENCES } from '@/state/preferencesStore';

import { ConfigKeys } from './configKeys';

// An unset autoUpdateVRCX falls back to the legacy autoInstallUpdatesOnStartup
// switch, so its config default stays null on purpose.
const LEGACY_FALLBACK_KEYS = new Set(['autoUpdateVRCX']);

describe('ConfigKeys defaults', () => {
    it('match the preference store defaults for shared scalar keys', () => {
        const preferenceDefaults: Record<string, unknown> = DEFAULT_PREFERENCES;
        const mismatches = Object.entries(ConfigKeys).flatMap(
            ([key, definition]) => {
                const preferenceDefault = preferenceDefaults[key];
                if (
                    LEGACY_FALLBACK_KEYS.has(key) ||
                    !(key in preferenceDefaults) ||
                    (typeof preferenceDefault === 'object' &&
                        preferenceDefault !== null)
                ) {
                    return [];
                }
                return Object.is(definition.default, preferenceDefault)
                    ? []
                    : [[key, definition.default, preferenceDefault]];
            }
        );

        expect(mismatches).toEqual([]);
    });
});
