import { useEffect, useRef, useState } from 'react';

import userSessionRepository from '@/repositories/userSessionRepository';
import vrchatModerationRepository from '@/repositories/vrchatModerationRepository';
import { refreshModerationSync } from '@/services/moderationSyncService';
import { getVrchatUserModeration } from '@/services/shellIntegrationService';
import { useRuntimeStore } from '@/state/runtimeStore';

export type ModerationState = {
    block: boolean;
    mute: boolean;
};

export type ExtendedModerationState = {
    interactOff: boolean;
    muteChat: boolean;
};

export type AvatarOverrideState = {
    hideAvatar: boolean;
    showAvatar: boolean;
};

type UserDialogModerationStateOptions = {
    currentEndpoint?: string;
    currentUserId?: string | null;
    isTargetCurrentUser: boolean;
    normalizedCurrentUserId: string;
    normalizedUserId: string;
    reloadToken: number;
};

export function useUserDialogModerationState({
    currentEndpoint,
    currentUserId,
    isTargetCurrentUser,
    normalizedCurrentUserId,
    normalizedUserId,
    reloadToken
}: UserDialogModerationStateOptions) {
    const vrchatPathDiscoveryAvailable = useRuntimeStore(
        (state) => state.hostCapabilities.vrchatPathDiscovery.available
    );
    const [moderationState, setModerationState] = useState<ModerationState>(
        () => ({
            block: false,
            mute: false
        })
    );
    const [extendedModerationState, setExtendedModerationState] = useState(
        (): ExtendedModerationState => ({
            interactOff: false,
            muteChat: false
        })
    );
    const [avatarOverrideState, setAvatarOverrideState] =
        useState<AvatarOverrideState>(() => ({
            hideAvatar: false,
            showAvatar: false
        }));
    const moderationRevisionRef = useRef(0);

    useEffect(() => {
        let active = true;

        if (!normalizedUserId) {
            setModerationState({ block: false, mute: false });
            return () => {
                active = false;
            };
        }

        const revision = moderationRevisionRef.current;
        const localModerationPromise = currentUserId
            ? userSessionRepository.ensureUserTables(currentUserId).then(() =>
                  vrchatModerationRepository.getLocalModeration({
                      ownerUserId: currentUserId,
                      userId: normalizedUserId
                  })
              )
            : vrchatModerationRepository.getLocalModeration({
                  ownerUserId: '',
                  userId: normalizedUserId
              });
        localModerationPromise
            .then((entry) => {
                if (active && moderationRevisionRef.current === revision) {
                    setModerationState({
                        block: Boolean(entry?.block),
                        mute: Boolean(entry?.mute)
                    });
                }
            })
            .catch(() => {
                if (active && moderationRevisionRef.current === revision) {
                    setModerationState({ block: false, mute: false });
                }
            });

        return () => {
            active = false;
        };
    }, [currentUserId, normalizedUserId, reloadToken]);

    useEffect(() => {
        let active = true;

        if (
            !normalizedUserId ||
            !normalizedCurrentUserId ||
            isTargetCurrentUser
        ) {
            setExtendedModerationState({ interactOff: false, muteChat: false });
            return () => {
                active = false;
            };
        }

        refreshModerationSync({
            userId: normalizedCurrentUserId,
            endpoint: currentEndpoint
        })
            .then((response) => {
                if (!active) {
                    return;
                }
                const rows = response.rows;
                setExtendedModerationState({
                    interactOff: rows.some(
                        (row) =>
                            row.targetUserId === normalizedUserId &&
                            row.type === 'interactOff'
                    ),
                    muteChat: rows.some(
                        (row) =>
                            row.targetUserId === normalizedUserId &&
                            row.type === 'muteChat'
                    )
                });
            })
            .catch(() => {
                if (active) {
                    setExtendedModerationState({
                        interactOff: false,
                        muteChat: false
                    });
                }
            });

        return () => {
            active = false;
        };
    }, [
        currentEndpoint,
        isTargetCurrentUser,
        normalizedCurrentUserId,
        normalizedUserId,
        reloadToken
    ]);

    useEffect(() => {
        let active = true;

        if (
            !normalizedUserId ||
            !normalizedCurrentUserId ||
            isTargetCurrentUser ||
            // Fork: the local override file is unreachable without VRChat path
            // discovery (e.g. Linux), so don't make a call that always fails.
            !vrchatPathDiscoveryAvailable
        ) {
            setAvatarOverrideState({ hideAvatar: false, showAvatar: false });
            return () => {
                active = false;
            };
        }

        getVrchatUserModeration(normalizedCurrentUserId, normalizedUserId)
            .then((value) => {
                if (!active) {
                    return;
                }
                setAvatarOverrideState({
                    hideAvatar: value === 4,
                    showAvatar: value === 5
                });
            })
            .catch(() => {
                if (active) {
                    setAvatarOverrideState({
                        hideAvatar: false,
                        showAvatar: false
                    });
                }
            });

        return () => {
            active = false;
        };
    }, [
        isTargetCurrentUser,
        normalizedCurrentUserId,
        normalizedUserId,
        reloadToken,
        vrchatPathDiscoveryAvailable
    ]);

    return {
        avatarOverrideState,
        extendedModerationState,
        moderationRevisionRef,
        moderationState,
        setAvatarOverrideState,
        setExtendedModerationState,
        setModerationState
    };
}
