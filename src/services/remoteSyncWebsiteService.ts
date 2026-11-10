import {
    partyLinkParams,
    type FollowLinkRule,
    type PartyGroup
} from '@/domain/presence/followParty';
import configRepository from '@/repositories/configRepository';
import { isAvatarId, isUserId, isWorldId } from '@/shared/constants/vrchatIds';
import {
    isVrcxInstanceLink,
    VRCX_OPEN_RELAY_ORIGIN
} from '@/shared/constants/vrcxDeepLinks';

const WEBSITE_ORIGIN_KEY = 'remoteSyncWebsiteOrigin';
const IMAGE_HOSTS = new Set(['api.vrchat.cloud', 'assets.vrchat.com']);

export async function getRemoteSyncWebsiteOrigin(): Promise<string> {
    const configured = await configRepository.getString(
        WEBSITE_ORIGIN_KEY,
        VRCX_OPEN_RELAY_ORIGIN
    );
    return normalizeWebsiteOrigin(configured) ?? VRCX_OPEN_RELAY_ORIGIN;
}

export function normalizeWebsiteOrigin(value: string): string | null {
    try {
        const url = new URL(value);
        if (
            url.protocol !== 'https:' ||
            !url.hostname ||
            url.username ||
            url.password ||
            url.search ||
            url.hash ||
            (url.pathname !== '/' && url.pathname !== '')
        ) {
            return null;
        }
        return url.origin;
    } catch {
        return null;
    }
}

export async function buildWorldRelayUrl(input: {
    worldId: string;
    name?: string | null;
    author?: string | null;
    imageUrl?: string | null;
}): Promise<string> {
    if (!isWorldId(input.worldId)) {
        throw new Error(
            'Cannot create a website link for an invalid world ID.'
        );
    }
    return buildEntityRelayUrl('world', input.worldId, {
        name: input.name,
        author: input.author,
        imageUrl: input.imageUrl
    });
}

export async function buildAvatarRelayUrl(input: {
    avatarId: string;
    name?: string | null;
    author?: string | null;
    imageUrl?: string | null;
}): Promise<string> {
    if (!isAvatarId(input.avatarId)) {
        throw new Error(
            'Cannot create a website link for an invalid avatar ID.'
        );
    }
    return buildEntityRelayUrl('avatar', input.avatarId, {
        name: input.name,
        author: input.author,
        imageUrl: input.imageUrl
    });
}

export async function buildInstanceRelayUrl(input: {
    worldId: string;
    instanceId: string;
    shortName?: string;
    launchToken?: string;
}): Promise<string> {
    if (
        !isVrcxInstanceLink({
            worldId: input.worldId,
            instanceId: input.instanceId,
            shortName: input.shortName ?? '',
            launchToken: input.launchToken
        })
    ) {
        throw new Error(
            'Cannot create a website link for an invalid instance.'
        );
    }
    const origin = await getRemoteSyncWebsiteOrigin();
    const url = new URL(
        `/open/instance/${encodeURIComponent(input.worldId)}`,
        origin
    );
    url.searchParams.set('instanceId', input.instanceId);
    if (input.shortName) url.searchParams.set('shortName', input.shortName);
    if (input.launchToken)
        url.searchParams.set('launchToken', input.launchToken);
    return url.toString();
}

/**
 * Gated follow link. Everything is in the fragment, so the website never
 * receives it; the criteria shown there are informational, the app checks
 * them against VRChat before answering a request invite.
 */
export async function buildFollowLinkUrl(input: {
    userId: string;
    displayName: string;
    rules: FollowLinkRule[];
    consentEmoji?: string;
}): Promise<string> {
    if (!isUserId(input.userId)) {
        throw new Error('Cannot create a follow link without a user ID.');
    }
    const origin = await getRemoteSyncWebsiteOrigin();
    const url = new URL('/open/follow', origin);
    const fragment = new URLSearchParams();
    fragment.set('u', input.userId);
    const name = limitPreview(input.displayName);
    if (name) fragment.set('n', name);
    const requirements = new Set<string>();
    for (const rule of input.rules.filter((rule) => rule.enabled)) {
        if (rule.requireFriend) requirements.add('friend');
        if (rule.age !== 'none') requirements.add(rule.age);
        if (rule.groups.length) requirements.add('group');
    }
    if (requirements.size) fragment.set('r', [...requirements].join(','));
    if (input.consentEmoji) fragment.set('e', input.consentEmoji);
    url.hash = fragment.toString();
    return url.toString();
}

/**
 * Live location link. The key in the fragment decrypts the location; the
 * website never receives it.
 */
export async function buildLiveFollowUrl(input: {
    code: string;
    linkKey: string;
    displayName: string;
}): Promise<string> {
    if (!/^[A-Za-z0-9]{10}$/.test(input.code)) {
        throw new Error('Cannot create a link for an invalid share code.');
    }
    const origin = await getRemoteSyncWebsiteOrigin();
    const url = new URL(`/f/${input.code}`, origin);
    const fragment = new URLSearchParams();
    fragment.set('k', input.linkKey);
    const name = limitPreview(input.displayName).slice(0, 60);
    if (name) fragment.set('n', name);
    url.hash = fragment.toString();
    return url.toString();
}

export async function buildPartyLinkUrl(
    party: PartyGroup,
    selfUserId: string
): Promise<string> {
    const origin = await getRemoteSyncWebsiteOrigin();
    const url = new URL('/open/party', origin);
    url.hash = partyLinkParams(party, selfUserId).toString();
    return url.toString();
}

export async function entityRelayUrl(
    kind: 'world' | 'avatar',
    id: string
): Promise<string> {
    const origin = await getRemoteSyncWebsiteOrigin();
    return new URL(
        `/open/${kind}/${encodeURIComponent(id)}`,
        origin
    ).toString();
}

async function buildEntityRelayUrl(
    kind: 'world' | 'avatar',
    id: string,
    preview: {
        name?: string | null;
        author?: string | null;
        imageUrl?: string | null;
    }
): Promise<string> {
    const origin = await getRemoteSyncWebsiteOrigin();
    const url = new URL(`/open/${kind}/${encodeURIComponent(id)}`, origin);
    const fragment = new URLSearchParams();
    const name = limitPreview(preview.name);
    const author = limitPreview(preview.author);
    const image = normalizePreviewImage(preview.imageUrl);
    if (name) fragment.set('n', name);
    if (author) fragment.set('a', author);
    if (image) fragment.set('i', image);
    const serialized = fragment.toString();
    if (serialized) url.hash = serialized;
    return url.toString();
}

function limitPreview(value?: string | null): string {
    return Array.from(value?.trim() ?? '')
        .slice(0, 200)
        .join('');
}

function normalizePreviewImage(value?: string | null): string {
    if (!value) return '';
    try {
        const url = new URL(value);
        if (url.protocol !== 'https:' || !IMAGE_HOSTS.has(url.hostname)) {
            return '';
        }
        return limitPreview(url.toString());
    } catch {
        return '';
    }
}

export function acceptedRelayOrigins(configuredOrigin: string): string[] {
    return [
        normalizeWebsiteOrigin(configuredOrigin),
        VRCX_OPEN_RELAY_ORIGIN
    ].filter((value): value is string => Boolean(value));
}
