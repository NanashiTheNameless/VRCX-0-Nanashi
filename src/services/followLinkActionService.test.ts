import { describe, expect, it } from 'vitest';

import { followJoinPlan } from './followLinkActionService';

describe('followJoinPlan', () => {
    it('joins instances VRChat lets you into', () => {
        for (const location of [
            'wrld_a:1',
            'wrld_a:1~friends(usr_x)',
            'wrld_a:1~hidden(usr_x)',
            'wrld_a:1~group(grp_x)~groupAccessType(public)'
        ]) {
            expect(followJoinPlan(location)).toEqual({
                kind: 'selfInvite',
                location
            });
        }
    });

    it('asks for an invite when the instance is hidden or invite-only', () => {
        for (const location of [
            '',
            'private',
            'offline',
            'traveling',
            'wrld_a:1~private(usr_x)',
            'wrld_a:1~private(usr_x)~canRequestInvite'
        ]) {
            expect(followJoinPlan(location)).toEqual({ kind: 'requestInvite' });
        }
    });
});
