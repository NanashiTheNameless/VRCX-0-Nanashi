import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { commands } from '@/platform/tauri/bindings';
import { toast } from '@/services/toastService';
import { Button } from '@/ui/shadcn/button';

export function SafetyWatchButton({
    kind,
    id,
    label
}: {
    kind: 'group' | 'avatar';
    id: string;
    label: string;
}) {
    const { t } = useTranslation();
    const [enabled, setEnabled] = useState<boolean | null>(null);
    const identity = `${kind}:${id}`;
    const identityRef = useRef(identity);
    identityRef.current = identity;
    const [busy, setBusy] = useState(false);
    useEffect(() => {
        let active = true;
        setEnabled(null);
        commands
            .appSafetySettingsGet()
            .then((settings) => {
                if (active)
                    setEnabled(
                        (kind === 'group'
                            ? settings.groups
                            : settings.avatars
                        ).some((entry) => entry.id === id && entry.enabled)
                    );
            })
            .catch((error) => {
                if (active) toast.add({ type: 'error', title: String(error) });
            });
        return () => {
            active = false;
        };
    }, [kind, id]);
    async function toggle() {
        setBusy(true);
        try {
            await commands.appSafetyWatchSet(kind, id, label, !enabled);
            if (identityRef.current === identity) setEnabled(!enabled);
        } catch (error) {
            toast.add({ type: 'error', title: String(error) });
        } finally {
            setBusy(false);
        }
    }
    return (
        <>
            <Button
                variant="outline"
                size="sm"
                disabled={enabled === null || busy}
                aria-pressed={enabled === true}
                onClick={() => void toggle()}
            >
                {t(`view.settings.safety.${enabled ? 'unwatch' : 'watch'}`)}
            </Button>
            <SafetySourceBadge kind={kind} id={id} />
        </>
    );
}

export function SafetySourceBadge({
    kind,
    id
}: {
    kind: 'group' | 'avatar' | 'user';
    id: string;
}) {
    const { t } = useTranslation();
    const [sources, setSources] = useState<string[]>([]);
    useEffect(() => {
        let active = true;
        setSources([]);
        if (kind !== 'group' && id)
            commands
                .appSafetyEntrySources(kind, id)
                .then((value) => {
                    if (active) setSources(value);
                })
                .catch((error) => {
                    if (active)
                        toast.add({ type: 'error', title: String(error) });
                });
        return () => {
            active = false;
        };
    }, [kind, id]);
    return sources.length ? (
        <span
            role="status"
            className="text-destructive text-xs"
            title={sources.join(', ')}
        >
            {t('view.settings.safety.listed', { sources: sources.join(', ') })}
        </span>
    ) : null;
}
