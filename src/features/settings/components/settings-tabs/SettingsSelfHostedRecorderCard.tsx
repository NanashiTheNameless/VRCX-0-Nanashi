import { useTranslation } from 'react-i18next';

import { resolveOfflineRecordHealth } from '@/services/offlineRecordService';
import { useOfflineRecordStore } from '@/state/offlineRecordStore';
import { useRuntimeStore } from '@/state/runtimeStore';
import { Button } from '@/ui/shadcn/button';

import { SettingsCard } from '../SettingsCard';
import { Field } from '../SettingsField';

type SettingsSelfHostedRecorderCardProps = {
    historySyncEnabled: boolean;
};

export function SettingsSelfHostedRecorderCard({
    historySyncEnabled
}: SettingsSelfHostedRecorderCardProps) {
    const { t } = useTranslation();
    const currentUserId = useRuntimeStore((state) => state.auth.currentUserId);
    const setSystemHostOpen = useRuntimeStore(
        (state) => state.setSystemHostOpen
    );
    const probe = useOfflineRecordStore((state) => state.health);
    const health = resolveOfflineRecordHealth(probe, currentUserId);
    const unsynced =
        probe?.state === 'connected' ? probe.status.unsyncedFrames : 0;
    const blocked = historySyncEnabled && !health;

    let status = t('view.settings.history_sync.recorder_not_set_up');
    if (health) {
        status =
            health.level === 'ok' && unsynced > 0
                ? t('offline_record.status_unsynced', { count: unsynced })
                : t(health.messageKey);
    }

    return (
        <SettingsCard
            cardId="history-sync.recorder"
            title={t('offline_record.header')}
            description={t('offline_record.dialog_description')}
        >
            <p className="text-muted-foreground px-1 pb-2 text-sm">
                {t('view.settings.history_sync.recorder_not_preferred')}
            </p>
            <Field
                settingId="history-sync.recorder.status"
                label={t('view.settings.history_sync.recorder_status')}
                description={
                    blocked
                        ? t('view.settings.history_sync.recorder_blocked')
                        : status
                }
            >
                <Button
                    type="button"
                    variant="outline"
                    disabled={blocked}
                    onClick={() => setSystemHostOpen('offlineRecordOpen', true)}
                >
                    {t(
                        health
                            ? 'view.settings.history_sync.recorder_manage'
                            : 'view.settings.history_sync.recorder_set_up'
                    )}
                </Button>
            </Field>
        </SettingsCard>
    );
}
