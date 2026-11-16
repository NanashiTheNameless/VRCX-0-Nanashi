import { CopyIcon, ExternalLinkIcon, GiftIcon, SearchIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { userFacingErrorMessage } from '@/lib/errorDisplay';
import vrchatMediaRepository from '@/repositories/vrchatMediaRepository';
import { copyTextToClipboard } from '@/services/clipboardService';
import {
    DEFAULT_CODE_SEARCH_QUERY,
    searchForCodes,
    type CodeSearchResult,
    type CodeSearchSettings
} from '@/services/codeSearchService';
import { openExternalLink } from '@/services/shellIntegrationService';
import { toast } from '@/services/toastService';
import { useModalStore } from '@/state/modalStore';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle
} from '@/ui/shadcn/dialog';
import { Input } from '@/ui/shadcn/input';
import { Spinner } from '@/ui/shadcn/spinner';

const T = 'view.tools.inventory.code_search';

/**
 * Results from the search engine the user chose, with words that look like
 * codes picked out. Nothing is redeemed without the user's confirmation.
 */
export function CodeSearchDialog({
    open,
    settings,
    onOpenChange
}: {
    open: boolean;
    settings: CodeSearchSettings;
    onOpenChange: (open: boolean) => void;
}) {
    const { t } = useTranslation();
    const [query, setQuery] = useState(DEFAULT_CODE_SEARCH_QUERY);
    const [results, setResults] = useState<CodeSearchResult[] | null>(null);
    const [searching, setSearching] = useState(false);
    const [error, setError] = useState('');
    const [redeeming, setRedeeming] = useState('');

    async function search() {
        const words = query.trim();
        if (!words) {
            return;
        }
        setSearching(true);
        setError('');
        try {
            setResults(await searchForCodes(settings, words));
        } catch (caught) {
            setResults(null);
            setError(userFacingErrorMessage(caught));
        } finally {
            setSearching(false);
        }
    }

    async function redeem(code: string) {
        const confirmed = await useModalStore.getState().confirm({
            title: t(`${T}.redeem_confirm_title`),
            description: t(`${T}.redeem_confirm_description`, { code }),
            confirmText: t('prompt.redeem.redeem'),
            cancelText: t('prompt.redeem.cancel')
        });
        if (!confirmed.ok) {
            return;
        }
        setRedeeming(code);
        try {
            await vrchatMediaRepository.redeemReward(code);
            toast.add({ type: 'success', title: t('prompt.redeem.success') });
        } catch (caught) {
            toast.add({ type: 'error', title: userFacingErrorMessage(caught) });
        } finally {
            setRedeeming('');
        }
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-2xl">
                <DialogHeader>
                    <DialogTitle>{t(`${T}.header`)}</DialogTitle>
                    <DialogDescription>
                        {t(`${T}.description`)}
                    </DialogDescription>
                </DialogHeader>
                <form
                    className="flex items-center gap-2"
                    onSubmit={(event) => {
                        event.preventDefault();
                        void search();
                    }}
                >
                    <Input
                        value={query}
                        maxLength={200}
                        disabled={searching}
                        onChange={(event) => setQuery(event.target.value)}
                    />
                    <Button type="submit" disabled={searching || !query.trim()}>
                        {searching ? (
                            <Spinner data-icon="inline-start" />
                        ) : (
                            <SearchIcon data-icon="inline-start" />
                        )}
                        {t(`${T}.search`)}
                    </Button>
                </form>
                <div className="max-h-[55vh] min-h-24 overflow-y-auto">
                    {error ? (
                        <p className="text-destructive text-sm" role="alert">
                            {error}
                        </p>
                    ) : results === null ? (
                        <p className="text-muted-foreground text-sm">
                            {t(`${T}.hint`)}
                        </p>
                    ) : results.length === 0 ? (
                        <p className="text-muted-foreground text-sm">
                            {t(`${T}.no_results`)}
                        </p>
                    ) : (
                        results.map((result) => (
                            <div
                                key={result.url}
                                className="border-b py-2 last:border-b-0"
                            >
                                <button
                                    type="button"
                                    className="text-primary flex items-center gap-1 text-left text-sm font-medium hover:underline"
                                    onClick={() =>
                                        void openExternalLink(result.url)
                                    }
                                >
                                    <span className="truncate">
                                        {result.title}
                                    </span>
                                    <ExternalLinkIcon className="size-3.5 shrink-0" />
                                </button>
                                <p className="text-muted-foreground truncate text-xs">
                                    {result.url}
                                </p>
                                {result.snippet ? (
                                    <p className="mt-1 text-xs">
                                        {result.snippet}
                                    </p>
                                ) : null}
                                {result.codes.length ? (
                                    <div className="mt-2 flex flex-wrap items-center gap-2">
                                        <span className="text-muted-foreground text-xs">
                                            {t(`${T}.possible_codes`)}
                                        </span>
                                        {result.codes.map((code) => (
                                            <span
                                                key={code}
                                                className="inline-flex items-center gap-1"
                                            >
                                                <Badge
                                                    variant="outline"
                                                    className="font-mono"
                                                >
                                                    {code}
                                                </Badge>
                                                <Button
                                                    type="button"
                                                    variant="ghost"
                                                    size="icon-sm"
                                                    aria-label={t(
                                                        'common.actions.copy'
                                                    )}
                                                    title={t(
                                                        'common.actions.copy'
                                                    )}
                                                    onClick={() =>
                                                        void copyTextToClipboard(
                                                            code
                                                        )
                                                    }
                                                >
                                                    <CopyIcon />
                                                </Button>
                                                <Button
                                                    type="button"
                                                    variant="ghost"
                                                    size="icon-sm"
                                                    disabled={Boolean(
                                                        redeeming
                                                    )}
                                                    aria-label={t(
                                                        'prompt.redeem.redeem'
                                                    )}
                                                    title={t(
                                                        'prompt.redeem.redeem'
                                                    )}
                                                    onClick={() =>
                                                        void redeem(code)
                                                    }
                                                >
                                                    <GiftIcon />
                                                </Button>
                                            </span>
                                        ))}
                                    </div>
                                ) : null}
                            </div>
                        ))
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
}
