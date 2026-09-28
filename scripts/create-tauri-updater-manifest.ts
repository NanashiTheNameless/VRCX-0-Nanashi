import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const REPO_RELEASE_DOWNLOAD_BASE =
    'https://github.com/NanashiTheNameless/VRCX-0-Nanashi/releases/download';

type UpdaterPlatform = {
    signature: string;
    url: string;
};

type UpdaterManifest = Record<string, unknown> & {
    version: string;
    platforms: Record<string, unknown>;
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

function requireArg(argName: string): string {
    const value = readArg(argName).trim();
    if (!value) {
        throw new Error(`Missing required argument: --${argName}`);
    }
    return value;
}

function validateTarget(target: string): void {
    if (
        /^windows-x86_64-stable$/.test(target) === false &&
        /^linux-x86_64-(appimage|deb|rpm)-stable$/.test(target) === false &&
        /^macos-(aarch64|x86_64)-stable$/.test(target) === false
    ) {
        throw new Error(`Invalid updater target: ${target}`);
    }
}

function readNotes(notesFile: string): string {
    if (!notesFile) {
        return '';
    }
    return fs.readFileSync(notesFile, 'utf8').trim();
}

function releaseAssetUrl(tag: string, assetName: string): string {
    return `${REPO_RELEASE_DOWNLOAD_BASE}/${encodeURIComponent(tag)}/${encodeURIComponent(assetName)}`;
}

function readBaseManifest(
    basePath: string,
    version: string
): UpdaterManifest | null {
    if (!basePath) {
        return null;
    }

    const parsedManifest: unknown = JSON.parse(
        fs.readFileSync(basePath, 'utf8')
    );
    if (!parsedManifest || typeof parsedManifest !== 'object') {
        throw new Error(`Base manifest must be an object: ${basePath}`);
    }
    const manifest = parsedManifest as Record<string, unknown>;
    if (manifest.version !== version) {
        throw new Error(
            `Base manifest version ${manifest.version} does not match ${version}.`
        );
    }
    if (
        !manifest.platforms ||
        typeof manifest.platforms !== 'object' ||
        Array.isArray(manifest.platforms)
    ) {
        throw new Error(`Base manifest has no platforms object: ${basePath}`);
    }
    return manifest as UpdaterManifest;
}

function main(): void {
    const version = requireArg('version');
    const tag = requireArg('tag');
    const target = requireArg('target');
    const assetName = requireArg('asset-name');
    const signatureFile = requireArg('signature-file');
    const out = requireArg('out');
    const notesFile = readArg('notes-file');
    const base = readArg('base');

    validateTarget(target);

    const signature = fs.readFileSync(signatureFile, 'utf8').trim();
    if (!signature) {
        throw new Error(`Signature file is empty: ${signatureFile}`);
    }

    const manifest: UpdaterManifest = readBaseManifest(base, version) || {
        version,
        notes: readNotes(notesFile),
        pub_date: new Date().toISOString(),
        platforms: {}
    };
    const platform: UpdaterPlatform = {
        signature,
        url: releaseAssetUrl(tag, assetName)
    };
    manifest.platforms[target] = platform;

    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, `${JSON.stringify(manifest, null, 4)}\n`);
    console.log(out);
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

export { readBaseManifest, releaseAssetUrl, validateTarget };
