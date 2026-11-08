import { lstat, opendir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = new Set(process.argv.slice(2));
const allowed = new Set([
    '--caches-only',
    '--dry-run',
    '--frontend-only',
    '--help'
]);
for (const arg of args) {
    if (!allowed.has(arg)) throw new Error(`Unknown option: ${arg}`);
}

if (args.has('--help')) {
    console.log('Usage: npm run clean -- [--dry-run] [--frontend-only]');
    console.log('       npm run clean:caches -- [--dry-run] [--frontend-only]');
    console.log('       npm run clean:dry-run -- [--frontend-only]');
    console.log('       npm run clean:caches:dry-run -- [--frontend-only]');
    process.exit(0);
}

const root = fileURLToPath(new URL('../', import.meta.url));
const dryRun = args.has('--dry-run');
const cachesOnly = args.has('--caches-only');
const paths = [
    ...(args.has('--frontend-only') ? [] : ['target', 'src-tauri/target']),
    'node_modules/.vite',
    'node_modules/.vite-temp',
    'node_modules/.cache',
    'node_modules/.tmp',
    '.vite',
    '.vite-temp',
    'tools/badge-editor/node_modules/.vite',
    'tools/badge-editor/node_modules/.vite-temp',
    'tsconfig.tsbuildinfo',
    'tsconfig.app.tsbuildinfo',
    'tsconfig.node.tsbuildinfo',
    ...(cachesOnly
        ? []
        : [
              'dist',
              'build',
              'tools/badge-editor/dist',
              'src-tauri/gen',
              'src-tauri/resources/licenses/THIRD_PARTY_NOTICES.txt',
              'coverage',
              '.nyc_output',
              'scripts/__pycache__'
          ])
];

function formatBytes(bytes) {
    const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
    const unit =
        bytes > 0
            ? Math.min(
                  Math.floor(Math.log(bytes) / Math.log(1024)),
                  units.length - 1
              )
            : 0;
    return `${(bytes / 1024 ** unit).toFixed(unit === 0 ? 0 : 2)} ${units[unit]}`;
}

function formatCount(count, singular, plural = `${singular}s`) {
    return `${count.toLocaleString('en-US')} ${count === 1 ? singular : plural}`;
}

const reports = [];
const hardlinks = new Map();
let missing = 0;
let skipped = 0;

async function scanPath(target, report) {
    const entry = await lstat(target).catch((error) => {
        if (error.code === 'ENOENT') return null;
        throw error;
    });
    if (!entry) return;
    const bytes = Number.isFinite(entry.blocks)
        ? entry.blocks * 512
        : entry.size;
    if (entry.isDirectory()) {
        report.directories++;
        report.bytes += bytes;
        const directory = await opendir(target);
        for await (const child of directory) {
            await scanPath(join(target, child.name), report);
        }
        return;
    }
    report.files++;
    if (entry.isFile() && entry.nlink > 1 && entry.ino !== 0) {
        const key = `${entry.dev}:${entry.ino}`;
        let group = hardlinks.get(key);
        if (!group) {
            group = { bytes, links: entry.nlink, paths: new Map() };
            hardlinks.set(key, group);
        }
        group.links = Math.max(group.links, entry.nlink);
        group.bytes = Math.max(group.bytes, bytes);
        group.paths.set(report, (group.paths.get(report) ?? 0) + 1);
    } else {
        report.bytes += bytes;
    }
}

console.log('Scanning cleanup paths...');
for (const path of paths) {
    const report = {
        path,
        files: 0,
        directories: 0,
        bytes: 0,
        status: 'scanned'
    };
    let target = root;
    let present = true;
    try {
        for (const part of path.split('/')) {
            target = join(target, part);
            const entry = await lstat(target).catch((error) => {
                if (error.code === 'ENOENT') return null;
                throw error;
            });
            if (!entry) {
                missing++;
                present = false;
                break;
            }
            if (entry.isSymbolicLink()) {
                console.log(`Skipping symlink: ${path}`);
                skipped++;
                present = false;
                break;
            }
        }
        if (!present) continue;
        await scanPath(target, report);
        report.target = target;
    } catch (error) {
        report.status = 'failed';
        console.error(`Failed to scan ${path}: ${error.message}`);
        process.exitCode = 1;
    }
    reports.push(report);
}

for (const report of reports) {
    if (report.status === 'failed') continue;
    if (dryRun) {
        report.status = 'would remove';
        continue;
    }
    console.log(`Removing ${report.path}...`);
    try {
        await rm(report.target, {
            recursive: true,
            force: true,
            maxRetries: 3
        });
        report.status = 'removed';
    } catch (error) {
        report.status = 'failed';
        console.error(`Failed to remove ${report.path}: ${error.message}`);
        process.exitCode = 1;
    }
}

for (const group of hardlinks.values()) {
    const removed = [...group.paths].filter(
        ([report]) => report.status !== 'failed'
    );
    const links = removed.reduce((total, [, count]) => total + count, 0);
    if (links >= group.links) {
        removed.at(-1)[0].bytes += group.bytes;
    }
}

console.log('\nCleanup report:');
const totals = { paths: 0, files: 0, directories: 0, bytes: 0, failed: 0 };
for (const report of reports) {
    if (report.status === 'failed') {
        totals.failed++;
        console.log(`Failed: ${report.path} (excluded from totals)`);
        continue;
    }
    totals.paths++;
    totals.files += report.files;
    totals.directories += report.directories;
    totals.bytes += report.bytes;
    console.log(
        `${dryRun ? 'Would remove' : 'Removed'} ${report.path}: ${formatBytes(report.bytes)}, ${formatCount(report.files, 'file')}, ${formatCount(report.directories, 'directory', 'directories')}`
    );
}
console.log(
    `Total: ${formatCount(totals.paths, 'path')}, ${formatCount(totals.files, 'file')}, ${formatCount(totals.directories, 'directory', 'directories')}`
);
console.log(
    `Estimated space ${dryRun ? 'to reclaim' : 'reclaimed'}: ${formatBytes(totals.bytes)} (${totals.bytes.toLocaleString('en-US')} bytes)`
);
console.log(
    `Missing: ${formatCount(missing, 'path')}. Skipped symlinks: ${skipped}. Failed: ${totals.failed}.`
);
console.log(
    dryRun
        ? 'Dry run complete. No files removed.'
        : totals.failed > 0
          ? 'Cleanup finished with errors. Failed paths may be partially removed.'
          : cachesOnly
            ? 'Cache cleanup complete.'
            : 'Build and cache cleanup complete.'
);
