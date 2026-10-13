import { PictureInPicture2Icon } from 'lucide-react';
import { type ReactElement, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/utils';
import { commands } from '@/platform/tauri/bindings';
import { toast } from '@/services/toastService';
import { useRuntimeStore } from '@/state/runtimeStore';
import { Button } from '@/ui/shadcn/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/shadcn/tooltip';

import {
    STATUS_BAR_TOGGLE_ACTIVE,
    STATUS_BAR_TOGGLE_IDLE
} from './statusBarToggle';

export function DesktopWidgetToggle(): ReactElement | null {
    const { t } = useTranslation();
    const [updating, setUpdating] = useState(false);
    const supported = useRuntimeStore((state) => state.desktopWidget.supported);
    const enabled = useRuntimeStore((state) => state.desktopWidget.enabled);
    const clickThrough = useRuntimeStore(
        (state) => state.desktopWidget.clickThrough
    );
    if (!supported) {
        return null;
    }
    let tooltip = t('status_bar.desktop_widget_off');
    if (enabled) {
        tooltip = clickThrough
            ? t('status_bar.desktop_widget_click_through')
            : t('status_bar.desktop_widget_on');
    }

    async function toggle() {
        setUpdating(true);
        try {
            const snapshot =
                await commands.appDesktopWidgetEnabledSet(!enabled);
            useRuntimeStore.getState().setDesktopWidget(snapshot);
        } catch (error) {
            toast.add({
                type: 'error',
                title:
                    error instanceof Error
                        ? error.message
                        : t('status_bar.desktop_widget_failed')
            });
        } finally {
            setUpdating(false);
        }
    }

    return (
        <Tooltip>
            <TooltipTrigger
                render={
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={tooltip}
                        aria-pressed={enabled}
                        disabled={updating}
                        className={cn(
                            'size-6 shrink-0 rounded-none',
                            enabled
                                ? STATUS_BAR_TOGGLE_ACTIVE
                                : STATUS_BAR_TOGGLE_IDLE
                        )}
                        onClick={() => void toggle()}
                    >
                        <PictureInPicture2Icon data-icon="icon" />
                    </Button>
                }
            />
            <TooltipContent>{tooltip}</TooltipContent>
        </Tooltip>
    );
}
