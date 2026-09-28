import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { commands } from '@/platform/tauri/bindings';
import avatarProfileRepository from '@/repositories/avatarProfileRepository';
import avatarSearchProviderRepository from '@/repositories/avatarSearchProviderRepository';
import { isAvatarSearchQueryLongEnough } from '@/shared/utils/avatarSearchQuery';
import { useModalStore } from '@/state/modalStore';
import { Button } from '@/ui/shadcn/button';

const P = 'view.settings.safety.instance_check';
/** Pause between provider searches so a check never floods the provider. */
const SEARCH_INTERVAL_MS = 2_000;
const MAX_NAMES = 40;

type ListedCandidate = { id: string; sources: string[] };
type CheckResult = {
    displayName: string;
    avatarName: string;
    candidates: number;
    listed: ListedCandidate[];
    blocked?: boolean;
};

function sleep(ms: number, signal: AbortSignal) {
    return new Promise<void>((resolve) => {
        const timer = window.setTimeout(resolve, ms);
        signal.addEventListener('abort', () => {
            window.clearTimeout(timer);
            resolve();
        });
    });
}

// Fork: on-demand check of the avatar names in the current instance against
// community avatar-ID lists. The log only has names, so names are resolved via
// the configured avatar search provider; blocking is offered only when exactly
// one exact-name result is on a list, and always asks first.
export function SettingsInstanceAvatarCheck() {
    const { t } = useTranslation();
    const [results, setResults] = useState<CheckResult[] | null>(null);
    const [progress, setProgress] = useState('');
    const [error, setError] = useState('');
    const [running, setRunning] = useState(false);
    const abort = useRef<AbortController | null>(null);

    async function check() {
        const controller = new AbortController();
        abort.current = controller;
        setRunning(true);
        setError('');
        setResults(null);
        try {
            const config = await avatarSearchProviderRepository.getConfig();
            if (!config.enabled || !config.activeProviders.length) {
                setError(t(`${P}.no_provider`));
                return;
            }
            const avatars = await commands.appSafetyInstanceAvatars();
            const byName = new Map<string, string[]>();
            for (const avatar of avatars) {
                const names = byName.get(avatar.avatarName) ?? [];
                names.push(avatar.displayName);
                byName.set(avatar.avatarName, names);
            }
            const names = [...byName.keys()]
                .filter((name) => isAvatarSearchQueryLongEnough(name))
                .slice(0, MAX_NAMES);
            if (!names.length) {
                setResults([]);
                return;
            }
            const found: CheckResult[] = [];
            for (const [index, avatarName] of names.entries()) {
                if (controller.signal.aborted) break;
                setProgress(
                    t(`${P}.progress`, { done: index, total: names.length })
                );
                if (index > 0) {
                    await sleep(SEARCH_INTERVAL_MS, controller.signal);
                }
                let candidates: { id: string; name?: string }[] = [];
                try {
                    const search = await avatarSearchProviderRepository.search({
                        providers: config.activeProviders,
                        query: avatarName
                    });
                    candidates = search.avatars.filter(
                        (avatar) =>
                            (avatar.name ?? '').trim().toLowerCase() ===
                            avatarName.trim().toLowerCase()
                    );
                } catch {
                    continue;
                }
                const listed: ListedCandidate[] = [];
                for (const candidate of candidates) {
                    const sources = await commands.appSafetyEntrySources(
                        'avatar',
                        candidate.id
                    );
                    if (sources.length) {
                        listed.push({ id: candidate.id, sources });
                    }
                }
                if (listed.length) {
                    found.push({
                        displayName: (byName.get(avatarName) ?? []).join(', '),
                        avatarName,
                        candidates: candidates.length,
                        listed
                    });
                }
            }
            setResults(found);
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : String(cause));
        } finally {
            setRunning(false);
            setProgress('');
            abort.current = null;
        }
    }

    async function block(result: CheckResult) {
        const [candidate] = result.listed;
        const confirmed = await useModalStore.getState().confirm({
            title: t(`${P}.block_title`),
            description: t(`${P}.block_description`, {
                name: result.avatarName,
                id: candidate.id,
                sources: candidate.sources.join(', ')
            }),
            confirmText: t(`${P}.block_confirm`),
            cancelText: t(`${P}.cancel`)
        });
        if (!confirmed.ok) return;
        try {
            await avatarProfileRepository.sendAvatarModeration({
                avatarId: candidate.id
            });
            setResults(
                (current) =>
                    current?.map((row) =>
                        row === result ? { ...row, blocked: true } : row
                    ) ?? null
            );
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : String(cause));
        }
    }

    return (
        <div className="space-y-2 rounded-md border p-3 text-sm">
            <p className="font-medium">{t(`${P}.header`)}</p>
            <p className="text-muted-foreground">{t(`${P}.description`)}</p>
            <div className="flex gap-2">
                <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={running}
                    onClick={() => void check()}
                >
                    {t(`${P}.check`)}
                </Button>
                {running ? (
                    <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => abort.current?.abort()}
                    >
                        {t(`${P}.cancel`)}
                    </Button>
                ) : null}
            </div>
            {progress ? (
                <p className="text-muted-foreground">{progress}</p>
            ) : null}
            {results && !results.length ? (
                <p className="text-muted-foreground">{t(`${P}.none`)}</p>
            ) : null}
            {results?.map((result) => (
                <div
                    key={`${result.avatarName}-${result.displayName}`}
                    className="space-y-1 rounded border p-2"
                >
                    <p>
                        {t(`${P}.match`, {
                            player: result.displayName,
                            name: result.avatarName
                        })}
                    </p>
                    {result.listed.map((candidate) => (
                        <p
                            key={candidate.id}
                            className="text-muted-foreground font-mono text-xs"
                        >
                            {candidate.id} ({candidate.sources.join(', ')})
                        </p>
                    ))}
                    {result.blocked ? (
                        <p>{t(`${P}.blocked`)}</p>
                    ) : result.listed.length === 1 ? (
                        <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => void block(result)}
                        >
                            {t(`${P}.block_button`)}
                        </Button>
                    ) : (
                        <p className="text-muted-foreground">
                            {t(`${P}.ambiguous`)}
                        </p>
                    )}
                </div>
            ))}
            {error ? <p className="text-destructive">{error}</p> : null}
        </div>
    );
}
