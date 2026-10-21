import avatarProfileRepository from '@/repositories/avatarProfileRepository';
import memoPersistenceRepository from '@/repositories/memoPersistenceRepository';
import {
    selectAvatar as selectCurrentAvatar,
    selectFallbackAvatar as selectCurrentFallbackAvatar
} from '@/services/avatarSelectionService';
import { refreshCurrentUser } from '@/services/backgroundMaintenanceService';
import { toast } from '@/services/toastService';
import { useDialogStore } from '@/state/dialogStore';

import type {
    AvatarDialogActionDependencies,
    AvatarReleaseStatus
} from './avatarDialogTypes';
import {
    createAvatarCacheActions,
    createAvatarGalleryActions,
    createAvatarImageUploadActions
} from './avatarMediaActions';
import { createAvatarModerationActions } from './avatarModerationActions';

function normalizeEntityId(value: unknown): string {
    return typeof value === 'string'
        ? value.trim()
        : String(value ?? '').trim();
}

export function createAvatarDialogActions({
    actionStatusRef,
    activeAvatarTargetRef,
    applyCurrentAvatarUpdate,
    avatar,
    avatarSideData,
    canManageAvatar,
    canSelectAvatar,
    canSelectFallbackAvatar,
    closeDialog,
    confirm,
    currentEndpoint,
    galleryUploadInputRef,
    imageCropRequest,
    imageUploadAvatarRef,
    imageUploadInputRef,
    isCurrentAvatar,
    memo,
    memoRevisionRef,
    moderationRevisionRef,
    normalizedAvatarId,
    prompt,
    setActionStatus,
    setAvatar,
    setAvatarBlocked,
    setAvatarSideData,
    setDetail,
    setImageCropRequest,
    setMemo,
    setOwnerEditor,
    t
}: AvatarDialogActionDependencies) {
    async function refreshAvatarProfile() {
        if (actionStatusRef.current !== 'idle') {
            return;
        }

        actionStatusRef.current = 'refresh';
        setActionStatus('refresh');
        try {
            const nextAvatar = await avatarProfileRepository.getAvatarProfile({
                avatarId: normalizedAvatarId,
                force: true,
                dialog: true,
                allowLocalFallback: false
            });
            applyCurrentAvatarUpdate(nextAvatar);
            toast.add({
                type: 'success',
                title: t('dialog.avatar.success.avatar_refreshed')
            });
        } catch (error) {
            toast.add({
                type: 'error',
                title:
                    error instanceof Error
                        ? error.message
                        : t('dialog.avatar.toast.failed_to_refresh_avatar')
            });
        } finally {
            actionStatusRef.current = 'idle';
            setActionStatus('idle');
        }
    }

    async function selectAvatar() {
        if (!canSelectAvatar || actionStatusRef.current !== 'idle') {
            return;
        }

        actionStatusRef.current = 'selecting';
        setActionStatus('selecting');

        try {
            const result = await selectCurrentAvatar(avatar.id);
            if (!result.applied) {
                return;
            }
            toast.add({
                type: 'success',
                title: t('dialog.avatar.success.avatar_selected')
            });
        } catch (error) {
            toast.add({
                type: 'error',
                title:
                    error instanceof Error
                        ? error.message
                        : t('dialog.avatar.toast.failed_to_select_avatar')
            });
        } finally {
            actionStatusRef.current = 'idle';
            setActionStatus('idle');
        }
    }

    async function selectFallbackAvatar() {
        if (!canSelectFallbackAvatar || actionStatusRef.current !== 'idle') {
            return;
        }

        actionStatusRef.current = 'fallback';
        setActionStatus('fallback');
        const result = await confirm({
            title: t('dialog.avatar.modal.select_fallback_avatar'),
            description: t(
                'dialog.avatar.dynamic.use_value_as_your_vrchat_fallback_avatar',
                { value: avatar.name || avatar.id }
            ),
            confirmText: t('dialog.avatar.modal.select_fallback'),
            cancelText: t('common.actions.cancel')
        });

        if (!result.ok) {
            actionStatusRef.current = 'idle';
            setActionStatus('idle');
            return;
        }

        try {
            const selection = await selectCurrentFallbackAvatar(avatar.id);
            if (!selection.applied) {
                return;
            }
            toast.add({
                type: 'success',
                title: t('dialog.avatar.empty.fallback_avatar_updated')
            });
        } catch (error) {
            toast.add({
                type: 'error',
                title:
                    error instanceof Error
                        ? error.message
                        : t(
                              'dialog.avatar.toast.failed_to_select_fallback_avatar'
                          )
            });
        } finally {
            actionStatusRef.current = 'idle';
            setActionStatus('idle');
        }
    }

    async function updateReleaseStatus(nextStatus: AvatarReleaseStatus) {
        if (!canManageAvatar || actionStatusRef.current !== 'idle') {
            return;
        }

        const isPublic = nextStatus === 'public';
        actionStatusRef.current = 'release-status';
        setActionStatus('release-status');
        const result = await confirm({
            title: isPublic
                ? t('view.my_avatars.modal.make_avatar_public')
                : t('view.my_avatars.modal.make_avatar_private'),
            description: avatar.name || avatar.id,
            confirmText: isPublic
                ? t('dialog.avatar.actions.make_public')
                : t('dialog.avatar.actions.make_private'),
            cancelText: t('common.actions.cancel'),
            destructive: !isPublic
        });

        if (!result.ok) {
            actionStatusRef.current = 'idle';
            setActionStatus('idle');
            return;
        }

        try {
            const response = await avatarProfileRepository.saveAvatar({
                avatarId: avatar.id,
                params: {
                    id: avatar.id,
                    releaseStatus: nextStatus
                }
            });
            applyCurrentAvatarUpdate(
                response.json && typeof response.json === 'object'
                    ? response.json
                    : { ...avatar, releaseStatus: nextStatus }
            );
            toast.add({
                type: 'success',
                title: isPublic
                    ? t('dialog.avatar.toast.avatar_made_public')
                    : t('dialog.avatar.toast.avatar_made_private')
            });
        } catch (error) {
            toast.add({
                type: 'error',
                title:
                    error instanceof Error
                        ? error.message
                        : t(
                              'dialog.avatar.toast.failed_to_update_avatar_release_status'
                          )
            });
        } finally {
            actionStatusRef.current = 'idle';
            setActionStatus('idle');
        }
    }

    async function changeAvatarContentTags() {
        if (!canManageAvatar || actionStatusRef.current !== 'idle') {
            return;
        }
        setOwnerEditor('content-tags');
    }

    async function editAvatarDetails() {
        if (!canManageAvatar || actionStatusRef.current !== 'idle') {
            return;
        }
        setOwnerEditor('details');
    }

    async function deleteAvatar() {
        if (!canManageAvatar || actionStatusRef.current !== 'idle') {
            return;
        }

        const result = await confirm({
            title: t('dialog.avatar.modal.delete_avatar'),
            description: avatar.name || avatar.id,
            confirmText: t('common.actions.delete'),
            cancelText: t('common.actions.cancel'),
            destructive: true
        });
        if (!result.ok) {
            return;
        }

        actionStatusRef.current = 'delete';
        setActionStatus('delete');
        try {
            await avatarProfileRepository.deleteAvatar({
                avatarId: avatar.id
            });
            let refreshFailed = false;
            try {
                await refreshCurrentUser();
            } catch {
                refreshFailed = true;
            }
            toast.add({
                type: 'success',
                title: refreshFailed
                    ? t(
                          'dialog.avatar.toast.avatar_deleted_but_current_user_snapshot_refresh'
                      )
                    : t('message.avatar.deleted')
            });
            const dialogState = useDialogStore.getState();
            if (dialogState.breadcrumbs.length > 1) {
                dialogState.popToBreadcrumb(dialogState.breadcrumbs.length - 2);
            } else {
                closeDialog();
            }
        } catch (error) {
            toast.add({
                type: 'error',
                title:
                    error instanceof Error
                        ? error.message
                        : t('dialog.avatar.toast.failed_to_delete_avatar')
            });
        } finally {
            actionStatusRef.current = 'idle';
            setActionStatus('idle');
        }
    }

    async function refreshAvatarSnapshot({ force = false } = {}) {
        const nextAvatar = await avatarProfileRepository.getAvatarProfile({
            avatarId: avatar.id,
            force,
            dialog: true,
            allowLocalFallback: false
        });
        applyCurrentAvatarUpdate(nextAvatar);
    }

    async function saveMemo(nextValue: string) {
        const targetAvatarId = normalizeEntityId(avatar.id);
        const targetEndpoint = currentEndpoint;
        const revision = memoRevisionRef.current + 1;
        memoRevisionRef.current = revision;
        try {
            const nextEntry = await memoPersistenceRepository.saveAvatarMemo({
                avatarId: targetAvatarId,
                memo: nextValue
            });
            if (
                activeAvatarTargetRef.current.avatarId !== targetAvatarId ||
                activeAvatarTargetRef.current.endpoint !== targetEndpoint ||
                memoRevisionRef.current !== revision
            ) {
                return;
            }
            const nextMemo = nextEntry.memo || '';
            setMemo(nextMemo);
            setAvatar((currentAvatar) => {
                if (
                    !currentAvatar ||
                    normalizeEntityId(currentAvatar.id) !== targetAvatarId
                ) {
                    return currentAvatar;
                }
                return { ...currentAvatar, $memo: nextMemo };
            });
            toast.add({
                type: 'success',
                title: nextMemo
                    ? t('dialog.avatar.toast.memo_saved')
                    : t('dialog.avatar.toast.memo_cleared')
            });
        } catch (error) {
            if (
                activeAvatarTargetRef.current.avatarId !== targetAvatarId ||
                activeAvatarTargetRef.current.endpoint !== targetEndpoint ||
                memoRevisionRef.current !== revision
            ) {
                return;
            }
            toast.add({
                type: 'error',
                title:
                    error instanceof Error
                        ? error.message
                        : t('dialog.avatar.toast.failed_to_save_memo')
            });
        }
    }

    const {
        beginAvatarImageUpload,
        confirmAvatarImageUpload,
        onFileChangeAvatarImage
    } = createAvatarImageUploadActions({
        actionStatusRef,
        activeAvatarTargetRef,
        avatar,
        canManageAvatar,
        currentEndpoint,
        imageCropRequest,
        imageUploadAvatarRef,
        imageUploadInputRef,
        setActionStatus,
        setAvatar,
        setDetail,
        setImageCropRequest,
        t
    });
    const { deleteAvatarCache, openAvatarCacheFolder } =
        createAvatarCacheActions({
            actionStatusRef,
            avatar,
            avatarSideData,
            setActionStatus,
            setAvatar,
            setAvatarSideData,
            t
        });
    const {
        beginAvatarGalleryUpload,
        deleteAvatarGalleryImage,
        moveAvatarGalleryImage,
        onFileChangeAvatarGallery
    } = createAvatarGalleryActions({
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
    });
    const { setAvatarBlock, updateAvatarImposter } =
        createAvatarModerationActions({
            actionStatusRef,
            avatar,
            canManageAvatar,
            confirm,
            isCurrentAvatar,
            moderationRevisionRef,
            refreshAvatarSnapshot,
            setActionStatus,
            setAvatarBlocked,
            t
        });

    async function editMemo() {
        const result = await prompt({
            title: t('dialog.avatar.modal.edit_local_memo'),
            description: avatar.name || avatar.id,
            inputValue: memo,
            multiline: true,
            confirmText: t('common.actions.save'),
            cancelText: t('common.actions.cancel')
        });

        if (!result.ok) {
            return;
        }

        await saveMemo(typeof result.value === 'string' ? result.value : '');
    }

    return {
        beginAvatarGalleryUpload,
        beginAvatarImageUpload,
        changeAvatarContentTags,
        confirmAvatarImageUpload,
        deleteAvatar,
        deleteAvatarCache,
        deleteAvatarGalleryImage,
        editAvatarDetails,
        editMemo,
        moveAvatarGalleryImage,
        onFileChangeAvatarGallery,
        onFileChangeAvatarImage,
        openAvatarCacheFolder,
        refreshAvatarProfile,
        saveMemo,
        selectAvatar,
        selectFallbackAvatar,
        setAvatarBlock,
        updateAvatarImposter,
        updateReleaseStatus
    };
}
