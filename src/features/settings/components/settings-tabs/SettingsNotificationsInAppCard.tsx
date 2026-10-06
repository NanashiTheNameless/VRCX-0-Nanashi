import { useTranslation } from 'react-i18next';

import type { NotificationLayout } from '@/state/shellStore';
import {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectTrigger,
    SelectValue
} from '@/ui/shadcn/select';
import { Switch } from '@/ui/shadcn/switch';

import { SettingsCard } from '../SettingsCard';
import { Field } from '../SettingsField';

type SettingsNotificationsInAppCardProps = {
    prefs: {
        notificationLayout: string;
        notificationIconDot: boolean;
        taskbarIconDot: boolean;
        friendLogNotificationDot: boolean;
    };
    showTaskbarIconDot: boolean;
    notificationLayoutOptions: ReadonlyArray<readonly [string, string]>;
    onNotificationLayoutChange: (value: NotificationLayout) => void;
    onNotificationIconDotChange: (value: boolean) => void;
    onTaskbarIconDotChange: (value: boolean) => void;
    onFriendLogNotificationDotChange: (value: boolean) => void;
};

export function SettingsNotificationsInAppCard({
    prefs,
    showTaskbarIconDot,
    notificationLayoutOptions,
    onNotificationLayoutChange,
    onNotificationIconDotChange,
    onTaskbarIconDotChange,
    onFriendLogNotificationDotChange
}: SettingsNotificationsInAppCardProps) {
    const { t } = useTranslation();
    const notificationLayoutItems = notificationLayoutOptions.map(
        ([value, labelKey]) => ({
            value,
            label: t(labelKey)
        })
    );

    return (
        <SettingsCard
            cardId="notifications.in-app"
            title={t('view.settings.notifications.notifications.in_app.header')}
        >
            <Field
                label={t('view.settings.notifications.notifications.layout')}
                controlId="settings-notification-layout"
            >
                <Select
                    value={prefs.notificationLayout}
                    items={notificationLayoutItems}
                    onValueChange={(value) => {
                        if (
                            value === 'notification-center' ||
                            value === 'table'
                        ) {
                            onNotificationLayoutChange(value);
                        }
                    }}
                >
                    <SelectTrigger
                        id="settings-notification-layout"
                        className="w-56"
                    >
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectGroup>
                            {notificationLayoutItems.map(({ value, label }) => (
                                <SelectItem key={value} value={value}>
                                    {label}
                                </SelectItem>
                            ))}
                        </SelectGroup>
                    </SelectContent>
                </Select>
            </Field>

            <Field
                label={t(
                    'view.settings.appearance.appearance.show_notification_icon_dot'
                )}
            >
                <Switch
                    checked={prefs.notificationIconDot}
                    onCheckedChange={onNotificationIconDotChange}
                />
            </Field>

            {showTaskbarIconDot ? (
                <Field
                    label={t(
                        'view.settings.appearance.appearance.show_taskbar_icon_dot'
                    )}
                    description={t(
                        'view.settings.appearance.appearance.show_taskbar_icon_dot_description'
                    )}
                >
                    <Switch
                        checked={prefs.taskbarIconDot}
                        onCheckedChange={onTaskbarIconDotChange}
                    />
                </Field>
            ) : null}

            <Field
                label={t(
                    'view.settings.appearance.friend_log.show_notification_dot'
                )}
            >
                <Switch
                    checked={prefs.friendLogNotificationDot}
                    onCheckedChange={onFriendLogNotificationDotChange}
                />
            </Field>
        </SettingsCard>
    );
}
