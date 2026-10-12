import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
    readBaseManifest,
    readBaseManifests,
    releaseAssetUrl,
    validateTarget
} from './create-tauri-updater-manifest';
import {
    cargoDependencyClosure,
    createThirdPartyNoticeText,
    normalizeFrontendEntry,
    parseCargoMetadata,
    sanitizeId
} from './generate-third-party-licenses';
import {
    buildReleaseMeta,
    syncVersionToManifests
} from './prepare-release-version';

const temporaryDirectories: string[] = [];

function createTemporaryDirectory(): string {
    const directory = fs.mkdtempSync(
        path.join(os.tmpdir(), 'vrcx-0-release-script-')
    );
    temporaryDirectories.push(directory);
    return directory;
}

function releaseScriptEnvironment(): NodeJS.ProcessEnv {
    const environment = { ...process.env };
    delete environment.GITHUB_OUTPUT;
    return environment;
}

afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

describe('recorder third-party notices', () => {
    it('lists only crates the recorder needs at runtime, including transitive ones', () => {
        const metadata = parseCargoMetadata({
            workspace_members: ['vrcx-0-logger', 'vrcx-0'],
            packages: [
                'vrcx-0-logger',
                'vrcx-0',
                'rustls',
                'ring',
                'tauri',
                'mockito',
                'cc'
            ].map((id) => ({ id, name: id, version: '1.0.0' })),
            resolve: {
                nodes: [
                    {
                        id: 'vrcx-0-logger',
                        deps: [
                            { pkg: 'rustls', dep_kinds: [{ kind: null }] },
                            { pkg: 'mockito', dep_kinds: [{ kind: 'dev' }] },
                            { pkg: 'cc', dep_kinds: [{ kind: 'build' }] }
                        ]
                    },
                    {
                        id: 'rustls',
                        deps: [{ pkg: 'ring', dep_kinds: [{ kind: null }] }]
                    },
                    {
                        id: 'vrcx-0',
                        deps: [{ pkg: 'tauri', dep_kinds: [{ kind: null }] }]
                    }
                ]
            }
        });

        expect(
            [...cargoDependencyClosure(metadata, 'vrcx-0-logger')].sort()
        ).toEqual(['ring', 'rustls', 'vrcx-0-logger']);
    });
});

describe('recorder release version', () => {
    function releaseCheckout() {
        const root = createTemporaryDirectory();
        const manifest = (name: string) =>
            `[package]\nname = "${name}"\nversion = "0.1.0"\n`;
        const lockEntry = (name: string) =>
            `[[package]]\nname = "${name}"\nversion = "0.1.0"\n`;
        const write = (content: string, ...segments: string[]) => {
            fs.mkdirSync(path.join(root, ...segments.slice(0, -1)), {
                recursive: true
            });
            fs.writeFileSync(path.join(root, ...segments), content);
        };
        write(
            JSON.stringify({ version: '2.31.0' }),
            'src-tauri',
            'tauri.conf.json'
        );
        write(manifest('vrcx-0'), 'src-tauri', 'Cargo.toml');
        write(manifest('vrcx-0-logger'), 'crates', 'logger', 'Cargo.toml');
        write(
            manifest('vrcx-0-logger-protocol'),
            'crates',
            'logger-protocol',
            'Cargo.toml'
        );
        write(
            ['vrcx-0-logger-protocol', 'vrcx-0-logger', 'vrcx-0']
                .map(lockEntry)
                .join('\n'),
            'Cargo.lock'
        );
        const read = (...segments: string[]) =>
            fs.readFileSync(path.join(root, ...segments), 'utf8');
        return { root, read, manifest, lockEntry };
    }

    it('moves the recorder to the same version as the desktop release', () => {
        const { root, read } = releaseCheckout();

        syncVersionToManifests('2.32.0-beta.1', root);

        expect(JSON.parse(read('src-tauri', 'tauri.conf.json')).version).toBe(
            '2.32.0-beta.1'
        );
        expect(read('src-tauri', 'Cargo.toml')).toContain(
            'version = "2.32.0-beta.1"'
        );
        expect(read('crates', 'logger', 'Cargo.toml')).toContain(
            'version = "2.32.0-beta.1"'
        );
        expect(read('Cargo.lock')).toContain(
            'name = "vrcx-0-logger"\nversion = "2.32.0-beta.1"'
        );
        expect(read('Cargo.lock')).toContain(
            'name = "vrcx-0"\nversion = "2.32.0-beta.1"'
        );
    });

    it('leaves similarly named crates such as the recorder protocol on their own version', () => {
        const { root, read, manifest, lockEntry } = releaseCheckout();

        syncVersionToManifests('2.32.0-beta.1', root);

        expect(read('crates', 'logger-protocol', 'Cargo.toml')).toBe(
            manifest('vrcx-0-logger-protocol')
        );
        expect(read('Cargo.lock')).toBe(
            [
                lockEntry('vrcx-0-logger-protocol'),
                lockEntry('vrcx-0-logger').replace('0.1.0', '2.32.0-beta.1'),
                lockEntry('vrcx-0').replace('0.1.0', '2.32.0-beta.1')
            ].join('\n')
        );
    });
});

