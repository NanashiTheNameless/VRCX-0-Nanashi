import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
    proxySettingsErrorMessage,
    saveProxySettingsPreferences,
    testProxySettings
} from '@/services/proxySettingsService';
import { toast } from '@/services/toastService';
import { usePreferencesStore } from '@/state/preferencesStore';
import { markRestartPending } from '@/state/restartPendingStore';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle
} from '@/ui/shadcn/dialog';

import { ProxySettingsEditor } from './ProxySettingsEditor';

type ProxySettingsDialogProps = {
    open: boolean;
    onOpenChange: (open: boolean) => void;
};

export function ProxySettingsDialog({
    open,
    onOpenChange
}: ProxySettingsDialogProps) {
    const { t } = useTranslation();
    const proxyEnabled = usePreferencesStore((state) => state.proxyEnabled);
    const proxyServer = usePreferencesStore((state) => state.proxyServer);
    const [draftEnabled, setDraftEnabled] = useState(proxyEnabled);
    const [draftServer, setDraftServer] = useState(proxyServer);
    const [saving, setSaving] = useState(false);
    const [testing, setTesting] = useState(false);

    useEffect(() => {
        if (open) {
            setDraftEnabled(proxyEnabled);
            setDraftServer(proxyServer);
        }
    }, [open, proxyEnabled, proxyServer]);

    async function save(restart: boolean) {
        setSaving(true);
        try {
            await saveProxySettingsPreferences(
                {
                    enabled: draftEnabled,
                    server: draftServer
                },
                { restart }
            );
            if (!restart) {
                markRestartPending();
                toast.add({
                    type: 'success',
                    title: t('prompt.proxy_settings.saved_restart_required')
                });
                onOpenChange(false);
            }
        } catch (error) {
            toast.add({
                type: 'error',
                title:
                    proxySettingsErrorMessage(error) ||
                    t('view.settings.toast.failed_to_save_proxy_settings')
            });
        } finally {
            setSaving(false);
        }
    }

    async function test() {
        setTesting(true);
        try {
            const result = await testProxySettings(draftServer);
            toast.add({
                type: 'success',
                title: t('prompt.proxy_settings.test_success', {
                    status: result.status
                })
            });
        } catch (error) {
            toast.add({
                type: 'error',
                title: t('prompt.proxy_settings.test_failed', {
                    message: proxySettingsErrorMessage(error)
                })
            });
        } finally {
            setTesting(false);
        }
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-lg">
                <DialogHeader>
                    <DialogTitle>
                        {t('prompt.proxy_settings.header')}
                    </DialogTitle>
                    <DialogDescription>
                        {t('prompt.proxy_settings.description')}
                    </DialogDescription>
                </DialogHeader>
                <ProxySettingsEditor
                    enabled={draftEnabled}
                    idPrefix="global-proxy-settings"
                    saving={saving}
                    server={draftServer}
                    testing={testing}
                    onEnabledChange={setDraftEnabled}
                    onSave={() => {
                        save(false);
                    }}
                    onSaveAndRestart={() => {
                        save(true);
                    }}
                    onServerChange={setDraftServer}
                    onTest={test}
                />
            </DialogContent>
        </Dialog>
    );
}
