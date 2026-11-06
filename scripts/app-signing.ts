import { spawnSync } from 'node:child_process';
import {
    createPrivateKey,
    createPublicKey,
    createSign,
    createVerify,
    randomBytes,
    X509Certificate,
    type KeyLike,
    type KeyObject
} from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');
const publicDirectory = path.join(root, 'signing');
const signatureSuffix = '.nn-signature';
const publishedPublicKey = 'NamelessNanashi-release-public-key.pem';
const publishedCertificate = 'NamelessNanashi-identity.cert.pem';

type SigningIdentity = {
    key: KeyObject;
    encryptedPem: Buffer;
    password: string;
};

function loadSigningIdentity(
    environment: NodeJS.ProcessEnv = process.env,
    settingsFile = path.join(root, '.signing', 'app-signing.json'),
    trustedDirectory = publicDirectory
): SigningIdentity | null {
    const encodedKey = environment.NN_SIGNING_KEY_PEM_BASE64;
    let encryptedPem: Buffer;
    let password: string;
    if (
        encodedKey !== undefined ||
        environment.NN_SIGNING_PASSWORD !== undefined
    ) {
        if (!encodedKey || !environment.NN_SIGNING_PASSWORD) {
            throw new Error(
                'Both NN_SIGNING_KEY_PEM_BASE64 and NN_SIGNING_PASSWORD are required.'
            );
        }
        encryptedPem = Buffer.from(encodedKey, 'base64');
        password = environment.NN_SIGNING_PASSWORD;
    } else {
        let directory = environment.NN_APP_SIGNING_HOME;
        try {
            if (!directory && fs.existsSync(settingsFile)) {
                directory = JSON.parse(
                    fs.readFileSync(settingsFile, 'utf8')
                ).directory;
            }
        } catch {
            throw new Error(
                'Unable to read the configured local app signing identity.'
            );
        }
        if (!directory) {
            if (environment.NN_SIGNING_REQUIRED === '1') {
                throw new Error(
                    'App signing keys are required for release packages. Configure the NN_SIGNING repository secrets.'
                );
            }
            return null;
        }
        try {
            encryptedPem = fs.readFileSync(
                path.join(directory, 'SECRET', 'identity.key.pem')
            );
            password = fs
                .readFileSync(
                    path.join(directory, 'SECRET', 'password.txt'),
                    'utf8'
                )
                .trim();
        } catch {
            throw new Error(
                'Unable to read the configured local app signing identity.'
            );
        }
    }
    let key: KeyObject;
    try {
        key = createPrivateKey({ key: encryptedPem, passphrase: password });
    } catch {
        throw new Error(
            'Unable to unlock the app signing key. Check its format and password.'
        );
    }
    validateSigningKey(key, trustedDirectory);
    return { key, encryptedPem, password };
}

function validateSigningKey(key: KeyObject, trustedDirectory: string): void {
    const expected = createPublicKey(
        fs.readFileSync(path.join(trustedDirectory, 'release-public-key.pem'))
    ).export({ type: 'spki', format: 'der' });
    const actual = createPublicKey(key).export({ type: 'spki', format: 'der' });
    const certificate = new X509Certificate(
        fs.readFileSync(path.join(trustedDirectory, 'identity.cert.pem'))
    );
    if (
        !actual.equals(expected) ||
        !certificate.publicKey
            .export({ type: 'spki', format: 'der' })
            .equals(expected)
    ) {
        throw new Error(
            "The signing key does not match this fork's pinned public key and certificate."
        );
    }
    if (
        Date.now() < Date.parse(certificate.validFrom) ||
        Date.now() >= Date.parse(certificate.validTo)
    ) {
        throw new Error(
            'The app signing certificate is outside its validity period.'
        );
    }
}

async function signFile(file: string, key: KeyObject): Promise<void> {
    const signer = createSign('SHA256');
    for await (const chunk of fs.createReadStream(file)) {
        signer.update(chunk);
    }
    const signature = signer.sign(key);
    const output = `${file}${signatureSuffix}`;
    if (fs.existsSync(output)) {
        if (!fs.readFileSync(output).equals(signature)) {
            throw new Error(`A different signature already exists: ${output}`);
        }
    } else {
        fs.writeFileSync(output, signature, { flag: 'wx' });
    }
    await verifyFile(file, createPublicKey(key));
}

