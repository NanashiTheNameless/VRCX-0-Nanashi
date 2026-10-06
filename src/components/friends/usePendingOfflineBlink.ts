import { useEffect, useRef } from 'react';

import { dimBlink } from '@/lib/dimBlink';

const PENDING_OFFLINE_BLINK = {
    opacity: 0.6,
    halfCycles: 5,
    halfCycleMs: 650
};

export function usePendingOfflineBlink<T extends HTMLElement>(
    pendingOffline: boolean
) {
    const ref = useRef<T>(null);

    useEffect(() => {
        const container = ref.current;
        if (
            !pendingOffline ||
            !container ||
            document.documentElement.classList.contains('reduce-effects')
        ) {
            return undefined;
        }
        const blinks = Array.from(container.children)
            .filter((child) => !child.hasAttribute('data-dim-exempt'))
            .map((child) => dimBlink(child, PENDING_OFFLINE_BLINK));
        return () => {
            for (const blink of blinks) {
                blink.cancel();
            }
        };
    }, [pendingOffline]);

    return ref;
}
