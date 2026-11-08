// Writes the fork developer badge keyframes into src/styles/globals.css.
// Usage: node scripts/generate-dev-badge-effects.ts [--check]
// With --check, only reports whether the stylesheet is up to date.
import fs from 'node:fs';
import path from 'node:path';

const { applyToStylesheet, sameIgnoringWhitespace, scanGaps } = (await import(
    new URL('./devBadgeEffects.ts', import.meta.url).href
)) as typeof import('./devBadgeEffects');

const file = path.join(import.meta.dirname, '..', 'src/styles/globals.css');
const css = fs.readFileSync(file, 'utf8');
const next = applyToStylesheet(css);

if (process.argv.includes('--check')) {
    if (!sameIgnoringWhitespace(css, next)) {
        console.error(
            'The developer badge keyframes are out of date. Run npm run badges:dev-fx.'
        );
        process.exit(1);
    }
    console.log('The developer badge keyframes are up to date.');
} else {
    fs.writeFileSync(file, next);
    scanGaps().forEach(({ before, after }, index) => {
        console.log(
            `Scan ${index + 1}: ${before.toFixed(2)}s before, ${after.toFixed(2)}s after.`
        );
    });
    console.log(
        'Wrote the developer badge keyframes. Run npm run format next.'
    );
}