async function verifyFile(
    file: string,
    key: KeyLike = fs.readFileSync(
        path.join(publicDirectory, 'release-public-key.pem')
    )
): Promise<void> {
    const verifier = createVerify('SHA256');
    for await (const chunk of fs.createReadStream(file)) {
        verifier.update(chunk);
    }
    if (!verifier.verify(key, fs.readFileSync(`${file}${signatureSuffix}`))) {
        throw new Error(`Release signature verification failed: ${file}`);
    }
}

function copyPublicMaterial(directory: string): void {
    fs.copyFileSync(
        path.join(publicDirectory, 'release-public-key.pem'),
        path.join(directory, publishedPublicKey)
    );
    fs.copyFileSync(
        path.join(publicDirectory, 'identity.cert.pem'),
        path.join(directory, publishedCertificate)
    );
}

function desktopAssets(directory: string): string[] {
    if (!fs.existsSync(directory)) {
        return [];
    }
    return fs
        .readdirSync(directory, { withFileTypes: true })
        .flatMap((entry) => {
            const file = path.join(directory, entry.name);
            if (entry.isDirectory() && !entry.name.endsWith('.app')) {
                return desktopAssets(file);
            }
            return entry.isFile() &&
                /(?:\.(?:exe|msi|AppImage|dmg|deb|rpm)|\.app\.tar\.gz)$/.test(
                    entry.name
                )
                ? [file]
                : [];
        });
}

async function signFiles(files: string[], key: KeyObject): Promise<void> {
    if (!files.length) {
        throw new Error('No desktop release artifacts were found to sign.');
    }
    for (const file of files) {
        await signFile(file, key);
        copyPublicMaterial(path.dirname(file));
        console.log(`Signed and verified ${file}`);
    }
}

function runPrivate(
    command: string,
    args: string[],
    environment = process.env
): string {
    const result = spawnSync(command, args, {
        env: environment,
        encoding: 'utf8'
    });
    if (result.error || result.status !== 0) {
        throw new Error(
            `${path.basename(command)} ${args[0]} failed during app signing.`
        );
    }
    return result.stdout;
}

function nativeWindows(
    file: string,
    environment = process.env,
    verifyOnly = false
): void {
    const result = spawnSync(
        'powershell.exe',
        [
            '-NoProfile',
            '-File',
            path.join(root, 'scripts', 'sign-windows.ps1'),
            '-FilePath',
            path.resolve(file),
            ...(verifyOnly ? ['-VerifyOnly'] : [])
        ],
        { stdio: 'inherit', env: environment }
    );
    if (result.error || result.status !== 0) {
        throw new Error('Windows Authenticode signing failed.');
    }
}

