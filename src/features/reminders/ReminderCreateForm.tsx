import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
    commands,
    type Reminder,
    type ReminderTrigger
} from '@/platform/tauri/bindings';
import { toast } from '@/services/toastService';
import { useFriendRosterStore } from '@/state/friendRosterStore';
import { Button } from '@/ui/shadcn/button';
import {
    Combobox,
    ComboboxContent,
    ComboboxEmpty,
    ComboboxInput,
    ComboboxItem,
    ComboboxList
} from '@/ui/shadcn/combobox';
import { Input } from '@/ui/shadcn/input';
import { Label } from '@/ui/shadcn/label';
import {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectTrigger,
    SelectValue
} from '@/ui/shadcn/select';
import { Switch } from '@/ui/shadcn/switch';

import { REMINDERS_I18N as P } from './ReminderList';

export type ReminderKind = ReminderTrigger['kind'];

const KIND_LABEL_KEYS: Record<ReminderKind, string> = {
    friendOnline: `${P}.kind_friend_online`,
    friendOffline: `${P}.kind_friend_offline`,
    friendLocation: `${P}.kind_friend_location`,
    playerJoined: `${P}.kind_player_joined`,
    time: `${P}.kind_time`
};
const KINDS = Object.keys(KIND_LABEL_KEYS) as ReminderKind[];

export function isReminderKind(value: string): value is ReminderKind {
    return (KINDS as string[]).includes(value);
}

/** Values to start the form with, e.g. from an AI draft. */
export type ReminderFormInitial = {
    message?: string;
    kind?: ReminderKind;
    friendId?: string;
    worldId?: string;
    localTime?: string;
    repeatMinutes?: number;
    recurring?: boolean;
    /** Shown under the friend picker, e.g. when a name had no match. */
    friendHint?: string;
};

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

/** `datetime-local` value for a date, in local time. */
function toLocalInputValue(date: Date): string {
    const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
    return local.toISOString().slice(0, 16);
}

export function buildReminderTrigger(
    kind: ReminderKind,
    {
        friendId,
        friendName,
        worldId,
        localTime,
        repeatMinutes
    }: {
        friendId: string;
        friendName: string;
        worldId: string;
        localTime: string;
        repeatMinutes: number;
    }
): ReminderTrigger | null {
    if (kind === 'time') {
        const at = new Date(localTime);
        if (!localTime || Number.isNaN(at.getTime())) {
            return null;
        }
        return {
            kind,
            at: at.toISOString(),
            repeatMinutes: Math.max(0, Math.floor(repeatMinutes) || 0)
        };
    }
    if (!friendId) {
        return null;
    }
    const friend = { userId: friendId, displayName: friendName || friendId };
    return kind === 'friendLocation'
        ? { kind, ...friend, worldId: worldId.trim() }
        : { kind, ...friend };
}

