// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AppToastOptions } from '@/services/toastService';

const commandMocks = vi.hoisted(() => ({
    appVrchatGroupOrderGet: vi.fn(),
    appVrchatGroupOrderSet: vi.fn()
}));

const repositoryMocks = vi.hoisted(() => ({
    getUserGroups: vi.fn()
}));

const configMocks = vi.hoisted(() => ({
    getBool: vi.fn(),
    setBool: vi.fn()
}));

const runtimeState = vi.hoisted(() => ({
    auth: {
        currentUserId: 'usr_self'
    },
    gameState: {
        isGameRunning: false
    },
    hostCapabilities: {
        registryPrefs: {
            available: true,
            reason: ''
        }
    }
}));

const toastMocks = vi.hoisted(() => ({
    error: vi.fn()
}));

const translationMocks = vi.hoisted(() => ({
    t: (key: string) => key
}));

vi.mock('@/platform/tauri/bindings', () => ({
    commands: commandMocks
}));
vi.mock('@/repositories/groupProfileRepository', () => ({
    default: repositoryMocks
}));
vi.mock('@/repositories/configRepository', () => ({
    default: configMocks
}));
vi.mock('@/state/runtimeStore', () => ({
    useRuntimeStore: (selector: (state: typeof runtimeState) => unknown) =>
        selector(runtimeState)
}));
vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: translationMocks.t
    })
}));
vi.mock('@/services/toastService', () => ({
    toast: {
        add: (options: AppToastOptions) => {
            switch (options.type) {
                case 'error':
                    return toastMocks.error(options);
                default:
                    throw new Error('Unhandled toast type: ' + options.type);
            }
        }
    }
}));

import { groupIdForRow } from '@/components/dialogs/user-dialog/userDialogGroupRows';
import { useMyGroupsRevisionStore } from '@/state/myGroupsRevisionStore';

import { useMyGroupsPageState } from './useMyGroupsPageState';

const groups = [
    { id: 'grp_a', name: 'Alpha' },
    { id: 'grp_b', name: 'Beta' }
];

