import { ImageIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { FadeInImage } from '@/components/media/FadeInImage';

export type WorldHoverCardSeed = {
    name?: string;
    imageUrl?: string;
    authorName?: string;
    description?: string;
    capacity?: number;
};

export function WorldHoverCardContent({ seed }: { seed: WorldHoverCardSeed }) {
    const { t } = useTranslation();
    const name = seed.name?.trim() ?? '';
    const description = seed.description?.trim() ?? '';
    const authorName = seed.authorName?.trim() ?? '';

    return (
        <div className="flex flex-col">
            <div className="bg-muted flex aspect-[16/9] w-full items-center justify-center overflow-hidden">
                {seed.imageUrl ? (
                    <FadeInImage
                        src={seed.imageUrl}
                        alt=""
                        className="size-full object-cover"
                        fallback={
                            <ImageIcon className="text-muted-foreground size-6" />
                        }
                    />
                ) : (
                    <ImageIcon className="text-muted-foreground size-6" />
                )}
            </div>
            <div className="flex flex-col gap-1 p-3">
                <p className="text-foreground text-sm font-medium wrap-anywhere">
                    {name || t('dashboard.widget.unknown_world')}
                </p>
                {authorName ? (
                    <p className="text-muted-foreground text-xs wrap-anywhere">
                        {authorName}
                    </p>
                ) : null}
                {description ? (
                    <p className="text-muted-foreground mt-1 line-clamp-3 text-xs leading-relaxed">
                        {description}
                    </p>
                ) : null}
            </div>
        </div>
    );
}
