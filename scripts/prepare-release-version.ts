import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const rootDir = path.join(import.meta.dirname, '..');
const VERSIONED_CRATES = [
    { manifest: 'src-tauri/Cargo.toml', lockName: 'vrcx-0' },
    { manifest: 'crates/logger/Cargo.toml', lockName: 'vrcx-0-logger' }
];
// Stable: <major>.<minor>.<patch>. Nightly: <major>.<minor>.<patch>-Nightly-<GitSHA7>.
const RELEASE_VERSION_PATTERN =
    /^v?(?<major>[1-9][0-9]{0,1})\.(?<minor>0|[1-9][0-9]{0,2})\.(?<patch>0|[1-9][0-9]{0,2})(?:-Nightly-(?<sha>[0-9a-f]{7}))?$/;

type ReleaseMeta = {
    base_version: string;
    build_version: string;
    channel: 'stable' | 'nightly';
    prerelease: 'true' | 'false';
    nightly_sha: string;
    display_version: string;
    tag: string;
};

function readArg(argName: string, fallback = ''): string {
    const prefix = `--${argName}=`;
    const inline = process.argv.find((arg) => arg.startsWith(prefix));
    if (inline) {
        return inline.slice(prefix.length);
    }

    const index = process.argv.indexOf(`--${argName}`);
    if (index >= 0 && index + 1 < process.argv.length) {
        return process.argv[index + 1];
    }

    return fallback;
}

function hasFlag(argName: string): boolean {
    return process.argv.includes(`--${argName}`);
}

function buildReleaseMeta(versionInput: string): ReleaseMeta {
    const version = versionInput.trim();
    const match = RELEASE_VERSION_PATTERN.exec(version);
    if (!match?.groups) {
        throw new Error(`Invalid release version: ${version}`);
    }

    const buildVersion = version.replace(/^v/, '');
    const baseVersion = `${match.groups.major}.${match.groups.minor}.${match.groups.patch}`;
    const channel = match.groups.sha ? 'nightly' : 'stable';

    return {
        base_version: baseVersion,
        build_version: buildVersion,
        channel,
        prerelease: channel === 'nightly' ? 'true' : 'false',
        nightly_sha: match.groups.sha || '',
        display_version: buildVersion,
        tag: `v${buildVersion}`
    };
}

function replaceVersion(
    content: string,
    pattern: RegExp,
    version: string,
    description: string
): string {
    if (!pattern.test(content)) {
        throw new Error(`Failed to update ${description} version`);
    }
    return content.replace(pattern, `$1"${version}"`);
}

function syncVersionToManifests(buildVersion: string, root = rootDir): void {
    const tauriConfigPath = path.join(root, 'src-tauri', 'tauri.conf.json');
    const parsedTauriConfig: unknown = JSON.parse(
        fs.readFileSync(tauriConfigPath, 'utf8')
    );
    if (!parsedTauriConfig || typeof parsedTauriConfig !== 'object') {
        throw new Error('Invalid src-tauri/tauri.conf.json');
    }
    const tauriConfig = parsedTauriConfig as Record<string, unknown>;
    tauriConfig.version = buildVersion;
    fs.writeFileSync(
        tauriConfigPath,
        `${JSON.stringify(tauriConfig, null, 4)}\n`
    );

    for (const crate of VERSIONED_CRATES) {
        const manifestPath = path.join(root, crate.manifest);
        fs.writeFileSync(
            manifestPath,
            replaceVersion(
                fs.readFileSync(manifestPath, 'utf8'),
                /(^\[package\][\s\S]*?^version\s*=\s*)"[^"]+"/m,
                buildVersion,
                crate.manifest
            )
        );
    }

    const cargoLockPath = path.join(root, 'Cargo.lock');
    if (!fs.existsSync(cargoLockPath)) {
        return;
    }
    let cargoLock = fs.readFileSync(cargoLockPath, 'utf8');
    for (const crate of VERSIONED_CRATES) {
        cargoLock = replaceVersion(
            cargoLock,
            new RegExp(
                `(\\[\\[package\\]\\]\\r?\\nname = "${crate.lockName}"\\r?\\nversion = )"[^"]+"`
            ),
            buildVersion,
            `Cargo.lock ${crate.lockName}`
        );
    }
    fs.writeFileSync(cargoLockPath, cargoLock);
}

function writeOutputs(meta: ReleaseMeta): void {
    const lines = Object.entries(meta).map(([key, value]) => `${key}=${value}`);
    for (const line of lines) {
        console.log(line);
    }

    if (process.env.GITHUB_OUTPUT) {
        fs.appendFileSync(process.env.GITHUB_OUTPUT, `${lines.join('\n')}\n`);
    }
}

function main(): void {
    const meta = buildReleaseMeta(readArg('version'));
    if (!hasFlag('dry-run')) {
        syncVersionToManifests(meta.build_version);
    }
    writeOutputs(meta);
}

if (
    process.argv[1] &&
    import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
    try {
        main();
    } catch (error) {
        console.error(error);
        process.exitCode = 1;
    }
}

export { buildReleaseMeta, syncVersionToManifests };
