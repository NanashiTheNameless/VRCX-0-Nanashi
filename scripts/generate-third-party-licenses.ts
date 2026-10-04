import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

type JsonRecord = Record<string, unknown>;

type ThirdPartyLicenseEntry = {
    id: string;
    name: string;
    version: string;
    license: string;
    sourceType: string;
    sourceLabel: string;
    projectUrl?: string;
    noticeText: string;
    needsReview: boolean;
};

type CargoMetadataPackage = {
    id: string;
    name: string;
    version: string;
    license: string;
    licenseFile: string;
    repository: string;
    homepage: string;
};

type CargoMetadata = {
    workspaceMembers: string[];
    packages: CargoMetadataPackage[];
};

const rootDir = path.join(import.meta.dirname, '..');
const outputDir = path.join(rootDir, 'dist', 'licenses');
const frontendLicenseJsonPath = path.join(outputDir, 'frontend-licenses.json');
const outputManifestPath = path.join(outputDir, 'third-party-licenses.json');
const packageLockPath = path.join(rootDir, 'package-lock.json');
const tauriLicenseResourceDir = path.join(
    rootDir,
    'src-tauri',
    'resources',
    'licenses'
);
const tauriResourceNoticePath = path.join(
    tauriLicenseResourceDir,
    'THIRD_PARTY_NOTICES.txt'
);
const bundledFontPackages = Object.freeze([
    '@fontsource-variable/geist',
    '@fontsource/jost'
]);

