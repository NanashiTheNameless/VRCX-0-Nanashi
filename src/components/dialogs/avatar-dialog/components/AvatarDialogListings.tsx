import { CheckIcon, ExternalLinkIcon, ImageIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import {
    economyImageUrl,
    listingPrice,
    listingTerm
} from '@/components/economy/economyDisplay';
import { useOwnedEconomyItems } from '@/components/economy/useOwnedEconomyItems';
import { FadeInImage } from '@/components/media/FadeInImage';
import type { EconomyListingRecord } from '@/repositories/vrchatEconomyRepository';
import { openExternalLink } from '@/services/entityMediaService';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';

import { EntityInfoBlock } from '../../EntityDialogScaffold';

export function AvatarDialogListings({
    listings,
    productId,
    avatarUrl
}: {
    listings: EconomyListingRecord[];
    productId: string;
    avatarUrl: string;
}) {
    const { t } = useTranslation();
    const owned = useOwnedEconomyItems(listings.length > 0);

    if (!listings.length) {
        return null;
    }

    return (
        <EntityInfoBlock label={t('dialog.avatar.info.listings')} full>
            <div className="flex flex-col gap-2">
                {listings.map((listing, index) => {
                    const listingId = listing.listingId || listing.id || '';
                    const isOwned =
                        (listingId && owned.listingIds.has(listingId)) ||
                        (productId && owned.productIds.has(productId));
                    const price = listingPrice(listing, t);
                    const imageUrl = economyImageUrl(
                        listing.imageUrl,
                        listing.imageId
                    );
                    return (
                        <div
                            key={listingId || index}
                            className="flex min-w-0 items-center gap-3 rounded-md border p-2"
                        >
                            <span className="bg-muted flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-md">
                                {imageUrl ? (
                                    <FadeInImage
                                        src={imageUrl}
                                        alt=""
                                        className="size-full object-cover"
                                    />
                                ) : (
                                    <ImageIcon className="text-muted-foreground size-5" />
                                )}
                            </span>
                            <span className="min-w-0 flex-1">
                                <span className="block truncate text-sm font-medium">
                                    {listing.displayName || listingId}
                                </span>
                                <span className="text-muted-foreground block text-xs">
                                    {listingTerm(listing, t)}
                                </span>
                                {listing.description ? (
                                    <span className="text-muted-foreground line-clamp-2 text-xs">
                                        {listing.description}
                                    </span>
                                ) : null}
                            </span>
                            <span className="flex shrink-0 flex-col items-end gap-1">
                                <span className="text-sm font-medium tabular-nums">
                                    {price.label}
                                </span>
                                {price.vrcPlusLabel ? (
                                    <span className="text-muted-foreground text-xs tabular-nums">
                                        {price.vrcPlusLabel}
                                    </span>
                                ) : null}
                                {isOwned ? (
                                    <Badge className="bg-emerald-500/15 text-emerald-400">
                                        <CheckIcon data-icon="inline-start" />
                                        {t('economy.owned')}
                                    </Badge>
                                ) : null}
                            </span>
                        </div>
                    );
                })}
                {avatarUrl ? (
                    <div className="flex justify-end">
                        <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => openExternalLink(avatarUrl)}
                        >
                            <ExternalLinkIcon data-icon="inline-start" />
                            {t('common.actions.view_on_website')}
                        </Button>
                    </div>
                ) : null}
            </div>
        </EntityInfoBlock>
    );
}
