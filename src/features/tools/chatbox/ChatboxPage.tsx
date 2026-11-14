import { ExternalLinkIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { PageBody, PageScaffold } from '@/components/layout/PageScaffold';
import { ToolPageHeader } from '@/components/layout/ToolPageHeader';
import { commands } from '@/platform/tauri/bindings';
import { openExternalLink } from '@/services/entityMediaService';
import { useChatboxStore } from '@/state/chatboxStore';
import { Alert, AlertDescription, AlertTitle } from '@/ui/shadcn/alert';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';
import { Spinner } from '@/ui/shadcn/spinner';

import { chatboxStatusLabelKey } from './chatboxConfig';
import { ChatboxAfkCard } from './components/ChatboxAfkCard';
import { ChatboxComposer } from './components/ChatboxComposer';
import { ChatboxPagesCard } from './components/ChatboxPagesCard';
import { ChatboxPreviewCard } from './components/ChatboxPreviewCard';
import { ChatboxSettingsCard } from './components/ChatboxSettingsCard';
import { useChatboxController } from './useChatboxController';

export function ChatboxPage() {
    const { t } = useTranslation();
    const {
        config,
        meta,
        status,
        updateConfig: onUpdate
    } = useChatboxController();
    const receivedAt = useChatboxStore((state) => state.receivedAt);

    const header = (
        <ToolPageHeader
            toolKey="chatbox"
            status={
                status ? (
                    <Badge variant="secondary">
                        {t(chatboxStatusLabelKey(status))}
                    </Badge>
                ) : null
            }
        />
    );

    return (
        <PageScaffold className="chatbox-page flex-1">
            {header}
            <PageBody>
                <Alert
                    role="note"
                    className="border-primary/30 bg-primary/5 shrink-0"
                >
                    <AlertTitle>
                        {t('view.tools.chatbox.recommendation.title')}
                    </AlertTitle>
                    <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
                        <span className="min-w-0 flex-1 basis-64">
                            {t('view.tools.chatbox.recommendation.description')}
                        </span>
                        <Button
                            type="button"
                            size="sm"
                            onClick={() =>
                                void openExternalLink(
                                    'https://github.com/VolcanicArts/VRCOSC'
                                )
                            }
                        >
                            {t('view.tools.chatbox.recommendation.open')}
                            <ExternalLinkIcon data-icon="inline-end" />
                        </Button>
                    </AlertDescription>
                </Alert>
                {config && meta ? (
                    <div className="min-h-0 flex-1 overflow-y-auto">
                        <div className="flex flex-col gap-3 pb-3">
                            <div className="grid gap-3 lg:grid-cols-2">
                                <ChatboxPreviewCard
                                    status={status}
                                    receivedAt={receivedAt}
                                    maxChars={meta.limits.maxChars}
                                />
                                <ChatboxComposer
                                    maxChars={meta.limits.maxChars}
                                    maxQuickPhrases={
                                        meta.limits.maxQuickPhrases
                                    }
                                    quickPhrases={config.messages.quickPhrases}
                                    pauseReason={status?.pauseReason ?? null}
                                    onUpdate={onUpdate}
                                />
                            </div>
                            <div className="grid gap-3 lg:grid-cols-2">
                                <ChatboxAfkCard
                                    config={config}
                                    limits={meta.limits}
                                    status={status}
                                    onUpdate={onUpdate}
                                    onManualAfkChange={(afk) =>
                                        void commands.appChatboxAfkSet(afk)
                                    }
                                />
                                <ChatboxSettingsCard
                                    config={config}
                                    onUpdate={onUpdate}
                                />
                            </div>
                            <ChatboxPagesCard
                                config={config}
                                meta={meta}
                                activePageId={
                                    status?.activity === 'status'
                                        ? status.pageId
                                        : null
                                }
                                onUpdate={onUpdate}
                            />
                        </div>
                    </div>
                ) : (
                    <div className="flex flex-1 items-center justify-center">
                        <Spinner />
                    </div>
                )}
            </PageBody>
        </PageScaffold>
    );
}
