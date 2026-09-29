import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import {
    REMINDERS_I18N,
    ReminderList,
    useReminders
} from '@/features/reminders/ReminderList';
import { Button } from '@/ui/shadcn/button';

import { SettingsCard } from '../SettingsCard';

// Fork: reminders live on their own page; Settings lists them with a link.
export function SettingsRemindersCard() {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const { reminders, remove, error } = useReminders();

    return (
        <SettingsCard
            cardId="ai.reminders"
            title={t(`${REMINDERS_I18N}.title`)}
            description={t(`${REMINDERS_I18N}.description`)}
            action={
                <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => navigate('/reminders')}
                >
                    {t('view.reminders.manage')}
                </Button>
            }
        >
            <ReminderList
                reminders={reminders}
                error={error}
                onDelete={(id) => void remove(id)}
            />
        </SettingsCard>
    );
}
