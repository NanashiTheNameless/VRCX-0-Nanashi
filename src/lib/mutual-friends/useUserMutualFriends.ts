import { queryOptions, useQuery } from '@tanstack/react-query';

import { queryKeys } from '@/lib/entityQueryCache';
import userProfileRepository from '@/repositories/userProfileRepository';
import { DEFAULT_VRCHAT_API_ENDPOINT } from '@/shared/vrchatEndpoint';

export function userMutualFriendsQueryOptions(userId: string) {
    return queryOptions({
        queryKey: queryKeys.userMutualFriends(
            userId,
            DEFAULT_VRCHAT_API_ENDPOINT
        ),
        queryFn: async ({ signal }) =>
            (
                await userProfileRepository.getAllMutualFriends({
                    userId,
                    signal
                })
            ).rows,
        retry: false,
        staleTime: Infinity,
        refetchOnWindowFocus: false
    });
}

export function useUserMutualFriends(userId: string, enabled: boolean) {
    return useQuery({
        ...userMutualFriendsQueryOptions(userId),
        enabled: enabled && Boolean(userId)
    });
}
