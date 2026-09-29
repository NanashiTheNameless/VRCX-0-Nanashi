// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AppToastOptions } from '@/services/toastService';

const mocks = vi.hoisted(() => ({
    saveWorldMemo: vi.fn(),
    toastSuccess: vi.fn(),
    toastError: vi.fn()
}));

vi.mock('@/services/toastService', () => ({
    toast: {
        add: (options: AppToastOptions) => {
            switch (options.type) {
                case 'success':
                    return mocks.toastSuccess(options);
                case 'error':
                    return mocks.toastError(options);
                default:
                    throw new Error('Unhandled toast type: ' + options.type);
            }
        }
    }
}));

vi.mock('@/repositories/memoPersistenceRepository', async (importOriginal) => {
    const actual =
        await importOriginal<
            typeof import('@/repositories/memoPersistenceRepository')
        >();
    return {
        ...actual,
        default: {
            ...actual.default,
            saveWorldMemo: mocks.saveWorldMemo
        }
    };
});

import worldProfileRepository from '@/repositories/worldProfileRepository';

import { useWorldActions } from './useWorldActions';
import { defaultWorldSideData } from './worldDialogHelpers';

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((complete) => {
        resolve = complete;
    });
    return { promise, resolve };
}

describe('useWorldActions saveMemo', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('ignores an older save response for the same active world', async () => {
        const first = deferred<{ memo: string }>();
        const second = deferred<{ memo: string }>();
        mocks.saveWorldMemo
            .mockReturnValueOnce(first.promise)
            .mockReturnValueOnce(second.promise);
        const setMemo = vi.fn();
        const activeWorldTargetRef = {
            current: { worldId: 'wrld_target', endpoint: 'endpoint-a' }
        };
        const { result } = renderHook(() =>
            useWorldActions({
                world: worldProfileRepository.normalize({
                    id: 'wrld_target',
                    name: 'Target'
                }),
                setWorld: vi.fn(),
                currentEndpoint: 'endpoint-a',
                currentUserId: 'usr_self',
                profileWorldId: 'wrld_target',
                normalizedWorldId: 'wrld_target',
                isInstanceLocation: false,
                worldDialogShortName: '',
                isHomeWorld: false,
                canUpdateHome: false,
                actionStatusRef: { current: 'idle' },
                setActionStatus: vi.fn(),
                activeWorldTargetRef,
                memoRevisionRef: { current: 0 },
                memo: '',
                setMemo,
                worldSideData: defaultWorldSideData(),
                setWorldSideData: vi.fn(),
                isCurrentWorldTarget: (worldId, endpoint) =>
                    activeWorldTargetRef.current.worldId === worldId &&
                    activeWorldTargetRef.current.endpoint === endpoint,
                confirm: vi.fn(),
                prompt: vi.fn(),
                setAuthBootstrap: vi.fn()
            })
        );

        let firstSave!: Promise<void>;
        let secondSave!: Promise<void>;
        act(() => {
            firstSave = result.current.saveMemo('first');
            secondSave = result.current.saveMemo('second');
        });
        await act(async () => {
            second.resolve({ memo: 'second' });
            await secondSave;
        });
        await act(async () => {
            first.resolve({ memo: 'first' });
            await firstSave;
        });

        expect(setMemo).toHaveBeenCalledTimes(1);
        expect(setMemo).toHaveBeenCalledWith('second');
        expect(mocks.toastSuccess).toHaveBeenCalledTimes(1);
    });

    it('ignores a save response after the endpoint changes', async () => {
        const request = deferred<{ memo: string }>();
        mocks.saveWorldMemo.mockReturnValue(request.promise);
        const setMemo = vi.fn();
        const activeWorldTargetRef = {
            current: { worldId: 'wrld_target', endpoint: 'endpoint-a' }
        };
        const { result } = renderHook(() =>
            useWorldActions({
                world: worldProfileRepository.normalize({ id: 'wrld_target' }),
                setWorld: vi.fn(),
                currentEndpoint: 'endpoint-a',
                currentUserId: null,
                profileWorldId: 'wrld_target',
                normalizedWorldId: 'wrld_target',
                isInstanceLocation: false,
                worldDialogShortName: '',
                isHomeWorld: false,
                canUpdateHome: false,
                actionStatusRef: { current: 'idle' },
                setActionStatus: vi.fn(),
                activeWorldTargetRef,
                memoRevisionRef: { current: 0 },
                memo: '',
                setMemo,
                worldSideData: defaultWorldSideData(),
                setWorldSideData: vi.fn(),
                isCurrentWorldTarget: vi.fn(),
                confirm: vi.fn(),
                prompt: vi.fn(),
                setAuthBootstrap: vi.fn()
            })
        );

        const save = result.current.saveMemo('memo');
        activeWorldTargetRef.current = {
            worldId: 'wrld_target',
            endpoint: 'endpoint-b'
        };
        await act(async () => {
            request.resolve({ memo: 'memo' });
            await save;
        });

        expect(setMemo).not.toHaveBeenCalled();
        expect(mocks.toastSuccess).not.toHaveBeenCalled();
    });
});
