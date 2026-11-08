// Checks data/global-badges.jsonc before it is signed and published.
// Usage: node scripts/validate-global-badges.ts [file] [--published file]
// With --published, the revision may not be lower than the published one;
// the same revision may be released again.
import fs from 'node:fs';
import path from 'node:path';

import { parse, printParseErrorCode, type ParseError } from 'jsonc-parser';

type Validator = {
    validateGlobalBadgeFile: (
        data: unknown,
        options?: { iconNames?: ReadonlySet<string> }
    ) => string[];
};

type IconCatalog = { BADGE_ICON_NAMES: readonly string[] };

function readJsonc(file: string): unknown {
    const errors: ParseError[] = [];
    const data: unknown = parse(fs.readFileSync(file, 'utf8'), errors, {
        allowTrailingComma: true
    });
    if (errors.length) {
        const details = errors
            .map(
                (error) =>
                    `${printParseErrorCode(error.error)} at ${error.offset}`
            )
            .join(', ');
        throw new Error(`${file} is not valid JSONC: ${details}`);
    }
    return data;
}

const args = process.argv.slice(2);
const publishedIndex = args.indexOf('--published');
const published = publishedIndex >= 0 ? args[publishedIndex + 1] : undefined;
const file =
    args.find(
        (arg, index) =>
            !arg.startsWith('--') &&
            (publishedIndex < 0 || index !== publishedIndex + 1)
    ) ?? 'data/global-badges.jsonc';

const validator = (await import(
    new URL('../src/domain/badges/globalBadges.ts', import.meta.url).href
)) as Validator;

// The icons the app can draw (Lucide plus Lucide Lab), so a misspelt or
// missing icon fails here instead of showing as the default in the app.
const { BADGE_ICON_NAMES } = (await import(
    new URL('../src/components/badges/badgeIconCatalog.ts', import.meta.url)
        .href
)) as IconCatalog;

const data = readJsonc(path.resolve(file));
const problems = validator.validateGlobalBadgeFile(data, {
    iconNames: new Set(BADGE_ICON_NAMES)
});
if (published && fs.existsSync(published)) {
    const before = (readJsonc(published) as { revision?: unknown }).revision;
    const after = (data as { revision?: unknown }).revision;
    if (
        typeof before === 'number' &&
        typeof after === 'number' &&
        after < before
    ) {
        problems.push(
            `"revision" is ${after}, but the published file is already at ${before}; it may not go down.`
        );
    }
}
if (problems.length) {
    console.error(`${file} has ${problems.length} problem(s):`);
    for (const problem of problems) {
        console.error(`- ${problem}`);
    }
    process.exit(1);
}
console.log(`${file} is valid.`);