describe('prepare-release-version', () => {
    it('builds stable and nightly metadata without changing manifests', () => {
        expect(buildReleaseMeta('v3.0.0-Nightly-abc1234')).toEqual({
            base_version: '3.0.0',
            build_version: '3.0.0-Nightly-abc1234',
            channel: 'nightly',
            prerelease: 'true',
            nightly_sha: 'abc1234',
            display_version: '3.0.0-Nightly-abc1234',
            tag: 'v3.0.0-Nightly-abc1234'
        });
        expect(buildReleaseMeta('2.31.4')).toMatchObject({
            channel: 'stable',
            prerelease: 'false',
            nightly_sha: ''
        });
        expect(() => buildReleaseMeta('2.31.4-preview.2')).toThrow(
            'Invalid release version: 2.31.4-preview.2'
        );
        expect(() => buildReleaseMeta('2.031.4')).toThrow(
            'Invalid release version: 2.031.4'
        );
    });

    it('preserves the command line dry-run output contract', () => {
        const result = spawnSync(
            process.execPath,
            [
                path.join(import.meta.dirname, 'prepare-release-version.ts'),
                '--version',
                'v3.0.0-Nightly-abc1234',
                '--dry-run'
            ],
            { encoding: 'utf8', env: releaseScriptEnvironment() }
        );

        expect(result.status).toBe(0);
        expect(result.stderr).toBe('');
        expect(result.stdout.trim().split(/\r?\n/)).toEqual([
            'base_version=3.0.0',
            'build_version=3.0.0-Nightly-abc1234',
            'channel=nightly',
            'prerelease=true',
            'nightly_sha=abc1234',
            'display_version=3.0.0-Nightly-abc1234',
            'tag=v3.0.0-Nightly-abc1234'
        ]);
    });
});

