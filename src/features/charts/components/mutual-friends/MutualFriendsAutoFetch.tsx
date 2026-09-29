import { useEffect, useEffectEvent, useRef } from 'react';
import { useLocation, useSearchParams } from 'react-router';

import { MUTUAL_GRAPH_AUTO_FETCH_PARAM } from '@/lib/mutual-friends/mutualFriendsSettings';

export function MutualFriendsAutoFetch({
    currentUserId,
    onFetch
}: {
    currentUserId: string;
    onFetch: () => void;
}) {
    const { key: locationKey } = useLocation();
    const [searchParams, setSearchParams] = useSearchParams();
    const requested = searchParams.get(MUTUAL_GRAPH_AUTO_FETCH_PARAM) === '1';
    const handledLocationKeyRef = useRef('');
    const startFetch = useEffectEvent(onFetch);

    useEffect(() => {
        if (
            !requested ||
            !currentUserId ||
            handledLocationKeyRef.current === locationKey
        ) {
            return;
        }
        handledLocationKeyRef.current = locationKey;
        setSearchParams(
            (params) => {
                const next = new URLSearchParams(params);
                next.delete(MUTUAL_GRAPH_AUTO_FETCH_PARAM);
                return next;
            },
            { replace: true }
        );
        startFetch();
    }, [currentUserId, locationKey, requested, setSearchParams]);

    return null;
}
