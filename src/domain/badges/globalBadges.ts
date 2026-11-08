// Shapes of the catalog the app command returns (`GlobalBadgeCatalog` in
// crates/contracts/src/global_badges.rs). Declared here because domain code
// may not import the generated bindings.
export type GlobalBadgeDefinition = {
    id: string;
    label: string;
    description: string;
    icon: string;
    style: string;
    animation: string;
    colorFrom: string;
    colorTo: string;
    colorBorder: string;
    colorText: string;
};

export type GlobalBadgeOverrides = Omit<GlobalBadgeDefinition, 'id'>;

export type GlobalBadgeGrant = {
    userId: string;
    badge: string;
    reason: string;
    since: number | null;
    until: number | null;
    overrides: GlobalBadgeOverrides;
};

export type GlobalBadgeCatalog = {
    revision: number;
    badges: GlobalBadgeDefinition[];
    awards: GlobalBadgeGrant[];
    source: 'embedded' | 'cached' | 'downloaded';
};

// Icons only global badges may use (custom badges cannot pick them), so an
// award can never be imitated. Keep this list in sync with the editor, which
// imports it.
export const AWARD_ICONS = Object.freeze([
    'HandHeart',
    'HeartHandshake',
    'Handshake',
    'Gift',
    'Coffee',
    'Award',
    'Trophy',
    'Medal',
    'Crown',
    'Gem',
    'BadgeCheck',
    'Bug',
    'BugPlay',
    'ShieldPlus',
    'FlaskConical',
    'TestTubeDiagonal',
    'Microscope',
    'Sprout',
    'Rocket',
    'Sparkles',
    'Flame',
    'Zap',
    'Lightbulb',
    'Wrench',
    'Hammer',
    'GitPullRequest',
    'GitMerge',
    'BookOpen',
    'Megaphone',
    'Palette',
    'Accessibility',
    'PenTool',
    'Languages'
] as const);

export const AWARD_STYLES = Object.freeze([
    'ember',
    'gold',
    'emerald',
    'sapphire',
    'amethyst',
    'crimson',
    'rose',
    'teal',
    'midnight'
] as const);

export const AWARD_ANIMATIONS = Object.freeze([
    'none',
    'shimmer',
    'flow',
    'sparkle',
    'wiggle',
    'glow'
] as const);

export type AwardStyle = (typeof AWARD_STYLES)[number];
export type AwardAnimation = (typeof AWARD_ANIMATIONS)[number];

type Loose<T> = { [K in keyof T]?: T[K] extends object ? Loose<T[K]> : T[K] };

const EMPTY_LOOK: GlobalBadgeOverrides = {
    label: '',
    description: '',
    icon: '',
    style: '',
    animation: '',
    colorFrom: '',
    colorTo: '',
    colorBorder: '',
    colorText: ''
};

/**
 * The catalog with every field filled in. The app command's generated types
 * mark all fields optional because the backend fills defaults when reading.
 */
export function normalizeGlobalBadgeCatalog(
    raw: Loose<GlobalBadgeCatalog> | null | undefined
): GlobalBadgeCatalog | null {
    if (!raw) {
        return null;
    }
    return {
        revision: raw.revision ?? 0,
        source: raw.source ?? 'embedded',
        badges: (raw.badges ?? []).map((badge) => ({
            ...EMPTY_LOOK,
            ...badge,
            id: badge?.id ?? ''
        })) as GlobalBadgeDefinition[],
        awards: (raw.awards ?? []).map((grant) => ({
            userId: grant?.userId ?? '',
            badge: grant?.badge ?? '',
            reason: grant?.reason ?? '',
            since: grant?.since ?? null,
            until: grant?.until ?? null,
            overrides: { ...EMPTY_LOOK, ...grant?.overrides }
        })) as GlobalBadgeGrant[]
    };
}

/**
 * The `badge` of a one-off award with no badge type: the award carries its
 * own label (required), description, icon, style, animation and colours.
 */
export const CUSTOM_AWARD_BADGE = 'custom';

export const DEFAULT_AWARD_ICON = 'Award';
export const DEFAULT_AWARD_STYLE: AwardStyle = 'gold';
export const DEFAULT_AWARD_ANIMATION: AwardAnimation = 'shimmer';

export function awardIcon(value: string): string {
    return (AWARD_ICONS as readonly string[]).includes(value)
        ? value
        : DEFAULT_AWARD_ICON;
}

export function awardStyle(value: string): AwardStyle {
    return AWARD_STYLES.find((style) => style === value) ?? DEFAULT_AWARD_STYLE;
}

export function awardAnimation(value: string): AwardAnimation {
    return (
        AWARD_ANIMATIONS.find((animation) => animation === value) ??
        DEFAULT_AWARD_ANIMATION
    );
}

