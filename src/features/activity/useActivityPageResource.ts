import { useCallback, useEffect, useRef, useState } from 'react';

import {
    commands,
    type ActivityCompanionOrder,
    type ActivityPageView
} from '@/platform/tauri/bindings';
import { usePreferencesStore } from '@/state/preferencesStore';

import { utcOffsetMinutes } from './activityPageModel';

type ActivityPageResource = {
    view: ActivityPageView | null;
    loading: boolean;
    error: string;
    refresh: () => void;
};

export function useActivityPageResource(
    ownerUserId: string,
    rangeDays: number,
    windowToMs: number | null,
    companionOrder: ActivityCompanionOrder
): ActivityPageResource {
    const timeZone = usePreferencesStore((state) => state.dtTimeZone);
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
                    rangeDays,
                    utcOffsetMinutes: utcOffsetMinutes(),
                    now: Math.floor(Date.now() / 1000),
                    windowTo:
                        windowToMs === null
                            ? null
                            : Math.floor(windowToMs / 1000),
                    companionOrder,
                    forceRefresh: forceRefresh || Boolean(timeZone)
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
        [companionOrder, ownerUserId, rangeDays, windowToMs, timeZone]
    );

    useEffect(() => {
        void load(false);
    }, [load]);

    const refresh = useCallback(() => {
        void load(true);
    }, [load]);

    return { view, loading, error, refresh };
}
