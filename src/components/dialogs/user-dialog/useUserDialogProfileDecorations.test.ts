// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AppToastOptions } from '@/services/toastService';

const mediaMocks = vi.hoisted(() => ({
    equipProfileDecoration: vi.fn(),
    collectInventoryItems: vi.fn(),
    unequipProfileDecoration: vi.fn()
}));

const maintenanceMocks = vi.hoisted(() => ({
    refreshCurrentUser: vi.fn()
}));

const profileMocks = vi.hoisted(() => ({
    updateCurrentUserProfile: vi.fn()
}));

const runtimeState = vi.hoisted(() => ({
    auth: {
        currentUserEndpoint: 'https://api.vrchat.cloud/api/1',
        currentUserId: 'usr_self',
        currentUserWebsocket: 'wss://pipeline.vrchat.cloud'
    }
}));

const toastMocks = vi.hoisted(() => ({
    error: vi.fn(),
    success: vi.fn()
}));

vi.mock('@/repositories/vrchatMediaRepository', () => ({
    default: mediaMocks
}));
vi.mock('@/services/backgroundMaintenanceSessionService', () => ({
    refreshCurrentUser: maintenanceMocks.refreshCurrentUser
}));
vi.mock('@/repositories/userProfileRepository', () => ({
    default: profileMocks
}));
vi.mock('@/state/runtimeStore', () => ({
    useRuntimeStore: (selector: (state: typeof runtimeState) => unknown) =>
        selector(runtimeState)
}));
vi.mock('@/services/toastService', () => ({
    toast: {
        add: (options: AppToastOptions) => {
            switch (options.type) {
                case 'error':
                    return toastMocks.error(options);
                case 'success':
                    return toastMocks.success(options);
                default:
                    throw new Error('Unhandled toast type: ' + options.type);
            }
        }
    }
}));

import { useUserDialogProfileDecorations } from './useUserDialogProfileDecorations';

function useProfileDecorations({
    enabled = true,
    onProfileUpdated
}: {
    enabled?: boolean;
    onProfileUpdated?: () => void;
} = {}) {
    return useUserDialogProfileDecorations({
        enabled,
        onProfileUpdated
    });
}

function equippableItem(overrides: Record<string, unknown> = {}) {
    return {
        id: 'inv_frame',
        holderId: 'usr_self',
        itemType: 'iconFrame',
        equipSlot: '',
        equipSlots: ['iconFrame'],
        flags: ['equippable'],
        ...overrides
    };
}

