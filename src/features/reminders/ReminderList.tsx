import type { TFunction } from 'i18next';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { formatDateFilter } from '@/lib/dateTime';
import {
    commands,
    type Reminder,
    type ReminderTrigger
} from '@/platform/tauri/bindings';
import { Button } from '@/ui/shadcn/button';

// Fork: reminders from the assistant (upstream #479) or made by hand. They
// fire through the normal notification filters (type "Assistant reminder"),
// Social AI open or not.

export const REMINDERS_I18N = 'view.settings.ai.reminders';
const P = REMINDERS_I18N;

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

export function describeReminderTrigger(
    trigger: ReminderTrigger,
    t: TFunction
): string {
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
            const at = formatDateFilter(trigger.at, 'long');
            return trigger.repeatMinutes
                ? t(`${P}.trigger_time_repeat`, {
                      at,
                      minutes: trigger.repeatMinutes
                  })
                : t(`${P}.trigger_time`, { at });
        }
    }
}

/** The signed-in account's reminders, with delete. */
export function useReminders() {
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

    const remove = useCallback(async (id: string) => {
        setError('');
        try {
            setReminders(await commands.appRemindersDelete(id));
        } catch (cause) {
            setError(errorMessage(cause));
        }
    }, []);

    return { reminders, setReminders, remove, error };
}

export function ReminderList({
    reminders,
    error,
    onDelete
}: {
    reminders: Reminder[];
    error?: string;
    onDelete: (id: string) => void;
}) {
    const { t } = useTranslation();
    return (
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
                            {describeReminderTrigger(reminder.trigger, t)}
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
                        onClick={() => onDelete(reminder.id)}
                    >
                        {t(`${P}.delete`)}
                    </Button>
                </div>
            ))}
            {error ? <p className="text-destructive">{error}</p> : null}
        </div>
    );
}
