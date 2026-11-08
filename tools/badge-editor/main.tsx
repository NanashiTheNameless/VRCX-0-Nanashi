import '@/styles/globals.css';
import '@/services/i18nService';
import {
    applyEdits,
    findNodeAtLocation,
    modify,
    parse,
    parseTree,
    type FormattingOptions,
    type ParseError
} from 'jsonc-parser';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';

import { AppProviders } from '@/app/providers/AppProviders';
import { BadgeIcon } from '@/components/badges/BadgeIcon';
import { loadBadgeIcons } from '@/components/badges/badgeIcons';
import { UserDialogHeaderSection } from '@/components/dialogs/user-dialog/components/UserDialogHeaderSection';
import type {
    UserHeaderCommands,
    UserHeaderModel
} from '@/components/dialogs/user-dialog/components/UserDialogHeaderSection';
import {
    GlobalBadgeChip,
    DeveloperBadge,
    UserBadges
} from '@/components/UserBadges';
import { UserDetailContent } from '@/components/UserDetailTile';
import {
    AWARD_ANIMATIONS,
    AWARD_ICONS,
    AWARD_STYLES,
    CUSTOM_AWARD_BADGE,
    activeAwardsFor,
    normalizeHexColor,
    parseAwardDate,
    validateGlobalBadgeFile,
    type ActiveAward,
    type GlobalBadgeCatalog,
    type GlobalBadgeDefinition
} from '@/domain/badges/globalBadges';
import { VRCHAT_STAFF_GROUP_ID } from '@/shared/constants/user';
import { computeTrustLevel } from '@/shared/utils/userTransforms';
import { useGlobalBadgeStore } from '@/state/globalBadgeStore';
import { recordUserGroups } from '@/state/userGroupMembershipStore';

type BadgeDraft = {
    id: string;
    label: string;
    description: string;
    icon: string;
    style: string;
    animation: string;
    colorFrom?: string;
    colorTo?: string;
    colorBorder?: string;
    colorText?: string;
};

type AwardDraft = {
    userId: string;
    badge: string;
    name?: string;
    reason?: string;
    // Epoch seconds; older hand-written files may hold date strings.
    since?: number | string | null;
    until?: number | string | null;
    // Per-person overrides; left out to use the badge type's values. For a
    // custom (one-off) award they are the whole badge.
    label?: string;
    description?: string;
    icon?: string;
    style?: string;
    animation?: string;
    colorFrom?: string;
    colorTo?: string;
    colorBorder?: string;
    colorText?: string;
};

const OVERRIDE_FIELDS = [
    'label',
    'description',
    'icon',
    'style',
    'animation',
    'colorFrom',
    'colorTo',
    'colorBorder',
    'colorText'
] as const;

type FileDraft = {
    revision: number;
    badges: BadgeDraft[];
    awards: AwardDraft[];
};

const ENDPOINT = '/__badge-editor/file';
const PUBLISHED_ENDPOINT = '/__badge-editor/published';
const PROFILE_ENDPOINT = '/__badge-editor/profile';
const PREVIEW_USER = 'usr_00000000-0000-0000-0000-000000000000';
const FORMAT: FormattingOptions = { insertSpaces: true, tabSize: 4 };

function readDraft(text: string): { draft: FileDraft | null; error: string } {
    const errors: ParseError[] = [];
    const value = parse(text, errors, { allowTrailingComma: true }) as
        | Partial<FileDraft>
        | undefined;
    if (errors.length || !value || typeof value !== 'object') {
        return { draft: null, error: 'The file is not valid JSONC.' };
    }
    return {
        draft: {
            revision: Number(value.revision) || 1,
            badges: Array.isArray(value.badges) ? value.badges : [],
            awards: Array.isArray(value.awards) ? value.awards : []
        },
        error: ''
    };
}

// The commented-out example at the top of "awards". Rewriting the list drops
// comments inside it, so saving puts this one back.
const AWARD_EXAMPLE = [
    '// {',
    '//     "userId": "usr_00000000-0000-0000-0000-000000000000",',
    '//     "badge": "donator",',
    '//     "name": "Display name, only to make this file easier to read",',
    '//     "reason": "Donated in November 2026",',
    '//     "since": 1794009600,',
    '//     "until": 1825545600',
    '// },'
];

function withAwardExample(text: string): string {
    if (text.includes(AWARD_EXAMPLE[1])) {
        return text;
    }
    const awards = findNodeAtLocation(parseTree(text)!, ['awards']);
    if (!awards || awards.type !== 'array') {
        return text;
    }
    const open = awards.offset + 1;
    const comment = AWARD_EXAMPLE.map((line) => `\n        ${line}`).join('');
    const empty = awards.children?.length === 0;
    return (
        text.slice(0, open) +
        comment +
        (empty ? '\n    ' : '') +
        text.slice(empty ? awards.offset + awards.length - 1 : open)
    );
}

