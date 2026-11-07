import { useEffect, useState } from 'react';

import { commands } from '@/platform/tauri/bindings';

let cached: boolean | null = null;
let pending: Promise<boolean> | null = null;

// Whether this run uses hardware (DMABUF) rendering on Linux. It only changes
// on restart, so it is read once. Unknown counts as off, the safe choice.
function loadLinuxHardwareRendering(): Promise<boolean> {
    pending ??= commands
        .appGetLinuxRendering()
        .then((snapshot) => {
            cached = Boolean(snapshot?.enabled);
            return cached;
        })
        .catch(() => {
            cached = false;
            return false;
        });
    return pending;
}

export function useLinuxHardwareRendering(isLinux: boolean): boolean {
    const [enabled, setEnabled] = useState(cached ?? false);
    useEffect(() => {
        if (!isLinux) {
            return;
        }
        let active = true;
        void loadLinuxHardwareRendering().then((value) => {
            if (active) {
                setEnabled(value);
            }
        });
        return () => {
            active = false;
        };
    }, [isLinux]);
    return isLinux && enabled;
}
