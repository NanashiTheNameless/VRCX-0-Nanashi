export type CurrentUserPresenceRecord = Record<string, unknown>;

const CURRENT_USER_PRESENCE_FIELDS = [
    '$presence',
    'location',
    '$location',
    '$location_at',
    'locationUpdatedAt',
    'worldId',
    'instanceId',
    'travelingToLocation',
    'travelingToWorld',
    'travelingToInstance',
    '$travelingToLocation',
    '$travelingToTime'
];

export function mergeCurrentUserPresenceFields<
    TUser extends CurrentUserPresenceRecord
>(
    nextUser: TUser,
    previousUser: CurrentUserPresenceRecord | null | undefined
): TUser {
    if (!previousUser) {
        return nextUser;
    }
    const presenceFields: CurrentUserPresenceRecord = {};
    for (const field of CURRENT_USER_PRESENCE_FIELDS) {
        if (previousUser[field] !== undefined) {
            presenceFields[field] = previousUser[field];
        }
    }
    return { ...nextUser, ...presenceFields };
}
