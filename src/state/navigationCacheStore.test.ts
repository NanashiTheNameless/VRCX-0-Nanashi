import { beforeEach, describe, expect, it, vi } from 'vitest';

const fs = vi.hoisted(() => ({
    readTextFile: vi.fn(),
    writeTextFile: vi.fn().mockResolvedValue(undefined),
    mkdir: vi.fn().mockResolvedValue(undefined)
}));

vi.mock('@tauri-apps/plugin-fs', () => ({
    ...fs,
    BaseDirectory: { AppCache: 16 }
}));

beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
});

describe('navigation cache', () => {
    it('restores the route and independent open and closed folders', async () => {
        fs.readTextFile.mockResolvedValue(
            JSON.stringify({
                lastRoute: '/settings?tab=appearance',
                folders: { favorites: false, tools: true, invalid: 'true' },
                settingsCards: {
                    'system.application': false,
                    'advanced.troubleshooting': true,
                    invalid: 'true'
                },
                toolRows: { 'status-schedule': false, invalid: 1 }
            })
        );
        const { useNavigationCacheStore } =
            await import('./navigationCacheStore');
        await useNavigationCacheStore.getState().hydrate();
        const state = useNavigationCacheStore.getState();
        expect(state).toMatchObject({
            hydrated: true,
            lastRoute: '/settings?tab=appearance'
        });
        expect(state.folders).toEqual({ favorites: false, tools: true });
        expect(state.settingsCards).toEqual({
            'system.application': false,
            'advanced.troubleshooting': true
        });
        expect(state.toolRows).toEqual({ 'status-schedule': false });
        expect(fs.writeTextFile).not.toHaveBeenCalled();
    });

    it('does not overwrite stored navigation before hydration completes', async () => {
        let finishRead: (value: string) => void = () => {};
        fs.readTextFile.mockReturnValue(
            new Promise<string>((resolve) => {
                finishRead = resolve;
            })
        );
        const { useNavigationCacheStore } =
            await import('./navigationCacheStore');
        const loading = useNavigationCacheStore.getState().hydrate();
        useNavigationCacheStore.getState().setLastRoute('/feed');
        useNavigationCacheStore.getState().setFolderOpen('tools', false);
        useNavigationCacheStore
            .getState()
            .setSettingsCardOpen('system.application', true);
        finishRead(
            JSON.stringify({
                lastRoute: '/game-log',
                folders: { tools: true },
                settingsCards: { 'system.application': false }
            })
        );
        await loading;
        expect(useNavigationCacheStore.getState().lastRoute).toBe('/game-log');
        expect(useNavigationCacheStore.getState().folders.tools).toBe(true);
        expect(
            useNavigationCacheStore.getState().settingsCards[
                'system.application'
            ]
        ).toBe(false);
        expect(fs.writeTextFile).not.toHaveBeenCalled();
    });

    it('continues with defaults on damaged cache and saves subsequent changes together', async () => {
        fs.readTextFile.mockResolvedValue('{');
        const { useNavigationCacheStore } =
            await import('./navigationCacheStore');
        await useNavigationCacheStore.getState().hydrate();
        expect(useNavigationCacheStore.getState().hydrated).toBe(true);
        useNavigationCacheStore.getState().setFolderOpen('favorites', false);
        useNavigationCacheStore.getState().setLastRoute('/friends-locations');
        useNavigationCacheStore
            .getState()
            .setToolRowOpen('status-schedule', false);
        await vi.waitFor(() =>
            expect(fs.writeTextFile).toHaveBeenCalledTimes(3)
        );
        expect(JSON.parse(fs.writeTextFile.mock.calls[2][1])).toEqual({
            lastRoute: '/friends-locations',
            folders: { favorites: false },
            settingsCards: {},
            toolRows: { 'status-schedule': false }
        });
    });

    it('serializes rapid card changes and restores the final states on restart', async () => {
        fs.readTextFile.mockResolvedValue(
            JSON.stringify({ lastRoute: '/settings', folders: { tools: true } })
        );
        const { useNavigationCacheStore } =
            await import('./navigationCacheStore');
        await useNavigationCacheStore.getState().hydrate();
        expect(useNavigationCacheStore.getState().settingsCards).toEqual({});
        let finishWrite: () => void = () => {};
        fs.writeTextFile.mockImplementationOnce(
            () =>
                new Promise<void>((resolve) => {
                    finishWrite = resolve;
                })
        );
        const { setSettingsCardOpen } = useNavigationCacheStore.getState();
        setSettingsCardOpen('system.application', false);
        setSettingsCardOpen('advanced.troubleshooting', true);
        setSettingsCardOpen('system.application', true);
        setSettingsCardOpen('system.application', false);
        await vi.waitFor(() =>
            expect(fs.writeTextFile).toHaveBeenCalledTimes(1)
        );
        finishWrite();
        await vi.waitFor(() =>
            expect(fs.writeTextFile).toHaveBeenCalledTimes(4)
        );
        const saved: string = fs.writeTextFile.mock.calls[3][1];
        expect(JSON.parse(saved)).toEqual({
            lastRoute: '/settings',
            folders: { tools: true },
            settingsCards: {
                'system.application': false,
                'advanced.troubleshooting': true
            },
            toolRows: {}
        });
        fs.readTextFile.mockResolvedValue(saved);
        vi.resetModules();
        const restarted = (await import('./navigationCacheStore'))
            .useNavigationCacheStore;
        await restarted.getState().hydrate();
        expect(restarted.getState().settingsCards).toEqual({
            'system.application': false,
            'advanced.troubleshooting': true
        });
    });
});