describe('create-tauri-updater-manifest', () => {
    it('validates supported targets and encodes release asset URLs', () => {
        expect(() => validateTarget('windows-x86_64-stable')).not.toThrow();
        expect(() =>
            validateTarget('linux-x86_64-appimage-stable')
        ).not.toThrow();
        expect(() => validateTarget('linux-x86_64-deb-stable')).toThrow(
            'Invalid updater target: linux-x86_64-deb-stable'
        );
        expect(() => validateTarget('linux-x86_64-rpm-stable')).toThrow(
            'Invalid updater target: linux-x86_64-rpm-stable'
        );
        expect(() => validateTarget('macos-aarch64-stable')).not.toThrow();
        expect(() => validateTarget('windows-aarch64-stable')).toThrow(
            'Invalid updater target: windows-aarch64-stable'
        );
        expect(releaseAssetUrl('v2.31.4 preview', 'VRCX 0.exe')).toBe(
            'https://github.com/NanashiTheNameless/VRCX-0-Nanashi/releases/download/v2.31.4%20preview/VRCX%200.exe'
        );
    });

    it('keeps existing platform entries when reading a base manifest', () => {
        const directory = createTemporaryDirectory();
        const basePath = path.join(directory, 'base.json');
        fs.writeFileSync(
            basePath,
            JSON.stringify({
                version: '2.31.4',
                notes: 'Existing notes',
                platforms: {
                    'windows-x86_64-stable': {
                        signature: 'windows-signature',
                        url: 'https://example.test/windows'
                    }
                }
            })
        );

        expect(readBaseManifest(basePath, '2.31.4')).toMatchObject({
            version: '2.31.4',
            notes: 'Existing notes',
            platforms: {
                'windows-x86_64-stable': {
                    signature: 'windows-signature',
                    url: 'https://example.test/windows'
                }
            }
        });
        expect(() => readBaseManifest(basePath, '2.31.5')).toThrow(
            'Base manifest version 2.31.4 does not match 2.31.5.'
        );
    });

    it('merges every base manifest into one set of platform entries', () => {
        const directory = createTemporaryDirectory();
        const windowsPath = path.join(directory, 'manifest_windows.json');
        const linuxPath = path.join(directory, 'manifest_linux.json');
        const outputPath = path.join(directory, 'version_manifest.json');
        fs.writeFileSync(
            windowsPath,
            JSON.stringify({
                version: '2.31.4',
                notes: 'Release notes',
                pub_date: '2026-01-01T00:00:00.000Z',
                platforms: {
                    'windows-x86_64-stable': {
                        signature: 'windows-signature',
                        url: 'https://example.test/windows'
                    }
                }
            })
        );
        fs.writeFileSync(
            linuxPath,
            JSON.stringify({
                version: '2.31.4',
                notes: 'Release notes',
                pub_date: '2026-01-01T00:00:00.000Z',
                platforms: {
                    'linux-x86_64-deb-stable': {
                        signature: 'linux-signature',
                        url: 'https://example.test/linux'
                    }
                }
            })
        );

        const result = spawnSync(
            process.execPath,
            [
                path.join(
                    import.meta.dirname,
                    'create-tauri-updater-manifest.ts'
                ),
                '--version',
                '2.31.4',
                '--base',
                windowsPath,
                '--base',
                linuxPath,
                '--out',
                outputPath
            ],
            { encoding: 'utf8', env: releaseScriptEnvironment() }
        );

        expect(result.status).toBe(0);
        expect(JSON.parse(fs.readFileSync(outputPath, 'utf8'))).toEqual({
            version: '2.31.4',
            notes: 'Release notes',
            pub_date: '2026-01-01T00:00:00.000Z',
            platforms: {
                'windows-x86_64-stable': {
                    signature: 'windows-signature',
                    url: 'https://example.test/windows'
                },
                'linux-x86_64-deb-stable': {
                    signature: 'linux-signature',
                    url: 'https://example.test/linux'
                }
            }
        });
    });

    it('rejects base manifests that disagree on a platform', () => {
        const directory = createTemporaryDirectory();
        const firstPath = path.join(directory, 'first.json');
        const secondPath = path.join(directory, 'second.json');
        const shared = {
            'windows-x86_64-stable': {
                signature: 'windows-signature',
                url: 'https://example.test/windows'
            }
        };
        fs.writeFileSync(
            firstPath,
            JSON.stringify({ version: '2.31.4', platforms: shared })
        );
        fs.writeFileSync(
            secondPath,
            JSON.stringify({ version: '2.31.4', platforms: shared })
        );

        expect(() =>
            readBaseManifests([firstPath, secondPath], '2.31.4')
        ).toThrow(
            'Duplicate updater target across base manifests: windows-x86_64-stable.'
        );
    });

    it('writes the updater manifest through the production CLI', () => {
        const directory = createTemporaryDirectory();
        const signaturePath = path.join(directory, 'signature.sig');
        const notesPath = path.join(directory, 'notes.md');
        const outputPath = path.join(directory, 'nested', 'latest.json');
        fs.writeFileSync(signaturePath, ' signed-value \n');
        fs.writeFileSync(notesPath, ' Release notes \n');

        const result = spawnSync(
            process.execPath,
            [
                path.join(
                    import.meta.dirname,
                    'create-tauri-updater-manifest.ts'
                ),
                '--version',
                '2.31.4',
                '--tag',
                'v2.31.4',
                '--target',
                'linux-x86_64-appimage-stable',
                '--asset-name',
                'VRCX-0.AppImage',
                '--signature-file',
                signaturePath,
                '--notes-file',
                notesPath,
                '--out',
                outputPath
            ],
            { encoding: 'utf8', env: releaseScriptEnvironment() }
        );

        expect(result.status).toBe(0);
        expect(result.stderr).toBe('');
        expect(result.stdout.trim()).toBe(outputPath);
        expect(JSON.parse(fs.readFileSync(outputPath, 'utf8'))).toMatchObject({
            version: '2.31.4',
            notes: 'Release notes',
            platforms: {
                'linux-x86_64-appimage-stable': {
                    signature: 'signed-value',
                    url: 'https://github.com/NanashiTheNameless/VRCX-0-Nanashi/releases/download/v2.31.4/VRCX-0.AppImage'
                }
            }
        });
    });
});

