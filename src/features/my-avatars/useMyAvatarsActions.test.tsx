// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { createRef, type SetStateAction } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AppToastOptions } from '@/services/toastService';

const mocks = vi.hoisted(() => ({
    selectAvatar: vi.fn(),
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

vi.mock('@/services/avatarSelectionService', () => ({
    selectAvatar: mocks.selectAvatar
}));

vi.mock('./components/MyAvatarsViewParts', () => ({
    openAvatarDetails: vi.fn()
}));

import { useModalStore } from '@/state/modalStore';
import { useRuntimeStore } from '@/state/runtimeStore';

import { useMyAvatarsActions } from './useMyAvatarsActions';

const ENDPOINT = 'https://api.vrchat.cloud/api/1';

function deferred<T>() {
    let reject: (reason?: unknown) => void = () => {
        throw new Error('Deferred promise was not initialized.');
    };
    const promise = new Promise<T>((_resolve, fail) => {
        reject = fail;
    });
    return { promise, reject };
}

function renderActions(setDetail: (value: SetStateAction<string>) => void) {
    return renderHook(() =>
        useMyAvatarsActions({
            avatars: [],
            imageCropRequest: null,
            imageUploadAuthTargetRef: createRef(),
            imageUploadAvatarRef: createRef(),
            imageUploadInputRef: createRef(),
            setAvatars: vi.fn(),
            setContentTagsAvatar: vi.fn(),
            setDetail,
            setEditDetailsAvatar: vi.fn(),
            setImageCropRequest: vi.fn(),
            setManageTagsAvatar: vi.fn()
        })
    );
}

describe('useMyAvatarsActions avatar selection', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        useRuntimeStore.getState().resetRuntimeState();
        useModalStore.getState().resetModalState();
    });

    it('keeps the current avatar unchanged while pending and after failure', async () => {
        const previousSnapshot = {
            id: 'usr_self',
            currentAvatar: 'avtr_old',
            currentAvatarName: 'Old Avatar'
        };
        useRuntimeStore.getState().setAuthBootstrap({
            currentUserId: 'usr_self',
            currentUserEndpoint: ENDPOINT,
            currentUserSnapshot: previousSnapshot
        });
        const response = deferred<never>();
        mocks.selectAvatar.mockReturnValue(response.promise);
        const setDetail = vi.fn<(value: SetStateAction<string>) => void>();
        const { result } = renderActions(setDetail);
        let selection: Promise<void>;

        act(() => {
            selection = result.current.handleAvatarAction('wear', {
                id: 'avtr_new',
                name: 'New Avatar'
            });
        });

        expect(result.current.updatingAvatarId).toBe('avtr_new');
        expect(useRuntimeStore.getState().auth.currentUserSnapshot).toBe(
            previousSnapshot
        );

        await act(async () => {
            response.reject(new Error('selection failed'));
            await selection!;
        });

        expect(useRuntimeStore.getState().auth.currentUserSnapshot).toBe(
            previousSnapshot
        );
        expect(result.current.updatingAvatarId).toBe('');
        expect(setDetail).toHaveBeenCalledWith('selection failed');
        expect(mocks.toastError).toHaveBeenCalledWith(
            expect.objectContaining({
                type: 'error',
                title: 'selection failed'
            })
        );
    });

    it('does not report success for a superseded selection response', async () => {
        const previousSnapshot = {
            id: 'usr_self',
            currentAvatar: 'avtr_old'
        };
        useRuntimeStore.getState().setAuthBootstrap({
            currentUserId: 'usr_self',
            currentUserEndpoint: ENDPOINT,
            currentUserSnapshot: previousSnapshot
        });
        mocks.selectAvatar.mockResolvedValue({
            applied: false
        });
        const setDetail = vi.fn<(value: SetStateAction<string>) => void>();
        const { result } = renderActions(setDetail);

        await act(async () => {
            await result.current.handleAvatarAction('wear', {
                id: 'avtr_new',
                name: 'New Avatar'
            });
        });

        expect(useRuntimeStore.getState().auth.currentUserSnapshot).toBe(
            previousSnapshot
        );
        expect(result.current.updatingAvatarId).toBe('');
        expect(setDetail).not.toHaveBeenCalled();
        expect(mocks.toastSuccess).not.toHaveBeenCalled();
        expect(mocks.toastError).not.toHaveBeenCalled();
    });
});
