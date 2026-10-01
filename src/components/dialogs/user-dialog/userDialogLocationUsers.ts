import { resolveFriendPresenceLocation } from '@/domain/friends/presence';
import {
    isOfflineOrLeavingFriend,
    resolveObservedPlayerUserId
} from '@/domain/friends/sameInstanceFriends';
import {
    buildInstanceRosterRows,
    firstText,
    isSameInstanceLocation
} from '@/domain/instances/instanceRoster';
import { parseLocation } from '@/shared/utils/location';
import { isRecord } from '@/shared/utils/record';

function filterVisibleUserDialogLocationUsers<TUser>({
    currentUserId,
    friendsById,
    location,
    memberUserIds,
    ownerId,
    users
}: {
    currentUserId: string | null;
    friendsById: unknown;
    location?: unknown;
    memberUserIds?: ReadonlySet<string>;
    ownerId?: string;
    users: readonly TUser[];
}): TUser[] {
    const friendDirectory =
        friendsById && typeof friendsById === 'object'
            ? Object.fromEntries(Object.entries(friendsById))
            : {};
    const normalizedCurrentUserId = firstText(currentUserId);
    const normalizedOwnerId = firstText(ownerId);
    return users.filter((user) => {
        const userRecord: Record<string, unknown> = isRecord(user) ? user : {};
        const userId = firstText(userRecord.id, userRecord.userId);
        const friend = userId ? friendDirectory[userId] : null;
        const friendLocation = resolveFriendPresenceLocation(friend, {
            preferTraveling: true
        });
        const friendIsElsewhere = Boolean(
            location &&
            parseLocation(friendLocation).isRealInstance &&
            !isSameInstanceLocation(friendLocation, location)
        );
        return Boolean(
            userId &&
            (userId === normalizedOwnerId ||
                userId === normalizedCurrentUserId ||
                (friend &&
                    !isOfflineOrLeavingFriend(friend) &&
                    !friendIsElsewhere &&
                    (!memberUserIds || memberUserIds.has(userId))))
        );
    });
}

export function buildUserDialogLocationUsers({
    currentUserId,
    friendsById,
    locationInstance,
    locationOwnerGroup,
    locationOwnerUser,
    profile,
    sameInstanceUsers,
    t,
    visiblePresenceParsedLocation
}: {
    currentUserId: string | null;
    friendsById: unknown;
    locationInstance: unknown;
    locationOwnerGroup: unknown;
    locationOwnerUser: unknown;
    profile: unknown;
    sameInstanceUsers: unknown;
    t: (key: string) => string;
    visiblePresenceParsedLocation: unknown;
}) {
    const record = (value: unknown) =>
        value && typeof value === 'object'
            ? Object.fromEntries(Object.entries(value))
            : {};
    const source = (value: unknown) =>
        typeof value === 'string'
            ? value
            : value && typeof value === 'object'
              ? record(value)
              : null;
    const instance = record(locationInstance);
    const parsedLocation = record(visiblePresenceParsedLocation);
    const friendDirectory = record(friendsById);
    const group =
        instance.group && typeof instance.group === 'object'
            ? Object.fromEntries(Object.entries(instance.group))
            : {};
    const ownerFallbackId = firstText(
        parsedLocation.userId,
        instance.ownerUserId,
        instance.owner_user_id,
        instance.ownerId,
        instance.owner_id,
        instance.userId,
        instance.user_id,
        instance.groupId,
        instance.group_id,
        group.id,
        parsedLocation.groupId
    );
    const rosterUsers = (
        Array.isArray(sameInstanceUsers) ? sameInstanceUsers : []
    ).map((user) => {
        const userId = resolveObservedPlayerUserId(user, friendDirectory);
        return userId
            ? {
                  ...record(user),
                  id: userId,
                  userId
              }
            : user;
    });
    const memberUserIds = new Set(
        rosterUsers
            .map((user) => firstText(record(user).id, record(user).userId))
            .filter(Boolean)
    );
    const roster = buildInstanceRosterRows({
        includeProfileFallback: true,
        instanceCreatorLabel: t('dialog.user.info.instance_creator'),
        ownerFallbackId,
        ownerGroup: source(locationOwnerGroup),
        ownerUser: source(locationOwnerUser),
        parsedLocation,
        profile: source(profile),
        users: rosterUsers
    });
    const rowsWithCreator = roster.rows.map((user) => {
        const userId = firstText(user.id, user.userId);
        if (!userId || userId !== roster.ownerId) {
            return user;
        }
        return {
            ...user,
            $isInstanceCreator: true,
            isFriend: Boolean(friendDirectory[userId] || user.isFriend)
        };
    });
    const visibleRows = filterVisibleUserDialogLocationUsers({
        currentUserId,
        friendsById,
        location: parsedLocation.tag,
        memberUserIds,
        ownerId: roster.ownerId,
        users: rowsWithCreator
    });

    return {
        locationInstanceUsers: visibleRows,
        locationOwnerId: roster.ownerId
    };
}

export { filterVisibleUserDialogLocationUsers };