function isRecord(value: unknown): value is JsonRecord {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function normalizeWhitespace(value: unknown): string {
    return String(value ?? '')
        .replace(/\r\n/g, '\n')
        .trim();
}

function sanitizeId(value: unknown): string {
    return String(value)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
}

function readRequiredJsonArray(filePath: string): unknown[] {
    if (!fs.existsSync(filePath)) {
        throw new Error(
            `Missing frontend license manifest: ${path.relative(rootDir, filePath)}`
        );
    }

    const parsed: unknown = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (!Array.isArray(parsed)) {
        throw new Error(
            `Frontend license manifest must be a JSON array: ${path.relative(rootDir, filePath)}`
        );
    }

    return parsed;
}

function normalizeFrontendEntry(
    entry: unknown,
    index: number
): ThirdPartyLicenseEntry {
    const source = isRecord(entry) ? entry : {};
    const packageName =
        normalizeWhitespace(source.name) || `frontend-package-${index + 1}`;
    const version = normalizeWhitespace(source.version);
    const license = normalizeWhitespace(source.identifier || source.license);
    const noticeText = normalizeWhitespace(source.text || source.noticeText);

    return {
        id: `frontend-${sanitizeId(`${packageName}-${version || index + 1}`)}`,
        name: packageName,
        version,
        license,
        sourceType: 'frontend',
        sourceLabel: 'Frontend bundle',
        noticeText,
        needsReview: !license && !noticeText
    };
}

function getPackageDir(packageName: string): string {
    return path.join(rootDir, 'node_modules', ...packageName.split('/'));
}

function readPackageJson(packageName: string): JsonRecord {
    const packageJsonPath = path.join(
        getPackageDir(packageName),
        'package.json'
    );
    if (!fs.existsSync(packageJsonPath)) {
        return {};
    }

    const parsed: unknown = JSON.parse(
        fs.readFileSync(packageJsonPath, 'utf8')
    );
    return isRecord(parsed) ? parsed : {};
}

function readPackageLicenseText(packageName: string): string {
    const licensePath = path.join(getPackageDir(packageName), 'LICENSE');
    if (!fs.existsSync(licensePath)) {
        return '';
    }

    return normalizeWhitespace(fs.readFileSync(licensePath, 'utf8'));
}

function readBundledFontEntries(
    existingEntries: readonly ThirdPartyLicenseEntry[]
): ThirdPartyLicenseEntry[] {
    if (!fs.existsSync(packageLockPath)) {
        return [];
    }

    const parsedPackageLock: unknown = JSON.parse(
        fs.readFileSync(packageLockPath, 'utf8')
    );
    const packageLock = isRecord(parsedPackageLock) ? parsedPackageLock : {};
    const packages = isRecord(packageLock.packages) ? packageLock.packages : {};
    const existingEntryKeys = new Set(
        existingEntries.map((entry) => `${entry.name}@${entry.version}`)
    );

    return bundledFontPackages
        .map((packageName, index): ThirdPartyLicenseEntry | null => {
            const lockEntryValue = packages[`node_modules/${packageName}`];
            if (!isRecord(lockEntryValue)) {
                return null;
            }

            const packageJson = readPackageJson(packageName);
            const entryName =
                normalizeWhitespace(packageJson.name) || packageName;
            const version = normalizeWhitespace(
                packageJson.version || lockEntryValue.version
            );
            if (existingEntryKeys.has(`${entryName}@${version}`)) {
                return null;
            }

            const license = normalizeWhitespace(
                packageJson.license || lockEntryValue.license
            );
            const noticeText = readPackageLicenseText(packageName);

            return {
                id: `font-${sanitizeId(`${entryName}-${version || index + 1}`)}`,
                name: entryName,
                version,
                license,
                sourceType: 'font',
                sourceLabel: 'Bundled font asset',
                projectUrl: normalizeWhitespace(packageJson.homepage),
                noticeText,
                needsReview: !license && !noticeText
            };
        })
        .filter((entry): entry is ThirdPartyLicenseEntry => entry !== null);
}

function createThirdPartyNoticeText(
    entries: readonly ThirdPartyLicenseEntry[]
): string {
    const lines = [
        'VRCX-0-Nanashi Third-Party Notices',
        '',
        `Generated: ${new Date().toISOString()}`,
        ''
    ];

    if (!entries.length) {
        lines.push('No license manifest was available.', '');
        return `${lines.join('\n').trimEnd()}\n`;
    }

    const groups = new Map<string, ThirdPartyLicenseEntry[]>();
    for (const entry of entries) {
        const label = entry.sourceLabel || 'Third-party dependency';
        const entriesForLabel = groups.get(label) || [];
        entriesForLabel.push(entry);
        groups.set(label, entriesForLabel);
    }

    const sortedLabels = [...groups.keys()].sort((left, right) =>
        left.localeCompare(right)
    );
    for (const label of sortedLabels) {
        lines.push(
            '========================================',
            label,
            '========================================',
            ''
        );
        for (const entry of groups.get(label) || []) {
            lines.push(
                `## ${entry.name}${entry.version ? ` - ${entry.version}` : ''}${entry.license ? ` (${entry.license})` : ''}`,
                '',
                entry.noticeText ||
                    'No local license text was generated for this entry.',
                ''
            );
        }
    }

    return `${lines.join('\n').trimEnd()}\n`;
}

function parseCargoMetadata(value: unknown): CargoMetadata {
    if (!isRecord(value)) {
        throw new Error('Cargo metadata must be an object');
    }
    const workspaceMembers = Array.isArray(value.workspace_members)
        ? value.workspace_members.map(String)
        : [];
    const packages = Array.isArray(value.packages)
        ? value.packages.filter(isRecord).map((pkg): CargoMetadataPackage => ({
              id: normalizeWhitespace(pkg.id),
              name: normalizeWhitespace(pkg.name),
              version: normalizeWhitespace(pkg.version),
              license: normalizeWhitespace(pkg.license),
              licenseFile: normalizeWhitespace(pkg.license_file),
              repository: normalizeWhitespace(pkg.repository),
              homepage: normalizeWhitespace(pkg.homepage)
          }))
        : [];
    return { workspaceMembers, packages };
}

function readRustEntries(): ThirdPartyLicenseEntry[] {
    const cargoManifestPath = path.join(rootDir, 'Cargo.toml');
    if (!fs.existsSync(cargoManifestPath)) {
        return [];
    }

    let metadata: CargoMetadata;
    try {
        const output = execFileSync(
            'cargo',
            [
                'metadata',
                '--format-version',
                '1',
                '--manifest-path',
                cargoManifestPath
            ],
            { encoding: 'utf8', maxBuffer: 1024 * 1024 * 64 }
        );
        metadata = parseCargoMetadata(JSON.parse(output));
    } catch (error) {
        console.warn(
            `Skipping Rust dependency licenses (cargo unavailable): ${error instanceof Error ? error.message : String(error)}`
        );
        return [];
    }

    const workspaceMemberIds = new Set(metadata.workspaceMembers);
    return metadata.packages
        .filter((pkg) => !workspaceMemberIds.has(pkg.id))
        .map((pkg): ThirdPartyLicenseEntry => {
            const license = normalizeWhitespace(
                pkg.license || (pkg.licenseFile ? `See ${pkg.licenseFile}` : '')
            );

            return {
                id: `rust-${sanitizeId(`${pkg.name}-${pkg.version}`)}`,
                name: pkg.name,
                version: pkg.version,
                license,
                sourceType: 'rust',
                sourceLabel: 'Rust dependency (backend)',
                projectUrl: normalizeWhitespace(pkg.repository || pkg.homepage),
                noticeText: '',
                needsReview: !license
            };
        });
}

function removeIntermediateFrontendManifest(): void {
    if (fs.existsSync(frontendLicenseJsonPath)) {
        fs.unlinkSync(frontendLicenseJsonPath);
    }
}

function main(): void {
    fs.mkdirSync(outputDir, { recursive: true });
    fs.mkdirSync(tauriLicenseResourceDir, { recursive: true });

    const frontendEntries = readRequiredJsonArray(frontendLicenseJsonPath)
        .map(normalizeFrontendEntry)
        .sort((left, right) => left.name.localeCompare(right.name));
    const bundledFontEntries = readBundledFontEntries(frontendEntries);
    const rustEntries = readRustEntries();
    const entries = [
        ...frontendEntries,
        ...bundledFontEntries,
        {
            id: 'font-0xproto',
            name: '0xProto',
            version: '',
            license: 'OFL-1.1',
            sourceType: 'font',
            sourceLabel: 'Bundled UI and VR overlay font',
            projectUrl: 'https://github.com/0xType/0xProto',
            noticeText: fs.readFileSync(
                path.join(rootDir, 'LICENSES/OFL-1.1-0xProto.txt'),
                'utf8'
            ),
            needsReview: false
        },
        ...[
            [
                'haeldb',
                'UI Sounds (HaelDB)',
                'https://opengameart.org/content/ui-sounds-0'
            ],
            [
                'bart',
                'Interface Beeps (bart)',
                'https://opengameart.org/content/interface-beeps'
            ],
            [
                'kenney',
                'Digital Audio (Kenney)',
                'https://kenney.nl/assets/digital-audio'
            ]
        ].map(([id, name, projectUrl]) => ({
            id: `sounds-${id}`,
            name,
            version: '',
            license: 'CC0-1.0',
            sourceType: 'sound',
            sourceLabel: 'Bundled notification sounds',
            projectUrl,
            noticeText: fs.readFileSync(
                path.join(rootDir, 'LICENSES/CC0-1.0.txt'),
                'utf8'
            ),
            needsReview: false
        })),
        ...rustEntries
    ].sort((left, right) => left.name.localeCompare(right.name));
    const manifest = {
        generatedAt: new Date().toISOString(),
        noticePath: 'licenses/THIRD_PARTY_NOTICES.txt',
        entries
    };

    fs.writeFileSync(outputManifestPath, JSON.stringify(manifest, null, 4));
    fs.writeFileSync(
        tauriResourceNoticePath,
        createThirdPartyNoticeText(entries)
    );
    removeIntermediateFrontendManifest();

    const reviewCount = manifest.entries.filter(
        (entry) => entry.needsReview
    ).length;
    console.log(
        `Generated third-party license manifest with ${manifest.entries.length} entries (${reviewCount} requiring review).`
    );
}

if (
    process.argv[1] &&
    import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
    main();
}

export {
    createThirdPartyNoticeText,
    normalizeFrontendEntry,
    parseCargoMetadata,
    sanitizeId
};
