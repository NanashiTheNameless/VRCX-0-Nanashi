import { describe, expect, it } from 'vitest';

import { vrchatDefaultEmojis } from '@/shared/constants/vrchatDefaultEmojis';

import rust from '../../../crates/application-realtime/src/realtime/party/config.rs?raw';
import {
    CONSENT_EMOJI_IDS,
    isConsentEmoji,
    mergeJoinedParty,
    newPartyGroup,
    parseFollowLinkRules,
    parsePartyGroups,
    partyFromJoinOffer,
    partyLinkParams,
    pickConsentEmoji,
    ruleHasRequirement,
    STOP_EMOJI_ID
} from './followParty';

const SELF = 'usr_11111111-1111-1111-1111-111111111111';
const FRIEND = 'usr_22222222-2222-2222-2222-222222222222';
const GUEST = 'usr_33333333-3333-3333-3333-333333333333';

describe('consent emojis', () => {
    it('match the Rust list exactly', () => {
        const block = rust.slice(
            rust.indexOf('pub const CONSENT_EMOJI_IDS'),
            rust.indexOf('];', rust.indexOf('pub const CONSENT_EMOJI_IDS'))
        );
        const rustIds = [...block.matchAll(/"(default_[a-z_]+)"/g)].map(
            (match) => match[1]
        );
        expect(rustIds).toEqual([...CONSENT_EMOJI_IDS]);
    });

    it('are real default emojis and never Stop or everyday boops', () => {
        const known = new Set(vrchatDefaultEmojis.map((emoji) => emoji.id));
        for (const id of CONSENT_EMOJI_IDS) {
            expect(known.has(id)).toBe(true);
        }
        for (const reserved of [
            STOP_EMOJI_ID,
            'default_hand_wave',
            'default_smile',
            'default_heart',
            'default_thumbs_up',
            'default_laugh',
            'default_kiss',
            'default_in_love',
            'default_portal'
        ]) {
            expect(isConsentEmoji(reserved)).toBe(false);
        }
    });

    it('picks a different emoji when rotating', () => {
        const first = pickConsentEmoji('', () => 0);
        expect(first).toBe(CONSENT_EMOJI_IDS[0]);
        expect(pickConsentEmoji(first, () => 0)).not.toBe(first);
        expect(isConsentEmoji(pickConsentEmoji('', () => 0.9999))).toBe(true);
    });
});

describe('follow link rules', () => {
    it('reads stored rules leniently', () => {
        expect(
            parseFollowLinkRules([
                {
                    id: 'r1',
                    enabled: true,
                    requireFriend: true,
                    age: 'adult',
                    groups: ['grp_a', 'nope', 3]
                },
                { enabled: true },
                'bad'
            ])
        ).toEqual([
            {
                id: 'r1',
                label: '',
                enabled: true,
                requireFriend: true,
                age: 'adult',
                groups: ['grp_a']
            }
        ]);
        expect(parseFollowLinkRules(null)).toEqual([]);
    });

    it('knows when a rule has no requirement', () => {
        const [rule] = parseFollowLinkRules([{ id: 'r1', enabled: true }]);
        expect(ruleHasRequirement(rule)).toBe(false);
        expect(ruleHasRequirement({ ...rule, age: 'verified' })).toBe(true);
    });
});

describe('parties', () => {
    it('shares itself with the sharer as a member', () => {
        const party = {
            ...newPartyGroup(),
            id: 'party123',
            name: 'Crew',
            emoji: 'default_fire',
            followMode: 'leader' as const,
            leaderUserId: SELF,
            members: [
                {
                    userId: FRIEND,
                    displayName: 'Friend',
                    role: 'member' as const
                },
                { userId: GUEST, displayName: 'Guest', role: 'guest' as const }
            ]
        };
        const params = partyLinkParams(party, SELF);
        expect(Object.fromEntries(params)).toEqual({
            p: 'party123',
            n: 'Crew',
            e: 'default_fire',
            f: 'leader',
            l: SELF,
            m: `${SELF}:member,${FRIEND}:member,${GUEST}:guest`
        });
    });

    it('joins an offer without listing the user themselves', () => {
        const party = partyFromJoinOffer(
            {
                partyId: 'party123',
                name: 'Crew',
                emoji: 'default_fire',
                followMode: 'leader',
                leaderUserId: FRIEND,
                members: [
                    { userId: FRIEND, role: 'member' },
                    { userId: SELF, role: 'member' },
                    { userId: GUEST, role: 'guest' }
                ]
            },
            SELF,
            { [FRIEND]: 'Friend' }
        );
        expect(party.members).toEqual([
            { userId: FRIEND, displayName: 'Friend', role: 'member' },
            { userId: GUEST, displayName: '', role: 'guest' }
        ]);
        expect(party.leaderUserId).toBe(FRIEND);
        expect(party.autoLaunch).toBe(false);
    });

    it('keeps the local auto-launch choice when re-joining', () => {
        const existing = { ...newPartyGroup(), id: 'p1', autoLaunch: true };
        const joined = { ...newPartyGroup(), id: 'p1', name: 'New name' };
        const merged = mergeJoinedParty([existing], joined);
        expect(merged).toHaveLength(1);
        expect(merged[0].name).toBe('New name');
        expect(merged[0].autoLaunch).toBe(true);
    });

    it('drops malformed members and fixes unknown emojis', () => {
        const [party] = parsePartyGroups([
            {
                id: 'p1',
                enabled: true,
                emoji: 'default_stop',
                followMode: 'other',
                members: [
                    { userId: FRIEND, role: 'guest' },
                    { userId: 'bad id', role: 'member' }
                ]
            }
        ]);
        expect(isConsentEmoji(party.emoji)).toBe(true);
        expect(party.followMode).toBe('anyone');
        expect(party.members).toEqual([
            { userId: FRIEND, displayName: '', role: 'guest' }
        ]);
    });
});
