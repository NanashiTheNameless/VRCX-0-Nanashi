import { isRecord } from '@/shared/utils/record';

export const FOLLOW_LINK_RULES_KEY = 'followLinkRules';
export const PARTY_GROUPS_KEY = 'partyGroups';
export const CONSENT_EMOJI_KEY = 'autoInviteConsentEmoji';
export const CONSENT_BOOP_BACK_KEY = 'autoInviteConsentBoopBack';
export const CONSENT_HOURS_KEY = 'autoInviteConsentHours';
export const CONSENT_STATE_KEY = 'autoInviteConsents';

export const STOP_EMOJI_ID = 'default_stop';
export const DEFAULT_CONSENT_HOURS = 24;

/**
 * Permanent VRChat default emojis that may be picked as a consent emoji.
 * Seasonal ones can disappear, everyday boops would grant consent by
 * accident, and Stop is reserved for withdrawing it. Keep in step with
 * `CONSENT_EMOJI_IDS` in `crates/application-realtime/src/realtime/party/config.rs`.
 */
export const CONSENT_EMOJI_IDS = Object.freeze([
    'default_angry',
    'default_blushing',
    'default_crying',
    'default_frown',
    'default_stoic',
    'default_sunglasses',
    'default_thinking',
    'default_thumbs_down',
    'default_tongue_out',
    'default_wow',
    'default_arrow_point',
    'default_hourglass',
    'default_keyboard',
    'default_cloud',
    'default_fire',
    'default_money',
    'default_broken_heart',
    'default_exclamation',
    'default_go',
    'default_music_note',
    'default_question',
    'default_zzz',
    'default_beer',
    'default_pizza',
    'default_tomato',
    'default_gift',
    'default_life_ring'
]);

export type AgeRequirement = 'none' | 'verified' | 'adult';
export type FollowMode = 'leader' | 'anyone';
export type PartyRole = 'member' | 'guest';

export interface FollowLinkRule {
    id: string;
    label: string;
    enabled: boolean;
    requireFriend: boolean;
    age: AgeRequirement;
    groups: string[];
}

export interface PartyMember {
    userId: string;
    displayName: string;
    role: PartyRole;
}

export interface PartyGroup {
    id: string;
    name: string;
    enabled: boolean;
    emoji: string;
    followMode: FollowMode;
    leaderUserId: string;
    autoLaunch: boolean;
    members: PartyMember[];
}

export function isConsentEmoji(value: string): boolean {
    return value !== STOP_EMOJI_ID && CONSENT_EMOJI_IDS.includes(value);
}

export function pickConsentEmoji(
    exclude: string = '',
    random: () => number = Math.random
): string {
    const choices = CONSENT_EMOJI_IDS.filter((id) => id !== exclude);
    const index = Math.min(
        choices.length - 1,
        Math.floor(random() * choices.length)
    );
    return choices[Math.max(0, index)];
}

export function newShareId(): string {
    const bytes = new Uint8Array(9);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (byte) => byte.toString(36).padStart(2, '0'))
        .join('')
        .slice(0, 16);
}

function isUserId(value: unknown): value is string {
    return typeof value === 'string' && /^usr_[A-Za-z0-9-]+$/.test(value);
}

function text(value: unknown, max = 60): string {
    return typeof value === 'string'
        ? Array.from(value.trim()).slice(0, max).join('')
        : '';
}

/** Lenient read of stored rules; the Rust side applies the strict checks. */
export function parseFollowLinkRules(raw: unknown): FollowLinkRule[] {
    if (!Array.isArray(raw)) {
        return [];
    }
    return raw.filter(isRecord).flatMap((rule) => {
        const id = text(rule.id, 40);
        if (!id) {
            return [];
        }
        const age: AgeRequirement =
            rule.age === 'verified' || rule.age === 'adult' ? rule.age : 'none';
        return [
            {
                id,
                label: text(rule.label),
                enabled: rule.enabled === true,
                requireFriend: rule.requireFriend === true,
                age,
                groups: Array.isArray(rule.groups)
                    ? rule.groups.filter(
                          (group): group is string =>
                              typeof group === 'string' &&
                              group.startsWith('grp_')
                      )
                    : []
            }
        ];
    });
}

