import { beforeEach, describe, expect, it, vi } from 'vitest';

const { recordBrowseHistory } = vi.hoisted(() => ({
    recordBrowseHistory: vi.fn().mockResolvedValue(null)
}));

vi.mock('@/services/toastService', () => ({
    toast: { add: vi.fn() }
}));

vi.mock('@/services/i18nService', () => ({
    default: {
        t: (key: string) => key
    }
}));

vi.mock('@/services/userFactAccessService', () => ({
    recordUserProfile: vi.fn()
}));

vi.mock('@/platform/tauri/bindings', () => ({
    commands: {
        appBrowseHistoryRecord: recordBrowseHistory
    }
}));

vi.mock('@/state/runtimeStore', () => ({
    useRuntimeStore: {
        getState: () => ({
            auth: {
                currentUserId: 'usr_owner',
                currentUserEndpoint: 'https://api.vrchat.cloud/api/1'
            }
        })
    }
}));

import { useDialogStore } from '@/state/dialogStore';

import {
    openAvatarDialog,
    openUserDialog,
    openWorldDialog
} from './dialogService';

describe('dialogService entity trail', () => {
    beforeEach(() => {
        useDialogStore.getState().clearDialogState();
        recordBrowseHistory.mockClear();
    });

    it('records a visit from the shared four-entity open path', () => {
        openWorldDialog({
            worldId: 'wrld_w',
            title: 'World W',
            description: 'Author W',
            seedData: {
                id: 'wrld_w',
                name: 'World W',
                thumbnailImageUrl: 'https://example.com/world.png'
            }
        });

        expect(recordBrowseHistory).toHaveBeenCalledWith({
            ownerUserId: 'usr_owner',
            entityKind: 'world',
            entityId: 'wrld_w',
            title: 'World W',
            imageUrl: 'https://example.com/world.png',
            recordVisit: true
        });
    });

    it('truncates a dialog cycle when reopening an entity already in the trail', () => {
        openUserDialog({ userId: 'usr_a', title: 'User A' });
        openWorldDialog({ worldId: 'wrld_w', title: 'World W' });

        openUserDialog({ userId: 'usr_a', title: 'User A' });

        const state = useDialogStore.getState();
        expect(state.activeDialog).toMatchObject({
            kind: 'user',
            entityId: 'usr_a'
        });
        expect(state.breadcrumbs.map((crumb) => crumb.key)).toEqual([
            'user:usr_a'
        ]);
    });

    it('replaces the retained crumb with metadata from the latest open request', () => {
        openUserDialog({ userId: 'usr_a', title: 'User A' });
        openWorldDialog({ worldId: 'wrld_w', title: 'Old World' });
        openAvatarDialog({ avatarId: 'avtr_v', title: 'Avatar V' });

        openWorldDialog({
            worldId: 'wrld_w',
            title: 'Fresh World',
            seedData: { id: 'wrld_w', name: 'Fresh World' }
        });

        const state = useDialogStore.getState();
        expect(state.breadcrumbs.map((crumb) => crumb.key)).toEqual([
            'user:usr_a',
            'world:wrld_w'
        ]);
        expect(state.breadcrumbs.at(-1)).toMatchObject({
            title: 'Fresh World',
            payload: {
                seedData: { id: 'wrld_w', name: 'Fresh World' }
            }
        });
    });
});
