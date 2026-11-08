import { useState, type ReactNode } from 'react';

import {
    CustomBadgeChip,
    CustomBadgeFolder,
    DeveloperBadge,
    GlobalBadgeChip,
    VrchatStaffBadge
} from '@/components/UserBadges';
import type { CustomBadge } from '@/domain/badges/customBadges';
import {
    AWARD_ANIMATIONS,
    type ActiveAward
} from '@/domain/badges/globalBadges';
import { cn } from '@/lib/utils';
import {
    FORK_DEVELOPER_USER_ID,
    UPSTREAM_DEVELOPER_USER_ID
} from '@/shared/constants/user';

export type GalleryBadge = {
    id: string;
    label: string;
    award: (animation?: string) => ActiveAward;
    effects: string;
};

// Example custom badges; shields are reserved, so none of them uses one.
const EXAMPLE_CUSTOM: CustomBadge[] = [
    ['Artist', 'Brush', '#7c3aed'],
    ['DJ', 'Music', '#0891b2'],
    ['Event host', 'CalendarDays', '#f59e0b'],
    ['Close friend', 'Heart', '#e11d48'],
    ['Mod', 'Gavel', '#16a34a']
].map(([label, icon, color], index) => ({
    id: `example-${index}`,
    label,
    icon,
    color,
    enabled: true,
    rules: []
}));

const COMBINATIONS = [
    'embers wiggle',
    'sparkle glow',
    'flip shimmer',
    'embers glow flip'
];

function Row({
    title,
    note,
    children
}: {
    title: string;
    note?: string;
    children: ReactNode;
}) {
    return (
        <div
            className="grid items-center gap-4 border-b py-2.5 last:border-b-0"
            style={{ gridTemplateColumns: '12rem minmax(0, 1fr)' }}
        >
            <div className="min-w-0">
                <div className="text-sm font-medium">{title}</div>
                {note ? (
                    <div className="text-muted-foreground truncate text-xs">
                        {note}
                    </div>
                ) : null}
            </div>
            <div className="flex flex-wrap items-center gap-3">{children}</div>
        </div>
    );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
    return (
        <section className="flex flex-col gap-1">
            <h2 className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
                {title}
            </h2>
            <div className="rounded-lg border px-4">{children}</div>
        </section>
    );
}

// Every kind of badge the app draws, at both sizes, using the app's own
// components. Badge types come from the draft, so unsaved edits show here.
export function BadgeGallery({ badges }: { badges: readonly GalleryBadge[] }) {
    const [paused, setPaused] = useState(false);
    const sample = badges[0];
    return (
        <div className={cn('flex flex-col gap-6', paused && 'reduce-effects')}>
            <div className="flex items-center gap-3">
                <p className="text-muted-foreground text-sm">
                    Small badges in lists only animate while hovered, except the
                    developer badges.
                </p>
                <button
                    type="button"
                    className="ml-auto rounded-md border px-3 py-1 text-sm"
                    aria-pressed={paused}
                    onClick={() => setPaused((value) => !value)}
                >
                    {paused ? 'Play effects' : 'Pause effects'}
                </button>
            </div>

            <Section title="Built-in badges">
                <Row title="Fork developer">
                    <DeveloperBadge
                        userId={FORK_DEVELOPER_USER_ID}
                        size="full"
                    />
                    <DeveloperBadge userId={FORK_DEVELOPER_USER_ID} />
                </Row>
                <Row title="Upstream developer">
                    <DeveloperBadge
                        userId={UPSTREAM_DEVELOPER_USER_ID}
                        size="full"
                    />
                    <DeveloperBadge userId={UPSTREAM_DEVELOPER_USER_ID} />
                </Row>
                <Row title="VRChat Staff">
                    <VrchatStaffBadge size="full" />
                    <VrchatStaffBadge />
                </Row>
            </Section>

            <Section title="Global badges, in file order">
                {badges.map((badge) => (
                    <Row
                        key={badge.id}
                        title={badge.label}
                        note={badge.effects}
                    >
                        <GlobalBadgeChip award={badge.award()} size="full" />
                        <GlobalBadgeChip award={badge.award()} />
                    </Row>
                ))}
            </Section>

            {sample ? (
                <Section title={`Each effect on ${sample.label}`}>
                    {AWARD_ANIMATIONS.map((effect) => (
                        <Row key={effect} title={effect}>
                            <GlobalBadgeChip
                                award={sample.award(effect)}
                                size="full"
                            />
                            <GlobalBadgeChip award={sample.award(effect)} />
                        </Row>
                    ))}
                    {COMBINATIONS.map((effects) => (
                        <Row key={effects} title={effects} note="combined">
                            <GlobalBadgeChip
                                award={sample.award(effects)}
                                size="full"
                            />
                            <GlobalBadgeChip award={sample.award(effects)} />
                        </Row>
                    ))}
                </Section>
            ) : null}

            <Section title="Custom badges (examples)">
                <Row title="With labels">
                    {EXAMPLE_CUSTOM.map((badge) => (
                        <CustomBadgeChip
                            key={badge.id}
                            badge={badge}
                            size="full"
                        />
                    ))}
                </Row>
                <Row title="Icons only">
                    {EXAMPLE_CUSTOM.map((badge) => (
                        <CustomBadgeChip key={badge.id} badge={badge} />
                    ))}
                </Row>
                <Row title="Folder" note="in lists, then full size">
                    <CustomBadgeFolder badges={EXAMPLE_CUSTOM} />
                    <CustomBadgeFolder badges={EXAMPLE_CUSTOM} size="full" />
                </Row>
            </Section>
        </div>
    );
}
