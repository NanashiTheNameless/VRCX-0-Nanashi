import { describe, expect, it, vi } from 'vitest';

import type { AppToastOptions } from '@/services/toastService';

import type { GalleryUploadTarget } from './galleryConstants';
import type { GalleryAssetActionDeps } from './galleryTypes';
import { createGalleryAssetActions } from './useGalleryAssetActions';

function createActions(overrides: Partial<GalleryAssetActionDeps> = {}) {
    const uploadAssetImage = vi.fn().mockResolvedValue({ json: null });
    const uploadInputRef = {
        current: {
            click: vi.fn()
        }
    };
    const toast = {
        error: vi.fn(),
        success: vi.fn(),
        add(options: AppToastOptions) {
            if (options.type === 'error') {
                toast.error(options);
                return '';
            }
            if (options.type === 'success') {
                toast.success(options);
                return '';
            }
            throw new Error('Unhandled toast type: ' + options.type);
        }
    };
    const actions = createGalleryAssetActions({
        FILE_TABS: {},
        UPLOAD_ASPECT_RATIOS: {},
        activeTab: 'prints',
        confirm: vi.fn(),
        cropRequest: {
            tab: 'prints',
            file: new File(['image'], 'print.png', { type: 'image/png' }),
            aspectRatio: 16 / 9,
            settings: {
                isAnimated: false,
                animationStyle: 'Stop',
                fps: 15,
                frames: 4,
                loopPingPong: false
            },
            authTarget: {
                userId: 'usr_self',
                endpoint: 'https://api.vrchat.cloud'
            }
        },
        currentEndpoint: 'https://api.vrchat.cloud',
        currentUserId: 'usr_self',
        emojiAnimFps: 15,
        emojiAnimFrameCount: 4,
        emojiAnimLoopPingPong: false,
        emojiAnimType: false,
        emojiAnimationStyle: 'Stop',
        getLocalTimestampString: () => '2026-06-09T10:11:12',
        isRuntimeAuthTarget: () => true,
        isVrcPlusSupporter: true,
        mediaRepository: {
            uploadAssetImage,
            collectInventoryItems: vi.fn(),
            deleteFile: vi.fn(),
            getFileList: vi.fn(),
            getPrints: vi.fn()
        },
        parseEmojiUploadSettings: vi.fn(),
        readFileAsBase64: vi.fn().mockResolvedValue('base64-body'),
        setAssets: vi.fn(),
        setCropRequest: vi.fn(),
        setEmojiAnimFps: vi.fn(),
        setEmojiAnimFrameCount: vi.fn(),
        setEmojiAnimLoopPingPong: vi.fn(),
        setEmojiAnimType: vi.fn(),
        setEmojiAnimationStyle: vi.fn(),
        setLoadingByTab: vi.fn(),
        setMutatingKey: vi.fn(),
        setUploadingTab: vi.fn(),
        t: (key: string) => key,
        toast,
        uploadAuthTargetRef: {
            current: null
        },
        uploadInputRef,
        uploadTargetRef: {
            current: null
        },
        validateImageFile: vi.fn(),
        withUploadTimeout: <T>(promise: Promise<T>) => promise,
        ...overrides
    });

    return {
        actions,
        toast,
        uploadAssetImage,
        uploadInputRef
    };
}

describe('createGalleryAssetActions', () => {
    it('defaults print white-border cropping on', async () => {
        const { actions, uploadAssetImage } = createActions();
        const blob = new Blob(['image'], { type: 'image/png' });

        await actions.confirmCroppedUpload(blob, { note: 'print note' });

        expect(uploadAssetImage).toHaveBeenCalledWith('base64-body', {
            assetKind: 'prints',
            cropWhiteBorder: true,
            params: {
                note: 'print note',
                timestamp: '2026-06-09T10:11:12'
            }
        });
    });

    it('uses the crop white border option provided by the print crop dialog', async () => {
        const { actions, uploadAssetImage } = createActions();
        const blob = new Blob(['image'], { type: 'image/png' });

        await actions.confirmCroppedUpload(blob, {
            note: 'print note',
            cropWhiteBorder: false
        });

        expect(uploadAssetImage).toHaveBeenCalledWith('base64-body', {
            assetKind: 'prints',
            cropWhiteBorder: false,
            params: {
                note: 'print note',
                timestamp: '2026-06-09T10:11:12'
            }
        });
    });

    it('allows profile media uploads without VRC+', () => {
        const { actions, toast, uploadInputRef } = createActions({
            isVrcPlusSupporter: false
        });

        actions.beginUpload('gallery');
        actions.beginUpload('icons');

        expect(uploadInputRef.current.click).toHaveBeenCalledTimes(2);
        expect(toast.error).not.toHaveBeenCalled();
    });

    it('opens the crop dialog for an image dropped on the active tab', () => {
        const setCropRequest = vi.fn();
        const { actions } = createActions({
            setCropRequest,
            validateImageFile: () => true
        });
        const file = new File(['image'], 'drop.png', { type: 'image/png' });

        actions.uploadDroppedFile(file);

        expect(setCropRequest).toHaveBeenCalledWith(
            expect.objectContaining({
                tab: 'prints',
                file,
                authTarget: {
                    userId: 'usr_self',
                    endpoint: 'https://api.vrchat.cloud'
                }
            })
        );
    });

    it('keeps dropped prints restricted to VRC+ users', () => {
        const setCropRequest = vi.fn();
        const { actions, toast } = createActions({
            isVrcPlusSupporter: false,
            setCropRequest,
            validateImageFile: () => true
        });

        actions.uploadDroppedFile(
            new File(['image'], 'drop.png', { type: 'image/png' })
        );

        expect(setCropRequest).not.toHaveBeenCalled();
        expect(toast.error).toHaveBeenCalledWith(
            expect.objectContaining({ title: 'message.vrcplus.required' })
        );
    });

    it.each<GalleryUploadTarget>(['prints', 'emojis', 'stickers'])(
        'keeps %s uploads restricted to VRC+ users',
        (tab) => {
            const { actions, toast, uploadInputRef } = createActions({
                isVrcPlusSupporter: false
            });

            actions.beginUpload(tab);

            expect(uploadInputRef.current.click).not.toHaveBeenCalled();
            expect(toast.error).toHaveBeenCalledWith(
                expect.objectContaining({
                    type: 'error',
                    title: 'message.vrcplus.required'
                })
            );
        }
    );
});
