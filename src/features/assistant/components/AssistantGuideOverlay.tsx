import { MessageCircleIcon, SparklesIcon } from 'lucide-react';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import { useSettingsHighlightStore } from '@/features/settings/settingsHighlightStore';
import { useAssistantChatStore } from '@/state/assistantChatStore';
import { Button } from '@/ui/shadcn/button';

import { useAssistantGuideStore } from '../assistantClientRequests';

// A settings deep link highlights the setting briefly; the guide keeps it
// highlighted once that fades, for as long as the guide is open.
const KEEP_HIGHLIGHT_AFTER_MS = 2100;

/**
 * Shown while the assistant points at a setting or a doc: opens it, keeps a
 * setting highlighted, and offers the way back to the conversation.
 */
export function AssistantGuideOverlay() {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const target = useAssistantGuideStore((state) => state.target);
    const clear = useAssistantGuideStore((state) => state.clear);
    const chatOpen = useAssistantChatStore((state) => state.open);

    useEffect(() => {
        if (!target) {
            return undefined;
        }
        navigate(target.path);
        const settingId = target.settingId;
        if (!settingId) {
            return undefined;
        }
        const timer = window.setTimeout(() => {
            useSettingsHighlightStore
                .getState()
                .setHighlightedSetting(settingId);
        }, KEEP_HIGHLIGHT_AFTER_MS);
        return () => {
            window.clearTimeout(timer);
            const highlight = useSettingsHighlightStore.getState();
            if (highlight.settingId === settingId) {
                highlight.setHighlightedSetting(null);
            }
        };
    }, [navigate, target]);

    useEffect(() => {
        if (chatOpen && target) {
            clear();
        }
    }, [chatOpen, clear, target]);

    if (!target || chatOpen) {
        return null;
    }

    return (
        <aside
            className="bg-popover text-popover-foreground fixed right-4 bottom-[calc(1rem+env(safe-area-inset-bottom,0px))] z-50 flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2 rounded-xl border border-amber-500/60 p-3 shadow-lg"
            aria-label={t('assistant.guide.title')}
        >
            <span className="text-muted-foreground flex items-center gap-1.5 text-xs font-medium">
                <SparklesIcon className="size-3.5" />
                {t('assistant.guide.title')}
            </span>
            <span className="text-sm font-semibold">{target.label}</span>
            <span className="text-muted-foreground text-xs">
                {target.location}
            </span>
            <div className="flex flex-wrap justify-end gap-2">
                <Button type="button" variant="ghost" size="sm" onClick={clear}>
                    {t('assistant.guide.dismiss')}
                </Button>
                <Button
                    type="button"
                    size="sm"
                    onClick={() => {
                        clear();
                        useAssistantChatStore.getState().setOpen(true);
                    }}
                >
                    <MessageCircleIcon />
                    {t('assistant.guide.back')}
                </Button>
            </div>
        </aside>
    );
}
