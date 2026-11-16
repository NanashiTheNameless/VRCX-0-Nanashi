import { RefreshCwIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/utils';
import { checkFreeStoreItemsNow } from '@/services/freeStoreItemService';
import { toast } from '@/services/toastService';
import { useRuntimeStore } from '@/state/runtimeStore';
import { Button } from '@/ui/shadcn/button';

// Checks the VRChat store once, on click, whether or not the automatic check
// is on. Found items open the usual claim window.
export function FreeStoreItemCheckButton() {
    const { t } = useTranslation();
    const currentUserId = useRuntimeStore((state) => state.auth.currentUserId);
    const [checking, setChecking] = useState(false);

    async function check() {
        if (!currentUserId) {
            return;
        }
        setChecking(true);
        try {
            const found = await checkFreeStoreItemsNow(currentUserId);
            if (found === 0) {
                toast.add({
                    type: 'success',
                    title: t(
                        'view.settings.notifications.notifications.in_app.free_store_items_none'
                    )
                });
            }
        } catch (error) {
            toast.add({
                type: 'error',
                title: t(
                    'view.settings.notifications.notifications.in_app.free_store_items_failed',
                    {
                        error:
                            error instanceof Error
                                ? error.message
                                : String(error)
                    }
                )
            });
        } finally {
            setChecking(false);
        }
    }

    return (
        <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={checking || !currentUserId}
            onClick={() => {
                void check();
            }}
        >
            <RefreshCwIcon
                data-icon="inline-start"
                className={cn(checking && 'animate-spin')}
            />
            {t(
                'view.settings.notifications.notifications.in_app.free_store_items_check'
            )}
        </Button>
    );
}
