import { useQuery } from '@tanstack/react-query';

import { economyBalanceQueryOptions } from '@/repositories/vrchatEconomyRepository';

export function useEconomyBalance(userId: string, enabled: boolean) {
    return useQuery({
        ...economyBalanceQueryOptions(userId),
        enabled: enabled && Boolean(userId)
    });
}