/** The badge as this person sees it: their award's overrides win. */
export function withOverrides(
    badge: GlobalBadgeDefinition,
    grant: GlobalBadgeGrant
): GlobalBadgeDefinition {
    const overrides = grant.overrides;
    if (!overrides) {
        return badge;
    }
    return {
        ...badge,
        label: overrides.label || badge.label,
        description: overrides.description || badge.description,
        icon: overrides.icon || badge.icon,
        style: overrides.style || badge.style,
        animation: overrides.animation || badge.animation,
        colorFrom: overrides.colorFrom || badge.colorFrom,
        colorTo: overrides.colorTo || badge.colorTo,
        colorBorder: overrides.colorBorder || badge.colorBorder,
        colorText: overrides.colorText || badge.colorText
    };
}

export type ActiveAward = {
    badge: GlobalBadgeDefinition;
    grant: GlobalBadgeGrant;
};

/** The badge a one-off award describes by itself. */
function customBadge(grant: GlobalBadgeGrant): GlobalBadgeDefinition {
    return withOverrides(
        {
            id: CUSTOM_AWARD_BADGE,
            label: '',
            description: '',
            icon: DEFAULT_AWARD_ICON,
            style: DEFAULT_AWARD_STYLE,
            animation: DEFAULT_AWARD_ANIMATION,
            colorFrom: '',
            colorTo: '',
            colorBorder: '',
            colorText: ''
        },
        grant
    );
}

/**
 * Awards a user holds right now, in the order their badges are defined, then
 * their one-off awards in file order.
 */
export function activeAwardsFor(
    catalog: GlobalBadgeCatalog | null,
    userId: string,
    nowSeconds: number
): ActiveAward[] {
    if (!catalog || !userId) {
        return [];
    }
    const grants = catalog.awards.filter(
        (grant) =>
            grant.userId === userId &&
            (grant.since === null || grant.since <= nowSeconds) &&
            (grant.until === null || nowSeconds < grant.until)
    );
    if (!grants.length) {
        return [];
    }
    const result: ActiveAward[] = [];
    for (const badge of catalog.badges) {
        const grant = grants.find((entry) => entry.badge === badge.id);
        if (grant) {
            result.push({ badge: withOverrides(badge, grant), grant });
        }
    }
    for (const grant of grants) {
        if (grant.badge === CUSTOM_AWARD_BADGE && grant.overrides?.label) {
            result.push({ badge: customBadge(grant), grant });
        }
    }
    return result;
}

const BADGE_ID = /^[a-z0-9-]{1,40}$/;
const USER_ID =
    /^usr_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE =
    /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2}))?$/;
/**
 * A colour as `#rrggbb`, from `#rrggbb`, `rrggbb`, `#rgb` or `rgb`; null when
 * the text is not a hex colour.
 */
