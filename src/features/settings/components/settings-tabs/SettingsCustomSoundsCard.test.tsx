// @vitest-environment jsdom

import {
    cleanup,
    fireEvent,
    render,
    screen,
    waitFor
} from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    get: vi.fn(),
    set: vi.fn(),
    pick: vi.fn(),
    preview: vi.fn()
}));
vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (key: string) => key.split('.').at(-1) })
}));
vi.mock('@/repositories/configRepository', () => ({
    default: { getString: mocks.get, setString: mocks.set }
}));
vi.mock('@/platform/tauri/bindings', () => ({
    commands: {
        appOpenFileSelectorDialog: mocks.pick,
        appNotificationSoundTest: mocks.preview
    }
}));
vi.mock('../SettingsCard', () => ({
    SettingsCard: ({ children }: PropsWithChildren) => (
        <section>{children}</section>
    )
}));
vi.mock('@/ui/shadcn/slider', () => ({
    Slider: ({
        value,
        onValueChange,
        'aria-label': label
    }: {
        value: number[];
        onValueChange: (value: number[]) => void;
        'aria-label': string;
    }) => (
        <input
            type="range"
            aria-label={label}
            value={value[0]}
            onChange={(event) => onValueChange([Number(event.target.value)])}
        />
    )
}));

import { SettingsCustomSoundsCard } from './SettingsCustomSoundsCard';

const prefix = 'notificationSounds';
const persisted = {
    version: 1,
    rules: {
        'OnPlayerJoined@favorite': {
            enabled: true,
            path: '/sounds/favorite.wav',
            volume: 0.4
        }
    }
};

beforeEach(() => {
    vi.resetAllMocks();
    mocks.get.mockResolvedValue(JSON.stringify(persisted));
    mocks.set.mockResolvedValue(null);
    mocks.pick.mockResolvedValue('/sounds/new.ogg');
    mocks.preview.mockResolvedValue(null);
});
afterEach(cleanup);

describe('custom notification sounds', () => {
    it('loads rules, previews draft changes and persists the backend schema', async () => {
        render(<SettingsCustomSoundsCard />);
        await screen.findByDisplayValue('/sounds/favorite.wav');
        fireEvent.click(screen.getByText('browse'));
        await screen.findByDisplayValue('/sounds/new.ogg');
        fireEvent.change(screen.getByRole('slider'), {
            target: { value: '25' }
        });
        fireEvent.click(screen.getByText('test'));
        await waitFor(() =>
            expect(mocks.preview).toHaveBeenCalledWith('/sounds/new.ogg', 0.25)
        );
        await waitFor(() =>
            expect(screen.getByText('save').closest('fieldset')?.disabled).toBe(
                false
            )
        );
        fireEvent.click(screen.getByText('save'));
        await waitFor(() =>
            expect(mocks.set).toHaveBeenCalledWith(
                prefix,
                JSON.stringify({
                    version: 1,
                    rules: {
                        'OnPlayerJoined@favorite': {
                            enabled: true,
                            path: '/sounds/new.ogg',
                            volume: 0.25
                        }
                    }
                })
            )
        );
        await waitFor(() => expect(screen.queryByText('unsaved')).toBeNull());
    });

    it('adds an anyone rule without overwriting a favorite rule and prevents duplicates', async () => {
        render(<SettingsCustomSoundsCard />);
        await screen.findByDisplayValue('/sounds/favorite.wav');
        fireEvent.click(screen.getByText('add'));
        expect((screen.getByText('add') as HTMLButtonElement).disabled).toBe(
            true
        );
        expect((screen.getByText('save') as HTMLButtonElement).disabled).toBe(
            true
        );
        fireEvent.change(
            screen
                .getAllByRole('textbox')
                .find((input) => (input as HTMLInputElement).value === '')!,
            {
                target: { value: '/sounds/any.wav' }
            }
        );
        fireEvent.click(screen.getByText('save'));
        await waitFor(() => expect(mocks.set).toHaveBeenCalled());
        expect(JSON.parse(mocks.set.mock.calls[0][1]).rules).toEqual({
            ...persisted.rules,
            OnPlayerJoined: {
                enabled: true,
                path: '/sounds/any.wav',
                volume: 0.8
            }
        });
    });

    it('keeps changes available for retry after a failed save and persists removal', async () => {
        mocks.set.mockRejectedValueOnce(new Error('disk full'));
        render(<SettingsCustomSoundsCard />);
        await screen.findByDisplayValue('/sounds/favorite.wav');
        fireEvent.click(screen.getByText('remove'));
        fireEvent.click(screen.getByText('save'));
        expect((await screen.findByRole('alert')).textContent).toContain(
            'disk full'
        );
        expect(screen.getByText('unsaved')).toBeTruthy();
        fireEvent.click(screen.getByText('save'));
        await waitFor(() => expect(screen.queryByText('unsaved')).toBeNull());
        expect(mocks.set).toHaveBeenLastCalledWith(
            prefix,
            '{"version":1,"rules":{}}'
        );
    });

    it('leaves the file unchanged when the picker is cancelled', async () => {
        mocks.pick.mockResolvedValue('');
        render(<SettingsCustomSoundsCard />);
        await screen.findByDisplayValue('/sounds/favorite.wav');
        fireEvent.click(screen.getByText('browse'));
        await waitFor(() =>
            expect(screen.getByText('save').closest('fieldset')?.disabled).toBe(
                false
            )
        );
        expect(screen.getByDisplayValue('/sounds/favorite.wav')).toBeTruthy();
        expect(screen.queryByText('unsaved')).toBeNull();
    });

    it('blocks editing when stored settings cannot be read', async () => {
        mocks.get.mockResolvedValue('{broken');
        render(<SettingsCustomSoundsCard />);
        await screen.findByRole('alert');
        expect(screen.getByText('save').closest('fieldset')?.disabled).toBe(
            true
        );
        expect(mocks.set).not.toHaveBeenCalled();
    });
});
