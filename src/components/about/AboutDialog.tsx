import { CoffeeIcon, HeartIcon, type LucideIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

// Fork: wordmark font bundled locally (was loaded from Google Fonts at runtime).
import '@fontsource/jost/500.css';

import { cn } from '@/lib/utils';
import { openExternalLink } from '@/services/entityMediaService';
import { links } from '@/shared/constants/link';
import { formatReleaseDisplayVersion } from '@/shared/utils/releaseVersion';
import { useRuntimeStore } from '@/state/runtimeStore';
import { Avatar, AvatarFallback, AvatarImage } from '@/ui/shadcn/avatar';
import { Button } from '@/ui/shadcn/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogTitle
} from '@/ui/shadcn/dialog';
import { Skeleton } from '@/ui/shadcn/skeleton';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/shadcn/tooltip';

import {
    ABOUT_CREDITED_PEOPLE,
    useAboutContributors,
    type AboutContributor
} from './useAboutContributors';

const PLATFORM_LABELS: Record<string, string> = {
    windows: 'Windows',
    macos: 'macOS',
    linux: 'Linux'
};

type AboutActionLink = {
    key: string;
    label: string;
    href: string;
    icon: LucideIcon;
};

const SUPPORT_LINKS: AboutActionLink[] = [
    {
        key: 'github-sponsors',
        label: 'GitHub Sponsors',
        href: links.githubSponsors,
        icon: HeartIcon
    },
    {
        key: 'buymeacoffee',
        label: 'Buy Me a Coffee',
        href: links.buyMeACoffee,
        icon: CoffeeIcon
    },
    {
        key: 'kofi',
        label: 'Ko-fi',
        href: links.kofi,
        icon: CoffeeIcon
    },
    {
        key: 'liberapay',
        label: 'Liberapay',
        href: links.liberapay,
        icon: HeartIcon
    },
    {
        key: 'throne',
        label: 'Throne',
        href: links.throne,
        icon: HeartIcon
    }
];

function getAppDisplayVersion(): string {
    return formatReleaseDisplayVersion(VERSION || '') || String(VERSION || '');
}

function ContributorNode({
    contributor,
    index
}: {
    contributor: AboutContributor;
    index: number;
}) {
    const initials = contributor.login.slice(0, 2).toUpperCase();
    const [resolvedAvatarUrl, setResolvedAvatarUrl] = useState<string | null>(
        null
    );
    const imageReady = resolvedAvatarUrl === contributor.avatarUrl;
    const entranceDelayMs = Math.min(index * 30, 180);

    return (
        <Tooltip>
            <TooltipTrigger
                render={
                    <button
                        type="button"
                        aria-label={contributor.login}
                        className={cn(
                            'relative size-11 rounded-full transition-transform duration-150 ease-out hover:z-10 hover:scale-[1.07] active:scale-[0.98] motion-reduce:transition-none',
                            index % 2 === 1 && 'mt-1.5'
                        )}
                        onClick={() => {
                            openExternalLink(contributor.profileUrl);
                        }}
                    >
                        <Skeleton
                            aria-hidden="true"
                            className={cn(
                                'absolute inset-0 rounded-full transition-opacity duration-150',
                                imageReady && 'animate-none opacity-0'
                            )}
                        />
                        <Avatar
                            className={cn(
                                'size-11',
                                imageReady
                                    ? 'animate-in fade-in slide-in-from-bottom-2 fill-mode-both duration-200 ease-out motion-reduce:animate-none'
                                    : 'invisible'
                            )}
                            style={
                                imageReady
                                    ? {
                                          animationDelay: `${entranceDelayMs}ms`
                                      }
                                    : undefined
                            }
                        >
                            <AvatarImage
                                src={contributor.avatarUrl}
                                alt={contributor.login}
                                loading="eager"
                                onLoadingStatusChange={(status) => {
                                    if (
                                        status === 'loaded' ||
                                        status === 'error'
                                    ) {
                                        setResolvedAvatarUrl(
                                            contributor.avatarUrl
                                        );
                                    }
                                }}
                            />
                            <AvatarFallback>{initials}</AvatarFallback>
                        </Avatar>
                    </button>
                }
            />
            <TooltipContent>{contributor.login}</TooltipContent>
        </Tooltip>
    );
}

function AboutCreditedPeople() {
    const { t } = useTranslation();

    return (
        <div className="flex flex-wrap items-start justify-center gap-6">
            {ABOUT_CREDITED_PEOPLE.map((person, index) => (
                <div
                    key={person.login}
                    className="flex flex-col items-center gap-1.5"
                >
                    <ContributorNode contributor={person} index={index * 2} />
                    <span className="text-foreground/85 text-xs font-medium">
                        {person.login}
                    </span>
                    <span className="text-muted-foreground/75 text-[10px] font-medium tracking-[0.12em] uppercase">
                        {t(`view.about.role.${person.role}`)}
                    </span>
                </div>
            ))}
        </div>
    );
}