export function normalizeHexColor(value: unknown): string | null {
    const text = String(value ?? '')
        .trim()
        .replace(/^#/, '')
        .toLowerCase();
    if (/^[0-9a-f]{6}$/.test(text)) {
        return `#${text}`;
    }
    if (/^[0-9a-f]{3}$/.test(text)) {
        return `#${[...text].map((c) => c + c).join('')}`;
    }
    return null;
}

export const AWARD_COLOR_FIELDS = Object.freeze([
    'colorFrom',
    'colorTo',
    'colorBorder',
    'colorText'
] as const);
const BADGE_KEYS = new Set([
    'id',
    'label',
    'description',
    'icon',
    'style',
    'animation',
    ...AWARD_COLOR_FIELDS
]);
const AWARD_KEYS = new Set([
    'userId',
    'badge',
    'name',
    'reason',
    'since',
    'until',
    // Per-person overrides of the badge type; the whole badge for a custom
    // award.
    'label',
    'description',
    'icon',
    'style',
    'animation',
    ...AWARD_COLOR_FIELDS
]);

/**
 * UTC epoch seconds of a file date, or null if it is not one. The editor
 * writes epoch seconds like the rest of the app; date strings typed by hand
 * ("2026-11-07", "2026-11-07T18:30:00Z") are read too.
 */
export function parseAwardDate(value: unknown): number | null {
    if (typeof value === 'number') {
        if (!Number.isFinite(value) || value <= 0) {
            return null;
        }
        // A large number is milliseconds.
        return Math.floor(value > 100_000_000_000 ? value / 1000 : value);
    }
    if (typeof value !== 'string' || !DATE.test(value.trim())) {
        return null;
    }
    const ms = Date.parse(value.trim());
    return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
}

function record(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : null;
}

// Checks icon, style, animation and colours. Awards may leave any of them out
// (they inherit from the badge type); badge types must name the first three.
function checkAppearance(
    entry: Record<string, unknown>,
    where: string,
    optional: boolean,
    problems: string[]
) {
    const present = (key: string) =>
        entry[key] !== undefined && entry[key] !== '';
    if (
        (!optional || present('icon')) &&
        !(AWARD_ICONS as readonly string[]).includes(String(entry.icon))
    ) {
        problems.push(
            `${where}: "icon" must be one of the award icons (${AWARD_ICONS.join(', ')}).`
        );
    }
    if (
        (!optional || present('style')) &&
        !(AWARD_STYLES as readonly string[]).includes(String(entry.style))
    ) {
        problems.push(
            `${where}: "style" must be one of ${AWARD_STYLES.join(', ')}.`
        );
    }
    if (
        (!optional || present('animation')) &&
        !(AWARD_ANIMATIONS as readonly string[]).includes(
            String(entry.animation)
        )
    ) {
        problems.push(
            `${where}: "animation" must be one of ${AWARD_ANIMATIONS.join(', ')}.`
        );
    }
    for (const field of AWARD_COLOR_FIELDS) {
        if (present(field) && normalizeHexColor(entry[field]) === null) {
            problems.push(
                `${where}: "${field}" must be a hex colour like #ff8800 or #f80, or left out.`
            );
        }
    }
    if (
        optional &&
        present('label') &&
        String(entry.label).trim().length > 32
    ) {
        problems.push(`${where}: "label" must be at most 32 characters.`);
    }
}

/**
 * Checks parsed `global-badges.jsonc` content the way the publish workflow
 * and the editor need: everything the app would skip, plus unknown fields
 * and names the app does not know (it would fall back to defaults).
 */
export function validateGlobalBadgeFile(data: unknown): string[] {
    const problems: string[] = [];
    const root = record(data);
    if (!root) {
        return ['The file must contain one JSON object.'];
    }
    const revision = root.revision;
    if (!Number.isInteger(revision) || (revision as number) < 1) {
        problems.push('"revision" must be a whole number of 1 or more.');
    }
    const ids = new Set<string>();
    const badges = Array.isArray(root.badges) ? root.badges : null;
    if (!badges) {
        problems.push('"badges" must be a list.');
    }
    (badges ?? []).forEach((value, index) => {
        const badge = record(value);
        const where = `badges[${index}]`;
        if (!badge) {
            problems.push(`${where} must be an object.`);
            return;
        }
        for (const key of Object.keys(badge)) {
            if (!BADGE_KEYS.has(key)) {
                problems.push(`${where}: unknown field "${key}".`);
            }
        }
        const id = typeof badge.id === 'string' ? badge.id : '';
        if (!BADGE_ID.test(id)) {
            problems.push(
                `${where}: "id" must be lowercase letters, digits and dashes.`
            );
        } else if (id === CUSTOM_AWARD_BADGE) {
            problems.push(
                `${where}: id "${CUSTOM_AWARD_BADGE}" is kept for one-off awards.`
            );
        } else if (ids.has(id)) {
            problems.push(`${where}: id "${id}" is used twice.`);
        } else {
            ids.add(id);
        }
        const label = typeof badge.label === 'string' ? badge.label.trim() : '';
        if (!label || label.length > 32) {
            problems.push(`${where}: "label" must be 1 to 32 characters.`);
        }
        checkAppearance(badge, where, false, problems);
    });
    const awards = Array.isArray(root.awards) ? root.awards : null;
    if (!awards) {
        problems.push('"awards" must be a list.');
    }
    (awards ?? []).forEach((value, index) => {
        const award = record(value);
        const where = `awards[${index}]`;
        if (!award) {
            problems.push(`${where} must be an object.`);
            return;
        }
        for (const key of Object.keys(award)) {
            if (!AWARD_KEYS.has(key)) {
                problems.push(`${where}: unknown field "${key}".`);
            }
        }
        if (!USER_ID.test(String(award.userId ?? ''))) {
            problems.push(`${where}: "userId" must be a VRChat user id.`);
        }
        if (award.badge === CUSTOM_AWARD_BADGE) {
            if (typeof award.label !== 'string' || !award.label.trim()) {
                problems.push(`${where}: a custom award needs a "label".`);
            }
        } else if (!ids.has(String(award.badge ?? ''))) {
            problems.push(
                `${where}: "badge" must be the id of a badge in "badges", or "${CUSTOM_AWARD_BADGE}".`
            );
        }
        checkAppearance(award, where, true, problems);
        const since =
            award.since === undefined || award.since === null
                ? undefined
                : parseAwardDate(award.since);
        const until =
            award.until === undefined || award.until === null
                ? undefined
                : parseAwardDate(award.until);
        if (since === null) {
            problems.push(
                `${where}: "since" must be epoch seconds or a date like 2026-11-07.`
            );
        }
        if (until === null) {
            problems.push(
                `${where}: "until" must be epoch seconds or a date like 2026-11-07.`
            );
        }
        if (
            typeof since === 'number' &&
            typeof until === 'number' &&
            until <= since
        ) {
            problems.push(`${where}: "until" must be after "since".`);
        }
    });
    return problems;
}
