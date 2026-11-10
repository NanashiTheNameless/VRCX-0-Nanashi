import fs from 'node:fs';
import path from 'node:path';

const { buildOverlayBadgeEffects } = (await import(
    new URL('./overlayBadgeEffects.ts', import.meta.url).href
)) as typeof import('./overlayBadgeEffects');

const root = path.join(import.meta.dirname, '..');
const target = path.join(root, 'crates/vr-overlay/ui/badge-effects.json');
const data = buildOverlayBadgeEffects(
    fs.readFileSync(path.join(root, 'src/styles/globals.css'), 'utf8')
);
if (process.argv.includes('--check')) {
    if (
        JSON.stringify(JSON.parse(fs.readFileSync(target, 'utf8'))) !==
        JSON.stringify(JSON.parse(data))
    ) {
        throw new Error(
            'Run npm run badges:overlay-fx after changing badge effects.'
        );
    }
} else {
    fs.writeFileSync(target, data);
}
