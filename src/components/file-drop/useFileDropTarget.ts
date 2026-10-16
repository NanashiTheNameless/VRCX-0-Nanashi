import { useEffect, useEffectEvent, useState } from 'react';

import { onFileDragDrop } from '@/platform/tauri/fileDrop';

export function useFileDropTarget({
    enabled,
    onDrop
}: {
    enabled: boolean;
    onDrop: (paths: string[]) => void;
}) {
    const [dragActive, setDragActive] = useState(false);
    const handleDrop = useEffectEvent(onDrop);

    useEffect(() => {
        if (!enabled) {
            return;
        }
        let disposed = false;
        let unlisten: (() => void) | null = null;
        onFileDragDrop((event) => {
            if (event.type === 'enter') {
                setDragActive(event.paths.length > 0);
            } else if (event.type === 'leave') {
                setDragActive(false);
            } else if (event.type === 'drop') {
                setDragActive(false);
                if (event.paths.length > 0) {
                    handleDrop(event.paths);
                }
            }
        })
            .then((stop) => {
                if (disposed) {
                    stop();
                } else {
                    unlisten = stop;
                }
            })
            .catch((error: unknown) => {
                console.error('Failed to listen for file drops:', error);
            });
        return () => {
            disposed = true;
            unlisten?.();
            setDragActive(false);
        };
    }, [enabled]);

    return enabled && dragActive;
}
