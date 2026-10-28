import { useEffect } from 'react';

import { tauriEvents } from '@/platform/tauri/events';
import { restoreNormalWindowModeForIntent } from '@/services/windowModeService';
import { useRuntimeStore } from '@/state/runtimeStore';

const MENU_ACTION_EVENT = 'menuAction';

function readMenuAction(payload: unknown): string {
    if (!payload || typeof payload !== 'object') {
        return '';
    }

    const action = 'action' in payload ? payload.action : undefined;
    return typeof action === 'string' ? action : '';
}

export function MenuActionHost() {
    const setSystemHostOpen = useRuntimeStore(
        (state) => state.setSystemHostOpen
    );

    useEffect(() => {
        let disposed = false;
        let cleanup: (() => void) | null = null;
        tauriEvents
            .on(MENU_ACTION_EVENT, (payload: unknown) => {
                if (readMenuAction(payload) === 'check-updates') {
                    restoreNormalWindowModeForIntent();
                    setSystemHostOpen('updaterOpen', true);
                }
            })
            .then((unlisten) => {
                if (disposed) {
                    unlisten();
                    return;
                }
                cleanup = unlisten;
            })
            .catch((error) => {
                console.warn('Unable to subscribe to menu actions:', error);
            });

        return () => {
            disposed = true;
            cleanup?.();
        };
    }, [setSystemHostOpen]);

    return null;
}
