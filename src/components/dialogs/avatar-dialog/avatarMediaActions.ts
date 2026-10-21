import type { ChangeEvent } from 'react';

import { commands } from '@/platform/tauri/bindings';
import avatarProfileRepository from '@/repositories/avatarProfileRepository';
import vrchatMediaRepository from '@/repositories/vrchatMediaRepository';
import { unwrapVrchatResponse } from '@/repositories/vrchatRequest';
import { openFolderAndSelectItem } from '@/services/shellIntegrationService';
import { toast } from '@/services/toastService';
import {
    readFileAsBase64,
    validateImageUploadFile,
    withUploadTimeout
} from '@/shared/utils/imageUpload';
import { useVrchatConfigStore } from '@/state/vrchatConfigStore';

import { avatarGalleryImageUrl, resolveAssetBundleArgs } from './avatarAssets';
import { readAvatarCacheInfo } from './avatarCacheAdapter';
import type {
    AvatarCacheActionDependencies,
    AvatarGalleryActionDependencies,
    AvatarImageUploadActionDependencies
} from './avatarDialogTypes';

function normalizeEntityId(value: unknown): string {
    return typeof value === 'string'
        ? value.trim()
        : String(value ?? '').trim();
}

export function createAvatarImageUploadActions({
    actionStatusRef,
    activeAvatarTargetRef,
    avatar,
    currentEndpoint,
    imageCropRequest,
    imageUploadAvatarRef,
    imageUploadInputRef,
    canManageAvatar,
    setActionStatus,
    setAvatar,
    setDetail,
    setImageCropRequest,
    t
}: AvatarImageUploadActionDependencies) {
    function beginAvatarImageUpload() {
        if (!canManageAvatar || actionStatusRef.current !== 'idle') {
            return;
        }

        imageUploadAvatarRef.current = avatar;
        imageUploadInputRef.current?.click();
    }

    function onFileChangeAvatarImage(event: ChangeEvent<HTMLInputElement>) {
        const file = event.target.files?.[0] || null;
        event.target.value = '';
        if (!file) {
            return;
        }

        const validation = validateImageUploadFile(file);
        if (!validation.ok) {
            const message =
                validation.reason === 'too_large'
                    ? t('message.image.error.selected_image_is_too_large')
                    : t('message.image.success.selected_file_is_not_image');
            setDetail(message);
            toast.add({ type: 'error', title: message });
            return;
        }

        const selectedAvatar = imageUploadAvatarRef.current || avatar;
        if (!selectedAvatar?.id) {
            return;
        }

        imageUploadAvatarRef.current = selectedAvatar;
        setImageCropRequest({
            file,
            avatar: selectedAvatar
        });
    }

    async function confirmAvatarImageUpload(blob: Blob | null) {
        const request = imageCropRequest;
        const selectedAvatar =
            request?.avatar || imageUploadAvatarRef.current || avatar;
        const avatarId = normalizeEntityId(selectedAvatar?.id);
        const requestEndpoint = currentEndpoint;
        if (!blob || !avatarId) {
            return;
        }

        actionStatusRef.current = 'image-upload';
        setActionStatus('image-upload');

        try {
            const base64Body = await readFileAsBase64(blob);
            const base64File =
                await commands.appResizeImageToFitLimits(base64Body);
            const result = await withUploadTimeout(
                vrchatMediaRepository.uploadAvatarImageLegacy({
                    avatarId,
                    imageUrl:
                        selectedAvatar.imageUrl ||
                        selectedAvatar.thumbnailImageUrl ||
                        '',
                    base64File
                })
            );
            const activeTarget = activeAvatarTargetRef.current;
            if (
                activeTarget.avatarId !== avatarId ||
                activeTarget.endpoint !== requestEndpoint
            ) {
                return;
            }
            const currentAvatar = avatarProfileRepository.normalize(
                result.avatar,
                {
                    localTags: selectedAvatar.$tags,
                    timeSpent: selectedAvatar.$timeSpent,
                    memo: selectedAvatar.$memo,
                    cachedAvatar: selectedAvatar.$isCached
                }
            );
            setAvatar(currentAvatar);
            setDetail(
                t('dialog.avatar.dynamic.avatar_image_updated_for_value', {
                    value: selectedAvatar.name || avatarId
                })
            );
            toast.add({
                type: 'success',
                title: t('dialog.avatar.success.avatar_image_updated')
            });
        } catch (error) {
            const message =
                error instanceof Error
                    ? error.message
                    : t('dialog.avatar.toast.failed_to_upload_avatar_image');
            setDetail(message);
            toast.add({ type: 'error', title: message });
        } finally {
            imageUploadAvatarRef.current = null;
            setImageCropRequest(null);
            actionStatusRef.current = 'idle';
            setActionStatus('idle');
        }
    }

    return {
        beginAvatarImageUpload,
        confirmAvatarImageUpload,
        onFileChangeAvatarImage
    };
}

