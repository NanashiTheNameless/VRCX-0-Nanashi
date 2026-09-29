import { useCallback, useEffect, useRef, useState } from 'react';

import {
    commands,
    type ActivityCompanionOrder,
    type ActivityPageView
} from '@/platform/tauri/bindings';

import {
    rangeDaysFor,
    utcOffsetMinutes,
    type ActivityRange
} from './activityPageModel';

type ActivityPageResource = {
    view: ActivityPageView | null;
    loading: boolean;
    error: string;
    refresh: () => void;
};

export function useActivityPageResource(
    ownerUserId: string,
    range: ActivityRange,
    companionOrder: ActivityCompanionOrder
): ActivityPageResource {
    const [view, setView] = useState<ActivityPageView | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const requestIdRef = useRef(0);

    const load = useCallback(
        async (forceRefresh: boolean) => {
            if (!ownerUserId) {
                setView(null);
                return;
            }
            const requestId = requestIdRef.current + 1;
            requestIdRef.current = requestId;
            setLoading(true);
            setError('');
            try {
                const next = await commands.appActivityPageView({
                    ownerUserId,
                    rangeDays: rangeDaysFor(range),
                    utcOffsetMinutes: utcOffsetMinutes(),
                    nowMs: Date.now(),
                    companionOrder,
                    forceRefresh
                });
                if (requestIdRef.current === requestId) {
                    setView(next);
                }
            } catch (cause) {
                if (requestIdRef.current === requestId) {
                    setError(String(cause));
                }
            } finally {
                if (requestIdRef.current === requestId) {
                    setLoading(false);
                }
            }
        },
        [companionOrder, ownerUserId, range]
    );

    useEffect(() => {
        void load(false);
    }, [load]);

    const refresh = useCallback(() => {
        void load(true);
    }, [load]);

    return { view, loading, error, refresh };
}