function prepareNative(
    identity: SigningIdentity,
    environment: NodeJS.ProcessEnv
): { config: object; environment: NodeJS.ProcessEnv; cleanup: () => void } {
    if (process.platform === 'linux') {
        return { config: {}, environment, cleanup: () => {} };
    }
    const temporary = fs.mkdtempSync(
        path.join(os.tmpdir(), 'vrcx-0-app-signing-')
    );
    const certFile = path.join(publicDirectory, 'identity.cert.pem');
    const certificate = new X509Certificate(fs.readFileSync(certFile));
    const thumbprint = certificate.fingerprint.replaceAll(':', '');
    const privateFile = path.join(temporary, 'identity.key.pem');
    const pfx = path.join(temporary, 'identity.p12');
    const passwordFile = path.join(temporary, 'password.txt');
    const keychain = path.join(temporary, 'signing.keychain-db');
    let keychainCreated = false;
    let trustAdded = false;
    let keychains: string[] | undefined;
    const cleanup = () => {
        try {
            if (trustAdded) {
                runPrivate('sudo', [
                    '-n',
                    '/usr/bin/security',
                    'remove-trusted-cert',
                    '-d',
                    certFile
                ]);
            }
        } finally {
            try {
                if (keychains) {
                    runPrivate('/usr/bin/security', [
                        'list-keychains',
                        '-d',
                        'user',
                        '-s',
                        ...keychains
                    ]);
                }
            } finally {
                try {
                    if (keychainCreated) {
                        runPrivate('/usr/bin/security', [
                            'delete-keychain',
                            keychain
                        ]);
                    }
                } finally {
                    fs.rmSync(temporary, { recursive: true, force: true });
                }
            }
        }
    };
    try {
        fs.writeFileSync(privateFile, identity.encryptedPem, { mode: 0o600 });
        fs.writeFileSync(passwordFile, `${identity.password}\n`, {
            mode: 0o600
        });
        const openssl = environment.NN_SIGNING_OPENSSL || 'openssl';
        const compatibility =
            process.platform === 'darwin'
                ? [
                      '-keypbe',
                      'PBE-SHA1-3DES',
                      '-certpbe',
                      'PBE-SHA1-3DES',
                      '-macalg',
                      'sha1'
                  ]
                : [
                      '-keypbe',
                      'AES-256-CBC',
                      '-certpbe',
                      'AES-256-CBC',
                      '-macalg',
                      'sha256'
                  ];
        runPrivate(
            openssl,
            [
                'pkcs12',
                '-export',
                '-inkey',
                privateFile,
                '-in',
                certFile,
                '-passin',
                'env:NN_SIGNING_PASSWORD',
                '-passout',
                'env:NN_SIGNING_PASSWORD',
                '-name',
                'NamelessNanashi',
                '-CSP',
                'Microsoft Enhanced RSA and AES Cryptographic Provider',
                '-keysig',
                '-iter',
                '100000',
                '-out',
                pfx,
                ...compatibility
            ],
            { ...environment, NN_SIGNING_PASSWORD: identity.password }
        );
        fs.chmodSync(pfx, 0o600);
        if (process.platform === 'win32') {
            return {
                config: {
                    bundle: {
                        windows: {
                            signCommand: {
                                cmd: process.execPath,
                                args: [
                                    path.join(
                                        root,
                                        'scripts',
                                        'app-signing.ts'
                                    ),
                                    'windows-native',
                                    '%1'
                                ]
                            }
                        }
                    }
                },
                environment: {
                    ...environment,
                    NN_SIGNING_PFX_FILE: pfx,
                    NN_SIGNING_PASSWORD_FILE: passwordFile,
                    NN_SIGNING_CERT_SHA1: thumbprint
                },
                cleanup
            };
        }
        keychains = runPrivate('/usr/bin/security', [
            'list-keychains',
            '-d',
            'user'
        ])
            .split('\n')
            .map((line) => line.trim().replace(/^"|"$/g, ''))
            .filter(Boolean);
        const keychainPassword = randomBytes(32).toString('hex');
        runPrivate('/usr/bin/security', [
            'create-keychain',
            '-p',
            keychainPassword,
            keychain
        ]);
        keychainCreated = true;
        runPrivate('/usr/bin/security', [
            'unlock-keychain',
            '-p',
            keychainPassword,
            keychain
        ]);
        runPrivate('/usr/bin/security', [
            'set-keychain-settings',
            '-lut',
            '21600',
            keychain
        ]);
        runPrivate('/usr/bin/security', [
            'import',
            pfx,
            '-f',
            'pkcs12',
            '-k',
            keychain,
            '-P',
            identity.password,
            '-T',
            '/usr/bin/codesign'
        ]);
        runPrivate('/usr/bin/security', [
            'set-key-partition-list',
            '-S',
            'apple-tool:,apple:,codesign:',
            '-s',
            '-k',
            keychainPassword,
            keychain
        ]);
        runPrivate('/usr/bin/security', [
            'list-keychains',
            '-d',
            'user',
            '-s',
            ...keychains,
            keychain
        ]);
        const trusted =
            spawnSync(
                '/usr/bin/security',
                ['verify-cert', '-c', certFile, '-p', 'codeSign'],
                { stdio: 'ignore' }
            ).status === 0;
        if (!trusted) {
            if (
                environment.GITHUB_ACTIONS !== 'true' ||
                environment.RUNNER_ENVIRONMENT !== 'github-hosted'
            ) {
                throw new Error(
                    'Trust the NamelessNanashi certificate for Code Signing on this signing Mac first; see BUILDING.md.'
                );
            }
            runPrivate('sudo', [
                '-n',
                '/usr/bin/security',
                'add-trusted-cert',
                '-d',
                '-r',
                'trustRoot',
                '-p',
                'codeSign',
                '-k',
                keychain,
                certFile
            ]);
            trustAdded = true;
        }
        return {
            config: { bundle: { macOS: { signingIdentity: thumbprint } } },
            environment: { ...environment, APPLE_SIGNING_IDENTITY: thumbprint },
            cleanup
        };
    } catch (error) {
        cleanup();
        throw error;
    }
}

