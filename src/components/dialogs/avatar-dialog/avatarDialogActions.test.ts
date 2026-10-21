import type { TFunction } from 'i18next';
import type { SetStateAction } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import avatarProfileRepository from '@/repositories/avatarProfileRepository';
import type { AppToastOptions } from '@/services/toastService';

const mocks = vi.hoisted(() => ({
    saveAvatarMemo: vi.fn(),
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
            saveAvatarMemo: mocks.saveAvatarMemo
        }
    };
});

vi.mock('./avatarMediaActions', () => ({
    createAvatarCacheActions: () => ({
        deleteAvatarCache: vi.fn(),
        openAvatarCacheFolder: vi.fn()
    }),
    createAvatarGalleryActions: () => ({
        beginAvatarGalleryUpload: vi.fn(),
        deleteAvatarGalleryImage: vi.fn(),
        moveAvatarGalleryImage: vi.fn(),
        onFileChangeAvatarGallery: vi.fn()
    }),
    createAvatarImageUploadActions: () => ({
        beginAvatarImageUpload: vi.fn(),
        confirmAvatarImageUpload: vi.fn(),
        onFileChangeAvatarImage: vi.fn()
    })
}));

vi.mock('./avatarModerationActions', () => ({
    createAvatarModerationActions: () => ({
        setAvatarBlock: vi.fn(),
        updateAvatarImposter: vi.fn()
    })
}));

import { defaultAvatarSideData } from './avatarAssets';
import { createAvatarDialogActions } from './avatarDialogActions';
import type { AvatarDialogActionDependencies } from './avatarDialogTypes';

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((complete) => {
        resolve = complete;
    });
    return { promise, resolve };
}

function createDependencies() {
    const setMemo = vi.fn<(value: SetStateAction<string>) => void>();
    const setAvatar =
        vi.fn<
            (
                value: SetStateAction<
                    AvatarDialogActionDependencies['avatar'] | null
                >
            ) => void
        >();
    const dependencies: AvatarDialogActionDependencies = {
        actionStatusRef: { current: 'idle' },
        activeAvatarTargetRef: {
            current: { avatarId: 'avtr_target', endpoint: 'endpoint-a' }
        },
        applyCurrentAvatarUpdate: vi.fn(),
        avatar: avatarProfileRepository.normalize({
            id: 'avtr_target',
            name: 'Target'
        }),
        avatarSideData: defaultAvatarSideData(),
        canManageAvatar: false,
        canSelectAvatar: false,
        canSelectFallbackAvatar: false,
        closeDialog: vi.fn(),
        confirm: vi.fn(),
        currentEndpoint: 'endpoint-a',
        galleryUploadInputRef: { current: null },
        imageCropRequest: null,
        imageUploadAvatarRef: { current: null },
        imageUploadInputRef: { current: null },
        isCurrentAvatar: false,
        memo: '',
        memoRevisionRef: { current: 0 },
        moderationRevisionRef: { current: 0 },
        normalizedAvatarId: 'avtr_target',
        prompt: vi.fn(),
        setActionStatus: vi.fn(),
        setAvatar,
        setAvatarBlocked: vi.fn(),
        setAvatarSideData: vi.fn(),
        setDetail: vi.fn(),
        setImageCropRequest: vi.fn(),
        setMemo,
        setOwnerEditor: vi.fn(),
        t: ((key: string) => key) as TFunction
    };
    return { dependencies, setAvatar, setMemo };
}

describe('createAvatarDialogActions saveMemo', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('ignores an older save response for the same active avatar', async () => {
        const first = deferred<{ memo: string }>();
        const second = deferred<{ memo: string }>();
        mocks.saveAvatarMemo
            .mockReturnValueOnce(first.promise)
            .mockReturnValueOnce(second.promise);
        const { dependencies, setAvatar, setMemo } = createDependencies();
        const actions = createAvatarDialogActions(dependencies);

        const firstSave = actions.saveMemo('first');
        const secondSave = actions.saveMemo('second');
        second.resolve({ memo: 'second' });
        await secondSave;
        first.resolve({ memo: 'first' });
        await firstSave;

        expect(setMemo).toHaveBeenCalledTimes(1);
        expect(setMemo).toHaveBeenCalledWith('second');
        expect(setAvatar).toHaveBeenCalledTimes(1);
        expect(mocks.toastSuccess).toHaveBeenCalledTimes(1);
    });
});