describe('useMyGroupsPageState', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        useMyGroupsRevisionStore.setState({ revision: 0 });
        runtimeState.auth.currentUserId = 'usr_self';
        runtimeState.gameState.isGameRunning = false;
        runtimeState.hostCapabilities.registryPrefs.available = true;
        runtimeState.hostCapabilities.registryPrefs.reason = '';
        repositoryMocks.getUserGroups.mockResolvedValue(groups);
        commandMocks.appVrchatGroupOrderGet.mockResolvedValue([
            'grp_b',
            'grp_a'
        ]);
        commandMocks.appVrchatGroupOrderSet.mockResolvedValue(true);
        configMocks.getBool.mockImplementation(
            async (_key: string, defaultValue: boolean) => defaultValue
        );
        configMocks.setBool.mockResolvedValue(null);
    });

    afterEach(cleanup);

    it('reloads fresh groups after a group changes outside the page', async () => {
        const { result } = renderHook(() => useMyGroupsPageState());
        await waitFor(() => {
            expect(result.current.visibleGroups).toHaveLength(2);
        });
        repositoryMocks.getUserGroups.mockResolvedValue([groups[1]]);

        act(() => {
            useMyGroupsRevisionStore.getState().bumpRevision();
        });

        await waitFor(() => {
            expect(result.current.visibleGroups.map(groupIdForRow)).toEqual([
                'grp_b'
            ]);
        });
        expect(repositoryMocks.getUserGroups).toHaveBeenLastCalledWith({
            userId: 'usr_self',
            force: true
        });
    });

    it('loads fresh groups when opened after a group changed elsewhere', async () => {
        useMyGroupsRevisionStore.getState().bumpRevision();

        const { result } = renderHook(() => useMyGroupsPageState());

        await waitFor(() => {
            expect(result.current.status).toBe('ready');
        });
        expect(repositoryMocks.getUserGroups).toHaveBeenCalledWith({
            userId: 'usr_self',
            force: true
        });
    });

    it('shows groups in the in-game order by default', async () => {
        const { result } = renderHook(() => useMyGroupsPageState());

        await waitFor(() => {
            expect(result.current.status).toBe('ready');
            expect(result.current.visibleGroups.map(groupIdForRow)).toEqual([
                'grp_b',
                'grp_a'
            ]);
        });

        expect(result.current.sort).toBe('inGame');
    });

    it('adopts the in-game order when registry capability finishes loading', async () => {
        runtimeState.hostCapabilities.registryPrefs.available = false;
        const { result, rerender } = renderHook(() => useMyGroupsPageState());

        await waitFor(() => {
            expect(result.current.status).toBe('ready');
        });
        expect(result.current.sort).toBe('alphabetical');

        runtimeState.hostCapabilities.registryPrefs.available = true;
        rerender();

        await waitFor(() => {
            expect(result.current.sort).toBe('inGame');
            expect(result.current.visibleGroups.map(groupIdForRow)).toEqual([
                'grp_b',
                'grp_a'
            ]);
        });
    });

    it('uses edit mode as the only reorder mode', async () => {
        const { result } = renderHook(() => useMyGroupsPageState());

        await waitFor(() => {
            expect(result.current.status).toBe('ready');
        });
        expect(result.current.orderEditable).toBe(false);

        act(() => result.current.enterEditMode());
        expect(result.current.orderEditable).toBe(true);

        act(() => result.current.exitEditMode());
        expect(result.current.orderEditable).toBe(false);
    });

    it('persists the order produced by a completed drag', async () => {
        commandMocks.appVrchatGroupOrderGet.mockResolvedValue([
            'grp_a',
            'grp_b'
        ]);
        const { result } = renderHook(() => useMyGroupsPageState());

        await waitFor(() => {
            expect(result.current.visibleGroups.map(groupIdForRow)).toEqual([
                'grp_a',
                'grp_b'
            ]);
        });

        act(() => result.current.enterEditMode());
        await act(async () => {
            await result.current.moveGroup('grp_b', 'grp_a');
        });

        expect(commandMocks.appVrchatGroupOrderSet).toHaveBeenCalledWith([
            'grp_b',
            'grp_a'
        ]);
        expect(result.current.visibleGroups.map(groupIdForRow)).toEqual([
            'grp_b',
            'grp_a'
        ]);
    });

    it('splits own and joined groups into sections', async () => {
        repositoryMocks.getUserGroups.mockResolvedValue([
            { id: 'grp_a', name: 'Alpha', ownerId: 'usr_self' },
            { id: 'grp_b', name: 'Beta', ownerId: 'usr_other' }
        ]);
        const { result } = renderHook(() => useMyGroupsPageState());

        await waitFor(() => {
            expect(
                result.current.sections.map((section) => ({
                    key: section.key,
                    ids: section.groups.map(groupIdForRow)
                }))
            ).toEqual([
                { key: 'own', ids: ['grp_a'] },
                { key: 'joined', ids: ['grp_b'] }
            ]);
        });
    });

    it('restores and persists collapsed sections', async () => {
        configMocks.getBool.mockImplementation(async (key: string) =>
            key === 'VRCX_MyGroupsJoinedSectionOpen' ? false : true
        );
        repositoryMocks.getUserGroups.mockResolvedValue([
            { id: 'grp_a', name: 'Alpha', ownerId: 'usr_self' },
            { id: 'grp_b', name: 'Beta', ownerId: 'usr_other' }
        ]);
        const { result } = renderHook(() => useMyGroupsPageState());

        const openState = () =>
            result.current.sections.map((section) => [
                section.key,
                section.open
            ]);

        await waitFor(() => {
            expect(openState()).toEqual([
                ['own', true],
                ['joined', false]
            ]);
        });

        act(() => result.current.toggleSection('own'));

        expect(configMocks.setBool).toHaveBeenCalledWith(
            'VRCX_MyGroupsOwnSectionOpen',
            false
        );
        expect(openState()).toEqual([
            ['own', false],
            ['joined', false]
        ]);
    });
});