function argumentValue(
    args: string[],
    long: string,
    short: string
): string | undefined {
    const options = args.slice(
        0,
        args.includes('--') ? args.indexOf('--') : args.length
    );
    const inline = options.find((arg) => arg.startsWith(`${long}=`));
    const index = options.findIndex((arg) => arg === long || arg === short);
    return (
        inline?.slice(long.length + 1) ??
        (index < 0 ? undefined : options[index + 1])
    );
}

function insertSigningConfig(args: string[], config: object): string[] {
    const separator = args.indexOf('--');
    const index = separator < 0 ? args.length : separator;
    return [
        ...args.slice(0, index),
        '--config',
        JSON.stringify(config),
        ...args.slice(index)
    ];
}

async function tauri(args: string[]): Promise<number> {
    const command = args[0];
    const options = args.slice(
        0,
        args.includes('--') ? args.indexOf('--') : args.length
    );
    const binaryOnly = options.includes('--no-bundle');
    const sign =
        ['build', 'bundle'].includes(command) &&
        !options.includes('--no-sign') &&
        !options.includes('--help') &&
        !options.includes('-h') &&
        !(binaryOnly && process.platform !== 'win32');
    const identity = sign ? loadSigningIdentity() : null;
    let environment = { ...process.env };
    delete environment.NN_SIGNING_KEY_PEM_BASE64;
    delete environment.NN_SIGNING_PASSWORD;
    let prepared: ReturnType<typeof prepareNative> | undefined;
    try {
        if (identity) {
            for (const name of [
                'APPLE_CERTIFICATE',
                'APPLE_CERTIFICATE_PASSWORD',
                'APPLE_ID',
                'APPLE_PASSWORD',
                'APPLE_TEAM_ID',
                'APPLE_API_KEY',
                'APPLE_API_ISSUER',
                'APPLE_API_KEY_PATH'
            ]) {
                delete environment[name];
            }
            prepared = prepareNative(identity, environment);
            environment = prepared.environment;
            args = insertSigningConfig(args, prepared.config);
        } else if (sign) {
            console.log(
                'No local app signing kit found; building without NamelessNanashi signatures.'
            );
        }
        const cli = path.join(
            root,
            'node_modules',
            '@tauri-apps',
            'cli',
            'tauri.js'
        );
        const result = spawnSync(process.execPath, [cli, ...args], {
            cwd: root,
            stdio: 'inherit',
            env: environment
        });
        if (result.error || result.status !== 0) {
            return result.status || 1;
        }
        if (identity) {
            const target =
                argumentValue(args, '--target', '-t') ||
                environment.CARGO_BUILD_TARGET;
            const profile =
                options.includes('--debug') || options.includes('-d')
                    ? 'debug'
                    : 'release';
            const output = path.join(
                environment.CARGO_TARGET_DIR || path.join(root, 'target'),
                ...(target ? [target] : []),
                profile
            );
            if (binaryOnly) {
                const file = path.join(output, 'VRCX-0-Nanashi.exe');
                nativeWindows(file, environment);
                await signFiles([file], identity.key);
            } else {
                if (process.platform === 'win32') {
                    for (const file of [
                        path.join(output, 'VRCX-0-Nanashi.exe'),
                        ...desktopAssets(path.join(output, 'bundle'))
                    ]) {
                        nativeWindows(file, environment, true);
                    }
                } else if (process.platform === 'darwin') {
                    const apps = fs.globSync(
                        path.join(output, 'bundle', 'macos', '*.app')
                    );
                    if (!apps.length) {
                        throw new Error(
                            'No signed macOS app bundle was produced.'
                        );
                    }
                    for (const app of apps) {
                        verifyMacApp(app);
                    }
                }
                await signFiles(
                    desktopAssets(path.join(output, 'bundle')),
                    identity.key
                );
            }
        }
        return 0;
    } finally {
        prepared?.cleanup();
    }
}

