import { lazy } from 'react';

import { MountOnFirstOpen } from '@/components/hosts/MountOnFirstOpen';
import { useAssistantChatStore } from '@/state/assistantChatStore';
import { usePreferencesStore } from '@/state/preferencesStore';

import { useAssistantEvents } from './useAssistantEvents';

const AssistantDialog = lazy(() =>
    import('./AssistantDialog').then((module) => ({
        default: module.AssistantDialog
    }))
);

export function AssistantDialogHost() {
    useAssistantEvents();
    const open = useAssistantChatStore((state) => state.open);
    const socialAiEnabled = usePreferencesStore(
        (state) => state.socialAiEnabled
    );
    return (
        <MountOnFirstOpen open={open && socialAiEnabled}>
            <AssistantDialog />
        </MountOnFirstOpen>
    );
}
