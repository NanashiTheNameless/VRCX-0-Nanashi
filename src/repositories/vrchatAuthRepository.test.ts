import { beforeEach, describe, expect, it, vi } from 'vitest';

const commandMocks = vi.hoisted(() => ({
    appVrchatAuthConfigGet: vi.fn(),
    appVrchatAuthCurrentUserGet: vi.fn(),
    appVrchatAuthSessionStart: vi.fn(),
    appVrchatAuthSessionRespond: vi.fn(),
    appVrchatAuthSessionCancel: vi.fn(),
    appVrchatAuthVisitsGet: vi.fn(),
    appVrchatAuthFileAnalysisGet: vi.fn()
}));

vi.mock('@/platform/tauri/bindings', () => ({
    commands: commandMocks
}));

import { DEFAULT_VRCHAT_API_ENDPOINT } from '@/shared/vrchatEndpoint';

import vrchatAuthRepository from './vrchatAuthRepository';

function response(status = 200, data: unknown = { id: 'usr_1' }) {
    return {
        status,
        data: typeof data === 'string' ? data : JSON.stringify(data)
    };
}

function cancelledState() {
    return { status: 'cancelled' };
}

describe('vrchatAuthRepository', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        for (const command of Object.values(commandMocks)) {
            command.mockResolvedValue(response());
        }
        commandMocks.appVrchatAuthSessionStart.mockResolvedValue(
            cancelledState()
        );
        commandMocks.appVrchatAuthSessionRespond.mockResolvedValue(
            cancelledState()
        );
        commandMocks.appVrchatAuthSessionCancel.mockResolvedValue(
            cancelledState()
        );
    });

    it('unwraps auth responses against the canonical VRChat endpoint', async () => {
        await expect(
            vrchatAuthRepository.getCurrentUser()
        ).resolves.toMatchObject({
            json: {
                id: 'usr_1'
            },
            status: 200,
            endpointDomain: DEFAULT_VRCHAT_API_ENDPOINT
        });

        expect(commandMocks.appVrchatAuthCurrentUserGet).toHaveBeenCalledWith();
    });

    it('builds file-analysis requests with numeric versions and encoded error endpoints', async () => {
        commandMocks.appVrchatAuthFileAnalysisGet.mockResolvedValueOnce(
            response(404, {
                error: {
                    message: 'Missing file analysis'
                }
            })
        );

        await expect(
            vrchatAuthRepository.getFileAnalysis({
                fileId: 'file 1',
                version: 2,
                variant: 'Quest/Android'
            })
        ).rejects.toMatchObject({
            message: 'Missing file analysis',
            status: 404,
            endpoint: 'analysis/file%201/2/Quest%2FAndroid'
        });

        expect(commandMocks.appVrchatAuthFileAnalysisGet).toHaveBeenCalledWith({
            fileId: 'file 1',
            version: 2,
            variant: 'Quest/Android'
        });
    });

    it('throws a structured request error for a rejected config request', async () => {
        commandMocks.appVrchatAuthConfigGet.mockResolvedValueOnce(
            response(403, {
                error: {
                    message: 'Forbidden'
                }
            })
        );

        await expect(vrchatAuthRepository.getConfig()).rejects.toMatchObject({
            message: 'Forbidden',
            status: 403,
            endpoint: 'config'
        });
    });
});
