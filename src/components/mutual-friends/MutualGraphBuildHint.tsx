import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import { MUTUAL_GRAPH_AUTO_FETCH_PARAM } from '@/lib/mutual-friends/mutualFriendsSettings';
import { cn } from '@/lib/utils';

export function MutualGraphBuildHint({
    className,
    onBeforeNavigate
}: {
    className?: string;
    onBeforeNavigate?: () => void;
}) {
    const { t } = useTranslation();
    const navigate = useNavigate();

    return (
        <button
            type="button"
            className={cn(
                'text-muted-foreground hover:text-foreground shrink-0 cursor-pointer text-xs underline-offset-2 hover:underline',
                className
            )}
            onClick={() => {
                onBeforeNavigate?.();
                navigate(`/charts/mutual?${MUTUAL_GRAPH_AUTO_FETCH_PARAM}=1`);
            }}
        >
            {t('mutual_graph_hint.build')}
        </button>
    );
}
