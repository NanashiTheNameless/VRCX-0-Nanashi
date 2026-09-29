// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    getInstance: vi.fn(),
    recordLocationHintsFromInstances: vi.fn()
}));

vi.mock('@/repositories/vrchatInstanceRepository', () => ({
    default: { getInstance: mocks.getInstance }
}));

vi.mock('@/services/domainIngestionService', () => ({
    recordLocationHintsFromInstances: mocks.recordLocationHintsFromInstances
}));

import { useWorldDialogInstanceData } from './useWorldDialogInstanceData';

const target = {
    location: 'wrld_test:12345',
    worldId: 'wrld_test',
    instanceId: '12345'
};

describe('useWorldDialogInstanceData', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getInstance.mockResolvedValue({
            json: { id: target.location }
        });
    });

    it('reloads only when locations or the source revision change', async () => {
        const sourceRevision = [{ location: target.location }];
        const { rerender } = renderHook(
            ({ sourceRevision, targets }) =>
                useWorldDialogInstanceData({
                    endpoint: 'https://api.example.test',
                    sourceRevision,
                    targets
                }),
            {
                initialProps: {
                    sourceRevision,
                    targets: [{ ...target }]
                }
            }
        );

        await waitFor(() => {
            expect(mocks.getInstance).toHaveBeenCalledOnce();
        });

        await act(async () => {
            rerender({ sourceRevision, targets: [{ ...target }] });
            await Promise.resolve();
        });

        expect(mocks.getInstance).toHaveBeenCalledOnce();

        const nextSourceRevision = [{ location: target.location }];
        rerender({
            sourceRevision: nextSourceRevision,
            targets: [{ ...target }]
        });

        await waitFor(() => {
            expect(mocks.getInstance).toHaveBeenCalledTimes(2);
        });

        rerender({
            sourceRevision: nextSourceRevision,
            targets: [
                {
                    location: 'wrld_test:67890',
                    worldId: 'wrld_test',
                    instanceId: '67890'
                }
            ]
        });

        await waitFor(() => {
            expect(mocks.getInstance).toHaveBeenCalledTimes(3);
        });
        expect(mocks.getInstance).toHaveBeenLastCalledWith({
            worldId: 'wrld_test',
            instanceId: '67890'
        });
    });
});
