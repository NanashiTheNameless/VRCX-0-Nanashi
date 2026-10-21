import { isRecord } from '@/shared/utils/record';

export type InstanceLanguageRow = {
    code: string;
    iso639: string;
    label: string;
    percent: number;
};

export type InstanceLanguageBadge = {
    code: string;
    tooltip: string;
};

function stringList(value: unknown): string[] {
    return Array.isArray(value)
        ? value.filter(
              (item): item is string =>
                  typeof item === 'string' && Boolean(item.trim())
          )
        : [];
}

function baseCode(code: string) {
    return code.split('-')[0] ?? code;
}

export function instanceLanguageRows(
    instance: unknown,
    nameForKey: (key: string) => string | undefined
): InstanceLanguageRow[] {
    const source = isRecord(instance) ? instance : {};
    const ratio = isRecord(source.languageRatio) ? source.languageRatio : {};
    const declared = stringList(source.languages);
    const languages = declared.length ? declared : Object.keys(ratio);
    if (!languages.length) {
        return [];
    }
    const iso639 = stringList(source.languagesIso639);
    const bases = [...new Set(languages.map(baseCode))];
    const isoByBase = new Map(
        bases.map((base, index) => [base, iso639[index] ?? ''])
    );
    return languages
        .map((code) => {
            const region = code.split('-')[1];
            const iso = isoByBase.get(baseCode(code)) ?? '';
            const name = (iso && nameForKey(iso)) || code;
            return {
                code,
                iso639: iso,
                label: region ? `${name} (${region.toUpperCase()})` : name,
                percent: Math.round((Number(ratio[code]) || 0) * 100)
            };
        })
        .sort((left, right) => right.percent - left.percent);
}

export function instanceLanguageBadges(
    rows: InstanceLanguageRow[]
): InstanceLanguageBadge[] {
    const byIso = new Map<string, InstanceLanguageRow[]>();
    for (const row of rows) {
        if (row.iso639) {
            byIso.set(row.iso639, [...(byIso.get(row.iso639) ?? []), row]);
        }
    }
    return [...byIso.entries()].map(([iso, isoRows]) => ({
        code: iso.toUpperCase(),
        tooltip: isoRows
            .map((row) => `${row.label} ${row.percent}%`)
            .join(' · ')
    }));
}
