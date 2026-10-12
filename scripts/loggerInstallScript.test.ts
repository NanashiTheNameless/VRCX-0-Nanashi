import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

const rootDir = path.join(import.meta.dirname, '..');
const installScript = path.join(rootDir, 'crates', 'logger', 'install.sh');
const composeFile = path.join(rootDir, 'crates', 'logger', 'compose.yaml');

const STUBS: Record<string, string> = {
    docker: `#!/bin/sh
echo "docker $*" >> "$STUB_LOG"
[ -n "\${STUB_NO_COMPOSE:-}" ] && [ "$1" = compose ] && exit 1
[ "$1 $2" = "compose version" ] && exit 0
[ -n "\${STUB_DOCKER_FAIL:-}" ] && [ "$2" = "$STUB_DOCKER_FAIL" ] && exit 1
exit 0
`,
    curl: `#!/bin/sh
out=""
url=""
while [ $# -gt 0 ]; do
    case "$1" in
        -o) out=$2; shift 2 ;;
        -*) shift ;;
        *) url=$1; shift ;;
    esac
done
echo "curl $url" >> "$STUB_LOG"
case "$url" in
    */health) [ -z "\${STUB_HEALTH_FAIL:-}" ] ;;
    *) cp "$STUB_COMPOSE" "$out" ;;
esac
`,
    hostname: `#!/bin/sh
echo "192.168.1.20 "
`,
    sleep: `#!/bin/sh
exit 0
`
};

const temporaryDirectories: string[] = [];

type Run = {
    status: number | null;
    stdout: string;
    stderr: string;
    calls: string[];
    installDir: string;
};

function sandbox() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vrcx-0-install-'));
    temporaryDirectories.push(root);
    const bin = path.join(root, 'bin');
    fs.mkdirSync(bin);
    for (const [name, body] of Object.entries(STUBS)) {
        fs.writeFileSync(path.join(bin, name), body, { mode: 0o755 });
    }
    return { root, bin };
}

function install(
    box: { root: string; bin: string },
    options: {
        args?: string[];
        answers?: string[];
        env?: Record<string, string>;
    } = {}
): Run {
    const log = path.join(box.root, 'calls.log');
    fs.writeFileSync(log, '');
    const answersFile = path.join(box.root, 'answers');
    if (options.answers) {
        fs.writeFileSync(answersFile, `${options.answers.join('\n')}\n`);
    }
    const result = spawnSync('sh', [installScript, ...(options.args ?? [])], {
        cwd: box.root,
        encoding: 'utf8',
        input: '',
        env: {
            ...process.env,
            PATH: `${box.bin}${path.delimiter}${process.env.PATH ?? ''}`,
            STUB_LOG: log,
            STUB_COMPOSE: composeFile,
            VRCX0_LOGGER_ANSWERS: options.answers
                ? answersFile
                : path.join(box.root, 'no-terminal'),
            ...options.env
        }
    });
    expect(result.error).toBeUndefined();
    return {
        status: result.status,
        stdout: result.stdout,
        stderr: result.stderr,
        calls: fs.readFileSync(log, 'utf8').split('\n').filter(Boolean),
        installDir: path.join(box.root, 'vrcx-0-logger')
    };
}

function readSettings(dir: string): Record<string, string> {
    return Object.fromEntries(
        fs
            .readFileSync(path.join(dir, '.env'), 'utf8')
            .split('\n')
            .filter(Boolean)
            .map((line) => {
                const [key, ...value] = line.split('=');
                return [key, value.join('=')];
            })
    );
}

function started(run: Run): boolean {
    return run.calls.includes('docker compose up -d');
}

afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

