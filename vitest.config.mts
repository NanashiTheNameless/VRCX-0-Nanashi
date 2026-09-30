import { resolve } from 'node:path';

import react from '@vitejs/plugin-react';
import { configDefaults, defineConfig } from 'vitest/config';

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
        exclude: [...configDefaults.exclude, '.claude/**']
    }
});
