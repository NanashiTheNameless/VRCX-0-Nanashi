import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { economyImageUrl } from '@/components/economy/economyDisplay';
import { FadeInImage } from '@/components/media/FadeInImage';
import vrchatEconomyRepository from '@/repositories/vrchatEconomyRepository';
import { rememberFailedFreeListings } from '@/services/freeStoreItemService';
import { setBoolConfigPreference } from '@/services/preferencesService';
import { toast } from '@/services/toastService';
import { useFreeStoreItemStore } from '@/state/freeStoreItemStore';
import { usePreferencesStore } from '@/state/preferencesStore';
import { useRuntimeStore } from '@/state/runtimeStore';
import { Button } from '@/ui/shadcn/button';
import { Checkbox } from '@/ui/shadcn/checkbox';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle
} from '@/ui/shadcn/dialog';
import { Spinner } from '@/ui/shadcn/spinner';

// VRCX's free store item prompt: nothing is claimed until the user asks.
export function FreeStoreItemDialog() {
    const { t } = useTranslation();
    const open = useFreeStoreItemStore((state) => state.open);
    const listings = useFreeStoreItemStore((state) => state.listings);
    const close = useFreeStoreItemStore((state) => state.close);
    const currentUserId = useRuntimeStore((state) => state.auth.currentUserId);
    const [dontShowAgain, setDontShowAgain] = useState(false);
    const [claiming, setClaiming] = useState(false);

    function finish() {
        if (dontShowAgain) {
            usePreferencesStore.setState({
                freeStoreItemNotifications: false
            });
            void setBoolConfigPreference(
                'freeStoreItemNotifications',
                false
            ).catch(() => {});
        }
        setDontShowAgain(false);
        close();
    }

    async function claimAll() {
        setClaiming(true);
        let claimed = 0;
        const failed: string[] = [];
        for (const listing of listings) {
            if (!listing.id) {
                continue;
            }
            try {
                await vrchatEconomyRepository.claimFreeListing(listing.id);
                claimed += 1;
            } catch (error) {
                console.warn('Failed to claim a free store item:', error);
                failed.push(listing.id);
            }
        }
        if (currentUserId) {
            await rememberFailedFreeListings(currentUserId, failed).catch(
                () => {}
            );
        }
        if (claimed > 0) {
            toast.add({
                type: 'success',
                title: t('dialog.free_store_item.claimed', { count: claimed })
            });
        }
        if (failed.length > 0) {
            toast.add({
                type: 'error',
                title: t('dialog.free_store_item.claim_failed', {
                    count: failed.length
                })
            });
        }
        setClaiming(false);
        finish();
    }

    return (
        <Dialog
            open={open}
            onOpenChange={(next) => {
                if (!next && !claiming) {
                    finish();
                }
            }}
        >
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>
                        {t('dialog.free_store_item.header')}
                    </DialogTitle>
                    <DialogDescription>
                        {t('dialog.free_store_item.description')}
                    </DialogDescription>
                </DialogHeader>
                <div className="flex max-h-[50vh] flex-col gap-2 overflow-y-auto">
                    {listings.map((listing) => {
                        const image = economyImageUrl(
                            typeof listing.imageUrl === 'string'
                                ? listing.imageUrl
                                : undefined,
                            typeof listing.imageId === 'string'
                                ? listing.imageId
                                : undefined
                        );
                        return (
                            <div
                                key={listing.id}
                                className="flex items-center gap-3"
                            >
                                {image ? (
                                    <FadeInImage
                                        src={image}
                                        alt=""
                                        className="size-12 shrink-0 rounded object-cover"
                                    />
                                ) : (
                                    <div className="bg-muted size-12 shrink-0 rounded" />
                                )}
                                <div className="min-w-0">
                                    <div className="truncate text-sm">
                                        {listing.displayName ?? listing.id}
                                    </div>
                                    {listing.subtitle ? (
                                        <div className="text-muted-foreground truncate text-xs">
                                            {listing.subtitle}
                                        </div>
                                    ) : null}
                                </div>
                            </div>
                        );
                    })}
                </div>
                <DialogFooter className="items-center">
                    <label className="mr-auto inline-flex items-center gap-2 text-sm">
                        <Checkbox
                            checked={dontShowAgain}
                            disabled={claiming}
                            onCheckedChange={(checked) =>
                                setDontShowAgain(checked === true)
                            }
                        />
                        {t('dialog.free_store_item.dont_show_again')}
                    </label>
                    <Button
                        type="button"
                        variant="secondary"
                        disabled={claiming}
                        onClick={finish}
                    >
                        {t('common.actions.close')}
                    </Button>
                    <Button
                        type="button"
                        disabled={claiming || listings.length === 0}
                        onClick={() => {
                            void claimAll();
                        }}
                    >
                        {claiming ? <Spinner data-icon="inline-start" /> : null}
                        {t('dialog.free_store_item.claim_all')}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
