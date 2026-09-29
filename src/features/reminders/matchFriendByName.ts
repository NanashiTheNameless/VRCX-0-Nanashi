/**
 * Fork: match a name from an AI reminder draft to one friend id. Exact name
 * first, then a unique prefix, then a unique substring; anything ambiguous is
 * left for the user to pick.
 */
export function matchFriendByName(
    name: string,
    friends: ReadonlyArray<{ id: string; displayName: string }>
): string {
    const wanted = name.trim().toLowerCase();
    if (!wanted) {
        return '';
    }
    const named = friends.map((friend) => ({
        id: friend.id,
        name: friend.displayName.trim().toLowerCase()
    }));
    for (const matches of [
        (candidate: string) => candidate === wanted,
        (candidate: string) => candidate.startsWith(wanted),
        (candidate: string) => candidate.includes(wanted)
    ]) {
        const hits = named.filter((friend) => matches(friend.name));
        if (hits.length === 1) {
            return hits[0].id;
        }
        if (hits.length > 1) {
            return '';
        }
    }
    return '';
}
