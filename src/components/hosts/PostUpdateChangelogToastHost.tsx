import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import {
    loadPostUpdateChangelogToastState,
    markPostUpdateChangelogVersionSeen,
    releaseNotesUrl
} from '@/services/changelogService';
import { openExternalLink } from '@/services/shellIntegrationService';
import { toast } from '@/services/toastService';
import { formatReleaseDisplayVersion } from '@/shared/utils/releaseVersion';
import { useRuntimeStore } from '@/state/runtimeStore';

export function PostUpdateChangelogToastHost(): null {
    const { t } = useTranslation();
    const hasCheckedRef = useRef(false);
    const backendRuntimeSnapshotHydrated = useRuntimeStore(
        (state) => state.shell.backendRuntimeSnapshotHydrated
    );

    useEffect(() => {
        if (!backendRuntimeSnapshotHydrated || hasCheckedRef.current) {
            return undefined;
        }

        hasCheckedRef.current = true;
        let cancelled = false;

        const run = async () => {
            try {
                const state = await loadPostUpdateChangelogToastState();
                if (cancelled || !state.shouldShow) {
                    return;
                }

                let seenRecorded = false;
                const recordSeen = () => {
                    if (seenRecorded) {
                        return;
                    }
                    seenRecorded = true;
                    markPostUpdateChangelogVersionSeen(
                        state.currentVersion
                    ).catch((error) => {
                        console.warn(
                            'Failed to record changelog toast state:',
                            error
                        );
                    });
                };
                const displayVersion =
                    formatReleaseDisplayVersion(state.currentVersion) ||
                    state.currentVersion;
                const toastId = toast.add({
                    type: 'info',
                    title: t('dialog.change_log.toast_title', {
                        value: displayVersion
                    }),
                    description: t('dialog.change_log.toast_description'),
                    timeout: 0,
                    position: 'bottom-right',
                    actionProps: {
                        children: t('dialog.change_log.view_changes'),
                        onClick: () => {
                            recordSeen();
                            toast.close(toastId);
                            void openExternalLink(
                                releaseNotesUrl(state.currentVersion)
                            );
                        }
                    },
                    onClose: recordSeen,
                    data: { closeButton: true }
                });
            } catch (error) {
                console.warn(
                    'Failed to show post-update changelog toast:',
                    error
                );
            }
        };

        run();

        return () => {
            cancelled = true;
        };
    }, [backendRuntimeSnapshotHydrated, t]);

    return null;
}
