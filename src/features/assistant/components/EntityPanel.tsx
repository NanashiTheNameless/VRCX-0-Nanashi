import { GlobeIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { UserHoverCardContent } from '@/components/user-hover-card/UserHoverCardContent';
import type { Entity } from '@/domain/assistant/types';
import { openWorldDialog } from '@/services/dialogService';
import { useAssistantChatStore } from '@/state/assistantChatStore';
import { ScrollArea } from '@/ui/shadcn/scroll-area';

const EMPTY: Entity[] = [];

export function EntityPanel() {
    const { t } = useTranslation();
    const entities = useAssistantChatStore((state) =>
        state.activeSessionId
            ? (state.surfacedEntitiesBySession[state.activeSessionId] ?? EMPTY)
            : EMPTY
    );

    return (
        <div className="flex h-full min-h-0 flex-col">
            <div className="text-muted-foreground px-3 py-2 text-xs font-medium tracking-wide uppercase">
                {t('assistant.entities_title')}
            </div>
            <ScrollArea className="min-h-0 flex-1">
                <div className="flex flex-col gap-2 p-2 pt-0">
                    {entities.length === 0 && (
                        <p className="text-muted-foreground px-2 py-6 text-center text-xs">
                            {t('assistant.entities_empty')}
                        </p>
                    )}
                    {entities.map((entity, index) => (
                        <div
                            key={entity.id}
                            className="animate-in fade-in slide-in-from-right-4 border-border/40 bg-card/40 w-72 max-w-full overflow-hidden rounded-lg border"
                            style={{ animationDelay: `${index * 60}ms` }}
                        >
                            {entity.kind === 'world' ? (
                                <button
                                    type="button"
                                    onClick={() =>
                                        openWorldDialog({
                                            worldId: entity.id
                                        })
                                    }
                                    className="flex w-full items-center gap-2 p-3 text-left text-sm hover:bg-(--state-hover-surface)"
                                >
                                    <GlobeIcon className="text-muted-foreground size-4" />
                                    <span className="truncate">
                                        {entity.displayName || entity.id}
                                    </span>
                                </button>
                            ) : (
                                <UserHoverCardContent userId={entity.id} />
                            )}
                        </div>
                    ))}
                </div>
            </ScrollArea>
        </div>
    );
}