function verifyMacApp(app: string): void {
    const temporary = fs.mkdtempSync(
        path.join(os.tmpdir(), 'vrcx-0-signature-check-')
    );
    try {
        runPrivate('/usr/bin/codesign', [
            '--verify',
            '--deep',
            '--strict',
            app
        ]);
        const prefix = path.join(temporary, 'certificate');
        runPrivate('/usr/bin/codesign', [
            '--display',
            `--extract-certificates=${prefix}`,
            app
        ]);
        const actual = new X509Certificate(fs.readFileSync(`${prefix}0`));
        const expected = new X509Certificate(
            fs.readFileSync(path.join(publicDirectory, 'identity.cert.pem'))
        );
        if (!actual.raw.equals(expected.raw)) {
            throw new Error(
                'The macOS app was not signed with the pinned NamelessNanashi certificate.'
            );
        }
    } finally {
        fs.rmSync(temporary, { recursive: true, force: true });
    }
}

function configureRepositorySecrets(): void {
    const identity = loadSigningIdentity({
        ...process.env,
        NN_SIGNING_REQUIRED: '1'
    });
    const repository = 'NanashiTheNameless/VRCX-0-Nanashi';
    const values = {
        NN_SIGNING_KEY_PEM_BASE64: identity!.encryptedPem.toString('base64'),
        NN_SIGNING_PASSWORD: identity!.password
    };
    for (const [name, value] of Object.entries(values)) {
        const result = spawnSync(
            'gh',
            ['secret', 'set', name, '--repo', repository],
            {
                input: value,
                stdio: ['pipe', 'pipe', 'pipe']
            }
        );
        if (result.error || result.status !== 0) {
            throw new Error(
                `Could not configure ${name}. Check GitHub CLI authentication and repository permissions.`
            );
        }
        console.log(`Configured ${name} for ${repository}.`);
    }
}

async function main(): Promise<number> {
    const [command, ...args] = process.argv.slice(2);
    if (command === 'tauri') {
        return tauri(args);
    }
    if (command === 'windows-native' && args.length === 1) {
        nativeWindows(args[0]);
        return 0;
    }
    if (command === 'secrets' && args.length === 0) {
        configureRepositorySecrets();
        return 0;
    }
    if (['sign', 'verify'].includes(command) && args.length) {
        const files = args.flatMap((file) =>
            fs.statSync(file).isDirectory()
                ? desktopAssets(file)
                : [path.resolve(file)]
        );
        if (command === 'verify') {
            if (!files.length) {
                throw new Error(
                    'No desktop release artifacts were found to verify.'
                );
            }
            for (const file of files) {
                await verifyFile(file);
                console.log(`Verified ${file}`);
            }
        } else {
            const identity = loadSigningIdentity({
                ...process.env,
                NN_SIGNING_REQUIRED: '1'
            });
            await signFiles(files, identity!.key);
        }
        return 0;
    }
    throw new Error(
        'Usage: node scripts/app-signing.ts tauri <arguments> | sign <files/directories> | verify <files/directories> | secrets'
    );
}

if (
    process.argv[1] &&
    import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
    main()
        .then((code) => {
            process.exitCode = code;
        })
        .catch((error: Error) => {
            console.error(error.message);
            process.exitCode = 1;
        });
}

export {
    desktopAssets,
    insertSigningConfig,
    loadSigningIdentity,
    signFile,
    signFiles,
    verifyFile
};
