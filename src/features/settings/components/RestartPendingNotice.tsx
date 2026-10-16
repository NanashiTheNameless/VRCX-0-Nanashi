import { RotateCwIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { restartApplication } from '@/services/shellIntegrationService';
import { useRestartPendingStore } from '@/state/restartPendingStore';
import { Alert, AlertAction, AlertDescription } from '@/ui/shadcn/alert';
import { Button } from '@/ui/shadcn/button';

export function RestartPendingNotice() {
    const { t } = useTranslation();
    const pending = useRestartPendingStore((state) => state.pending);

    if (!pending) {
        return null;
    }

    return (
        <Alert>
            <RotateCwIcon />
            <AlertDescription>
                {t('view.settings.restart_pending.description')}
            </AlertDescription>
            <AlertAction>
                <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => {
                        void restartApplication();
                    }}
                >
                    {t('view.settings.restart_pending.restart_now')}
                </Button>
            </AlertAction>
        </Alert>
    );
}
