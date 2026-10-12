import { InfoIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
    commands,
    type FeedLoggerStatus,
    type FeedLoggerWebhookFormat
} from '@/platform/tauri/bindings';
import { toast } from '@/services/toastService';
import { Button } from '@/ui/shadcn/button';
import { Input } from '@/ui/shadcn/input';
import {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectTrigger,
    SelectValue
} from '@/ui/shadcn/select';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/shadcn/tooltip';

import {
    formatUnixTime,
    runThenRefreshStatus,
    type RunAction
} from './offlineRecordModel';
import { SectionTitle } from './SectionTitle';

function WebhookEventsInfo() {
    const { t } = useTranslation();
    const events = [
        'offline_record.webhook_events.login_stopped',
        'offline_record.webhook_events.two_factor',
        'offline_record.webhook_events.storage_failed',
        'offline_record.webhook_events.recovered',
        'offline_record.webhook_events.records_dropped'
    ];
    return (
        <Tooltip>
            <TooltipTrigger
                render={
                    <button
                        type="button"
                        aria-label={t('offline_record.webhook_events.title')}
                        className="text-muted-foreground hover:text-foreground inline-flex"
                    >
                        <InfoIcon className="size-3.5" />
                    </button>
                }
            />
            <TooltipContent className="flex max-w-xs flex-col gap-1.5 text-xs">
                <span className="font-medium">
                    {t('offline_record.webhook_events.title')}
                </span>
                <ul className="flex list-disc flex-col gap-1 pl-4">
                    {events.map((key) => (
                        <li key={key}>{t(key)}</li>
                    ))}
                </ul>
            </TooltipContent>
        </Tooltip>
    );
}

export function WebhookSection({
    status,
    busy,
    run
}: {
    status: FeedLoggerStatus;
    busy: boolean;
    run: RunAction;
}) {
    const { t } = useTranslation();
    const [editing, setEditing] = useState(false);
    const [url, setUrl] = useState('');
    const [format, setFormat] = useState<FeedLoggerWebhookFormat>(
        status.webhookFormat ?? 'discord'
    );
    const formatItems = [
        { value: 'discord', label: 'Discord' },
        { value: 'text', label: t('offline_record.webhook_format_text') }
    ];
    const formatLabel =
        formatItems.find((item) => item.value === status.webhookFormat)
            ?.label ?? '';
    const showForm = editing || !status.webhookConfigured;

    function sendTest() {
        void runThenRefreshStatus(run, async () => {
            await commands.appFeedLoggerTestWebhook();
            toast.add({
                type: 'success',
                title: t('offline_record.webhook_test_sent')
            });
        });
    }

    function save(nextUrl: string | null) {
        void runThenRefreshStatus(run, async () => {
            await commands.appFeedLoggerSetWebhook(nextUrl, format);
            setUrl('');
            setEditing(false);
        });
    }

    return (
        <section className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
                <div className="flex items-center gap-1.5">
                    <SectionTitle>{t('offline_record.webhook')}</SectionTitle>
                    <WebhookEventsInfo />
                </div>
                <p className="text-muted-foreground text-xs leading-relaxed">
                    {status.webhookConfigured && status.lastWebhookAt !== null
                        ? t('offline_record.webhook_last_sent', {
                              date: formatUnixTime(status.lastWebhookAt),
                              result: t(
                                  status.lastWebhookOk === false
                                      ? 'offline_record.webhook_result_failed'
                                      : 'offline_record.webhook_result_ok'
                              )
                          })
                        : t('offline_record.webhook_description')}
                </p>
            </div>
            {showForm ? (
                <div className="flex gap-2">
                    <Select
                        value={format}
                        items={formatItems}
                        onValueChange={(value) => {
                            if (value === 'discord' || value === 'text') {
                                setFormat(value);
                            }
                        }}
                    >
                        <SelectTrigger className="w-32 shrink-0">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectGroup>
                                {formatItems.map((item) => (
                                    <SelectItem
                                        key={item.value}
                                        value={item.value}
                                    >
                                        {item.label}
                                    </SelectItem>
                                ))}
                            </SelectGroup>
                        </SelectContent>
                    </Select>
                    <Input
                        aria-label={t('offline_record.webhook_url')}
                        placeholder="https://discord.com/api/webhooks/..."
                        value={url}
                        disabled={busy}
                        onChange={(event) => setUrl(event.target.value)}
                    />
                    <Button
                        type="button"
                        disabled={busy || !url.trim()}
                        onClick={() => save(url.trim())}
                    >
                        {t('common.actions.save')}
                    </Button>
                    {status.webhookConfigured ? (
                        <Button
                            type="button"
                            variant="ghost"
                            disabled={busy}
                            onClick={() => {
                                setUrl('');
                                setEditing(false);
                            }}
                        >
                            {t('common.actions.cancel')}
                        </Button>
                    ) : null}
                </div>
            ) : (
                <div className="flex items-center gap-2">
                    <div className="bg-muted/40 flex h-8 min-w-0 flex-1 items-center gap-2 rounded-lg border px-2.5">
                        <span className="text-muted-foreground shrink-0 text-xs">
                            {formatLabel}
                        </span>
                        <span className="truncate font-mono text-xs">
                            {status.webhookTarget}
                        </span>
                    </div>
                    <Button
                        type="button"
                        variant="outline"
                        disabled={busy}
                        onClick={() => {
                            setFormat(status.webhookFormat ?? 'discord');
                            setEditing(true);
                        }}
                    >
                        {t('offline_record.webhook_change')}
                    </Button>
                    <Button
                        type="button"
                        variant="outline"
                        disabled={busy}
                        onClick={sendTest}
                    >
                        {t('offline_record.webhook_test')}
                    </Button>
                    <Button
                        type="button"
                        variant="outline"
                        disabled={busy}
                        onClick={() => save(null)}
                    >
                        {t('offline_record.webhook_remove')}
                    </Button>
                </div>
            )}
        </section>
    );
}
