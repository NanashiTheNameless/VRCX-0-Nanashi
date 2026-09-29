import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    getConfig: vi.fn(),
    refreshConfig: vi.fn()
}));

vi.mock('@/repositories/vrchatAuthRepository', () => ({
    default: {
        getConfig: mocks.getConfig,
        refreshConfig: mocks.refreshConfig
    }
}));

import { useRuntimeStore } from '@/state/runtimeStore';
import { useVrchatConfigStore } from '@/state/vrchatConfigStore';

import { loadVrchatConfigSnapshot } from './vrchatConfigService';

function setAuth(userId: string, endpoint: string): void {
    useRuntimeStore.getState().setAuthBootstrap({
        currentUserId: userId,
        currentUserDisplayName: userId,
        currentUserEndpoint: endpoint
    });
}

function deferred<T>() {
    let resolve: (value: T) => void = () => {
        throw new Error('Deferred promise was not initialized.');
    };
    const promise = new Promise<T>((next) => {
        resolve = next;
    });
    return { promise, resolve };
}

describe('vrchatConfigService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        useRuntimeStore.getState().resetRuntimeState();
        useVrchatConfigStore.getState().reset();
        setAuth('usr_self', 'https://api.vrchat.cloud/api/1');
    });

    it('loads the backend config snapshot into the frontend session store', async () => {
        const snapshot = {
            sdkUnityVersion: '2022.3.22f1',
            constants: { LANGUAGE: { eng: 'English' } }
        };
        mocks.getConfig.mockResolvedValue({ json: snapshot });

        await expect(loadVrchatConfigSnapshot()).resolves.toEqual(snapshot);

        expect(mocks.getConfig).toHaveBeenCalledTimes(1);
        expect(mocks.refreshConfig).not.toHaveBeenCalled();
        expect(useVrchatConfigStore.getState().snapshot).toEqual(snapshot);
    });

    it('uses the explicit refresh command only when forced', async () => {
        const snapshot = { sdkUnityVersion: '2022.3.23f1' };
        mocks.refreshConfig.mockResolvedValue({ json: snapshot });

        await expect(
            loadVrchatConfigSnapshot({ force: true })
        ).resolves.toEqual(snapshot);

        expect(mocks.refreshConfig).toHaveBeenCalledTimes(1);
        expect(mocks.getConfig).not.toHaveBeenCalled();
    });

    it('does not publish a response after the authenticated scope changes', async () => {
        const request = deferred<{ json: Record<string, unknown> }>();
        mocks.getConfig.mockReturnValue(request.promise);

        const loading = loadVrchatConfigSnapshot();
        setAuth('usr_other', 'https://api.example.test/api/1');
        request.resolve({ json: { sdkUnityVersion: 'stale' } });

        await expect(loading).resolves.toBeNull();
        expect(useVrchatConfigStore.getState().snapshot).toBeNull();
    });
});
