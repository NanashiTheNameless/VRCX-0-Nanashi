import { beforeEach, describe, expect, it, vi } from 'vitest';

const { navigate, recordRecentToolOpen } = vi.hoisted(() => ({
    navigate: vi.fn(),
    recordRecentToolOpen: vi.fn(() => Promise.resolve())
}));

vi.mock('@/services/toastService', () => ({
    toast: { add: vi.fn() }
}));
vi.mock('@/platform/tauri/bindings', () => ({
    commands: {}
}));
vi.mock('@/services/hostCapabilityService', () => ({
    getHostCapabilityUnavailableReason: vi.fn(() => 'Unavailable'),
    isHostCapabilityAvailable: vi.fn(() => false),
    isHostCapabilitySupported: vi.fn(() => false)
}));
vi.mock('@/services/i18nService', () => ({
    default: { t: vi.fn((key: string) => key) }
}));
vi.mock('@/services/toolRecentService', () => ({
    recordRecentToolOpen
}));

import { triggerToolByKey } from './toolActionService';

describe('tool action dispatch', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('records one open when dispatching an available tool', async () => {
        await triggerToolByKey('inventory', {
            navigate,
            t: (key) => key
        });

        expect(recordRecentToolOpen).toHaveBeenCalledWith('inventory');
        expect(navigate).toHaveBeenCalledWith('/tools/inventory');
    });

    it('does not record unknown or unavailable tools', async () => {
        await triggerToolByKey('unknown-tool', {
            navigate,
            t: (key) => key
        });
        await triggerToolByKey('vrc-photos', {
            navigate,
            t: (key) => key
        });

        expect(recordRecentToolOpen).not.toHaveBeenCalled();
        expect(navigate).not.toHaveBeenCalled();
    });
});