// Fork: create reminders by hand, alongside the ones the assistant makes.
export function ReminderCreateForm({
    onCreated,
    initial = {}
}: {
    onCreated: (reminders: Reminder[]) => void;
    initial?: ReminderFormInitial;
}) {
    const { t } = useTranslation();
    const friendsById = useFriendRosterStore((state) => state.friendsById);
    const [message, setMessage] = useState(initial.message ?? '');
    const [kind, setKind] = useState<ReminderKind>(
        initial.kind ?? 'friendOnline'
    );
    const [friendId, setFriendId] = useState(initial.friendId ?? '');
    const [worldId, setWorldId] = useState(initial.worldId ?? '');
    const [localTime, setLocalTime] = useState(
        () =>
            initial.localTime ||
            toLocalInputValue(new Date(Date.now() + 60 * 60_000))
    );
    const [repeatMinutes, setRepeatMinutes] = useState(
        initial.repeatMinutes ?? 0
    );
    const [recurring, setRecurring] = useState(initial.recurring ?? false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');

    const friendIds = useMemo(
        () =>
            Object.keys(friendsById).sort((left, right) =>
                String(friendsById[left]?.displayName || left).localeCompare(
                    String(friendsById[right]?.displayName || right)
                )
            ),
        [friendsById]
    );
    const friendName = (id: string) =>
        String(friendsById[id]?.displayName || id);

    const trigger = buildReminderTrigger(kind, {
        friendId,
        friendName: friendName(friendId),
        worldId,
        localTime,
        repeatMinutes
    });
    const canCreate = Boolean(message.trim() && trigger) && !saving;

    async function create() {
        if (!trigger) {
            return;
        }
        setSaving(true);
        setError('');
        try {
            onCreated(
                await commands.appRemindersCreate(
                    message.trim(),
                    trigger,
                    kind !== 'time' && recurring
                )
            );
            setMessage('');
            toast.add({ type: 'success', title: t(`${P}.created`) });
        } catch (cause) {
            setError(errorMessage(cause));
        } finally {
            setSaving(false);
        }
    }

    return (
        <div className="space-y-3 rounded-md border p-3">
            <p className="text-sm font-medium">{t(`${P}.new`)}</p>
            <div className="grid gap-1.5">
                <Label htmlFor="reminder-message">{t(`${P}.message`)}</Label>
                <Input
                    id="reminder-message"
                    value={message}
                    maxLength={500}
                    placeholder={t(`${P}.message_placeholder`)}
                    onChange={(event) => setMessage(event.target.value)}
                />
            </div>
            <div className="grid gap-1.5">
                <Label htmlFor="reminder-kind">{t(`${P}.when`)}</Label>
                <Select
                    value={kind}
                    items={KINDS.map((value) => ({
                        value,
                        label: t(KIND_LABEL_KEYS[value])
                    }))}
                    onValueChange={(value) =>
                        setKind((value as ReminderKind | null) ?? 'time')
                    }
                >
                    <SelectTrigger id="reminder-kind" className="w-full">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectGroup>
                            {KINDS.map((value) => (
                                <SelectItem key={value} value={value}>
                                    {t(KIND_LABEL_KEYS[value])}
                                </SelectItem>
                            ))}
                        </SelectGroup>
                    </SelectContent>
                </Select>
            </div>
            {kind === 'time' ? (
                <div className="grid gap-3 sm:grid-cols-2">
                    <div className="grid gap-1.5">
                        <Label htmlFor="reminder-at">{t(`${P}.at`)}</Label>
                        <Input
                            id="reminder-at"
                            type="datetime-local"
                            value={localTime}
                            onChange={(event) =>
                                setLocalTime(event.target.value)
                            }
                        />
                    </div>
                    <div className="grid gap-1.5">
                        <Label htmlFor="reminder-repeat">
                            {t(`${P}.repeat_minutes`)}
                        </Label>
                        <Input
                            id="reminder-repeat"
                            type="number"
                            min={0}
                            value={repeatMinutes}
                            onChange={(event) =>
                                setRepeatMinutes(Number(event.target.value))
                            }
                        />
                    </div>
                </div>
            ) : (
                <>
                    <div className="grid gap-1.5">
                        <Label htmlFor="reminder-friend">
                            {t(`${P}.friend`)}
                        </Label>
                        <Combobox
                            items={friendIds}
                            value={friendId || null}
                            itemToStringLabel={friendName}
                            onValueChange={(value) =>
                                setFriendId((value as string | null) ?? '')
                            }
                        >
                            <ComboboxInput
                                id="reminder-friend"
                                className="w-full"
                                placeholder={t(`${P}.friend_placeholder`)}
                            />
                            <ComboboxContent>
                                <ComboboxEmpty>
                                    {t(`${P}.friend_empty`)}
                                </ComboboxEmpty>
                                <ComboboxList>
                                    {(id: string) => (
                                        <ComboboxItem key={id} value={id}>
                                            {friendName(id)}
                                        </ComboboxItem>
                                    )}
                                </ComboboxList>
                            </ComboboxContent>
                        </Combobox>
                        {initial.friendHint && !friendId ? (
                            <p className="text-muted-foreground text-xs">
                                {initial.friendHint}
                            </p>
                        ) : null}
                    </div>
                    {kind === 'friendLocation' ? (
                        <div className="grid gap-1.5">
                            <Label htmlFor="reminder-world">
                                {t(`${P}.world_id`)}
                            </Label>
                            <Input
                                id="reminder-world"
                                value={worldId}
                                placeholder={t(`${P}.world_id_placeholder`)}
                                onChange={(event) =>
                                    setWorldId(event.target.value)
                                }
                            />
                        </div>
                    ) : null}
                    <div className="flex items-center justify-between gap-3">
                        <Label htmlFor="reminder-recurring">
                            {t(`${P}.repeats`)}
                        </Label>
                        <Switch
                            id="reminder-recurring"
                            checked={recurring}
                            onCheckedChange={setRecurring}
                        />
                    </div>
                </>
            )}
            {error ? <p className="text-destructive text-sm">{error}</p> : null}
            <Button
                type="button"
                size="sm"
                disabled={!canCreate}
                onClick={() => void create()}
            >
                {t(`${P}.create`)}
            </Button>
        </div>
    );
}
