import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { DateTimeRangeValue } from '@/components/date-time-range-picker/DateTimeRangePicker';
import {
    commands,
    type ActivityJourneyVisit,
    type ScreenshotWindowImages
} from '@/platform/tauri/bindings';
import {
    startScreenshotLibraryScan,
    subscribeScreenshotLibraryScanStatus
} from '@/services/screenshotLibraryScanService';

import {
    journeyDaysInRange,
    journeyPageWindow,
    journeyVisitKey,
    mergeJourneyVisits,
    JOURNEY_PAGE_DAYS,
    JOURNEY_PHOTO_PREVIEW_LIMIT
} from './activityJourneyModel';
import { utcOffsetMinutes } from './activityPageModel';

type JourneyPhotos = ReadonlyMap<string, ScreenshotWindowImages>;

type ActivityJourneyFeed = {
    visits: ActivityJourneyVisit[];
    photos: JourneyPhotos;
    loading: boolean;
    hasMore: boolean;
    error: string;
    loadMore: () => void;
    refresh: () => void;
};

async function loadPhotos(
    visits: readonly ActivityJourneyVisit[]
): Promise<Map<string, ScreenshotWindowImages>> {
    if (visits.length === 0) {
        return new Map();
    }
    const windows = await commands.appGetScreenshotsInWindows(
        visits.map((visit) => ({ fromMs: visit.startMs, toMs: visit.endMs })),
        JOURNEY_PHOTO_PREVIEW_LIMIT
    );
    return new Map(
        visits.map((visit, index) => [journeyVisitKey(visit), windows[index]])
    );
}

export function useActivityJourneyFeed(
    ownerUserId: string,
    range: DateTimeRangeValue,
    screenshotsAvailable: boolean
): ActivityJourneyFeed {
    const [days, setDays] = useState<string[]>([]);
    const [daysLoaded, setDaysLoaded] = useState(false);
    const [visits, setVisits] = useState<ActivityJourneyVisit[]>([]);
    const [photos, setPhotos] = useState<JourneyPhotos>(() => new Map());
    const [loadedDays, setLoadedDays] = useState(0);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [nonce, setNonce] = useState(0);
    const generationRef = useRef(0);
    const loadingRef = useRef(false);
    const visitsRef = useRef<ActivityJourneyVisit[]>([]);
    const rangeFromMs = range.from?.getTime() ?? null;
    const rangeToMs = range.to?.getTime() ?? null;

    useEffect(() => {
        if (!ownerUserId) {
            setDays([]);
            return;
        }
        let active = true;
        setDaysLoaded(false);
        void commands
            .appActivityJourneyDays({
                ownerUserId,
                utcOffsetMinutes: utcOffsetMinutes()
            })
            .then((next) => {
                if (active) {
                    setDays(next);
                }
            })
            .catch((cause) => {
                if (active) {
                    setDays([]);
                    setError(String(cause));
                }
            })
            .finally(() => {
                if (active) {
                    setDaysLoaded(true);
                }
            });
        return () => {
            active = false;
        };
    }, [nonce, ownerUserId]);

    const dayList = useMemo(
        () => journeyDaysInRange(days, rangeFromMs, rangeToMs),
        [days, rangeFromMs, rangeToMs]
    );

    const loadPage = useCallback(
        async (generation: number, startIndex: number) => {
            const window = journeyPageWindow(
                dayList,
                startIndex,
                rangeFromMs,
                rangeToMs
            );
            if (!ownerUserId || !window) {
                return;
            }
            loadingRef.current = true;
            setLoading(true);
            try {
                const page = await commands.appActivityJourneyVisits({
                    ownerUserId,
                    fromMs: window.fromMs,
                    toMs: window.toMs
                });
                if (generationRef.current !== generation) {
                    return;
                }
                const merged = mergeJourneyVisits(visitsRef.current, page);
                visitsRef.current = merged;
                setVisits(merged);
                setLoadedDays(startIndex + JOURNEY_PAGE_DAYS);
                if (screenshotsAvailable) {
                    const pagePhotos = await loadPhotos(page).catch(
                        () => new Map<string, ScreenshotWindowImages>()
                    );
                    if (generationRef.current === generation) {
                        setPhotos(
                            (current) => new Map([...current, ...pagePhotos])
                        );
                    }
                }
            } catch (cause) {
                if (generationRef.current === generation) {
                    setError(String(cause));
                }
            } finally {
                if (generationRef.current === generation) {
                    loadingRef.current = false;
                    setLoading(false);
                }
            }
        },
        [dayList, ownerUserId, rangeFromMs, rangeToMs, screenshotsAvailable]
    );

    useEffect(() => {
        const generation = generationRef.current + 1;
        generationRef.current = generation;
        loadingRef.current = false;
        visitsRef.current = [];
        setVisits([]);
        setPhotos(new Map());
        setLoadedDays(0);
        setError('');
        setLoading(false);
        void loadPage(generation, 0);
    }, [loadPage]);

    const hasMore = loadedDays < dayList.length;

    const loadMore = useCallback(() => {
        if (loadingRef.current || loadedDays >= dayList.length) {
            return;
        }
        void loadPage(generationRef.current, loadedDays);
    }, [dayList.length, loadPage, loadedDays]);

    useEffect(() => {
        if (!screenshotsAvailable) {
            return;
        }
        let scanning = false;
        const unsubscribe = subscribeScreenshotLibraryScanStatus((status) => {
            if (status.running) {
                scanning = true;
                return;
            }
            if (!scanning) {
                return;
            }
            scanning = false;
            const generation = generationRef.current;
            void loadPhotos(visitsRef.current)
                .then((next) => {
                    if (generationRef.current === generation) {
                        setPhotos(next);
                    }
                })
                .catch(() => {});
        });
        void startScreenshotLibraryScan(false).catch(() => {});
        return unsubscribe;
    }, [screenshotsAvailable]);

    const refresh = useCallback(() => {
        setNonce((current) => current + 1);
    }, []);

    return {
        visits,
        photos,
        loading: loading || (Boolean(ownerUserId) && !daysLoaded),
        hasMore,
        error,
        loadMore,
        refresh
    };
}
