import {
    useEffect,
    useRef,
    useState,
    type Dispatch,
    type RefObject,
    type SetStateAction
} from 'react';
import { useTranslation } from 'react-i18next';

import memoPersistenceRepository from '@/repositories/memoPersistenceRepository';
import vrchatToolsRepository from '@/repositories/vrchatToolsRepository';
import { toast } from '@/services/toastService';
import { useFriendRosterStore } from '@/state/friendRosterStore';

import { normalizeUserId } from './userProfileFields';
import type { UserDialogProfileRecord } from './useUserDialogProfileResource';

function createMemoDialogState() {
    return {
        open: false,
        targetUserId: '',
        targetEndpoint: '',
        targetLabel: '',
        originalNote: '',
        note: '',
        memo: '',
        saving: false
    };
}

type MemoDialogState = ReturnType<typeof createMemoDialogState>;

type UseUserDialogMemoStateProps = {
    activeUserTargetRef: RefObject<{ userId: string; endpoint?: string }>;
    currentEndpoint: string;
    normalizedUserId: string;
    profile: UserDialogProfileRecord | null;
    setBaseProfile: Dispatch<SetStateAction<UserDialogProfileRecord | null>>;
};

export function useUserDialogMemoState({
    activeUserTargetRef,
    currentEndpoint,
    normalizedUserId,
    profile,
    setBaseProfile
}: UseUserDialogMemoStateProps) {
    const { t } = useTranslation();
    const [memo, setMemo] = useState('');
    const [memoDialog, setMemoDialog] = useState(createMemoDialogState);
    const memoRevisionRef = useRef(0);

    useEffect(() => {
        let active = true;

        if (!normalizedUserId) {
            setMemo('');
            return () => {
                active = false;
            };
        }

        setMemo('');
        const revision = memoRevisionRef.current;
        memoPersistenceRepository
            .getUserMemo(normalizedUserId)
            .then((entry) => {
                if (active && memoRevisionRef.current === revision) {
                    setMemo(entry?.memo || '');
                }
            })
            .catch(() => {
                if (active && memoRevisionRef.current === revision) {
                    setMemo('');
                }
            });

        return () => {
            active = false;
        };
    }, [normalizedUserId]);

    async function editMemo() {
        const targetProfile = profile;
        const targetUserId = normalizeUserId(targetProfile?.id);
        if (!targetUserId) {
            return;
        }

        const originalNote = String(targetProfile?.note || '').slice(0, 256);
        setMemoDialog({
            ...createMemoDialogState(),
            open: true,
            targetUserId,
            targetEndpoint: currentEndpoint,
            targetLabel: targetProfile?.displayName || targetProfile?.id || '',
            originalNote,
            note: originalNote,
            memo
        });
    }

    async function saveMemoDialog() {
        const dialog = memoDialog;
        const targetUserId = normalizeUserId(dialog.targetUserId);
        const targetEndpoint = dialog.targetEndpoint;
        if (!targetUserId || dialog.saving) {
            return;
        }

        const nextNote = String(dialog.note || '').slice(0, 256);
        const nextMemoInput = String(dialog.memo || '');
        const noteChanged = nextNote !== dialog.originalNote;
        memoRevisionRef.current += 1;
        setMemoDialog((current: MemoDialogState) => ({
            ...current,
            saving: true
        }));
        const noteSave = noteChanged
            ? vrchatToolsRepository.saveUserNote({
                  targetUserId,
                  note: nextNote
              })
            : Promise.resolve();
        const [noteResult, memoResult] = await Promise.allSettled([
            noteSave,
            memoPersistenceRepository.saveUserMemo({
                userId: targetUserId,
                memo: nextMemoInput
            })
        ]);
        const nextMemo =
            memoResult.status === 'fulfilled'
                ? String(memoResult.value.memo || '')
                : memo;
        const savedFields = {
            ...(noteChanged && noteResult.status === 'fulfilled'
                ? { note: nextNote }
                : {}),
            ...(memoResult.status === 'fulfilled' ? { memo: nextMemo } : {})
        };
        const saveSucceeded =
            noteResult.status === 'fulfilled' &&
            memoResult.status === 'fulfilled';

        if (saveSucceeded) {
            setMemoDialog(createMemoDialogState());
        } else {
            setMemoDialog((current: MemoDialogState) => ({
                ...current,
                originalNote:
                    noteResult.status === 'fulfilled'
                        ? nextNote
                        : current.originalNote,
                memo:
                    memoResult.status === 'fulfilled' ? nextMemo : current.memo,
                saving: false
            }));
        }

        let error: unknown = null;
        if (noteResult.status === 'rejected') {
            error = noteResult.reason;
        } else if (memoResult.status === 'rejected') {
            error = memoResult.reason;
        }
        if (!saveSucceeded) {
            toast.add({
                type: 'error',
                title:
                    error instanceof Error
                        ? error.message
                        : t('dialog.user.toast.failed_to_save_memo')
            });
        }

        if (
            activeUserTargetRef.current.userId !== targetUserId ||
            activeUserTargetRef.current.endpoint !== targetEndpoint
        ) {
            return;
        }
        if (memoResult.status === 'fulfilled') {
            setMemo(nextMemo);
        }
        if (Object.keys(savedFields).length > 0) {
            setBaseProfile((currentProfile) =>
                normalizeUserId(currentProfile?.id) === targetUserId
                    ? {
                          ...currentProfile,
                          ...savedFields
                      }
                    : currentProfile
            );
            if (useFriendRosterStore.getState().friendsById[targetUserId]) {
                useFriendRosterStore.getState().applyFriendPatch({
                    userId: targetUserId,
                    patch: savedFields
                });
            }
        }

        if (saveSucceeded) {
            toast.add({
                type: 'success',
                title: nextMemo
                    ? t('dialog.user.toast.memo_saved')
                    : t('dialog.user.toast.memo_cleared')
            });
            return;
        }
    }

    return {
        editMemo,
        memo,
        memoDialog: {
            ...memoDialog,
            onOpenChange(open: boolean) {
                if (!open && !memoDialog.saving) {
                    setMemoDialog(createMemoDialogState());
                }
            },
            onCancel() {
                if (!memoDialog.saving) {
                    setMemoDialog(createMemoDialogState());
                }
            },
            onMemoChange(nextMemo: string) {
                setMemoDialog((current: MemoDialogState) => ({
                    ...current,
                    memo: nextMemo
                }));
            },
            onNoteChange(nextNote: string) {
                setMemoDialog((current: MemoDialogState) => ({
                    ...current,
                    note: nextNote.slice(0, 256)
                }));
            },
            onSave: saveMemoDialog
        }
    };
}
