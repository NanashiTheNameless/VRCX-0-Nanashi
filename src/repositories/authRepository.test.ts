import { beforeEach, describe, expect, it, vi } from 'vitest';

const commandMocks = vi.hoisted(() => ({
    appVrchatAuthSavedSnapshotGet: vi.fn()
}));

vi.mock('@/platform/tauri/bindings', () => ({
    commands: commandMocks
}));

import authRepository from './authRepository';

describe('authRepository', () => {
    beforeEach(() => {
        vi.resetAllMocks();
    });

    it('wraps platform command failures with the repository fallback message', async () => {
        commandMocks.appVrchatAuthSavedSnapshotGet.mockRejectedValueOnce(
            new Error('bridge unavailable')
        );

        await expect(authRepository.getSavedAuthSnapshot()).rejects.toThrow(
            'Auth saved snapshot failed: bridge unavailable'
        );
    });
});
