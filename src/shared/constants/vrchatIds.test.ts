import { describe, expect, it } from 'vitest';

import {
    hasAvatarIdPrefix,
    hasGroupIdPrefix,
    hasUserIdPrefix,
    hasWorldIdPrefix,
    isAvatarId,
    isGroupId,
    isUserId,
    isWorldId
} from './vrchatIds';

describe('vrchatIds', () => {
    it('validates strict UUID-backed IDs by entity type', () => {
        expect(isUserId('usr_12345678-1234-1234-1234-1234567890ab')).toBe(true);
        expect(isWorldId('wrld_12345678-1234-1234-1234-1234567890ab')).toBe(
            true
        );
        expect(isAvatarId('avtr_12345678-1234-1234-1234-1234567890ab')).toBe(
            true
        );
        expect(isGroupId('grp_12345678-1234-1234-1234-1234567890ab')).toBe(
            true
        );
        expect(isUserId(' usr_12345678-1234-1234-1234-1234567890ab ')).toBe(
            true
        );
        expect(isUserId('usr_not-a-uuid')).toBe(false);
        expect(isUserId('wrld_12345678-1234-1234-1234-1234567890ab')).toBe(
            false
        );
    });

    it('keeps loose prefix checks separate from strict UUID validation', () => {
        expect(hasUserIdPrefix('usr_short')).toBe(true);
        expect(hasWorldIdPrefix('wrld_short')).toBe(true);
        expect(hasAvatarIdPrefix('avtr_short')).toBe(true);
        expect(hasGroupIdPrefix('grp_short')).toBe(true);
        expect(hasGroupIdPrefix(' user grp_short')).toBe(false);
    });
});