// Keeps the file's comments: only the three top-level values are rewritten.
function writeDraft(text: string, draft: FileDraft): string {
    let next = text;
    for (const [key, value] of [
        ['revision', draft.revision],
        ['badges', draft.badges.map(cleanBadge)],
        ['awards', draft.awards.map(cleanAward)]
    ] as const) {
        next = applyEdits(
            next,
            modify(next, [key], value, { formattingOptions: FORMAT })
        );
    }
    return withAwardExample(next);
}

function cleanBadge(badge: BadgeDraft): BadgeDraft {
    const out: BadgeDraft = { ...badge };
    for (const field of [
        'colorFrom',
        'colorTo',
        'colorBorder',
        'colorText'
    ] as const) {
        if (!out[field]) delete out[field];
    }
    return out;
}

function cleanAward(award: AwardDraft): AwardDraft {
    const out: AwardDraft = { userId: award.userId.trim(), badge: award.badge };
    if (award.name?.trim()) out.name = award.name.trim();
    if (award.reason?.trim()) out.reason = award.reason.trim();
    const since = parseAwardDate(award.since);
    const until = parseAwardDate(award.until);
    if (since !== null) out.since = since;
    if (until !== null) out.until = until;
    for (const field of OVERRIDE_FIELDS) {
        const value = award[field]?.trim();
        if (value) out[field] = value;
    }
    return out;
}

function toCatalog(draft: FileDraft): GlobalBadgeCatalog {
    return {
        revision: draft.revision,
        source: 'embedded',
        badges: draft.badges.map((badge): GlobalBadgeDefinition => ({
            id: badge.id,
            label: badge.label,
            description: badge.description ?? '',
            icon: badge.icon,
            style: badge.style,
            animation: badge.animation,
            colorFrom: normalizeHexColor(badge.colorFrom) ?? '',
            colorTo: normalizeHexColor(badge.colorTo) ?? '',
            colorBorder: normalizeHexColor(badge.colorBorder) ?? '',
            colorText: normalizeHexColor(badge.colorText) ?? ''
        })),
        awards: draft.awards.map((award) => ({
            userId: award.userId,
            badge: award.badge,
            reason: award.reason ?? '',
            since: parseAwardDate(award.since),
            until: parseAwardDate(award.until),
            overrides: {
                label: award.label ?? '',
                description: award.description ?? '',
                icon: award.icon ?? '',
                style: award.style ?? '',
                animation: award.animation ?? '',
                colorFrom: normalizeHexColor(award.colorFrom) ?? '',
                colorTo: normalizeHexColor(award.colorTo) ?? '',
                colorBorder: normalizeHexColor(award.colorBorder) ?? '',
                colorText: normalizeHexColor(award.colorText) ?? ''
            }
        }))
    };
}

const noop = () => undefined;
const commands = new Proxy({}, { get: () => noop }) as UserHeaderCommands;

// What the profile helper returns for a real VRChat user (read-only lookup
// with the installed app's saved login).
type LiveProfile = {
    displayName: string;
    bio: string;
    statusDescription: string;
    status: string;
    pronouns: string;
    icon: string | null;
    banner: string | null;
    bannerColor?: string;
    tags?: string[];
    developerType?: string;
};

function headerModel(
    userId: string,
    name: string,
    live: LiveProfile | null = null
): UserHeaderModel {
    const trust = computeTrustLevel(
        live?.tags ?? [],
        live?.developerType ?? ''
    );
    return {
        actionStatus: 'idle',
        appearanceVisibility: {
            profileBackground: true,
            avatarFrame: true,
            profileEffect: true,
            nameplateEffect: true
        },
        avatarOverrideState: { hideAvatar: false, showAvatar: false },
        bannerColor: live?.bannerColor ?? '',
        bannerFallbackUrl: '',
        canInviteFromCurrentLocation: false,
        currentAvatarTarget: '',
        currentUserAccountStanding: '',
        currentUserBoopingEnabled: false,
        detail: '',
        extendedModerationState: { interactOff: false, muteChat: false },
        fallbackAvatarTarget: '',
        friendRequestState: { incoming: false, outgoing: false },
        imageUrl: live?.banner ?? '',
        isCurrentUser: false,
        isFriend: true,
        loadStatus: 'ready',
        moderationState: { block: false, mute: false },
        noteSummary: '',
        platform: { icon: null, label: 'PC' },
        PlatformIcon: null,
        previousDisplayNames: [],
        profile: {
            displayName: name,
            id: userId,
            statusDescription: live?.statusDescription || 'Online',
            bio: live?.bio ?? '',
            tags: live?.tags ?? [],
            developerType: live?.developerType ?? 'none',
            $trustLevel: trust.trustLevel,
            $trustClass: trust.trustClass
        },
        pronounsText: live?.pronouns || undefined,
        profileAppearance: {},
        profileIconUrl: live?.icon ?? '',
        profileLanguages: [],
        profileTitle: name,
        recentDialogShortcut: () => null,
        statusDotClassName: 'status-dot-active',
        statusStateText: 'Online',
        username: name.toLowerCase(),
        userUrl: ''
    } as unknown as UserHeaderModel;
}

