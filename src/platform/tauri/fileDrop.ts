import type { DragDropEvent } from '@tauri-apps/api/webview';

import { normalizePlatformError } from './errors';

export type FileDragDropEvent = DragDropEvent;

export async function onFileDragDrop(
    handler: (event: FileDragDropEvent) => void
): Promise<() => void> {
    try {
        const { getCurrentWebview } = await import('@tauri-apps/api/webview');
        return await getCurrentWebview().onDragDropEvent((event) => {
            handler(event.payload);
        });
    } catch (error) {
        throw normalizePlatformError(
            error,
            'Unable to subscribe to file drag and drop'
        );
    }
}
