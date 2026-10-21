import type { ComponentProps } from 'react';

import {
    instanceLanguageBadges,
    instanceLanguageRows
} from '@/components/instances/instanceLanguages';
import { LanguageCodeBadge } from '@/components/language/LanguageCodeBadge';
import { RegionCodeBadge } from '@/components/location/RegionCodeBadge';
import { LocationWorld } from '@/components/LocationWorld';
import { parseLocation } from '@/shared/utils/location';

import { useSpokenLanguageSelection } from '../useSpokenLanguageSelection';

const NO_LANGUAGE_KEYS: string[] = [];
const VISIBLE_LANGUAGE_BADGES = 3;

export function WorldInstanceRowTitle({
    location,
    displayName,
    languageSource,
    locationWorldProps
}: {
    location: string;
    displayName: string;
    languageSource: unknown;
    locationWorldProps: ComponentProps<typeof LocationWorld>;
}) {
    const { languageOptionsMap } = useSpokenLanguageSelection(NO_LANGUAGE_KEYS);
    const languageBadges = instanceLanguageBadges(
        instanceLanguageRows(
            languageSource,
            (key) => languageOptionsMap.get(key)?.value
        )
    );
    const visibleBadges = languageBadges.slice(0, VISIBLE_LANGUAGE_BADGES);
    const hiddenBadges = languageBadges.slice(VISIBLE_LANGUAGE_BADGES);

    return (
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <div className="flex min-w-0 items-center gap-2">
                <LocationWorld
                    {...locationWorldProps}
                    className="min-w-0 text-sm"
                />
                {visibleBadges.length ? (
                    <span className="ml-auto inline-flex shrink-0 items-center gap-1">
                        {visibleBadges.map((badge) => (
                            <LanguageCodeBadge
                                key={badge.code}
                                code={badge.code}
                                tooltip={badge.tooltip}
                            />
                        ))}
                        {hiddenBadges.length ? (
                            <LanguageCodeBadge
                                code={`+${hiddenBadges.length}`}
                                tooltip={hiddenBadges
                                    .map((badge) => badge.tooltip)
                                    .join(' · ')}
                            />
                        ) : null}
                    </span>
                ) : null}
            </div>
            {displayName ? (
                <div className="flex min-w-0 items-center">
                    <RegionCodeBadge
                        region={parseLocation(location).region}
                        className="invisible"
                    />
                    <span
                        className="text-muted-foreground truncate text-xs"
                        title={displayName}
                    >
                        {displayName}
                    </span>
                </div>
            ) : null}
        </div>
    );
}
