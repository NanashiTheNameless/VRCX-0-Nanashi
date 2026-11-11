import { sendRequestInviteToUser } from '@/services/inviteDeliveryService';
import { selfInviteToInstance } from '@/services/launchService';
import { toast } from '@/services/toastService';
import { parseLocation } from '@/shared/utils/location';
import { useFriendRosterStore } from '@/state/friendRosterStore';
import { useModalStore } from '@/state/modalStore';

import i18n from './i18nService';

const SELF_JOINABLE = new Set(['public', 'group', 'friends', 'friends+']);

/**
 * Fork: what "Join" from a follow link does. Join an instance VRChat lets
 * you into; otherwise ask for an invite, which the sharer's app checks.
 */
export function followJoinPlan(
    location: string
): { kind: 'selfInvite'; location: string } | { kind: 'requestInvite' } {
    const parsed = parseLocation(location);
    return parsed.isRealInstance &&
        parsed.worldId &&
        parsed.instanceId &&
        SELF_JOINABLE.has(parsed.accessType)
        ? { kind: 'selfInvite', location: parsed.tag }
        : { kind: 'requestInvite' };
}

function friendState(userId: string) {
    const friend = useFriendRosterStore.getState().friendsById[userId];
    const presence = friend?.$presence;
    const location =
        presence && 'place' in presence ? presence.place.location.tag : '';
    return { name: friend?.displayName || userId, location };
}

async function requestInvite(userId: string, name: string) {
    await sendRequestInviteToUser({ receiverUserId: userId });
    toast.add({
        type: 'success',
        title: i18n.t('deep_link.follow.request_sent', { name })
    });
}

export async function requestInviteFlow(userId: string): Promise<void> {
    const { name } = friendState(userId);
    const result = await useModalStore.getState().confirm({
        title: i18n.t('deep_link.follow.request_title', { name }),
        description: i18n.t('deep_link.follow.request_description', { name }),
        confirmText: i18n.t('deep_link.follow.request_confirm'),
        cancelText: i18n.t('deep_link.follow.cancel')
    });
    if (result.ok) {
        await requestInvite(userId, name);
    }
}

export async function joinUserFlow(userId: string): Promise<void> {
    const { name, location } = friendState(userId);
    const plan = followJoinPlan(location);
    const result = await useModalStore.getState().confirm({
        title: i18n.t('deep_link.follow.join_title', { name }),
        description:
            plan.kind === 'selfInvite'
                ? i18n.t('deep_link.follow.join_description', { name })
                : i18n.t('deep_link.follow.join_request_description', { name }),
        confirmText:
            plan.kind === 'selfInvite'
                ? i18n.t('deep_link.follow.join_confirm')
                : i18n.t('deep_link.follow.request_confirm'),
        cancelText: i18n.t('deep_link.follow.cancel')
    });
    if (!result.ok) {
        return;
    }
    if (plan.kind === 'selfInvite') {
        await selfInviteToInstance(plan.location);
        toast.add({
            type: 'success',
            title: i18n.t('message.invite.self_sent')
        });
        return;
    }
    await requestInvite(userId, name);
}
