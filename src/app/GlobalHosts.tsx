import { lazy } from 'react';

import { AppToaster } from '@/components/hosts/AppToaster';
import { BackgroundRouteResumeHost } from '@/components/hosts/BackgroundRouteResumeHost';
import { CommunityThemeSafetyHost } from '@/components/hosts/CommunityThemeSafetyHost';
import { CustomLocaleCompletenessHost } from '@/components/hosts/CustomLocaleCompletenessHost';
import { DialogHost } from '@/components/hosts/DialogHost';
import { FriendProfileLoadHost } from '@/components/hosts/FriendProfileLoadHost';
import { LinuxRenderingTrialHost } from '@/components/hosts/LinuxRenderingTrialHost';
import { ModalHost } from '@/components/hosts/ModalHost';
import { MountOnFirstOpen } from '@/components/hosts/MountOnFirstOpen';
import { PostUpdateChangelogToastHost } from '@/components/hosts/PostUpdateChangelogToastHost';
import { PreviousInstancesDialogHost } from '@/components/hosts/PreviousInstancesDialogHost';
import { SystemDialogsHost } from '@/components/hosts/SystemDialogsHost';
import { ToolsDialogsHost } from '@/components/hosts/ToolsDialogsHost';
import { PrivacyLockDialogHost } from '@/features/privacy-lock/PrivacyLockDialogHost';
import { PrivacyLockOverlay } from '@/features/privacy-lock/PrivacyLockOverlay';
import { CommunityThemeUpdateToastHost } from '@/features/themes/CommunityThemeUpdateToastHost';
import { useLaunchStore } from '@/state/launchStore';
import { usePreferencesStore } from '@/state/preferencesStore';
import { useVrcNotificationStore } from '@/state/vrcNotificationStore';

// These render nothing until first opened, so their code loads on demand.
// The assistant (off by default) loads once it is turned on and then stays,
// as before, so a turn in progress keeps receiving its events.
const AssistantDialogHost = lazy(() =>
    import('@/features/assistant/AssistantDialogHost').then((module) => ({
        default: module.AssistantDialogHost
    }))
);
const LaunchDialogHost = lazy(() =>
    import('@/components/hosts/LaunchDialogHost').then((module) => ({
        default: module.LaunchDialogHost
    }))
);
const VrcNotificationCenterHost = lazy(() =>
    import('@/features/notifications/VrcNotificationCenterHost').then(
        (module) => ({ default: module.VrcNotificationCenterHost })
    )
);

function LazyLaunchDialogHost() {
    const open = useLaunchStore((state) => Boolean(state.launchDialog.open));
    return (
        <MountOnFirstOpen open={open}>
            <LaunchDialogHost />
        </MountOnFirstOpen>
    );
}

function LazyVrcNotificationCenterHost() {
    const open = useVrcNotificationStore((state) => state.isCenterOpen);
    return (
        <MountOnFirstOpen open={open}>
            <VrcNotificationCenterHost />
        </MountOnFirstOpen>
    );
}

function LazyAssistantDialogHost() {
    const enabled = usePreferencesStore((state) => state.socialAiEnabled);
    return (
        <MountOnFirstOpen open={enabled}>
            <AssistantDialogHost />
        </MountOnFirstOpen>
    );
}

export function GlobalHosts() {
    return (
        <>
            <AppToaster />
            <CommunityThemeSafetyHost />
            <CommunityThemeUpdateToastHost />
            <BackgroundRouteResumeHost />
            <ModalHost />
            <DialogHost />
            <LinuxRenderingTrialHost />
            <FriendProfileLoadHost />
            <LazyVrcNotificationCenterHost />
            <PostUpdateChangelogToastHost />
            <CustomLocaleCompletenessHost />
            <LazyLaunchDialogHost />
            <PreviousInstancesDialogHost />
            <SystemDialogsHost />
            <ToolsDialogsHost />
            <LazyAssistantDialogHost />
            <PrivacyLockDialogHost />
            <PrivacyLockOverlay />
        </>
    );
}
