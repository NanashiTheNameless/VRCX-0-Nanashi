// @vitest-environment jsdom

import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AppToastOptions } from '@/services/toastService';

const mocks = vi.hoisted(() => ({
    confirm: vi.fn(),
    deleteScreenshotFile: vi.fn(),
    dismiss: vi.fn(),
    toastError: vi.fn(),
    toastSuccess: vi.fn(),
    toastWarning: vi.fn(),
    update: vi.fn()
}));

vi.mock('@/services/toastService', () => ({
    toast: {
        add: (options: AppToastOptions) => {
            switch (options.type) {
                case 'error':
                    return mocks.toastError(options);
                case 'success':
                    return mocks.toastSuccess(options);
                case 'warning':
                    return mocks.toastWarning(options);
                default:
                    throw new Error('Unhandled toast type: ' + options.type);
            }
        }
    }
}));

vi.mock('@/platform/tauri/bindings', () => ({
    commands: { appDeleteScreenshotFile: mocks.deleteScreenshotFile }
}));

vi.mock('@/state/modalStore', () => ({
    useModalStore: (selector: (state: { confirm: unknown }) => unknown) =>
        selector({ confirm: mocks.confirm })
}));

vi.mock('./galleryBulkProgressToast', () => ({
    startGalleryBulkProgressToast: () => ({
        update: mocks.update,
        dismiss: mocks.dismiss
    })
}));

import { useScreenshotBulkDelete } from './useScreenshotBulkDelete';

type HookValue = ReturnType<typeof useScreenshotBulkDelete>;

function renderHarness() {
    const removeDeletedImages = vi.fn();
    const refreshGalleryTree = vi.fn();
    let value: HookValue | null = null;

    function Harness() {
        value = useScreenshotBulkDelete({
            scopeKey: 'folder:C:\\VRChat\\2026-07',
            removeDeletedImages,
            refreshGalleryTree
        });
        return null;
    }

    render(<Harness />);
    return {
        refreshGalleryTree,
        removeDeletedImages,
        deleteScreenshots: (paths: string[]) =>
            act(async () => {
                await value!.deleteScreenshots(paths);
            })
    };
}

describe('useScreenshotBulkDelete', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.confirm.mockResolvedValue({ ok: true });
        mocks.deleteScreenshotFile.mockResolvedValue(null);
    });

    afterEach(cleanup);

    it('removes every deleted path in one update and refreshes the folder tree', async () => {
        const harness = renderHarness();

        await harness.deleteScreenshots(['a.png', 'b.png']);

        expect(mocks.deleteScreenshotFile).toHaveBeenCalledTimes(2);
        expect(harness.removeDeletedImages).toHaveBeenCalledTimes(1);
        expect(harness.removeDeletedImages).toHaveBeenCalledWith([
            'a.png',
            'b.png'
        ]);
        expect(harness.refreshGalleryTree).toHaveBeenCalledTimes(1);
        expect(mocks.toastSuccess).toHaveBeenCalledTimes(1);
    });

    it('keeps failed paths in the gallery and reports a partial failure', async () => {
        mocks.deleteScreenshotFile.mockImplementation((path: string) =>
            path === 'b.png'
                ? Promise.reject(new Error('locked'))
                : Promise.resolve(null)
        );
        const harness = renderHarness();

        await harness.deleteScreenshots(['a.png', 'b.png', 'c.png']);

        expect(harness.removeDeletedImages).toHaveBeenCalledWith([
            'a.png',
            'c.png'
        ]);
        expect(mocks.toastError).toHaveBeenCalledTimes(1);
        expect(mocks.toastSuccess).not.toHaveBeenCalled();
    });

    it('does nothing when the confirmation is dismissed', async () => {
        mocks.confirm.mockResolvedValue({ ok: false });
        const harness = renderHarness();

        await harness.deleteScreenshots(['a.png']);

        expect(mocks.deleteScreenshotFile).not.toHaveBeenCalled();
        expect(harness.removeDeletedImages).not.toHaveBeenCalled();
        expect(harness.refreshGalleryTree).not.toHaveBeenCalled();
    });
});