describe('generate-third-party-licenses', () => {
    it('normalizes untrusted frontend license entries', () => {
        expect(
            normalizeFrontendEntry(
                {
                    name: ' Example Package ',
                    version: ' 1.2.3 ',
                    identifier: ' MIT ',
                    text: ' Copyright\r\nExample '
                },
                0
            )
        ).toEqual({
            id: 'frontend-example-package-1-2-3',
            name: 'Example Package',
            version: '1.2.3',
            license: 'MIT',
            sourceType: 'frontend',
            sourceLabel: 'Frontend bundle',
            noticeText: 'Copyright\nExample',
            needsReview: false
        });
        expect(sanitizeId(' @Scope/Package 1.0 ')).toBe('scope-package-1-0');
    });

    it('groups notice entries without dropping missing license text', () => {
        const notice = createThirdPartyNoticeText([
            normalizeFrontendEntry({ name: 'Alpha', version: '1.0.0' }, 0),
            normalizeFrontendEntry(
                {
                    name: 'Beta',
                    version: '2.0.0',
                    license: 'MIT',
                    noticeText: 'Beta notice'
                },
                1
            )
        ]);

        expect(notice).toContain('Frontend bundle');
        expect(notice).toContain('## Alpha - 1.0.0');
        expect(notice).toContain(
            'No local license text was generated for this entry.'
        );
        expect(notice).toContain('## Beta - 2.0.0 (MIT)');
        expect(notice).toContain('Beta notice');
        expect(notice.endsWith('\n')).toBe(true);
    });

    it('parses cargo metadata through an explicit boundary', () => {
        expect(
            parseCargoMetadata({
                workspace_members: ['workspace 0.1.0'],
                packages: [
                    {
                        id: 'dependency 1.0.0',
                        name: 'dependency',
                        version: '1.0.0',
                        license: 'MIT',
                        license_file: null,
                        repository: 'https://example.test/dependency',
                        homepage: null
                    }
                ]
            })
        ).toEqual({
            workspaceMembers: ['workspace 0.1.0'],
            packages: [
                {
                    id: 'dependency 1.0.0',
                    name: 'dependency',
                    version: '1.0.0',
                    license: 'MIT',
                    licenseFile: '',
                    repository: 'https://example.test/dependency',
                    homepage: ''
                }
            ],
            resolveNodes: []
        });
    });
});
