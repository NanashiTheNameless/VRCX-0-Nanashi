import { FolderPlusIcon, PlusIcon, RotateCcwIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/ui/shadcn/button';
import { DialogFooter } from '@/ui/shadcn/dialog';
import { Separator } from '@/ui/shadcn/separator';

type CustomNavDialogFooterProps = {
    onAddDashboard: () => void;
    onAddFolder: () => void;
    onCancel: () => void;
    onReset: () => void;
    onSave: () => void;
};

export function CustomNavDialogFooter({
    onAddDashboard,
    onAddFolder,
    onCancel,
    onReset,
    onSave
}: CustomNavDialogFooterProps) {
    const { t } = useTranslation();

    return (
        <DialogFooter className="bg-popover relative z-10 shrink-0 items-center justify-between sm:justify-between">
            <div className="flex flex-wrap gap-2">
                <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                        onAddFolder();
                    }}
                >
                    <FolderPlusIcon data-icon="inline-start" />
                    {t('nav_menu.custom_nav.new_folder')}
                </Button>
                <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                        onAddDashboard();
                    }}
                >
                    <PlusIcon data-icon="inline-start" />
                    {t('dashboard.new_dashboard')}
                </Button>
            </div>
            <div className="flex items-center gap-2">
                <Button
                    type="button"
                    variant="ghost"
                    className="text-muted-foreground"
                    onClick={onReset}
                >
                    <RotateCcwIcon data-icon="inline-start" />
                    {t('nav_menu.custom_nav.restore_default')}
                </Button>
                <Separator orientation="vertical" className="h-5" />
                <Button type="button" variant="secondary" onClick={onCancel}>
                    {t('nav_menu.custom_nav.cancel')}
                </Button>
                <Button
                    type="button"
                    onClick={() => {
                        onSave();
                    }}
                >
                    {t('common.actions.confirm')}
                </Button>
            </div>
        </DialogFooter>
    );
}