const inputClass =
    'w-full rounded-md border bg-transparent px-2 py-1 text-sm outline-none focus:ring-1 focus:ring-(--ring)';

function Field({ label, children }: { label: string; children: ReactNode }) {
    return (
        <label className="flex min-w-0 flex-col gap-1 text-xs">
            <span className="text-muted-foreground">{label}</span>
            {children}
        </label>
    );
}

function Select({
    value,
    options,
    onChange,
    inheritLabel
}: {
    value: string;
    options: readonly string[];
    onChange: (value: string) => void;
    // When set, an empty value is offered as "inherit".
    inheritLabel?: string;
}) {
    return (
        <select
            className={inputClass}
            value={value}
            onChange={(event) => onChange(event.target.value)}
        >
            {inheritLabel !== undefined ? (
                <option value="">{inheritLabel}</option>
            ) : null}
            {options.includes(value) ||
            (inheritLabel !== undefined && !value) ? null : (
                <option value={value}>{value}</option>
            )}
            {options.map((option) => (
                <option key={option} value={option}>
                    {option}
                </option>
            ))}
        </select>
    );
}

function IconPicker({
    value,
    onChange,
    allowInherit = false
}: {
    value: string;
    onChange: (value: string) => void;
    allowInherit?: boolean;
}) {
    return (
        <div className="grid grid-cols-8 gap-1">
            {allowInherit ? (
                <button
                    type="button"
                    title="Use the badge type's icon"
                    onClick={() => onChange('')}
                    className={
                        'flex size-8 items-center justify-center rounded-md border text-[9px] ' +
                        (!value
                            ? 'border-(--ring) bg-(--state-selected-surface)'
                            : 'hover:bg-(--state-hover-surface)')
                    }
                >
                    inherit
                </button>
            ) : null}
            {AWARD_ICONS.map((icon) => (
                <button
                    key={icon}
                    type="button"
                    title={icon}
                    onClick={() => onChange(icon)}
                    className={
                        'flex size-8 items-center justify-center rounded-md border ' +
                        (icon === value
                            ? 'border-(--ring) bg-(--state-selected-surface)'
                            : 'hover:bg-(--state-hover-surface)')
                    }
                >
                    <BadgeIcon name={icon} allowReserved className="size-4" />
                </button>
            ))}
        </div>
    );
}

function todayUtcSeconds(): number {
    const now = new Date();
    return (
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) /
        1000
    );
}

// A date picker (UTC) over an epoch-seconds value.
function DateField({
    label,
    value,
    onChange
}: {
    label: string;
    value: number | string | null | undefined;
    onChange: (value: number | null) => void;
}) {
    const seconds = parseAwardDate(value);
    const day =
        seconds === null
            ? ''
            : new Date(seconds * 1000).toISOString().slice(0, 10);
    return (
        <Field label={label}>
            <div className="flex items-center gap-1">
                <input
                    type="date"
                    className={inputClass}
                    value={day}
                    onChange={(event) => {
                        const next = event.target.value;
                        onChange(
                            next ? Date.parse(`${next}T00:00:00Z`) / 1000 : null
                        );
                    }}
                />
                {seconds !== null ? (
                    <button
                        type="button"
                        className="shrink-0 rounded border px-1.5 text-[10px]"
                        onClick={() => onChange(null)}
                    >
                        clear
                    </button>
                ) : null}
            </div>
            <span className="text-muted-foreground font-mono text-[10px]">
                {seconds === null ? 'not set' : `${seconds} (epoch seconds)`}
            </span>
        </Field>
    );
}

const COLOR_FIELDS = [
    ['colorFrom', 'Gradient start'],
    ['colorTo', 'Gradient end'],
    ['colorBorder', 'Border'],
    ['colorText', 'Text and icon']
] as const;

// Empty means "use the style's colour"; the file then leaves the field out.
// The text box takes hex codes (#ff8800, ff8800, #f80) as typed or pasted.
function ColorField({
    label,
    value,
    onChange
}: {
    label: string;
    value: string;
    onChange: (value: string) => void;
}) {
    const [text, setText] = useState(value);
    useEffect(() => setText(value), [value]);
    const valid = text === '' || normalizeHexColor(text) !== null;
    return (
        <Field label={label}>
            <div className="flex items-center gap-1">
                <input
                    type="color"
                    className="h-7 w-8 shrink-0 cursor-pointer rounded border bg-transparent"
                    value={normalizeHexColor(value) ?? '#888888'}
                    onChange={(event) => onChange(event.target.value)}
                />
                <input
                    className={
                        inputClass +
                        ' min-w-0 font-mono text-xs' +
                        (valid ? '' : ' border-red-500')
                    }
                    value={text}
                    placeholder="style"
                    spellCheck={false}
                    onChange={(event) => {
                        const next = event.target.value;
                        setText(next);
                        if (next.trim() === '') {
                            onChange('');
                            return;
                        }
                        const normalized = normalizeHexColor(next);
                        if (normalized) {
                            onChange(normalized);
                        }
                    }}
                    onBlur={() => setText(value)}
                />
                {value ? (
                    <button
                        type="button"
                        className="shrink-0 rounded border px-1.5 text-[10px]"
                        title="Use the style's colour"
                        onClick={() => onChange('')}
                    >
                        reset
                    </button>
                ) : null}
            </div>
        </Field>
    );
}

