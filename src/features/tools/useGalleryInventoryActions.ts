import { refreshInventoryBundles } from '@/services/inventoryBundleService';
import {
    parseRedeemCodes,
    REDEEM_CODE_DELAY_MS,
    REDEEM_CODE_LIMIT,
    redeemCodesInTurn
} from '@/services/redeemCodeService';
import {
    mergeCurrentUserMediaFields,
    profileMediaFileUrl,
    profileMediaUpdate,
    PROFILE_MEDIA_URL_FIELD
} from '@/shared/utils/currentUserMedia';
import { extractFileId } from '@/shared/utils/fileUtils';
import { normalizeString } from '@/shared/utils/string';
import { usePrintFavoriteStore } from '@/state/printFavoriteStore';

import type {
    GalleryInventoryActionDeps,
    GalleryProfileField
} from './galleryTypes';

export function useGalleryInventoryActions({
    confirm,
    currentEndpoint,
    currentUserId,
    mediaProfile,
    refreshMediaProfile,
    getAuthTarget,
    isRuntimeAuthTarget,
    mediaRepository,
    prompt,
    refreshInventory,
    setAssets,
    setMutatingKey,
    t,
    toast,
    useRuntimeStore,
    userProfileRepository
}: GalleryInventoryActionDeps) {
    async function deletePrint(printId: string) {
        const normalizedPrintId = printId.trim();
        if (!normalizedPrintId) {
            return;
        }
        const authTarget = getAuthTarget();
        const result = await confirm({
            title: t('view.tools.modal.delete_print'),
            description: normalizedPrintId,
            confirmText: t('common.actions.delete'),
            cancelText: t('common.actions.cancel'),
            destructive: true
        });
        if (!result.ok) {
            return;
        }
        if (!isRuntimeAuthTarget(authTarget)) {
            return;
        }
        setMutatingKey(`prints:${normalizedPrintId}`);
        try {
            await mediaRepository.deletePrint(normalizedPrintId);
            if (isRuntimeAuthTarget(authTarget)) {
                setAssets((current) => ({
                    ...current,
                    prints: current.prints.filter(
                        (print) => print.id !== normalizedPrintId
                    )
                }));
                try {
                    const state = await mediaRepository.setPrintFavorite(
                        normalizedPrintId,
                        false
                    );
                    usePrintFavoriteStore
                        .getState()
                        .hydratePrintFavorites(state);
                } catch (favoriteError) {
                    usePrintFavoriteStore
                        .getState()
                        .removeFavoritePrintId(normalizedPrintId);
                    console.warn(
                        'Failed to clear favorite for deleted print:',
                        favoriteError
                    );
                }
                toast.add({
                    type: 'success',
                    title: t('view.tools.success.print_deleted')
                });
            }
        } catch (error) {
            if (isRuntimeAuthTarget(authTarget)) {
                toast.add({
                    type: 'error',
                    title:
                        error instanceof Error
                            ? error.message
                            : t('view.tools.toast.failed_to_delete_print')
                });
            }
        } finally {
            setMutatingKey((current) =>
                current === `prints:${normalizedPrintId}` ? '' : current
            );
        }
    }
    async function setProfileField(
        fieldName: GalleryProfileField,
        fileId: string
    ) {
        if (!currentUserId) {
            toast.add({
                type: 'error',
                title: t('view.tools.empty.no_current_user_is_available')
            });
            return;
        }
        const normalizedFileId = fileId.trim();
        const nextValue = profileMediaFileUrl(
            currentEndpoint,
            normalizedFileId
        );
        const currentValue =
            mediaProfile?.[PROFILE_MEDIA_URL_FIELD[fieldName]] || '';
        if (mediaProfile && normalizedFileId === extractFileId(currentValue)) {
            return;
        }
        const authTarget = getAuthTarget();
        if (!isRuntimeAuthTarget(authTarget)) {
            return;
        }
        setMutatingKey(`${fieldName}:${normalizedFileId || 'clear'}`);
        try {
            await userProfileRepository.updateCurrentUserProfile({
                expectedUserId: currentUserId,
                params: profileMediaUpdate(fieldName, nextValue)
            });
            if (!isRuntimeAuthTarget(authTarget)) {
                return;
            }
            const refreshed = await refreshMediaProfile();
            if (!isRuntimeAuthTarget(authTarget) || !refreshed) {
                return;
            }
            const mergedUser = mergeCurrentUserMediaFields(
                {
                    id: currentUserId,
                    ...useRuntimeStore.getState().auth.currentUserSnapshot
                },
                refreshed
            );
            useRuntimeStore.getState().setAuthBootstrap({
                currentUserSnapshot: mergedUser,
                currentUserDisplayName:
                    normalizeString(mergedUser.displayName) ||
                    normalizeString(mergedUser.username) ||
                    normalizeString(mergedUser.id) ||
                    currentUserId
            });
            toast.add({
                type: 'success',
                title:
                    fieldName === 'userIcon'
                        ? t('message.gallery.profile_icon_changed')
                        : t('message.gallery.profile_pic_changed')
            });
        } catch (error) {
            if (isRuntimeAuthTarget(authTarget)) {
                toast.add({
                    type: 'error',
                    title:
                        error instanceof Error
                            ? error.message
                            : t(
                                  'view.tools.toast.failed_to_update_profile_media'
                              )
                });
            }
        } finally {
            setMutatingKey((current) =>
                current === `${fieldName}:${normalizedFileId || 'clear'}`
                    ? ''
                    : current
            );
        }
    }
    async function consumeInventoryBundle(inventoryId: string) {
        const normalizedInventoryId = inventoryId.trim();
        if (!normalizedInventoryId) {
            return;
        }
        const authTarget = getAuthTarget();
        if (!isRuntimeAuthTarget(authTarget)) {
            return;
        }
        setMutatingKey(`inventory:${normalizedInventoryId}`);
        try {
            await mediaRepository.consumeInventoryBundle(normalizedInventoryId);
            if (isRuntimeAuthTarget(authTarget)) {
                setAssets((current) => ({
                    ...current,
                    inventory: current.inventory.filter(
                        (item) => item.id !== normalizedInventoryId
                    )
                }));
                refreshInventoryBundles(currentUserId).catch(() => {});
                await refreshInventory();
                toast.add({
                    type: 'success',
                    title: t('view.tools.label.inventory_bundle_consumed')
                });
            }
        } catch (error) {
            if (isRuntimeAuthTarget(authTarget)) {
                toast.add({
                    type: 'error',
                    title:
                        error instanceof Error
                            ? error.message
                            : t(
                                  'view.tools.toast.failed_to_consume_inventory_bundle'
                              )
                });
            }
        } finally {
            setMutatingKey((current) =>
                current === `inventory:${normalizedInventoryId}` ? '' : current
            );
        }
    }
    async function redeemReward() {
        const authTarget = getAuthTarget();
        const result = await prompt({
            title: t('prompt.redeem.header'),
            description: t('prompt.redeem.description'),
            confirmText: t('prompt.redeem.redeem'),
            cancelText: t('prompt.redeem.cancel')
        });
        const codes = parseRedeemCodes(result.value ?? '');
        if (!result.ok || !codes.length) {
            return;
        }
        if (codes.length > REDEEM_CODE_LIMIT) {
            toast.add({
                type: 'error',
                title: t('prompt.redeem.too_many', {
                    limit: REDEEM_CODE_LIMIT
                })
            });
            return;
        }
        if (!isRuntimeAuthTarget(authTarget)) {
            return;
        }
        setMutatingKey('inventory:redeem');
        try {
            if (codes.length > 1) {
                toast.add({
                    type: 'info',
                    title: t('prompt.redeem.in_progress', {
                        count: codes.length,
                        seconds: Math.ceil(
                            ((codes.length - 1) * REDEEM_CODE_DELAY_MS) / 1000
                        )
                    })
                });
            }
            // One at a time with a pause between, and only while the same
            // account stays signed in.
            const outcomes = await redeemCodesInTurn(
                codes,
                (code) => mediaRepository.redeemReward(code),
                { shouldStop: () => !isRuntimeAuthTarget(authTarget) }
            );
            if (!isRuntimeAuthTarget(authTarget)) {
                return;
            }
            const redeemed = outcomes.filter(
                (outcome) => outcome.status === 'redeemed'
            );
            const failed = outcomes.filter(
                (outcome) => outcome.status === 'failed'
            );
            const skipped = outcomes.filter(
                (outcome) => outcome.status === 'skipped'
            );
            if (codes.length === 1) {
                toast.add(
                    redeemed.length
                        ? { type: 'success', title: t('prompt.redeem.success') }
                        : {
                              type: 'error',
                              title:
                                  (failed[0]?.status === 'failed' &&
                                      failed[0].error) ||
                                  t('view.tools.toast.failed_to_redeem_reward')
                          }
                );
            } else {
                toast.add({
                    type:
                        failed.length || skipped.length ? 'warning' : 'success',
                    title: t('prompt.redeem.summary', {
                        redeemed: redeemed.length,
                        failed: failed.length,
                        skipped: skipped.length
                    }),
                    description: failed
                        .map((outcome) =>
                            outcome.status === 'failed'
                                ? `${outcome.code}: ${outcome.error}`
                                : ''
                        )
                        .join('\n')
                });
            }
            if (redeemed.length) {
                await refreshInventory();
            }
        } catch (error) {
            if (isRuntimeAuthTarget(authTarget)) {
                toast.add({
                    type: 'error',
                    title:
                        error instanceof Error
                            ? error.message
                            : t('view.tools.toast.failed_to_redeem_reward')
                });
            }
        } finally {
            setMutatingKey((current) =>
                current === 'inventory:redeem' ? '' : current
            );
        }
    }
    return {
        deletePrint,
        setProfileField,
        consumeInventoryBundle,
        redeemReward
    };
}