function AboutContributorsWall({ open }: { open: boolean }) {
    const { t } = useTranslation();
    const contributorsQuery = useAboutContributors(open);
    const contributors = contributorsQuery.data ?? [];

    return (
        <div className="flex min-h-11 flex-wrap items-start justify-center gap-2">
            {contributorsQuery.isPending
                ? Array.from({ length: 10 }, (_, index) => (
                      <Skeleton
                          key={index}
                          className={cn(
                              'size-11 rounded-full',
                              index % 2 === 1 && 'mt-1.5'
                          )}
                      />
                  ))
                : null}
            {contributorsQuery.isError ? (
                <p className="text-muted-foreground self-center text-xs">
                    {t('view.about.contributors_error')}
                </p>
            ) : null}
            {contributors.map((contributor, index) => (
                <ContributorNode
                    key={contributor.login}
                    contributor={contributor}
                    index={index}
                />
            ))}
        </div>
    );
}

export function AboutVrcxDialog({
    open,
    onOpenChange,
    onOpenLicenses
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onOpenLicenses: () => void;
}) {
    const { t } = useTranslation();
    const hostPlatform = useRuntimeStore(
        (state) => state.hostCapabilities.platform
    );

    const displayVersion = getAppDisplayVersion();
    const platformLabel = PLATFORM_LABELS[hostPlatform] || '';

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent
                showCloseButton={false}
                className="gap-0 px-7 pt-8 pb-6 sm:max-w-[560px]"
            >
                <div className="flex flex-col items-center text-center">
                    <DialogTitle
                        className="text-4xl leading-none font-medium tracking-normal select-none"
                        style={{ fontFamily: "'Jost', var(--font-sans)" }}
                    >
                        VRCX-0-Nanashi
                    </DialogTitle>
                    <DialogDescription className="mt-3 text-[13px]">
                        {t('view.about.tagline')}
                    </DialogDescription>
                    <div className="text-muted-foreground mt-3 inline-flex h-6 items-center justify-center gap-2 font-sans text-xs tracking-[0.01em]">
                        <span className="text-foreground/80 font-medium tabular-nums">
                            {displayVersion}
                        </span>
                        {platformLabel ? (
                            <>
                                <span
                                    aria-hidden="true"
                                    className="bg-muted-foreground/35 size-1 rounded-full"
                                />
                                <span>{platformLabel}</span>
                            </>
                        ) : null}
                    </div>
                </div>

                <section className="mt-5 flex flex-col items-center gap-3.5 text-center">
                    <AboutCreditedPeople />
                    <span className="text-muted-foreground/75 text-[10px] font-medium tracking-[0.18em] uppercase">
                        {t('view.about.contributors')}
                    </span>
                    <AboutContributorsWall open={open} />
                    <p className="text-muted-foreground/70 mx-auto max-w-sm text-xs text-balance">
                        {t('view.about.thanks')}
                    </p>
                </section>

                <div className="mt-6 flex flex-col items-center gap-3">
                    <span
                        id="about-support-title"
                        className="text-muted-foreground/60 text-[10px] font-medium tracking-[0.16em] uppercase"
                    >
                        {t('support_vrcx.title')}
                    </span>
                    <div
                        className="flex flex-wrap justify-center gap-2"
                        role="group"
                        aria-labelledby="about-support-title"
                    >
                        {SUPPORT_LINKS.map(
                            ({ key, label, href, icon: Icon }) => (
                                <Button
                                    key={key}
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    className="text-muted-foreground hover:text-foreground"
                                    onClick={() => {
                                        openExternalLink(href);
                                    }}
                                >
                                    <Icon data-icon="inline-start" />
                                    {label}
                                </Button>
                            )
                        )}
                    </div>
                </div>

                <div className="mt-6 flex flex-wrap items-center justify-between gap-2 border-t pt-4">
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="text-muted-foreground/70 hover:text-foreground h-7 px-2 text-[11.5px] font-medium"
                        onClick={() => {
                            openExternalLink(links.license);
                        }}
                    >
                        {t('view.about.license_line')}
                    </Button>
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="text-muted-foreground/70 hover:text-foreground h-7 px-2 text-[11.5px] font-medium"
                        onClick={onOpenLicenses}
                    >
                        {t('app_menu.open_source_licenses')}
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}
