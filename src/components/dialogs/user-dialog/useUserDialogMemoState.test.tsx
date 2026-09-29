// @vitest-environment jsdom

import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AppToastOptions } from '@/services/toastService';

const mocks = vi.hoisted(() => ({
    getUserMemo: vi.fn(),
    saveUserMemo: vi.fn(),
    saveUserNote: vi.fn(),
    toastError: vi.fn(),
    toastSuccess: vi.fn()
}));

vi.mock('@/services/toastService', () => ({
    toast: {
        add: (options: AppToastOptions) => {
            switch (options.type) {
                case 'error':
                    return mocks.toastError(options);
                case 'success':
                    return mocks.toastSuccess(options);
                default:
                    throw new Error('Unhandled toast type: ' + options.type);
            }
        }
    }
}));

vi.mock('@/repositories/memoPersistenceRepository', () => ({
    default: {
        getUserMemo: mocks.getUserMemo,
        saveUserMemo: mocks.saveUserMemo
    }
}));

vi.mock('@/repositories/vrchatToolsRepository', () => ({
    default: {
        saveUserNote: mocks.saveUserNote
    }
}));

import { useFriendRosterStore } from '@/state/friendRosterStore';

import { useUserDialogMemoState } from './useUserDialogMemoState';

type HookProps = Parameters<typeof useUserDialogMemoState>[0];
type HookValue = ReturnType<typeof useUserDialogMemoState>;

function HookHarness({
    onValue,
    props
}: {
    onValue: (value: HookValue) => void;
    props: HookProps;
}) {
    onValue(useUserDialogMemoState(props));
    return null;
}

describe('useUserDialogMemoState', () => {
    let current: HookValue | null;

    function createProps(): HookProps {
        return {
            activeUserTargetRef: {
                current: {
                    userId: 'usr_friend',
                    endpoint: 'https://api.vrchat.cloud/api/1'
                }
            },
            currentEndpoint: 'https://api.vrchat.cloud/api/1',
            normalizedUserId: 'usr_friend',
            profile: {
                id: 'usr_friend',
                displayName: 'Friend User',
                note: 'Existing VRChat note'
            },
            setBaseProfile: vi.fn()
        };
    }

    beforeEach(() => {
        vi.clearAllMocks();
        current = null;
        mocks.getUserMemo.mockResolvedValue({
            userId: 'usr_friend',
            memo: 'Existing local note'
        });
        mocks.saveUserMemo.mockResolvedValue({
            userId: 'usr_friend',
            memo: 'Updated local note'
        });
        mocks.saveUserNote.mockResolvedValue(undefined);
        useFriendRosterStore.setState({
            applyFriendPatch: vi.fn(),
            friendsById: {}
        });
    });

    afterEach(() => {
        cleanup();
    });

    function value() {
        if (!current) {
            throw new Error('Hook value is unavailable.');
        }
        return current;
    }

    async function renderMemoState() {
        render(
            <HookHarness
                onValue={(nextValue) => {
                    current = nextValue;
                }}
                props={createProps()}
            />
        );

        await waitFor(() => {
            expect(value().memo).toBe('Existing local note');
        });
    }

    function editBothNotes() {
        act(() => {
            value().editMemo();
        });
        act(() => {
            value().memoDialog.onNoteChange('Updated VRChat note');
            value().memoDialog.onMemoChange('Updated local note');
        });
    }

    async function saveNotes() {
        await act(async () => {
            await value().memoDialog.onSave();
        });
    }

    it('saves both the edited VRChat note and the local memo', async () => {
        await renderMemoState();
        editBothNotes();
        await saveNotes();

        expect(mocks.saveUserNote).toHaveBeenCalledWith({
            targetUserId: 'usr_friend',
            note: 'Updated VRChat note'
        });
        expect(mocks.saveUserMemo).toHaveBeenCalledWith({
            userId: 'usr_friend',
            memo: 'Updated local note'
        });
    });

    it('saves the local memo when the VRChat note save fails', async () => {
        mocks.saveUserNote.mockRejectedValueOnce(
            new Error('VRChat note save failed')
        );
        await renderMemoState();
        editBothNotes();
        await saveNotes();

        expect(mocks.saveUserMemo).toHaveBeenCalledWith({
            userId: 'usr_friend',
            memo: 'Updated local note'
        });
        expect(value().memo).toBe('Updated local note');
        expect(value().memoDialog.open).toBe(true);
        expect(value().memoDialog.saving).toBe(false);
        expect(mocks.toastError).toHaveBeenCalledWith(
            expect.objectContaining({
                type: 'error',
                title: 'VRChat note save failed'
            })
        );
    });

    it('does not repeat a successful VRChat note save when the local memo is retried', async () => {
        mocks.saveUserMemo.mockRejectedValueOnce(
            new Error('Local memo save failed')
        );
        await renderMemoState();
        editBothNotes();
        await saveNotes();

        expect(value().memoDialog.open).toBe(true);
        expect(value().memoDialog.saving).toBe(false);
        expect(mocks.toastError).toHaveBeenCalledWith(
            expect.objectContaining({
                type: 'error',
                title: 'Local memo save failed'
            })
        );

        await saveNotes();

        expect(mocks.saveUserNote).toHaveBeenCalledTimes(1);
        expect(mocks.saveUserMemo).toHaveBeenCalledTimes(2);
        expect(value().memoDialog.open).toBe(false);
    });

    it('preserves current presence when saving a friend note', async () => {
        const applyFriendPatch = vi.fn();
        useFriendRosterStore.setState({
            applyFriendPatch,
            friendsById: {
                usr_friend: {
                    id: 'usr_friend',
                    displayName: 'Friend User',
                    tags: [],
                    state: 'online',
                    stateBucket: 'online',
                    $trustLevel: 'Visitor',
                    $friendNumber: 0,
                    $trustClass: 'x-tag-untrusted',
                    $trustSortNum: 0,
                    $isModerator: false,
                    $isTroll: false,
                    $isProbableTroll: false,
                    $platform: ''
                }
            }
        });
        const props = createProps();
        render(
            <HookHarness
                onValue={(nextValue) => {
                    current = nextValue;
                }}
                props={props}
            />
        );
        await waitFor(() => {
            expect(value().memo).toBe('Existing local note');
        });

        editBothNotes();
        await saveNotes();

        expect(applyFriendPatch).toHaveBeenCalledWith({
            userId: 'usr_friend',
            patch: {
                note: 'Updated VRChat note',
                memo: 'Updated local note',
                $nickName: 'Updated local note'
            },
            stateBucketAuthority: 'preserve'
        });
    });
});
