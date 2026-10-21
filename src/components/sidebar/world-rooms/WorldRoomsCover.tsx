import { FadeInImage } from '@/components/media/FadeInImage';
import { cn } from '@/lib/utils';

import { useWorldRoomsQuery } from './useWorldRooms';

export function WorldRoomsCover({
    worldId,
    className
}: {
    worldId: string;
    className?: string;
}) {
    const world = useWorldRoomsQuery(worldId).data;
    const coverUrl = world?.thumbnailImageUrl || world?.imageUrl || '';

    return (
        <span
            className={cn(
                'bg-muted block shrink-0 overflow-hidden rounded-sm',
                className
            )}
        >
            {coverUrl ? (
                <FadeInImage
                    src={coverUrl}
                    alt=""
                    loading="lazy"
                    className="size-full object-cover"
                    fallback={null}
                />
            ) : null}
        </span>
    );
}
