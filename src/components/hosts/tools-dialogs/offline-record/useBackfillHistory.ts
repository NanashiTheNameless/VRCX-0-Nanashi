import { useEffect, useState } from 'react';

import {
    commands,
    type FeedLoggerBackfillHistory
} from '@/platform/tauri/bindings';
import { useOfflineRecordStore } from '@/state/offlineRecordStore';

export function useBackfillHistory() {
    const revision = useOfflineRecordStore((state) => state.backfillRevision);
    const [history, setHistory] = useState<FeedLoggerBackfillHistory | null>(
        null
    );

    useEffect(() => {
        let active = true;
        void commands
            .appFeedLoggerBackfillHistory()
            .catch(() => null)
            .then((next) => {
                if (active) {
                    setHistory(next);
                }
            });
        return () => {
            active = false;
        };
    }, [revision]);

    return history;
}
