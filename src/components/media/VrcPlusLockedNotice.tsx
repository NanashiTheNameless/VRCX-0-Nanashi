import { LockIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Alert, AlertDescription, AlertTitle } from '@/ui/shadcn/alert';

export function VrcPlusLockedNotice({ className }: { className?: string }) {
    const { t } = useTranslation();

    return (
        <Alert className={className}>
            <LockIcon />
            <AlertTitle>{t('dialog.gallery_icons.locked_title')}</AlertTitle>
            <AlertDescription>
                {t('dialog.gallery_icons.locked_description')}
            </AlertDescription>
        </Alert>
    );
}
