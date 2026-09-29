import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
    commands,
    type ScreenshotLibraryImage
} from '@/platform/tauri/bindings';
import {
    getCurrentScreenshotLibraryScanStatus,
    startScreenshotLibraryScan,
    subscribeScreenshotLibraryScanStatus
} from '@/services/screenshotLibraryScanService';

import {
    createWorldDialogRequestContext,
    isSameWorldDialogRequestContext
} from './worldDialogRequestContext';

export type WorldWorldScreenshots = ScreenshotLibraryImage[];

type ScreenshotScanStatus = Awaited<
    ReturnType<typeof commands.appGetScreenshotLibraryStatus>
>;

export function useWorldDialogScreenshots({
    active,
    endpoint,
    openNonce,
    worldId
}: {
    active: boolean;
    endpoint: string;
    openNonce: number;
    worldId: string;
}) {
    const { t } = useTranslation();
    const [screenshots, setScreenshots] = useState<WorldWorldScreenshots>([]);
    const [status, setStatus] = useState('idle');
    const [error, setError] = useState('');
    const [refreshToken, setRefreshToken] = useState(0);
    const forceRefreshRef = useRef(false);
    const activeContextRef = useRef(
        createWorldDialogRequestContext({ endpoint, openNonce, worldId })
    );

    function refresh() {
        forceRefreshRef.current = true;
        setRefreshToken((current) => current + 1);
    }

    useEffect(() => {
        setScreenshots([]);
        setStatus('idle');
        setError('');
    }, [worldId]);

    useEffect(() => {
        if (!active || !worldId) {
            return;
        }

        let mounted = true;
        let scanActive = false;
        let scanCompleted = false;
        let scanError = '';
        const requestContext = createWorldDialogRequestContext({
            endpoint,
            openNonce,
            worldId
        });
        activeContextRef.current = requestContext;
        const isCurrent = () =>
            mounted &&
            isSameWorldDialogRequestContext(
                activeContextRef.current,
                requestContext
            );

        const loadWorldScreenshots = async () => {
            try {
                const nextScreenshots =
                    await commands.appGetWorldScreenshots(worldId);
                if (!isCurrent()) {
                    return;
                }
                const screenshotList = Array.isArray(nextScreenshots)
                    ? nextScreenshots
                    : [];
                setScreenshots(screenshotList);
                if (scanError) {
                    setError(scanError);
                    setStatus(screenshotList.length ? 'ready' : 'error');
                    return;
                }
                setError('');
                setStatus('ready');
            } catch (loadError) {
                if (!isCurrent()) {
                    return;
                }
                setScreenshots([]);
                setError(
                    loadError instanceof Error
                        ? loadError.message
                        : t('dialog.world.screenshots.load_failed')
                );
                setStatus('error');
            }
        };

        const completeScan = (scanStatus: ScreenshotScanStatus) => {
            if (scanCompleted) {
                return;
            }
            scanActive = false;
            scanCompleted = true;
            if (scanStatus?.error) {
                scanError = scanStatus.error;
            }
            void loadWorldScreenshots();
        };

        const handleScanStatus = (scanStatus: ScreenshotScanStatus) => {
            if (!isCurrent()) {
                return;
            }
            if (scanStatus.error) {
                scanError = scanStatus.error;
            }
            if (scanStatus.running) {
                scanError = '';
                scanActive = true;
                scanCompleted = false;
                return;
            }
            if (scanActive) {
                completeScan(scanStatus);
            }
        };

        const unsubscribe =
            subscribeScreenshotLibraryScanStatus(handleScanStatus);
        setStatus('loading');
        setError('');
        const forceRefresh = forceRefreshRef.current;
        forceRefreshRef.current = false;

        const initializeScan = async () => {
            try {
                let currentStatus =
                    await getCurrentScreenshotLibraryScanStatus();
                if (!isCurrent()) {
                    return;
                }
                if (!currentStatus) {
                    currentStatus =
                        await getCurrentScreenshotLibraryScanStatus();
                    if (!isCurrent()) {
                        return;
                    }
                }
                if (currentStatus?.running) {
                    handleScanStatus(currentStatus);
                    return;
                }
                scanActive = true;
                const scanStatus =
                    await startScreenshotLibraryScan(forceRefresh);
                if (!isCurrent() || !scanStatus) {
                    return;
                }
                handleScanStatus(scanStatus);
                if (!scanStatus.running) {
                    completeScan(scanStatus);
                }
            } catch (scanFailure) {
                if (!isCurrent()) {
                    return;
                }
                setScreenshots([]);
                setError(
                    scanFailure instanceof Error
                        ? scanFailure.message
                        : t('dialog.world.screenshots.load_failed')
                );
                setStatus('error');
            }
        };
        void initializeScan();

        return () => {
            mounted = false;
            unsubscribe();
        };
    }, [active, endpoint, openNonce, refreshToken, t, worldId]);

    return { error, refresh, screenshots, status };
}