export function createAvatarCacheActions({
    actionStatusRef,
    avatar,
    avatarSideData,
    setActionStatus,
    setAvatar,
    setAvatarSideData,
    t
}: AvatarCacheActionDependencies) {
    async function openAvatarCacheFolder() {
        const cachePath = avatarSideData.cache.cachePath;
        if (!cachePath) {
            return;
        }
        try {
            await openFolderAndSelectItem(cachePath, true);
        } catch (error) {
            toast.add({
                type: 'error',
                title:
                    error instanceof Error
                        ? error.message
                        : t(
                              'dialog.avatar.toast.failed_to_open_avatar_cache_folder'
                          )
            });
        }
    }

    async function deleteAvatarCache() {
        if (actionStatusRef.current !== 'idle') {
            return;
        }
        const sdkUnityVersion = String(
            useVrchatConfigStore.getState().snapshot?.sdkUnityVersion || ''
        );
        const args = resolveAssetBundleArgs(avatar, sdkUnityVersion);
        if (!args) {
            toast.add({
                type: 'error',
                title: t(
                    'dialog.avatar.error.avatar_cache_location_unavailable'
                )
            });
            return;
        }
        actionStatusRef.current = 'cache';
        setActionStatus('cache');
        try {
            await commands.assetBundleDeleteCache(
                args.fileId,
                args.fileVersion,
                args.variant,
                args.variantVersion
            );
            const cache = await readAvatarCacheInfo(avatar, sdkUnityVersion);
            setAvatarSideData((current) => ({ ...current, cache }));
            setAvatar((current) =>
                current ? { ...current, $isCached: cache.inCache } : current
            );
            toast.add({
                type: 'success',
                title: t('dialog.avatar.success.avatar_cache_deleted')
            });
        } catch (error) {
            toast.add({
                type: 'error',
                title:
                    error instanceof Error
                        ? error.message
                        : t('dialog.avatar.toast.failed_to_delete_avatar_cache')
            });
        } finally {
            actionStatusRef.current = 'idle';
            setActionStatus('idle');
        }
    }

    return {
        deleteAvatarCache,
        openAvatarCacheFolder
    };
}