export function ruleHasRequirement(rule: FollowLinkRule): boolean {
    return rule.requireFriend || rule.age !== 'none' || rule.groups.length > 0;
}

export function parsePartyGroups(raw: unknown): PartyGroup[] {
    if (!Array.isArray(raw)) {
        return [];
    }
    return raw.filter(isRecord).flatMap((party) => {
        const id = text(party.id, 40);
        if (!id) {
            return [];
        }
        const members: PartyMember[] = Array.isArray(party.members)
            ? party.members.filter(isRecord).flatMap((member) =>
                  isUserId(member.userId)
                      ? [
                            {
                                userId: member.userId,
                                displayName: text(member.displayName, 80),
                                role:
                                    member.role === 'guest'
                                        ? ('guest' as const)
                                        : ('member' as const)
                            }
                        ]
                      : []
              )
            : [];
        const emoji =
            typeof party.emoji === 'string' && isConsentEmoji(party.emoji)
                ? party.emoji
                : pickConsentEmoji();
        return [
            {
                id,
                name: text(party.name),
                enabled: party.enabled === true,
                emoji,
                followMode: party.followMode === 'leader' ? 'leader' : 'anyone',
                leaderUserId: isUserId(party.leaderUserId)
                    ? party.leaderUserId
                    : '',
                autoLaunch: party.autoLaunch === true,
                members
            }
        ];
    });
}

export function newFollowLinkRule(): FollowLinkRule {
    return {
        id: newShareId(),
        label: '',
        enabled: true,
        requireFriend: true,
        age: 'none',
        groups: []
    };
}

export function newPartyGroup(): PartyGroup {
    return {
        id: newShareId(),
        name: '',
        enabled: true,
        emoji: pickConsentEmoji(),
        followMode: 'anyone',
        leaderUserId: '',
        autoLaunch: false,
        members: []
    };
}

/** Party settings a member can share, read by the party link page. */
export function partyLinkParams(
    party: PartyGroup,
    selfUserId: string
): URLSearchParams {
    const params = new URLSearchParams();
    params.set('p', party.id);
    if (party.name) params.set('n', party.name);
    params.set('e', party.emoji);
    params.set('f', party.followMode);
    if (party.followMode === 'leader' && party.leaderUserId) {
        params.set('l', party.leaderUserId);
    }
    const members = [
        ...(isUserId(selfUserId) ? [`${selfUserId}:member`] : []),
        ...party.members
            .filter((member) => member.userId !== selfUserId)
            .map((member) => `${member.userId}:${member.role}`)
    ];
    params.set('m', members.join(','));
    return params;
}

export interface PartyJoinOffer {
    partyId: string;
    name: string;
    emoji: string;
    followMode: string;
    leaderUserId: string | null;
    members: { userId: string; role: string }[];
}

/**
 * Turns a party link into a party for this user's list. The user's own id
 * is left out of the roster, and the party stays saved only after the user
 * confirms it.
 */
export function partyFromJoinOffer(
    offer: PartyJoinOffer,
    selfUserId: string,
    displayNames: Record<string, string> = {}
): PartyGroup {
    const members: PartyMember[] = offer.members
        .filter((member) => isUserId(member.userId))
        .filter((member) => member.userId !== selfUserId)
        .map((member) => ({
            userId: member.userId,
            displayName: displayNames[member.userId] ?? '',
            role: member.role === 'guest' ? 'guest' : 'member'
        }));
    const followMode: FollowMode =
        offer.followMode === 'leader' ? 'leader' : 'anyone';
    return {
        id: offer.partyId,
        name: text(offer.name),
        enabled: true,
        emoji: isConsentEmoji(offer.emoji) ? offer.emoji : pickConsentEmoji(),
        followMode,
        leaderUserId:
            followMode === 'leader' && isUserId(offer.leaderUserId)
                ? offer.leaderUserId
                : '',
        autoLaunch: false,
        members
    };
}

/** Adds or replaces a party by id, keeping the user's own local choices. */
export function mergeJoinedParty(
    parties: PartyGroup[],
    joined: PartyGroup
): PartyGroup[] {
    const existing = parties.find((party) => party.id === joined.id);
    if (!existing) {
        return [...parties, joined];
    }
    return parties.map((party) =>
        party.id === joined.id
            ? { ...joined, autoLaunch: existing.autoLaunch }
            : party
    );
}
