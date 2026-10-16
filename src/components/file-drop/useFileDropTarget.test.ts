// @vitest-environment jsdom

import { PhysicalPosition } from '@tauri-apps/api/dpi';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { FileDragDropEvent } from '@/platform/tauri/fileDrop';

const mocks = vi.hoisted(() => ({
    handler: null as ((event: FileDragDropEvent) => void) | null,
    unlisten: vi.fn(),
    onFileDragDrop: vi.fn()
}));

vi.mock('@/platform/tauri/fileDrop', () => ({
    onFileDragDrop: mocks.onFileDragDrop
}));

import { useFileDropTarget } from './useFileDropTarget';

const position = new PhysicalPosition(0, 0);

function emit(event: FileDragDropEvent) {
    act(() => {
        mocks.handler?.(event);
    });
}

describe('useFileDropTarget', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.handler = null;
        mocks.onFileDragDrop.mockImplementation(
            async (handler: (event: FileDragDropEvent) => void) => {
                mocks.handler = handler;
                return mocks.unlisten;
            }
        );
    });

    it('shows the drop state while files hover and hands dropped paths over', async () => {
        const onDrop = vi.fn();
        const { result } = renderHook(() =>
            useFileDropTarget({ enabled: true, onDrop })
        );
        await waitFor(() => expect(mocks.handler).not.toBeNull());

        emit({ type: 'enter', paths: ['C:\\shot.png'], position });
        expect(result.current).toBe(true);

        emit({ type: 'drop', paths: ['C:\\shot.png'], position });
        expect(result.current).toBe(false);
        expect(onDrop).toHaveBeenCalledWith(['C:\\shot.png']);
    });

    it('ignores drags that carry no files', async () => {
        const onDrop = vi.fn();
        const { result } = renderHook(() =>
            useFileDropTarget({ enabled: true, onDrop })
        );
        await waitFor(() => expect(mocks.handler).not.toBeNull());

        emit({ type: 'enter', paths: [], position });
        expect(result.current).toBe(false);

        emit({ type: 'drop', paths: [], position });
        expect(onDrop).not.toHaveBeenCalled();
    });

    it('clears the drop state when the drag leaves the window', async () => {
        const { result } = renderHook(() =>
            useFileDropTarget({ enabled: true, onDrop: vi.fn() })
        );
        await waitFor(() => expect(mocks.handler).not.toBeNull());

        emit({ type: 'enter', paths: ['C:\\shot.png'], position });
        emit({ type: 'leave' });

        expect(result.current).toBe(false);
    });

    it('stops listening while disabled', async () => {
        const { rerender } = renderHook(
            ({ enabled }) => useFileDropTarget({ enabled, onDrop: vi.fn() }),
            { initialProps: { enabled: true } }
        );
        await waitFor(() => expect(mocks.handler).not.toBeNull());

        rerender({ enabled: false });

        expect(mocks.unlisten).toHaveBeenCalledTimes(1);
        expect(mocks.onFileDragDrop).toHaveBeenCalledTimes(1);
    });
});
