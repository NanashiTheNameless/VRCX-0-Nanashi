import { describe, expect, it } from 'vitest';

import { normalize } from '@/repositories/group-profile/profile';

import { buildGroupDialogViewState } from './groupDialogViewState';

function viewStateFor(patch: Record<string, unknown>) {
    return buildGroupDialogViewState({
        currentUserId: 'usr_me',
        friendsById: {},
        group: normalize({
            id: 'grp_test',
            name: 'Test Group',
            ownerId: 'usr_owner',
            memberCount: 5,
            membershipStatus: 'member',
            ...patch
        }),
        ownerProfile: null
    });
}

describe('group dialog membership exit', () => {
    it('lets a member leave the group', () => {
        expect(viewStateFor({})).toMatchObject({
            canLeave: true,
            canDelete: false
        });
    });

    it('offers deletion instead of leaving to an owner who is the last member', () => {
        expect(
            viewStateFor({ ownerId: 'usr_me', memberCount: 1 })
        ).toMatchObject({
            canLeave: false,
            canDelete: true
        });
    });

    it('offers neither leaving nor deleting to an owner with other members', () => {
        expect(
            viewStateFor({ ownerId: 'usr_me', memberCount: 3 })
        ).toMatchObject({
            canLeave: false,
            canDelete: false
        });
    });

    it('offers neither to someone outside the group', () => {
        expect(viewStateFor({ membershipStatus: 'inactive' })).toMatchObject({
            canLeave: false,
            canDelete: false
        });
    });
});
