import { useQuery } from '@tanstack/react-query';

import { resolveInventoryImageUrl } from '@/domain/entities/inventory';
import { entityQueryPolicies, queryKeys } from '@/lib/entityQueryCache';
import vrchatMediaRepository from '@/repositories/vrchatMediaRepository';
import { convertFileUrlToImageUrl } from '@/services/entityMediaService';
import { useRuntimeStore } from '@/state/runtimeStore';

import type { NotificationViewModelEmoji } from './notificationViewModel';

export function useNotificationEmojiImage(
    emoji: NotificationViewModelEmoji
): string {
    const endpoint = useRuntimeStore((state) => state.auth.currentUserEndpoint);
    const inventoryId = emoji.kind === 'inventory' ? emoji.id : '';
    const userId = emoji.kind === 'inventory' ? emoji.senderUserId : '';

    const itemQuery = useQuery({
        queryKey: queryKeys.boopEmoji(userId, inventoryId, endpoint),
        queryFn: () =>
            vrchatMediaRepository.getUserInventoryItem({ userId, inventoryId }),
        enabled: Boolean(userId && inventoryId),
        ...entityQueryPolicies.boopEmojiLookup
    });

    if (emoji.kind !== 'inventory') {
        return emoji.imageUrl;
    }
    return itemQuery.data
        ? convertFileUrlToImageUrl(
              resolveInventoryImageUrl(itemQuery.data.json),
              64
          )
        : '';
}
