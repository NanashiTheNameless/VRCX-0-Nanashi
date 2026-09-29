import { queryOptions } from '@tanstack/react-query';

import { entityQueryPolicies, queryKeys } from '@/lib/entityQueryCache';
import groupProfileRepository from '@/repositories/groupProfileRepository';

export function groupProfileQueryOptions(groupId: string, endpoint: string) {
    return queryOptions({
        queryKey: queryKeys.group(groupId, false, endpoint),
        queryFn: () =>
            groupProfileRepository.fetchGroupProfile({
                groupId,
                includeRoles: false
            }),
        enabled: Boolean(groupId),
        staleTime: entityQueryPolicies.group.staleTime,
        gcTime: entityQueryPolicies.group.gcTime,
        retry: entityQueryPolicies.group.retry,
        refetchOnWindowFocus: entityQueryPolicies.group.refetchOnWindowFocus
    });
}