describe('one-command recorder install', { timeout: 30_000 }, () => {
    it('installs with the defaults when nobody answers and prints the address and a generated password', () => {
        const run = install(sandbox());

        expect(run.status).toBe(0);
        expect(readSettings(run.installDir)).toEqual({
            VRCX0_LOGGER_TAG: 'latest',
            VRCX0_LOGGER_PORT: '8787',
            VRCX0_LOGGER_BIND: '0.0.0.0',
            VRCX0_LOGGER_RETENTION_DAYS: '',
            VRCX0_LOGGER_MAX_STORAGE_MB: '1024'
        });
        const password = fs.readFileSync(
            path.join(run.installDir, 'password'),
            'utf8'
        );
        expect(password).toMatch(/^[A-Za-z0-9]{20}$/);
        expect(fs.existsSync(path.join(run.installDir, 'data'))).toBe(true);
        expect(
            fs.readFileSync(path.join(run.installDir, 'compose.yaml'), 'utf8')
        ).toBe(fs.readFileSync(composeFile, 'utf8'));
        expect(run.calls).toEqual(
            expect.arrayContaining([
                'docker compose pull',
                'docker compose up -d',
                'curl http://127.0.0.1:8787/health'
            ])
        );
        expect(run.stdout).toContain('http://192.168.1.20:8787');
        expect(run.stdout).toContain(`Password: ${password}`);
    });

    it('uses what the user types for each setting', () => {
        const box = sandbox();
        const run = install(box, {
            answers: [
                'recorder',
                'beta',
                '9000',
                '',
                '30',
                '500',
                'my-secret-pw'
            ]
        });

        const dir = path.join(box.root, 'recorder');
        expect(run.status).toBe(0);
        expect(readSettings(dir)).toEqual({
            VRCX0_LOGGER_TAG: 'beta',
            VRCX0_LOGGER_PORT: '9000',
            VRCX0_LOGGER_BIND: '0.0.0.0',
            VRCX0_LOGGER_RETENTION_DAYS: '30',
            VRCX0_LOGGER_MAX_STORAGE_MB: '500'
        });
        expect(fs.readFileSync(path.join(dir, 'password'), 'utf8')).toBe(
            'my-secret-pw'
        );
        expect(run.stdout).toContain('http://192.168.1.20:9000');
        expect(run.stderr).toContain('Port [8787]');
    });

    it('listens only on the address the user gives, for example a VPN address on a VPS', () => {
        const run = install(sandbox(), { answers: ['', '', '', '100.64.0.5'] });

        expect(run.status).toBe(0);
        expect(readSettings(run.installDir).VRCX0_LOGGER_BIND).toBe(
            '100.64.0.5'
        );
        expect(run.calls).toContain('curl http://100.64.0.5:8787/health');
        expect(run.stdout).toContain('http://100.64.0.5:8787');
    });

    it('keeps a default for every question the user skips', () => {
        const run = install(sandbox(), {
            answers: ['', '', '', '', '', '', '']
        });

        expect(run.status).toBe(0);
        expect(readSettings(run.installDir)).toMatchObject({
            VRCX0_LOGGER_PORT: '8787',
            VRCX0_LOGGER_BIND: '0.0.0.0'
        });
        expect(
            fs.readFileSync(path.join(run.installDir, 'password'), 'utf8')
        ).toHaveLength(20);
    });

    it('takes defaults from environment variables when there is no terminal', () => {
        const run = install(sandbox(), {
            env: {
                VRCX0_LOGGER_TAG: 'beta',
                VRCX0_LOGGER_PORT: '9100',
                VRCX0_LOGGER_RETENTION_DAYS: '7',
                VRCX0_LOGGER_PASSWORD: 'from-the-env'
            }
        });

        expect(run.status).toBe(0);
        expect(readSettings(run.installDir)).toMatchObject({
            VRCX0_LOGGER_TAG: 'beta',
            VRCX0_LOGGER_PORT: '9100',
            VRCX0_LOGGER_RETENTION_DAYS: '7'
        });
        expect(
            fs.readFileSync(path.join(run.installDir, 'password'), 'utf8')
        ).toBe('from-the-env');
    });

    it('keeps records within 1 GB unless the user removes the limit with 0', () => {
        const limited = install(sandbox());
        const unlimited = install(sandbox(), {
            answers: ['', '', '', '', '', '0']
        });

        expect(
            readSettings(limited.installDir).VRCX0_LOGGER_MAX_STORAGE_MB
        ).toBe('1024');
        expect(unlimited.status).toBe(0);
        expect(
            readSettings(unlimited.installDir).VRCX0_LOGGER_MAX_STORAGE_MB
        ).toBe('0');
    });

    it('accepts a pinned version as the release channel', () => {
        const run = install(sandbox(), { answers: ['', '2.32.0-beta.1'] });

        expect(run.status).toBe(0);
        expect(readSettings(run.installDir).VRCX0_LOGGER_TAG).toBe(
            '2.32.0-beta.1'
        );
    });

    it('keeps the last answer even when it has no line break after it', () => {
        const box = sandbox();
        fs.writeFileSync(
            path.join(box.root, 'answers'),
            ['', '', '', '', '', '', 'no-newline-pw'].join('\n')
        );

        const run = install(box, {
            env: { VRCX0_LOGGER_ANSWERS: path.join(box.root, 'answers') }
        });

        expect(run.status).toBe(0);
        expect(
            fs.readFileSync(path.join(run.installDir, 'password'), 'utf8')
        ).toBe('no-newline-pw');
    });

    it.each([
        { answers: ['', 'stable'], reason: 'release channel' },
        { answers: ['', '2.32'], reason: 'release channel' },
        { answers: ['', '', 'abc'], reason: 'port must be a number' },
        { answers: ['', '', '70000'], reason: 'between 1 and 65535' },
        { answers: ['', '', '', 'my-vpn'], reason: 'listen address' },
        { answers: ['', '', '', '', '0'], reason: 'number of days' },
        { answers: ['', '', '', '', '', '-5'], reason: 'storage limit' },
        { answers: ['', '', '', '', '', '', 'short'], reason: 'at least 8' }
    ])(
        'refuses an invalid answer ($reason) without starting anything',
        ({ answers, reason }) => {
            const run = install(sandbox(), { answers });

            expect(run.status).not.toBe(0);
            expect(run.stderr).toContain(reason);
            expect(started(run)).toBe(false);
        }
    );

    it('asks again on the next run when the first install could not start', () => {
        const box = sandbox();
        const failed = install(box, {
            answers: ['', 'beta'],
            env: { STUB_DOCKER_FAIL: 'pull' }
        });
        expect(failed.status).not.toBe(0);

        const again = install(box, { answers: ['', 'latest', '9200'] });

        expect(again.status).toBe(0);
        expect(readSettings(again.installDir)).toMatchObject({
            VRCX0_LOGGER_TAG: 'latest',
            VRCX0_LOGGER_PORT: '9200'
        });
    });

    it('reports a recorder that never becomes healthy', () => {
        const run = install(sandbox(), { env: { STUB_HEALTH_FAIL: '1' } });

        expect(run.status).not.toBe(0);
        expect(run.stderr).toContain('did not start');
    });

    it('stops when the image cannot be pulled', () => {
        const run = install(sandbox(), { env: { STUB_DOCKER_FAIL: 'pull' } });

        expect(run.status).not.toBe(0);
        expect(started(run)).toBe(false);
    });

    it('needs Docker Compose v2', () => {
        const run = install(sandbox(), { env: { STUB_NO_COMPOSE: '1' } });

        expect(run.status).not.toBe(0);
        expect(run.stderr).toContain('Docker Compose v2');
        expect(started(run)).toBe(false);
    });
});

