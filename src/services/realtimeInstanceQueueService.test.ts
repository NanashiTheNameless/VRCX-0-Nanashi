import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AppToastOptions } from '@/services/toastService';

const mocks = vi.hoisted(() => ({
    success: vi.fn(),
    t: vi.fn((key: string) => key)
}));

vi.mock('@/services/toastService', () => ({
    toast: {
        add: (options: AppToastOptions) => {
            switch (options.type) {
                case 'success':
                    return mocks.success(options);
                default:
                    throw new Error('Unhandled toast type: ' + options.type);
            }
        }
    }
}));
vi.mock('@/services/i18nService', () => ({
    default: { t: mocks.t }
}));

import type { RealtimeInstanceQueueProjection } from '@/platform/tauri/bindings';
import { useLocationHintStore } from '@/state/locationHintStore';
import { useRuntimeStore } from '@/state/runtimeStore';

import { handleRealtimeInstanceQueueProjection } from './realtimeInstanceQueueService';

function queueProjection(
    kind: RealtimeInstanceQueueProjection['kind'],
    instanceLocation: string,
    values: {
        position?: number;
        queueSize?: number;
        receivedAt?: string;
    } = {}
): RealtimeInstanceQueueProjection {
    return {
        generation: 1,
        kind,
        instanceLocation,
        worldId: 'wrld_queue',
        worldName: 'Queue World',
        position: values.position ?? 0,
        queueSize: values.queueSize ?? 0,
        receivedAt: values.receivedAt ?? '2026-08-02T00:00:00.000Z'
    };
}

describe('realtimeInstanceQueueService', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-08-02T00:00:00.000Z'));
        mocks.success.mockReset();
        mocks.t.mockClear();
        useRuntimeStore.getState().resetRuntimeState();
        useLocationHintStore.getState().resetLocationHints();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('ignores projections without a location', () => {
        handleRealtimeInstanceQueueProjection(queueProjection('update', ''));

        expect(useRuntimeStore.getState().instanceQueue.active).toBe(false);
        expect(mocks.success).not.toHaveBeenCalled();
    });

    it('clamps negative queue numbers and reuses the current label', () => {
        useRuntimeStore.getState().setInstanceQueueState({
            active: true,
            instanceLocation: 'wrld_queue:123',
            label: 'Known Queue'
        });

        handleRealtimeInstanceQueueProjection(
            queueProjection('update', ' wrld_queue:123 ', {
                position: -3,
                queueSize: 5
            })
        );

        expect(useRuntimeStore.getState().instanceQueue).toEqual({
            active: true,
            instanceLocation: 'wrld_queue:123',
            position: 0,
            queueSize: 5,
            label: 'Known Queue',
            updatedAt: '2026-08-02T00:00:00.000Z'
        });
    });

    it('clears ready and left events only when they belong to the active queue', () => {
        useRuntimeStore.getState().setInstanceQueueState({
            active: true,
            instanceLocation: 'wrld_current:123',
            label: 'Current Queue'
        });

        handleRealtimeInstanceQueueProjection(
            queueProjection('left', 'wrld_other:456')
        );
        expect(useRuntimeStore.getState().instanceQueue.active).toBe(true);

        handleRealtimeInstanceQueueProjection(
            queueProjection('ready', 'wrld_other:456')
        );
        expect(useRuntimeStore.getState().instanceQueue.active).toBe(true);
        expect(mocks.success).toHaveBeenCalledWith(
            expect.objectContaining({
                type: 'success',
                title: 'Instance ready to join wrld_other public'
            })
        );

        handleRealtimeInstanceQueueProjection(
            queueProjection('left', 'wrld_current:123')
        );
        expect(useRuntimeStore.getState().instanceQueue.active).toBe(false);
    });

    it('clears the active queue and announces it with the cached label when it becomes ready', () => {
        useRuntimeStore.getState().setInstanceQueueState({
            active: true,
            instanceLocation: 'wrld_current:123',
            label: 'Current Queue'
        });

        handleRealtimeInstanceQueueProjection(
            queueProjection('ready', 'wrld_current:123')
        );

        expect(useRuntimeStore.getState().instanceQueue.active).toBe(false);
        expect(mocks.success).toHaveBeenCalledWith(
            expect.objectContaining({
                type: 'success',
                title: 'Instance ready to join Current Queue'
            })
        );
    });

    it('uses location hints when a queue label is not already cached', () => {
        useRuntimeStore.getState().setAuthBootstrap({
            currentUserEndpoint: 'https://api.vrchat.cloud/api/1'
        });
        useLocationHintStore.getState().upsertLocationHint({
            endpoint: 'https://api.vrchat.cloud/api/1',
            location: 'wrld_hint:123~group(grp_hint)',
            worldName: 'Hinted World',
            groupName: 'Hinted Group'
        });

        handleRealtimeInstanceQueueProjection(
            queueProjection('update', 'wrld_hint:123~group(grp_hint)', {
                position: 2,
                queueSize: 8,
                receivedAt: '2026-08-01T23:59:00.000Z'
            })
        );

        expect(useRuntimeStore.getState().instanceQueue).toMatchObject({
            label: 'Hinted World group(Hinted Group)',
            updatedAt: '2026-08-01T23:59:00.000Z'
        });
    });
});
