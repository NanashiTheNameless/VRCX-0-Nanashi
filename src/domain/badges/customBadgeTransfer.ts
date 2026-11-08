import { parse, printParseErrorCode, type ParseError } from 'jsonc-parser';

import {
    CUSTOM_BADGE_LIMIT,
    createCustomBadgeId,
    normalizeCustomBadge,
    type CustomBadge,
    type CustomBadgeRule
} from './customBadges';

export const CUSTOM_BADGE_EXPORT_FORMAT = 'vrcx-0-nanashi-custom-badges';
export const CUSTOM_BADGE_EXPORT_VERSION = 1;

// Fetched VRChat group member lists are a cache that can hold thousands of
// user ids. They stay on this PC; the importer fetches them again.
function stripCachedMembers(rule: CustomBadgeRule): CustomBadgeRule {
    if (rule.kind === 'group') {
        return { ...rule, rules: rule.rules.map(stripCachedMembers) };
    }
    if (rule.kind === 'vrchatGroup') {
        return { ...rule, memberIds: [], refreshedAt: 0, truncated: false };
    }
    return rule;
}

function indent(text: string, prefix: string): string {
    return text
        .split('\n')
        .map((line) => prefix + line)
        .join('\n');
}

function commentText(value: string): string {
    return value.replace(/[\r\n]+/g, ' ').replace(/\*\//g, '* /');
}

export function exportCustomBadgesJsonc(
    badges: readonly CustomBadge[]
): string {
    const entries = badges.map((badge) => {
        const body = JSON.stringify(
            { ...badge, rules: badge.rules.map(stripCachedMembers) },
            null,
            4
        );
        return `${indent(`// ${commentText(badge.label)}`, '        ')}\n${indent(body, '        ')}`;
    });
    return [
        '// VRCX-0-Nanashi custom badges.',
        '// Import in Settings > Social > User Badges. Comments and trailing',
        '// commas are allowed. Fetched VRChat group member lists are left',
        '// out; fetch them again after importing.',
        '{',
        `    "format": "${CUSTOM_BADGE_EXPORT_FORMAT}",`,
        `    "version": ${CUSTOM_BADGE_EXPORT_VERSION},`,
        `    "badges": [${entries.length ? `\n${entries.join(',\n')}\n    ` : ''}]`,
        '}',
        ''
    ].join('\n');
}

export type CustomBadgeImport =
    | { ok: true; badges: CustomBadge[]; invalid: number }
    | { ok: false; error: string };

function asRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : null;
}

/**
 * Reads an export, a bare list of badges, or a single badge object.
 */
export function parseCustomBadgesJsonc(text: string): CustomBadgeImport {
    const errors: ParseError[] = [];
    const parsed: unknown = parse(text, errors, {
        allowTrailingComma: true,
        disallowComments: false
    });
    if (errors.length) {
        const first = errors[0];
        return {
            ok: false,
            error: `${printParseErrorCode(first.error)} at ${first.offset}`
        };
    }
    const record = asRecord(parsed);
    let entries: unknown[];
    if (Array.isArray(parsed)) {
        entries = parsed;
    } else if (record && 'badges' in record) {
        if (
            record.format !== undefined &&
            record.format !== CUSTOM_BADGE_EXPORT_FORMAT
        ) {
            return {
                ok: false,
                error: `unknown format ${String(record.format)}`
            };
        }
        if (
            typeof record.version === 'number' &&
            record.version > CUSTOM_BADGE_EXPORT_VERSION
        ) {
            return {
                ok: false,
                error: `version ${record.version} is newer than this app supports`
            };
        }
        if (!Array.isArray(record.badges)) {
            return { ok: false, error: 'badges is not a list' };
        }
        entries = record.badges;
    } else if (record) {
        entries = [record];
    } else {
        return { ok: false, error: 'expected an object or a list' };
    }
    const badges: CustomBadge[] = [];
    let invalid = 0;
    for (const entry of entries) {
        const badge = normalizeCustomBadge(entry);
        if (badge) {
            badges.push(badge);
        } else {
            invalid += 1;
        }
    }
    return { ok: true, badges, invalid };
}

export type CustomBadgeMerge = {
    badges: CustomBadge[];
    added: number;
    replaced: number;
    skipped: number;
};

/**
 * With `replaceSameId`, an imported badge replaces the saved one with the same
 * id in place; otherwise every imported badge is added as a new copy.
 */
export function mergeImportedBadges(
    current: readonly CustomBadge[],
    imported: readonly CustomBadge[],
    replaceSameId: boolean
): CustomBadgeMerge {
    const next = [...current];
    const usedIds = new Set(current.map((badge) => badge.id));
    let added = 0;
    let replaced = 0;
    let skipped = 0;
    for (const badge of imported) {
        const existing = replaceSameId
            ? next.findIndex((entry) => entry.id === badge.id)
            : -1;
        if (existing >= 0) {
            next[existing] = badge;
            replaced += 1;
            continue;
        }
        if (next.length >= CUSTOM_BADGE_LIMIT) {
            skipped += 1;
            continue;
        }
        let id = badge.id;
        while (usedIds.has(id)) {
            id = createCustomBadgeId();
        }
        usedIds.add(id);
        next.push({ ...badge, id });
        added += 1;
    }
    return { badges: next, added, replaced, skipped };
}