describe('updating an installed recorder', { timeout: 30_000 }, () => {
    it('keeps the settings and password and only pulls and restarts', () => {
        const box = sandbox();
        const first = install(box, {
            answers: ['', 'beta', '9000', '', '', '', 'keep-this-pw']
        });
        const settings = readSettings(first.installDir);

        const again = install(box, { answers: ['', ''] });

        expect(again.status).toBe(0);
        expect(readSettings(again.installDir)).toEqual(settings);
        expect(
            fs.readFileSync(path.join(again.installDir, 'password'), 'utf8')
        ).toBe('keep-this-pw');
        expect(again.calls).toEqual(
            expect.arrayContaining([
                'docker compose pull',
                'docker compose up -d'
            ])
        );
        expect(again.stdout).toContain('Password: unchanged');
        expect(again.stdout).toContain(':9000');
    });

    it('takes over a manual Compose install without touching its password', () => {
        const box = sandbox();
        const dir = path.join(box.root, 'vrcx-0-logger');
        fs.mkdirSync(path.join(dir, 'data'), { recursive: true });
        fs.copyFileSync(composeFile, path.join(dir, 'compose.yaml'));
        fs.writeFileSync(path.join(dir, 'password'), 'manual-password');

        const run = install(box, { answers: ['', ''] });

        expect(run.status).toBe(0);
        expect(fs.readFileSync(path.join(dir, 'password'), 'utf8')).toBe(
            'manual-password'
        );
        expect(readSettings(dir)).toMatchObject({
            VRCX0_LOGGER_TAG: 'latest',
            VRCX0_LOGGER_PORT: '8787',
            VRCX0_LOGGER_BIND: '0.0.0.0'
        });
        expect(run.stderr).not.toContain('Recorder password');
        expect(run.stdout).toContain('Password: unchanged');
    });

    it('reads settings edited on Windows or written with quotes', () => {
        const box = sandbox();
        const first = install(box);
        fs.writeFileSync(
            path.join(first.installDir, '.env'),
            [
                'VRCX0_LOGGER_TAG="beta"',
                'VRCX0_LOGGER_PORT="9000"',
                'VRCX0_LOGGER_BIND=0.0.0.0',
                ''
            ].join('\r\n')
        );

        const again = install(box, { answers: ['', ''] });

        expect(again.status).toBe(0);
        expect(again.stderr).toContain('[beta]');
        expect(again.calls).toContain('curl http://127.0.0.1:9000/health');
        expect(
            fs.readFileSync(path.join(again.installDir, '.env'), 'utf8')
        ).not.toContain('\r');
    });

    it('keeps changes the user made to compose.yaml', () => {
        const box = sandbox();
        const first = install(box);
        const composePath = path.join(first.installDir, 'compose.yaml');
        fs.writeFileSync(composePath, 'services: {} # edited by the user\n');

        const again = install(box);

        expect(again.status).toBe(0);
        expect(fs.readFileSync(composePath, 'utf8')).toBe(
            'services: {} # edited by the user\n'
        );
        expect(again.calls.some((call) => call.includes('compose.yaml'))).toBe(
            false
        );
    });

    it('lets the user switch the release channel, for example to move off a pinned version', () => {
        const box = sandbox();
        install(box, { answers: ['', '2.32.0'] });

        const again = install(box, { answers: ['', 'latest'] });

        expect(again.status).toBe(0);
        expect(again.stderr).toContain('[2.32.0]');
        expect(readSettings(again.installDir).VRCX0_LOGGER_TAG).toBe('latest');
    });

    it('goes back to the previous release channel when the update cannot start', () => {
        const box = sandbox();
        install(box);

        const failed = install(box, {
            answers: ['', 'beta'],
            env: { STUB_DOCKER_FAIL: 'pull' }
        });

        expect(failed.status).not.toBe(0);
        expect(failed.stderr).toContain('previous release channel');
        expect(readSettings(failed.installDir).VRCX0_LOGGER_TAG).toBe('latest');
        expect(started(failed)).toBe(true);
    });

    it('down stops the recorder and keeps its data and password', () => {
        const box = sandbox();
        install(box);

        const run = install(box, { args: ['down'] });

        expect(run.status).toBe(0);
        expect(run.calls).toContain('docker compose down');
        expect(started(run)).toBe(false);
        expect(fs.existsSync(path.join(run.installDir, 'password'))).toBe(true);
    });

    it('down in a folder without a recorder changes nothing', () => {
        const box = sandbox();

        const run = install(box, { args: ['down'], answers: ['typo-dir'] });

        expect(run.status).not.toBe(0);
        expect(run.stderr).toContain('no recorder is installed');
        expect(fs.existsSync(path.join(box.root, 'typo-dir'))).toBe(false);
        expect(run.calls).not.toContain('docker compose down');
    });
});
