import type { TFunction } from 'i18next';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
    commands,
    type Reminder,
    type ReminderTrigger
} from '@/platform/tauri/bindings';
import { Button } from '@/ui/shadcn/button';

import { SettingsCard } from '../SettingsCard';

const P = 'view.settings.ai.reminders';

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function describeTrigger(trigger: ReminderTrigger, t: TFunction): string {
    switch (trigger.kind) {
        case 'friendOnline':
            return t(`${P}.trigger_online`, { name: trigger.displayName });
        case 'friendOffline':
            return t(`${P}.trigger_offline`, { name: trigger.displayName });
        case 'friendLocation':
            return trigger.worldId
                ? t(`${P}.trigger_location_world`, {
                      name: trigger.displayName,
                      world: trigger.worldId
                  })
                : t(`${P}.trigger_location`, { name: trigger.displayName });
        case 'playerJoined':
            return t(`${P}.trigger_joined`, { name: trigger.displayName });
        case 'time': {
            const at = new Date(trigger.at).toLocaleString();
            return trigger.repeatMinutes
                ? t(`${P}.trigger_time_repeat`, {
                      at,
                      minutes: trigger.repeatMinutes
                  })
                : t(`${P}.trigger_time`, { at });
        }
    }
}

// Fork: reminders created by the assistant (upstream #479). They fire through
// the normal notification filters (type "Assistant reminder"), chat closed or not.
export function SettingsRemindersCard() {
    const { t } = useTranslation();
    const [reminders, setReminders] = useState<Reminder[]>([]);
    const [error, setError] = useState('');

    useEffect(() => {
        let active = true;
        commands
            .appRemindersList()
            .then((result) => {
                if (active) setReminders(result);
            })
            .catch((cause) => {
                if (active) setError(errorMessage(cause));
            });
        return () => {
            active = false;
        };
    }, []);

    async function remove(id: string) {
        setError('');
        try {
            setReminders(await commands.appRemindersDelete(id));
        } catch (cause) {
            setError(errorMessage(cause));
        }
    }

    return (
        <SettingsCard
            cardId="ai.reminders"
            title={t(`${P}.title`)}
            description={t(`${P}.description`)}
        >
            <div className="space-y-2 text-sm">
                {!reminders.length ? (
                    <p className="text-muted-foreground">{t(`${P}.empty`)}</p>
                ) : null}
                {reminders.map((reminder) => (
                    <div
                        key={reminder.id}
                        className="flex items-start justify-between gap-2 rounded-md border p-2"
                    >
                        <div className="min-w-0 space-y-1">
                            <p className="break-words">{reminder.message}</p>
                            <p className="text-muted-foreground text-xs">
                                {describeTrigger(reminder.trigger, t)}
                                {reminder.recurring
                                    ? ` - ${t(`${P}.recurring`)}`
                                    : ''}
                                {reminder.fireCount
                                    ? ` - ${t(`${P}.fired`, {
                                          count: reminder.fireCount
                                      })}`
                                    : ''}
                            </p>
                        </div>
                        <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => void remove(reminder.id)}
                        >
                            {t(`${P}.delete`)}
                        </Button>
                    </div>
                ))}
                {error ? <p className="text-destructive">{error}</p> : null}
            </div>
        </SettingsCard>
    );
}
