import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import react from '@vitejs/plugin-react';
import { configDefaults, defineConfig } from 'vitest/config';

// Worker threads cannot change the timezone, so tests that stub TZ run in
// forked processes; everything else runs in faster worker threads.
const timezoneTestFiles = readdirSync('src', { recursive: true })
    .map((file) => `src/${String(file).replaceAll('\\', '/')}`)
    .filter((file) => /\.test\.tsx?$/.test(file))
    .filter((file) =>
        /stubEnv\(\s*['"]TZ['"]/.test(readFileSync(file, 'utf8'))
    );

export default defineConfig({
    plugins: [react()],
    resolve: {
        alias: {
            '@': resolve(import.meta.dirname, 'src')
        }
    },
    test: {
        environment: 'node',
        setupFiles: ['src/test/setup.ts'],
        // The userEvent-driven integration tests drive dozens of pointer
        // actions per test. They pass in ~2-3s alone but scale past the 5s
        // default when the suite runs in parallel, so the default fails them
        // intermittently and the aborted runs corrupt the tests that follow.
        testTimeout: 20000,
        exclude: [...configDefaults.exclude, '.claude/**'],
        projects: [
            {
                extends: true,
                test: {
                    name: 'threads',
                    pool: 'threads',
                    exclude: timezoneTestFiles
                }
            },
            {
                extends: true,
                test: {
                    name: 'timezone',
                    pool: 'forks',
                    include: timezoneTestFiles
                }
            }
        ]
    }
});