function sampleAward(badge: BadgeDraft): ActiveAward {
    return {
        badge: {
            id: badge.id,
            label: badge.label || 'Badge',
            description: badge.description ?? '',
            icon: badge.icon,
            style: badge.style,
            animation: badge.animation,
            colorFrom: normalizeHexColor(badge.colorFrom) ?? '',
            colorTo: normalizeHexColor(badge.colorTo) ?? '',
            colorBorder: normalizeHexColor(badge.colorBorder) ?? '',
            colorText: normalizeHexColor(badge.colorText) ?? ''
        },
        grant: {
            userId: PREVIEW_USER,
            badge: badge.id,
            reason: 'Example reason',
            since: null,
            until: null,
            overrides: {
                label: '',
                description: '',
                icon: '',
                style: '',
                animation: '',
                colorFrom: '',
                colorTo: '',
                colorBorder: '',
                colorText: ''
            }
        }
    };
}

function Editor() {
    // The editor session's "now" for deciding which awards are active.
    const [nowSeconds] = useState(() => Math.floor(Date.now() / 1000));
    const [text, setText] = useState('');
    const [draft, setDraft] = useState<FileDraft | null>(null);
    const [loadError, setLoadError] = useState('');
    const [status, setStatus] = useState('');
    const [dirty, setDirty] = useState(false);
    const [selected, setSelected] = useState<number | null>(null);
    const [published, setPublished] = useState<
        GlobalBadgeCatalog | 'none' | null
    >(null);
    const [simulateStaff, setSimulateStaff] = useState(false);
    const [live, setLive] = useState<LiveProfile | null>(null);
    const [liveStatus, setLiveStatus] = useState('');
    // Badge types start collapsed to a one-line summary.
    const [openBadges, setOpenBadges] = useState<Set<number>>(() => new Set());

    async function load() {
        const response = await fetch(ENDPOINT);
        const body = await response.text();
        const { draft: next, error } = readDraft(body);
        setText(body);
        setDraft(next);
        setLoadError(error);
        setDirty(false);
        setStatus('Loaded data/global-badges.jsonc');
    }

    useEffect(() => {
        void load();
        void loadBadgeIcons();
        void fetch(PUBLISHED_ENDPOINT)
            .then(async (response) => {
                const { draft: publishedDraft } = response.ok
                    ? readDraft(await response.text())
                    : { draft: null };
                setPublished(
                    publishedDraft ? toCatalog(publishedDraft) : 'none'
                );
            })
            .catch(() => setPublished('none'));
    }, []);

    const liveUserId = draft
        ? ((selected !== null ? draft.awards[selected] : draft.awards[0])
              ?.userId ?? '')
        : '';
    useEffect(() => {
        if (!/^usr_[0-9a-f-]{36}$/i.test(liveUserId)) {
            setLive(null);
            setLiveStatus('');
            return;
        }
        let active = true;
        setLiveStatus('Loading this person from VRChat with your app login...');
        const timer = setTimeout(() => {
            fetch(
                `${PROFILE_ENDPOINT}?userId=${encodeURIComponent(liveUserId)}`
            )
                .then((response) => response.json())
                .then(
                    (result: { ok: boolean; error?: string } & LiveProfile) => {
                        if (!active) return;
                        if (result.ok) {
                            setLive(result);
                            setLiveStatus('');
                        } else {
                            setLive(null);
                            setLiveStatus(
                                `Could not load this person: ${result.error ?? 'unknown error'}`
                            );
                        }
                    }
                )
                .catch(() => {
                    if (active)
                        setLiveStatus('Could not reach the editor server.');
                });
        }, 500);
        return () => {
            active = false;
            clearTimeout(timer);
        };
    }, [liveUserId]);

    const problems = useMemo(
        () => (draft ? validateGlobalBadgeFile(draft) : []),
        [draft]
    );

    // The preview uses the app's own store, so it shows exactly what the app
    // would show for this draft.
    useEffect(() => {
        if (draft) {
            useGlobalBadgeStore.setState({ catalog: toCatalog(draft) });
        }
    }, [draft]);

    function update(change: (current: FileDraft) => FileDraft) {
        setDraft((current) => (current ? change(current) : current));
        setDirty(true);
    }

    async function save() {
        if (!draft) return;
        const next = { ...draft, revision: draft.revision + 1 };
        const body = writeDraft(text, next);
        const response = await fetch(ENDPOINT, { method: 'PUT', body });
        if (!response.ok) {
            setStatus(`Not saved: ${await response.text()}`);
            return;
        }
        setText(body);
        setDraft(next);
        setDirty(false);
        setStatus(
            `Saved revision ${next.revision}. Commit and push data/global-badges.jsonc to publish it.`
        );
    }

    if (loadError) {
        return <p className="p-6 text-red-400">{loadError}</p>;
    }
    if (!draft) {
        return <p className="p-6">Loading...</p>;
    }

    const previewAward =
        selected !== null ? draft.awards[selected] : draft.awards[0];
    const previewUserId = previewAward?.userId || PREVIEW_USER;
    const previewName =
        previewAward?.name || live?.displayName || 'Preview user';
    const publishedAwards =
        published && published !== 'none'
            ? activeAwardsFor(published, previewUserId, nowSeconds)
            : [];
    const draftAwards = activeAwardsFor(
        toCatalog(draft),
        previewUserId,
        nowSeconds
    );

    return (
        <div className="grid min-h-screen grid-cols-[minmax(0,1fr)_minmax(0,46rem)] gap-6 p-6">
            <div className="flex min-w-0 flex-col gap-6">
                <header className="flex flex-wrap items-center gap-3">
                    <h1 className="text-lg font-semibold">Global badges</h1>
                    <span className="text-muted-foreground text-sm">
                        revision {draft.revision}
                        {dirty ? ' (unsaved; saving bumps it)' : ''}
                    </span>
                    <button
                        type="button"
                        className="bg-primary text-primary-foreground rounded-md px-3 py-1 text-sm disabled:opacity-50"
                        disabled={!dirty || problems.length > 0}
                        onClick={() => void save()}
                    >
                        Save
                    </button>
                    <button
                        type="button"
                        className="rounded-md border px-3 py-1 text-sm"
                        onClick={() => void load()}
                    >
                        Reload from disk
                    </button>
                    <span className="text-muted-foreground text-xs">
                        {status}
                    </span>
                </header>

                {problems.length ? (
                    <ul className="rounded-md border border-red-500/50 p-3 text-xs text-red-300">
                        {problems.map((problem) => (
                            <li key={problem}>{problem}</li>
                        ))}
                    </ul>
                ) : null}

                <details className="rounded-lg border p-3">
                    <summary className="cursor-pointer font-semibold">
                        Badge types ({draft.badges.length})
                    </summary>
                    <div className="mt-3 flex flex-col gap-3">
                        <div className="flex items-center gap-2">
                            <button
                                type="button"
                                className="rounded-md border px-2 py-0.5 text-xs"
                                onClick={() =>
                                    update((current) => ({
                                        ...current,
                                        badges: [
                                            ...current.badges,
                                            {
                                                id: `badge-${current.badges.length + 1}`,
                                                label: 'New badge',
                                                description: '',
                                                icon: 'Award',
                                                style: 'gold',
                                                animation: 'shimmer'
                                            }
                                        ]
                                    }))
                                }
                            >
                                Add badge type
                            </button>
                        </div>
                        {draft.badges.map((badge, index) => {
                            const set = (patch: Partial<BadgeDraft>) =>
                                update((current) => ({
                                    ...current,
                                    badges: current.badges.map((entry, i) =>
                                        i === index
                                            ? { ...entry, ...patch }
                                            : entry
                                    )
                                }));
                            const open = openBadges.has(index);
                            const summary = (
                                <button
                                    type="button"
                                    className="flex w-full items-center gap-3 text-left"
                                    onClick={() =>
                                        setOpenBadges((current) => {
                                            const next = new Set(current);
                                            if (next.has(index))
                                                next.delete(index);
                                            else next.add(index);
                                            return next;
                                        })
                                    }
                                >
                                    <span className="text-muted-foreground w-3 text-xs">
                                        {open ? 'v' : '>'}
                                    </span>
                                    <GlobalBadgeChip
                                        award={sampleAward(badge)}
                                        size="full"
                                    />
                                    <GlobalBadgeChip
                                        award={sampleAward(badge)}
                                    />
                                    <span className="text-muted-foreground font-mono text-xs">
                                        {badge.id}
                                    </span>
                                </button>
                            );
                            // Order in the file is the order badges show
                            // in, most prestigious first.
                            const move = (delta: number) => {
                                const target = index + delta;
                                if (
                                    target < 0 ||
                                    target >= draft.badges.length
                                ) {
                                    return;
                                }
                                update((current) => {
                                    const badges = [...current.badges];
                                    [badges[index], badges[target]] = [
                                        badges[target],
                                        badges[index]
                                    ];
                                    return { ...current, badges };
                                });
                                setOpenBadges((current) => {
                                    const next = new Set<number>();
                                    for (const i of current) {
                                        next.add(
                                            i === index
                                                ? target
                                                : i === target
                                                  ? index
                                                  : i
                                        );
                                    }
                                    return next;
                                });
                            };
                            const header = (
                                <div className="flex items-center gap-2">
                                    <div className="min-w-0 flex-1">
                                        {summary}
                                    </div>
                                    <button
                                        type="button"
                                        className="rounded-md border px-2 py-0.5 text-xs disabled:opacity-40"
                                        title="Show earlier (more prestigious)"
                                        disabled={index === 0}
                                        onClick={() => move(-1)}
                                    >
                                        Up
                                    </button>
                                    <button
                                        type="button"
                                        className="rounded-md border px-2 py-0.5 text-xs disabled:opacity-40"
                                        title="Show later (less prestigious)"
                                        disabled={
                                            index === draft.badges.length - 1
                                        }
                                        onClick={() => move(1)}
                                    >
                                        Down
                                    </button>
                                </div>
                            );
                            if (!open) {
                                return (
                                    <div
                                        key={index}
                                        className="rounded-lg border p-3"
                                    >
                                        {header}
                                    </div>
                                );
                            }
                            return (
                                <div
                                    key={index}
                                    className="flex flex-col gap-3 rounded-lg border p-3"
                                >
                                    {header}
                                    <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,17rem)] gap-3">
                                        <div className="grid grid-cols-2 gap-2">
                                            <Field label="Id (used by awards)">
                                                <input
                                                    className={inputClass}
                                                    value={badge.id}
                                                    onChange={(event) =>
                                                        set({
                                                            id: event.target
                                                                .value
                                                        })
                                                    }
                                                />
                                            </Field>
                                            <Field label="Label">
                                                <input
                                                    className={inputClass}
                                                    value={badge.label}
                                                    maxLength={32}
                                                    onChange={(event) =>
                                                        set({
                                                            label: event.target
                                                                .value
                                                        })
                                                    }
                                                />
                                            </Field>
                                            <div className="col-span-2">
                                                <Field label="Description (tooltip)">
                                                    <input
                                                        className={inputClass}
                                                        value={
                                                            badge.description ??
                                                            ''
                                                        }
                                                        onChange={(event) =>
                                                            set({
                                                                description:
                                                                    event.target
                                                                        .value
                                                            })
                                                        }
                                                    />
                                                </Field>
                                            </div>
                                            <Field label="Style">
                                                <Select
                                                    value={badge.style}
                                                    options={AWARD_STYLES}
                                                    onChange={(style) =>
                                                        set({ style })
                                                    }
                                                />
                                            </Field>
                                            <Field label="Animation">
                                                <Select
                                                    value={badge.animation}
                                                    options={AWARD_ANIMATIONS}
                                                    onChange={(animation) =>
                                                        set({ animation })
                                                    }
                                                />
                                            </Field>
                                            <div className="col-span-2 grid grid-cols-4 gap-2">
                                                {COLOR_FIELDS.map(
                                                    ([field, label]) => (
                                                        <ColorField
                                                            key={field}
                                                            label={label}
                                                            value={
                                                                badge[field] ??
                                                                ''
                                                            }
                                                            onChange={(value) =>
                                                                set({
                                                                    [field]:
                                                                        value
                                                                })
                                                            }
                                                        />
                                                    )
                                                )}
                                            </div>
                                            <div className="col-span-2 flex items-center gap-3">
                                                <GlobalBadgeChip
                                                    award={sampleAward(badge)}
                                                    size="full"
                                                />
                                                <GlobalBadgeChip
                                                    award={sampleAward(badge)}
                                                />
                                                <button
                                                    type="button"
                                                    className="ml-auto rounded-md border px-2 py-0.5 text-xs text-red-300"
                                                    onClick={() =>
                                                        update((current) => ({
                                                            ...current,
                                                            badges: current.badges.filter(
                                                                (_, i) =>
                                                                    i !== index
                                                            )
                                                        }))
                                                    }
                                                >
                                                    Remove
                                                </button>
                                            </div>
                                        </div>
                                        <Field label="Icon (award icons only)">
                                            <IconPicker
                                                value={badge.icon}
                                                onChange={(icon) =>
                                                    set({ icon })
                                                }
                                            />
                                        </Field>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </details>

                <section className="flex flex-col gap-3">
                    <div className="flex items-center gap-2">
                        <h2 className="font-semibold">Awards</h2>
                        <button
                            type="button"
                            className="rounded-md border px-2 py-0.5 text-xs"
                            onClick={() => {
                                update((current) => ({
                                    ...current,
                                    awards: [
                                        ...current.awards,
                                        {
                                            userId: '',
                                            badge: current.badges[0]?.id ?? '',
                                            name: '',
                                            reason: '',
                                            since: todayUtcSeconds(),
                                            until: null
                                        }
                                    ]
                                }));
                                setSelected(draft.awards.length);
                            }}
                        >
                            Add award
                        </button>
                        <span className="text-muted-foreground text-xs">
                            Add people only with their consent: this file is
                            public.
                        </span>
                    </div>
                    {draft.awards.map((award, index) => {
                        const isCustom = award.badge === CUSTOM_AWARD_BADGE;
                        const set = (patch: Partial<AwardDraft>) =>
                            update((current) => ({
                                ...current,
                                awards: current.awards.map((entry, i) =>
                                    i === index ? { ...entry, ...patch } : entry
                                )
                            }));
                        return (
                            <div
                                key={index}
                                // Focusable so a click on the card's empty space
                                // selects it too.
                                tabIndex={-1}
                                onFocusCapture={() => setSelected(index)}
                                className={
                                    'grid grid-cols-6 gap-2 rounded-lg border p-3 ' +
                                    (selected === index
                                        ? 'border-(--ring)'
                                        : '')
                                }
                            >
                                <div className="col-span-2">
                                    <Field label="Name (only for this file)">
                                        <input
                                            className={inputClass}
                                            value={award.name ?? ''}
                                            onChange={(event) =>
                                                set({
                                                    name: event.target.value
                                                })
                                            }
                                        />
                                    </Field>
                                </div>
                                <div className="col-span-3">
                                    <Field label="VRChat user id or profile link">
                                        <input
                                            className={inputClass}
                                            value={award.userId}
                                            placeholder="usr_..."
                                            onChange={(event) =>
                                                set({
                                                    userId:
                                                        event.target.value.match(
                                                            /usr_[0-9a-f-]{36}/i
                                                        )?.[0] ??
                                                        event.target.value
                                                })
                                            }
                                        />
                                    </Field>
                                </div>
                                <Field label="Badge">
                                    <Select
                                        value={award.badge}
                                        options={[
                                            ...draft.badges.map((b) => b.id),
                                            CUSTOM_AWARD_BADGE
                                        ]}
                                        onChange={(badge) => set({ badge })}
                                    />
                                </Field>
                                <div className="col-span-4">
                                    <Field label="Reason (tooltip)">
                                        <input
                                            className={inputClass}
                                            value={award.reason ?? ''}
                                            onChange={(event) =>
                                                set({
                                                    reason: event.target.value
                                                })
                                            }
                                        />
                                    </Field>
                                </div>
                                <DateField
                                    label="Since (UTC)"
                                    value={award.since}
                                    onChange={(since) => set({ since })}
                                />
                                <DateField
                                    label="Until (UTC, empty = no end)"
                                    value={award.until}
                                    onChange={(until) => set({ until })}
                                />
                                <details
                                    className="col-span-6 rounded-md border p-2"
                                    open={isCustom || undefined}
                                >
                                    <summary className="cursor-pointer text-xs">
                                        {isCustom
                                            ? 'This one-off badge (label required, the rest falls back to defaults)'
                                            : 'Look for this person (overrides the badge type)'}
                                        {OVERRIDE_FIELDS.some(
                                            (field) => award[field]
                                        )
                                            ? ' - customised'
                                            : ''}
                                    </summary>
                                    <div className="mt-2 grid grid-cols-[minmax(0,1fr)_minmax(0,17rem)] gap-3">
                                        <div className="grid grid-cols-2 gap-2">
                                            <div className="col-span-2">
                                                <Field
                                                    label={
                                                        isCustom
                                                            ? 'Label (required)'
                                                            : 'Label (blank = inherit)'
                                                    }
                                                >
                                                    <input
                                                        className={inputClass}
                                                        value={
                                                            award.label ?? ''
                                                        }
                                                        maxLength={32}
                                                        onChange={(event) =>
                                                            set({
                                                                label: event
                                                                    .target
                                                                    .value
                                                            })
                                                        }
                                                    />
                                                </Field>
                                            </div>
                                            <div className="col-span-2">
                                                <Field label="Description (tooltip, blank = inherit)">
                                                    <input
                                                        className={inputClass}
                                                        value={
                                                            award.description ??
                                                            ''
                                                        }
                                                        onChange={(event) =>
                                                            set({
                                                                description:
                                                                    event.target
                                                                        .value
                                                            })
                                                        }
                                                    />
                                                </Field>
                                            </div>
                                            <Field label="Style">
                                                <Select
                                                    value={award.style ?? ''}
                                                    options={AWARD_STYLES}
                                                    inheritLabel={
                                                        isCustom
                                                            ? 'default'
                                                            : 'inherit'
                                                    }
                                                    onChange={(style) =>
                                                        set({ style })
                                                    }
                                                />
                                            </Field>
                                            <Field label="Animation">
                                                <Select
                                                    value={
                                                        award.animation ?? ''
                                                    }
                                                    options={AWARD_ANIMATIONS}
                                                    inheritLabel={
                                                        isCustom
                                                            ? 'default'
                                                            : 'inherit'
                                                    }
                                                    onChange={(animation) =>
                                                        set({ animation })
                                                    }
                                                />
                                            </Field>
                                            <div className="col-span-2 grid grid-cols-4 gap-2">
                                                {COLOR_FIELDS.map(
                                                    ([field, label]) => (
                                                        <ColorField
                                                            key={field}
                                                            label={label}
                                                            value={
                                                                award[field] ??
                                                                ''
                                                            }
                                                            onChange={(value) =>
                                                                set({
                                                                    [field]:
                                                                        value
                                                                })
                                                            }
                                                        />
                                                    )
                                                )}
                                            </div>
                                        </div>
                                        <Field label="Icon">
                                            <IconPicker
                                                value={award.icon ?? ''}
                                                allowInherit
                                                onChange={(icon) =>
                                                    set({ icon })
                                                }
                                            />
                                        </Field>
                                    </div>
                                </details>
                                <div className="col-span-6 flex justify-end">
                                    <button
                                        type="button"
                                        className="rounded-md border px-2 py-0.5 text-xs text-red-300"
                                        onClick={(event) => {
                                            event.stopPropagation();
                                            update((current) => ({
                                                ...current,
                                                awards: current.awards.filter(
                                                    (_, i) => i !== index
                                                )
                                            }));
                                            setSelected(null);
                                        }}
                                    >
                                        Remove award
                                    </button>
                                </div>
                            </div>
                        );
                    })}
                </section>
            </div>

            <aside className="sticky top-6 flex h-fit flex-col gap-4">
                <h2 className="font-semibold">
                    Preview: {previewName}
                    <span className="text-muted-foreground ml-2 text-xs font-normal">
                        (click an award to preview its person; expired or future
                        awards are hidden, as in the app)
                    </span>
                </h2>
                {liveStatus ? (
                    <p className="text-muted-foreground text-xs">
                        {liveStatus}
                    </p>
                ) : null}
                <label className="flex items-center gap-2 text-xs">
                    <input
                        type="checkbox"
                        checked={simulateStaff}
                        onChange={(event) => {
                            setSimulateStaff(event.target.checked);
                            recordUserGroups(
                                previewUserId,
                                event.target.checked
                                    ? [VRCHAT_STAFF_GROUP_ID]
                                    : []
                            );
                        }}
                    />
                    Show as VRChat Staff (the editor cannot see real group
                    membership)
                </label>
                <div className="flex flex-col gap-2 rounded-lg border p-3 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                        <span className="text-muted-foreground w-36 text-xs">
                            Published now
                        </span>
                        {published === null ? (
                            <span className="text-muted-foreground text-xs">
                                loading...
                            </span>
                        ) : published === 'none' ? (
                            <span className="text-muted-foreground text-xs">
                                nothing published yet
                            </span>
                        ) : (
                            <>
                                <DeveloperBadge
                                    userId={previewUserId}
                                    size="full"
                                />
                                {publishedAwards.map((award) => (
                                    <GlobalBadgeChip
                                        key={award.badge.id}
                                        award={award}
                                        size="full"
                                    />
                                ))}
                                {publishedAwards.length ? null : (
                                    <span className="text-muted-foreground text-xs">
                                        no awards
                                    </span>
                                )}
                            </>
                        )}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        <span className="text-muted-foreground w-36 text-xs">
                            After saving
                        </span>
                        <DeveloperBadge userId={previewUserId} size="full" />
                        {draftAwards.map((award) => (
                            <GlobalBadgeChip
                                key={award.badge.id}
                                award={award}
                                size="full"
                            />
                        ))}
                        {draftAwards.length ? null : (
                            <span className="text-muted-foreground text-xs">
                                no awards
                            </span>
                        )}
                    </div>
                </div>
                <div className="badge-editor-profile entity-dialog ring-foreground/10 rounded-xl bg-(--entity-dialog-ground) p-4 ring-1">
                    <UserDialogHeaderSection
                        headerModel={headerModel(
                            previewUserId,
                            previewName,
                            live
                        )}
                        headerCommands={commands}
                    />
                </div>
                {live?.bio ? (
                    <div className="rounded-lg border p-3 text-sm whitespace-pre-wrap">
                        <div className="text-muted-foreground mb-1 text-xs">
                            Bio
                        </div>
                        {live.bio}
                    </div>
                ) : null}
                <div className="flex w-96 items-center gap-2 rounded-md border px-2 py-1.5">
                    <UserDetailContent
                        userId={previewUserId}
                        imageUrl={live?.icon ?? ''}
                        displayName={previewName}
                        subline={live?.statusDescription || 'Online'}
                        statusDotClassName="status-dot-active"
                    />
                </div>
                <div className="flex items-center gap-2 text-sm">
                    Header size:{' '}
                    <UserBadges userId={previewUserId} size="full" />
                </div>
            </aside>
        </div>
    );
}

createRoot(document.getElementById('root')!).render(
    <AppProviders>
        <main className="bg-background text-foreground min-h-screen">
            <Editor />
        </main>
    </AppProviders>
);
