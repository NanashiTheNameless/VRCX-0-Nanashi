// @vitest-environment jsdom
import {
    cleanup,
    fireEvent,
    render,
    screen,
    waitFor
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn() }));
vi.mock('@/platform/tauri/bindings', () => ({
    commands: {
        appProfileHistorySettingsGet: api.get,
        appProfileHistorySettingsSet: api.set
    }
}));
vi.mock('../SettingsCard', () => ({
    SettingsCard: ({ children }: { children: React.ReactNode }) => (
        <section>{children}</section>
    )
}));
vi.mock('../SettingsField', () => ({
    Field: ({ children }: { children: React.ReactNode }) => (
        <div>{children}</div>
    )
}));

import { SettingsProfileHistoryCard } from './SettingsProfileHistoryCard';

const T = 'view.settings.social.profile_history';

describe('SettingsProfileHistoryCard', () => {
    afterEach(() => {
        cleanup();
        vi.resetAllMocks();
    });

    it('defaults recording off and sync on, and saves only the chosen field', async () => {
        const initial = {
            status: { recording: false, sync: true },
            bio: { recording: false, sync: true },
            pronouns: { recording: false, sync: true }
        };
        api.get.mockResolvedValue(initial);
        api.set.mockResolvedValue(undefined);
        render(<SettingsProfileHistoryCard />);
        const status = screen.getByRole('switch', {
            name: `${T}.status: ${T}.recording`
        });
        await waitFor(() =>
            expect(status.hasAttribute('disabled')).toBe(false)
        );
        for (const field of ['status', 'bio', 'pronouns']) {
            expect(
                screen
                    .getByRole('switch', {
                        name: `${T}.${field}: ${T}.recording`
                    })
                    .getAttribute('aria-checked')
            ).toBe('false');
            expect(
                screen
                    .getByRole('switch', { name: `${T}.${field}: ${T}.sync` })
                    .getAttribute('aria-checked')
            ).toBe('true');
        }
        fireEvent.click(status);
        await waitFor(() =>
            expect(api.set).toHaveBeenCalledWith({
                ...initial,
                status: { recording: true, sync: true }
            })
        );
        await waitFor(() =>
            expect(status.getAttribute('aria-checked')).toBe('true')
        );
        fireEvent.click(
            screen.getByRole('switch', { name: `${T}.pronouns: ${T}.sync` })
        );
        await waitFor(() =>
            expect(api.set).toHaveBeenLastCalledWith({
                ...initial,
                status: { recording: true, sync: true },
                pronouns: { recording: false, sync: false }
            })
        );
    });

    it('keeps the saved choice when a write fails', async () => {
        api.get.mockResolvedValue({
            status: { recording: false, sync: true },
            bio: { recording: false, sync: true },
            pronouns: { recording: false, sync: true }
        });
        api.set.mockRejectedValue(new Error('Save failed'));
        render(<SettingsProfileHistoryCard />);
        const bio = screen.getByRole('switch', {
            name: `${T}.bio: ${T}.recording`
        });
        await waitFor(() => expect(bio.hasAttribute('disabled')).toBe(false));
        fireEvent.click(bio);
        expect((await screen.findByRole('alert')).textContent).toContain(
            'Save failed'
        );
        expect(bio.getAttribute('aria-checked')).toBe('false');
    });
});
