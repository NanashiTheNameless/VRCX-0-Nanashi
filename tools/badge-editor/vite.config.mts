// Local editor for data/global-badges.jsonc: `npm run badges:editor`.
// Serves a page that edits the file and previews the badges with the app's
// own components. The file endpoint only exists on this local dev server.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import { resolve } from 'node:path';

import { parse, type ParseError } from 'jsonc-parser';
import {
    mergeConfig,
    type ConfigEnv,
    type Plugin,
    type UserConfig
} from 'vite';

import baseConfig from '../../vite.config.mjs';

const root = resolve(import.meta.dirname, '../..');
const dataFile = resolve(root, 'data/global-badges.jsonc');
const endpoint = '/__badge-editor/file';
const publishedEndpoint = '/__badge-editor/published';
const profileEndpoint = '/__badge-editor/profile';
const PORT = 9010;
const PROFILE_CACHE_MS = 10 * 60 * 1000;
const profileCache = new Map<string, { at: number; body: string }>();

// Only this editor page may use the endpoints that touch the app's login: a
// request from another site (or a rebound host name) is refused.
function isLocalEditorRequest(
    headers: Record<string, string | string[] | undefined>
) {
    const host = String(headers.host ?? '');
    const origin = headers.origin ? String(headers.origin) : '';
    const local = [`127.0.0.1:${PORT}`, `localhost:${PORT}`];
    return (
        local.includes(host) &&
        (!origin || local.some((entry) => origin === `http://${entry}`))
    );
}

// Runs the read-only helper in crates/badge-editor-profile (built on first
// use) to look one user up with the installed app's saved login.
function lookUpProfile(userId: string): Promise<string> {
    const cached = profileCache.get(userId);
    if (cached && Date.now() - cached.at < PROFILE_CACHE_MS) {
        return Promise.resolve(cached.body);
    }
    return new Promise((resolvePromise) => {
        execFile(
            'cargo',
            [
                'run',
                '--quiet',
                '-p',
                'vrcx-0-badge-editor-profile',
                '--',
                userId
            ],
            { cwd: root, timeout: 15 * 60 * 1000, maxBuffer: 32 * 1024 * 1024 },
            (error, stdout) => {
                const line = stdout.trim().split('\n').pop() ?? '';
                const body = line.startsWith('{')
                    ? line
                    : JSON.stringify({
                          ok: false,
                          error: error
                              ? `profile helper failed: ${error.message.split('\n')[0]}`
                              : 'profile helper gave no answer'
                      });
                if (body.includes('"ok":true')) {
                    profileCache.set(userId, { at: Date.now(), body });
                }
                resolvePromise(body);
            }
        );
    });
}
const publishedUrl =
    'https://github.com/NanashiTheNameless/VRCX-0-Nanashi/releases/download/data-assets/global-badges.jsonc';

function badgeFilePlugin(): Plugin {
    return {
        name: 'badge-editor-file',
        configureServer(server) {
            server.middlewares.use(profileEndpoint, (request, response) => {
                if (!isLocalEditorRequest(request.headers)) {
                    response.statusCode = 403;
                    response.end();
                    return;
                }
                const userId =
                    new URL(request.url ?? '', 'http://local').searchParams.get(
                        'userId'
                    ) ?? '';
                if (!/^usr_[0-9a-f-]{36}$/i.test(userId)) {
                    response.statusCode = 400;
                    response.end(
                        JSON.stringify({ ok: false, error: 'bad user id' })
                    );
                    return;
                }
                void lookUpProfile(userId).then((body) => {
                    response.setHeader('content-type', 'application/json');
                    response.end(body);
                });
            });
            // The copy apps currently download, for the before/after preview.
            server.middlewares.use(publishedEndpoint, (_request, response) => {
                fetch(publishedUrl, {
                    headers: { 'user-agent': 'VRCX-0-Nanashi badge editor' }
                })
                    .then(async (result) => {
                        response.statusCode = result.ok ? 200 : 404;
                        response.setHeader(
                            'content-type',
                            'text/plain; charset=utf-8'
                        );
                        response.end(result.ok ? await result.text() : '');
                    })
                    .catch(() => {
                        response.statusCode = 502;
                        response.end('');
                    });
            });
            server.middlewares.use(endpoint, (request, response) => {
                if (!isLocalEditorRequest(request.headers)) {
                    response.statusCode = 403;
                    response.end();
                    return;
                }
                if (request.method === 'GET') {
                    response.setHeader(
                        'content-type',
                        'text/plain; charset=utf-8'
                    );
                    response.end(fs.readFileSync(dataFile, 'utf8'));
                    return;
                }
                if (request.method === 'PUT') {
                    let body = '';
                    request.setEncoding('utf8');
                    request.on('data', (chunk: string) => {
                        body += chunk;
                    });
                    request.on('end', () => {
                        const errors: ParseError[] = [];
                        parse(body, errors, { allowTrailingComma: true });
                        if (errors.length || body.length > 1024 * 1024) {
                            response.statusCode = 400;
                            response.end('Not valid JSONC; nothing was saved.');
                            return;
                        }
                        fs.writeFileSync(dataFile, body);
                        response.end('saved');
                    });
                    return;
                }
                response.statusCode = 405;
                response.end();
            });
        }
    };
}

export default async (env: ConfigEnv): Promise<UserConfig> => {
    const base =
        typeof baseConfig === 'function' ? await baseConfig(env) : baseConfig;
    return mergeConfig(base, {
        root,
        plugins: [badgeFilePlugin()],
        server: {
            port: PORT,
            strictPort: true,
            host: '127.0.0.1',
            open: '/tools/badge-editor/index.html'
        }
    });
};