export function createAvatarGalleryActions({
    actionStatusRef,
    activeAvatarTargetRef,
    avatar,
    avatarSideData,
    canManageAvatar,
    confirm,
    currentEndpoint,
    galleryUploadInputRef,
    setActionStatus,
    setAvatarSideData,
    t
}: AvatarGalleryActionDependencies) {
    function displayedGalleryRows() {
        return avatarSideData.galleryRows.filter((row) =>
            Boolean(avatarGalleryImageUrl(row))
        );
    }

    async function refreshAvatarGallery(
        targetAvatarId: string,
        requestEndpoint: string
    ): Promise<boolean> {
        const galleryRows = await avatarProfileRepository.getAvatarGallery({
            avatarId: targetAvatarId,
            force: true
        });
        if (
            activeAvatarTargetRef.current.avatarId !== targetAvatarId ||
            activeAvatarTargetRef.current.endpoint !== requestEndpoint
        ) {
            return false;
        }
        setAvatarSideData((current) => ({
            ...current,
            galleryRows,
            galleryImages: galleryRows
                .map(avatarGalleryImageUrl)
                .filter((url): url is string => Boolean(url))
        }));
        return true;
    }

    function beginAvatarGalleryUpload() {
        if (!canManageAvatar || actionStatusRef.current !== 'idle') {
            return;
        }
        galleryUploadInputRef.current?.click();
    }

    async function onFileChangeAvatarGallery(
        event: ChangeEvent<HTMLInputElement>
    ) {
        const file = event.target.files?.[0];
        event.target.value = '';
        const targetAvatarId = normalizeEntityId(avatar?.id);
        const requestEndpoint = currentEndpoint;
        if (!file || !targetAvatarId || actionStatusRef.current !== 'idle') {
            return;
        }
        const validation = validateImageUploadFile(file);
        if (!validation.ok) {
            toast.add({
                type: 'error',
                title:
                    validation.reason === 'too_large'
                        ? t('dialog.avatar.toast.selected_file_is_too_large')
                        : t('dialog.avatar.toast.selected_file_is_not_an_image')
            });
            return;
        }
        actionStatusRef.current = 'gallery-upload';
        setActionStatus('gallery-upload');
        try {
            const base64Body = await readFileAsBase64(file);
            await vrchatMediaRepository.uploadAvatarGalleryImage(
                base64Body,
                targetAvatarId
            );
            if (await refreshAvatarGallery(targetAvatarId, requestEndpoint)) {
                toast.add({
                    type: 'success',
                    title: t(
                        'dialog.avatar.label.avatar_gallery_image_uploaded'
                    )
                });
            }
        } catch (error) {
            toast.add({
                type: 'error',
                title:
                    error instanceof Error
                        ? error.message
                        : t(
                              'dialog.avatar.toast.failed_to_upload_avatar_gallery_image'
                          )
            });
        } finally {
            if (actionStatusRef.current === 'gallery-upload') {
                actionStatusRef.current = 'idle';
                setActionStatus('idle');
            }
        }
    }

    async function moveAvatarGalleryImage(
        index: number,
        direction: -1 | 1
    ): Promise<boolean> {
        const targetAvatarId = normalizeEntityId(avatar?.id);
        const requestEndpoint = currentEndpoint;
        const rows = displayedGalleryRows();
        const targetIndex = index + direction;
        if (
            !canManageAvatar ||
            !targetAvatarId ||
            actionStatusRef.current !== 'idle' ||
            !rows[index] ||
            !rows[targetIndex]
        ) {
            return false;
        }
        const orderedRows = rows.slice();
        [orderedRows[index], orderedRows[targetIndex]] = [
            orderedRows[targetIndex],
            orderedRows[index]
        ];
        const hiddenRows = avatarSideData.galleryRows.filter(
            (row) => !rows.includes(row)
        );
        actionStatusRef.current = 'gallery-edit';
        setActionStatus('gallery-edit');
        try {
            unwrapVrchatResponse(
                await commands.appVrchatMediaAvatarGalleryOrderSet({
                    avatarId: targetAvatarId,
                    fileIds: [...orderedRows, ...hiddenRows].map((row) =>
                        normalizeEntityId(row.id)
                    )
                }),
                'files/order'
            );
            return await refreshAvatarGallery(targetAvatarId, requestEndpoint);
        } catch (error) {
            toast.add({
                type: 'error',
                title:
                    error instanceof Error
                        ? error.message
                        : t(
                              'dialog.avatar.toast.failed_to_reorder_avatar_gallery'
                          )
            });
            return false;
        } finally {
            if (actionStatusRef.current === 'gallery-edit') {
                actionStatusRef.current = 'idle';
                setActionStatus('idle');
            }
        }
    }

    async function deleteAvatarGalleryImage(index: number) {
        const targetAvatarId = normalizeEntityId(avatar?.id);
        const requestEndpoint = currentEndpoint;
        const fileId = normalizeEntityId(displayedGalleryRows()[index]?.id);
        if (
            !canManageAvatar ||
            !targetAvatarId ||
            !fileId ||
            actionStatusRef.current !== 'idle'
        ) {
            return;
        }
        const result = await confirm({
            title: t('dialog.avatar.modal.delete_gallery_image'),
            description: avatar.name || avatar.id,
            confirmText: t('common.actions.delete'),
            cancelText: t('common.actions.cancel'),
            destructive: true
        });
        if (!result.ok || actionStatusRef.current !== 'idle') {
            return;
        }
        actionStatusRef.current = 'gallery-edit';
        setActionStatus('gallery-edit');
        try {
            await vrchatMediaRepository.deleteFile(fileId);
            if (await refreshAvatarGallery(targetAvatarId, requestEndpoint)) {
                toast.add({
                    type: 'success',
                    title: t('dialog.avatar.label.avatar_gallery_image_deleted')
                });
            }
        } catch (error) {
            toast.add({
                type: 'error',
                title:
                    error instanceof Error
                        ? error.message
                        : t(
                              'dialog.avatar.toast.failed_to_delete_avatar_gallery_image'
                          )
            });
        } finally {
            if (actionStatusRef.current === 'gallery-edit') {
                actionStatusRef.current = 'idle';
                setActionStatus('idle');
            }
        }
    }

    return {
        beginAvatarGalleryUpload,
        deleteAvatarGalleryImage,
        moveAvatarGalleryImage,
        onFileChangeAvatarGallery
    };
}