describe('useUserDialogProfileDecorations', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        runtimeState.auth.currentUserEndpoint =
            'https://api.vrchat.cloud/api/1';
        runtimeState.auth.currentUserId = 'usr_self';
        runtimeState.auth.currentUserWebsocket = 'wss://pipeline.vrchat.cloud';
        mediaMocks.collectInventoryItems.mockResolvedValue({
            items: [],
            truncated: false
        });
        mediaMocks.equipProfileDecoration.mockResolvedValue({
            json: { ok: true }
        });
        mediaMocks.unequipProfileDecoration.mockResolvedValue({ json: 'OK' });
        profileMocks.updateCurrentUserProfile.mockResolvedValue({
            id: 'usr_self',
            backgroundType: 'default'
        });
        maintenanceMocks.refreshCurrentUser.mockResolvedValue({
            id: 'usr_self'
        });
    });
    afterEach(cleanup);

    it('loads owned decorations and groups them by slot', async () => {
        mediaMocks.collectInventoryItems
            .mockResolvedValueOnce({
                items: [
                    { id: 'inv_frame', itemType: 'iconFrame' },
                    { id: 'inv_effect', itemType: 'profileEffect' },
                    { id: 'inv_plate', itemType: 'nameplateEffect' },
                    { id: 'inv_other', itemType: 'droneskin' }
                ],
                truncated: false
            })
            .mockResolvedValue({ items: [], truncated: false });

        const { result } = renderHook(() => useProfileDecorations());

        await waitFor(() => expect(result.current.isReady).toBe(true));

        expect(mediaMocks.collectInventoryItems).toHaveBeenCalledWith({
            types: ['iconFrame', 'profileEffect', 'nameplateEffect'],
            notFlags: ['ugc'],
            archived: false
        });
        expect(result.current.itemsBySlot.iconFrame).toHaveLength(1);
        expect(result.current.itemsBySlot.profileEffect).toHaveLength(1);
        expect(result.current.itemsBySlot.nameplateEffect).toHaveLength(1);
    });

    it('does not load while disabled', () => {
        renderHook(() => useProfileDecorations({ enabled: false }));
        expect(mediaMocks.collectInventoryItems).not.toHaveBeenCalled();
    });

    it('equips an unequipped item and refreshes the self profile', async () => {
        const { result } = renderHook(() => useProfileDecorations());
        await waitFor(() => expect(result.current.isReady).toBe(true));

        await act(async () => {
            result.current.equipItem(equippableItem());
        });

        await waitFor(() =>
            expect(mediaMocks.equipProfileDecoration).toHaveBeenCalledWith({
                expectedUserId: 'usr_self',
                inventoryId: 'inv_frame',
                equipSlot: 'iconFrame'
            })
        );
        expect(maintenanceMocks.refreshCurrentUser).toHaveBeenCalledWith({
            expectedUserId: 'usr_self',
            expectedEndpoint: 'https://api.vrchat.cloud/api/1',
            expectedWebsocket: 'wss://pipeline.vrchat.cloud'
        });
        expect(toastMocks.success).toHaveBeenCalledWith(
            expect.objectContaining({
                type: 'success',
                title: 'dialog.inventory.equipped_success'
            })
        );
    });

    it('unequips a slot directly', async () => {
        const { result } = renderHook(() => useProfileDecorations());
        await waitFor(() => expect(result.current.isReady).toBe(true));

        await act(async () => {
            result.current.unequipSlot('profileEffect');
        });

        await waitFor(() =>
            expect(mediaMocks.unequipProfileDecoration).toHaveBeenCalledWith({
                expectedUserId: 'usr_self',
                equipSlot: 'profileEffect'
            })
        );
        expect(mediaMocks.equipProfileDecoration).not.toHaveBeenCalled();
    });

    it('ignores equipItem for an already-equipped item', async () => {
        const { result } = renderHook(() => useProfileDecorations());
        await waitFor(() => expect(result.current.isReady).toBe(true));

        await act(async () => {
            result.current.equipItem(
                equippableItem({
                    id: 'inv_equipped',
                    itemType: 'profileEffect',
                    equipSlot: 'profileEffect',
                    equipSlots: ['profileEffect']
                })
            );
        });

        expect(mediaMocks.equipProfileDecoration).not.toHaveBeenCalled();
        expect(mediaMocks.unequipProfileDecoration).not.toHaveBeenCalled();
    });

    it('updates the profile background and requests an appearance refresh', async () => {
        const onProfileUpdated = vi.fn();
        const { result } = renderHook(() =>
            useProfileDecorations({ onProfileUpdated })
        );
        await waitFor(() => expect(result.current.isReady).toBe(true));

        act(() => {
            result.current.updateBackground('grid', {
                backgroundType: 'texture',
                backgroundTextureId: 'grid'
            });
        });

        await waitFor(() =>
            expect(profileMocks.updateCurrentUserProfile).toHaveBeenCalledWith({
                expectedUserId: 'usr_self',
                params: {
                    backgroundType: 'texture',
                    backgroundTextureId: 'grid'
                }
            })
        );
        await waitFor(() => expect(onProfileUpdated).toHaveBeenCalledOnce());
        expect(toastMocks.success).toHaveBeenCalledWith(
            expect.objectContaining({
                type: 'success',
                title: 'dialog.inventory.profile_background_updated'
            })
        );
    });

    it('optimistically updates the selected tile and profile appearance', async () => {
        let resolveEquip: (() => void) | undefined;
        const onProfileUpdated = vi.fn();
        mediaMocks.collectInventoryItems.mockResolvedValueOnce({
            items: [
                equippableItem({
                    id: 'inv_old',
                    equipSlot: 'iconFrame',
                    templateId: 'invt_old'
                }),
                equippableItem({
                    id: 'inv_new',
                    templateId: 'invt_new'
                })
            ],
            truncated: false
        });
        mediaMocks.equipProfileDecoration.mockReturnValueOnce(
            new Promise((resolve) => {
                resolveEquip = () => resolve({ json: { ok: true } });
            })
        );
        const { result, rerender } = renderHook(
            ({ enabled }: { enabled: boolean }) =>
                useProfileDecorations({ enabled, onProfileUpdated }),
            { initialProps: { enabled: true } }
        );
        await waitFor(() => expect(result.current.isReady).toBe(true));

        act(() => {
            result.current.equipItem(result.current.itemsBySlot.iconFrame[1]);
        });

        expect(result.current.itemsBySlot.iconFrame[0]?.equipSlot).toBe('');
        expect(result.current.itemsBySlot.iconFrame[1]?.equipSlot).toBe(
            'iconFrame'
        );
        expect(result.current.appearanceOverrides.iconFrame).toMatchObject({
            action: 'equip',
            item: { id: 'inv_new' },
            templateId: 'invt_new'
        });

        resolveEquip?.();
        await waitFor(() => expect(result.current.pendingKey).toBe(''));
        expect(mediaMocks.collectInventoryItems).toHaveBeenCalledTimes(1);
        expect(onProfileUpdated).toHaveBeenCalledOnce();

        mediaMocks.collectInventoryItems.mockResolvedValueOnce({
            items: [
                equippableItem({
                    id: 'inv_old',
                    equipSlot: 'iconFrame',
                    templateId: 'invt_old'
                }),
                equippableItem({
                    id: 'inv_new',
                    templateId: 'invt_new'
                })
            ],
            truncated: false
        });
        rerender({ enabled: false });
        rerender({ enabled: true });
        await waitFor(() =>
            expect(mediaMocks.collectInventoryItems).toHaveBeenCalledTimes(2)
        );

        expect(result.current.itemsBySlot.iconFrame[0]?.equipSlot).toBe('');
        expect(result.current.itemsBySlot.iconFrame[1]?.equipSlot).toBe(
            'iconFrame'
        );
    });

    it('rolls back the optimistic selection when the mutation fails', async () => {
        let rejectEquip: (() => void) | undefined;
        mediaMocks.collectInventoryItems.mockResolvedValueOnce({
            items: [
                equippableItem({
                    id: 'inv_old',
                    equipSlot: 'iconFrame',
                    templateId: 'invt_old'
                }),
                equippableItem({
                    id: 'inv_new',
                    templateId: 'invt_new'
                })
            ],
            truncated: false
        });
        mediaMocks.equipProfileDecoration.mockReturnValueOnce(
            new Promise((_, reject) => {
                rejectEquip = () => reject(new Error('equip failed'));
            })
        );
        const { result } = renderHook(() => useProfileDecorations());
        await waitFor(() => expect(result.current.isReady).toBe(true));

        act(() => {
            result.current.equipItem(result.current.itemsBySlot.iconFrame[1]);
        });
        expect(result.current.itemsBySlot.iconFrame[1]?.equipSlot).toBe(
            'iconFrame'
        );

        rejectEquip?.();
        await waitFor(() => expect(result.current.pendingKey).toBe(''));

        expect(result.current.itemsBySlot.iconFrame[0]?.equipSlot).toBe(
            'iconFrame'
        );
        expect(result.current.itemsBySlot.iconFrame[1]?.equipSlot).toBe('');
        expect(result.current.appearanceOverrides.iconFrame).toBeUndefined();
        expect(toastMocks.error).toHaveBeenCalledWith(
            expect.objectContaining({ type: 'error', title: 'equip failed' })
        );
    });

    it('optimistically unequips the current decoration', async () => {
        let resolveUnequip: (() => void) | undefined;
        mediaMocks.collectInventoryItems.mockResolvedValueOnce({
            items: [
                equippableItem({
                    equipSlot: 'iconFrame',
                    templateId: 'invt_frame'
                })
            ],
            truncated: false
        });
        mediaMocks.unequipProfileDecoration.mockReturnValueOnce(
            new Promise((resolve) => {
                resolveUnequip = () => resolve({ json: 'OK' });
            })
        );
        const { result } = renderHook(() => useProfileDecorations());
        await waitFor(() => expect(result.current.isReady).toBe(true));

        act(() => {
            result.current.unequipSlot('iconFrame');
        });

        expect(result.current.itemsBySlot.iconFrame[0]?.equipSlot).toBe('');
        expect(result.current.appearanceOverrides.iconFrame).toEqual({
            action: 'unequip'
        });

        resolveUnequip?.();
        await waitFor(() => expect(result.current.pendingKey).toBe(''));
    });

    it('does not commit a late mutation after the auth target changes', async () => {
        let resolveEquip: (() => void) | undefined;
        mediaMocks.collectInventoryItems.mockResolvedValueOnce({
            items: [
                equippableItem({
                    id: 'inv_new',
                    templateId: 'invt_new'
                })
            ],
            truncated: false
        });
        mediaMocks.equipProfileDecoration.mockReturnValueOnce(
            new Promise((resolve) => {
                resolveEquip = () => resolve({ json: { ok: true } });
            })
        );
        const onProfileUpdated = vi.fn();
        const { result, rerender } = renderHook(() =>
            useProfileDecorations({ onProfileUpdated })
        );
        await waitFor(() => expect(result.current.isReady).toBe(true));

        act(() => {
            result.current.equipItem(result.current.itemsBySlot.iconFrame[0]);
        });
        runtimeState.auth.currentUserId = 'usr_next';
        rerender();
        await waitFor(() => expect(result.current.isReady).toBe(true));

        resolveEquip?.();
        await waitFor(() => expect(result.current.pendingKey).toBe(''));

        expect(onProfileUpdated).not.toHaveBeenCalled();
        expect(result.current.itemsBySlot.iconFrame).toEqual([]);
        expect(result.current.appearanceOverrides).toEqual({});
    });
});
