import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router';

import { preloadRouteChunks } from '@/app/routes';
import { SidePanel } from '@/components/sidebar/SidePanel';
import { cn } from '@/lib/utils';
import { restoreNormalWindowModeForIntent } from '@/services/windowModeService';
import { useShellStore } from '@/state/shellStore';

import { AppSidebar } from './AppSidebar';
import { AppStatusBar } from './AppStatusBar';
import { KeepAliveOutlet } from './KeepAliveOutlet';
import { useRightSidePanelVisibility } from './useRightSidePanelVisibility';

const sidePanelStorageKey = 'VRCX_0_RightSidebarWidth';

function getResponsiveSidePanelWidth(preferredWidth: number): string {
    return `max(var(--vrcx-0-side-panel-min-width), min(${preferredWidth}px, calc(100% - var(--vrcx-0-main-content-preferred-min-width) - var(--vrcx-0-side-panel-resizer-width))))`;
}

function clampSidePanelWidth(value: string | number | null) {
    const width = Number.parseInt(String(value ?? ''), 10);
    if (!Number.isFinite(width)) {
        return 320;
    }
    return Math.min(700, Math.max(240, width));
}

function loadSidePanelWidth() {
    return clampSidePanelWidth(localStorage.getItem(sidePanelStorageKey));
}

export function AppShellLayout() {
    const location = useLocation();
    const { sidePanelOpen } = useRightSidePanelVisibility(location.pathname);
    const sidebarWindowMode = useShellStore(
        (state) => state.windowDisplayMode === 'sidebar'
    );
    const [sidePanelWidth, setSidePanelWidth] = useState(loadSidePanelWidth);
    const sidePanelWidthRef = useRef(sidePanelWidth);
    const sidePanelElementRef = useRef<HTMLDivElement | null>(null);
    const resizeCleanupRef = useRef<((commit?: boolean) => void) | null>(null);
    const previousPathnameRef = useRef(location.pathname);
    const sidePanelVisible = sidebarWindowMode || sidePanelOpen;

    useEffect(() => {
        sidePanelWidthRef.current = sidePanelWidth;
    }, [sidePanelWidth]);

    // Fork: fetch the other pages' code in the background once the shell is
    // up, so the first visit to each page does not wait on it.
    useEffect(() => {
        const timer = window.setTimeout(preloadRouteChunks, 3000);
        return () => window.clearTimeout(timer);
    }, []);

    useEffect(() => {
        localStorage.setItem(sidePanelStorageKey, String(sidePanelWidth));
    }, [sidePanelWidth]);

    useEffect(() => {
        return () => {
            resizeCleanupRef.current?.(false);
        };
    }, []);

    useEffect(() => {
        if (!sidePanelVisible || sidebarWindowMode) {
            resizeCleanupRef.current?.(false);
        }
    }, [sidePanelVisible, sidebarWindowMode]);

    useEffect(() => {
        const previousPathname = previousPathnameRef.current;
        previousPathnameRef.current = location.pathname;
        if (
            sidebarWindowMode &&
            previousPathname !== '/' &&
            previousPathname !== location.pathname
        ) {
            restoreNormalWindowModeForIntent();
        }
    }, [location.pathname, sidebarWindowMode]);

    function applySidePanelWidth(width: number) {
        const nextWidth = clampSidePanelWidth(width);
        sidePanelWidthRef.current = nextWidth;
        if (sidePanelElementRef.current) {
            sidePanelElementRef.current.style.width =
                getResponsiveSidePanelWidth(nextWidth);
        }
        return nextWidth;
    }

    function startSidePanelResize(event: React.PointerEvent<HTMLDivElement>) {
        event.preventDefault();
        const target = event.currentTarget;
        const pointerId = event.pointerId;
        try {
            target.setPointerCapture?.(pointerId);
        } catch {
            // Pointer capture can fail if the target is detached during resize.
        }
        const previousUserSelect = document.body.style.userSelect;
        const previousCursor = document.body.style.cursor;
        document.body.style.userSelect = 'none';
        document.body.style.cursor = 'col-resize';
        let cleanedUp = false;
        const panelRight =
            sidePanelElementRef.current?.getBoundingClientRect().right ??
            window.innerWidth;

        const handleMove = (moveEvent: PointerEvent) => {
            applySidePanelWidth(panelRight - moveEvent.clientX);
        };

        const cleanup = (commit = true) => {
            if (cleanedUp) {
                return;
            }
            cleanedUp = true;
            document.body.style.userSelect = previousUserSelect;
            document.body.style.cursor = previousCursor;
            window.removeEventListener('pointermove', handleMove);
            window.removeEventListener('pointerup', handleEnd);
            window.removeEventListener('pointercancel', handleEnd);
            window.removeEventListener('blur', handleEnd);
            try {
                target.releasePointerCapture?.(pointerId);
            } catch {
                // Releasing capture is best-effort after pointer cancellation.
            }
            resizeCleanupRef.current = null;
            if (commit) {
                const nextWidth = sidePanelWidthRef.current;
                setSidePanelWidth((currentWidth) =>
                    currentWidth === nextWidth ? currentWidth : nextWidth
                );
            }
        };
        const handleEnd = () => cleanup();

        resizeCleanupRef.current?.();
        window.addEventListener('pointermove', handleMove);
        window.addEventListener('pointerup', handleEnd);
        window.addEventListener('pointercancel', handleEnd);
        window.addEventListener('blur', handleEnd);
        resizeCleanupRef.current = cleanup;
        applySidePanelWidth(panelRight - event.clientX);
    }

    return (
        <div className="flex h-full min-h-0 w-full flex-col overflow-hidden">
            <div className="flex min-h-0 min-w-0 flex-1">
                <AppSidebar sidebarWindowMode={sidebarWindowMode}>
                    <div
                        data-vrcx-0-surface="main-shell"
                        className="vrcx-0-main-shell flex h-full min-h-0 min-w-0 flex-col overflow-hidden"
                    >
                        <div
                            data-vrcx-0-surface="workspace"
                            data-window-sidebar-mode={
                                sidebarWindowMode ? 'true' : undefined
                            }
                            className="vrcx-0-workspace flex min-h-0 min-w-0 flex-1 overflow-hidden"
                        >
                            <div
                                data-vrcx-0-surface="main-content"
                                className={cn(
                                    'vrcx-0-main-content flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden',
                                    sidebarWindowMode && 'hidden'
                                )}
                            >
                                <KeepAliveOutlet />
                            </div>
                            {sidePanelVisible ? (
                                <>
                                    {sidebarWindowMode ? null : (
                                        <div
                                            data-vrcx-0-resize="side-panel"
                                            className="z-20 w-(--vrcx-0-side-panel-resizer-width) shrink-0 cursor-ew-resize bg-transparent select-none"
                                            onPointerDown={startSidePanelResize}
                                        />
                                    )}
                                    <SidePanel
                                        ref={sidePanelElementRef}
                                        sidebarWindowMode={sidebarWindowMode}
                                        className={cn(
                                            'shrink-0',
                                            sidebarWindowMode && 'min-w-0'
                                        )}
                                        style={{
                                            width: sidebarWindowMode
                                                ? '100%'
                                                : getResponsiveSidePanelWidth(
                                                      sidePanelWidth
                                                  )
                                        }}
                                    />
                                </>
                            ) : null}
                        </div>
                    </div>
                </AppSidebar>
            </div>
            <AppStatusBar sidebarWindowMode={sidebarWindowMode} />
        </div>
    );
}
