// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    FriendMultiSelectList,
    type FriendMultiSelectOption,
    friendOptionMatches
} from './FriendMultiSelectList';

vi.mock('react-i18next', async (importOriginal) => ({
    ...(await importOriginal<typeof import('react-i18next')>()),
    useTranslation: () => ({
        t: (key: string, params?: Record<string, unknown>) =>
            params ? `${key}:${JSON.stringify(params)}` : key
    })
}));

vi.mock('@/components/media/FadeInImage', () => ({
    FadeInImage: () => null
}));

vi.mock('@/services/entityMediaService', () => ({
    userImage: () => ''
}));

function option(value: string, label: string): FriendMultiSelectOption {
    return { value, label, search: `${label} ${value}`, user: null };
}

const options = [
    option('usr_a', 'Ava'),
    option('usr_b', 'Ben'),
    option('usr_c', 'Cyd')
];

function Harness({
    initial = [],
    limit,
    onChange
}: {
    initial?: string[];
    limit?: number;
    onChange?: (next: string[]) => void;
}) {
    const [values, setValues] = useState(initial);
    return (
        <FriendMultiSelectList
            options={options}
            values={values}
            limit={limit}
            onChange={(next) => {
                setValues(next);
                onChange?.(next);
            }}
            placeholder="search"
            emptyContent="empty"
        />
    );
}

afterEach(() => {
    cleanup();
});

describe('friendOptionMatches', () => {
    it('matches every whitespace-separated token case-insensitively', () => {
        const target = option('usr_ava', 'Ava Star');
        expect(friendOptionMatches(target, '')).toBe(true);
        expect(friendOptionMatches(target, 'STAR usr_ava')).toBe(true);
        expect(friendOptionMatches(target, 'star missing')).toBe(false);
    });
});

describe('FriendMultiSelectList', () => {
    it('toggles a friend from the row and removes it from the chip', () => {
        const onChange = vi.fn();
        render(<Harness onChange={onChange} />);

        fireEvent.click(screen.getByRole('option', { name: /Ben/ }));
        expect(onChange).toHaveBeenLastCalledWith(['usr_b']);
        expect(
            screen
                .getByRole('option', { name: /Ben/ })
                .getAttribute('aria-selected')
        ).toBe('true');

        fireEvent.click(
            screen.getByRole('button', { name: 'common.actions.remove Ben' })
        );
        expect(onChange).toHaveBeenLastCalledWith([]);
    });

    it('keeps list order stable while selecting and filters by the query', () => {
        render(<Harness initial={['usr_c']} />);

        expect(
            screen.getAllByRole('option').map((node) => node.textContent)
        ).toEqual(['Ava', 'Ben', 'Cyd']);

        fireEvent.change(screen.getByRole('combobox'), {
            target: { value: 'usr_b' }
        });
        expect(
            screen.getAllByRole('option').map((node) => node.textContent)
        ).toEqual(['Ben']);

        fireEvent.change(screen.getByRole('combobox'), {
            target: { value: 'nobody' }
        });
        expect(screen.queryAllByRole('option')).toHaveLength(0);
        expect(screen.getByText('empty')).toBeTruthy();
    });

    it('keeps a selected id that has no option as a removable chip', () => {
        render(<Harness initial={['usr_gone']} />);

        expect(
            screen.getByRole('button', {
                name: 'common.actions.remove usr_gone'
            })
        ).toBeTruthy();
        expect(screen.getByRole('option', { name: /usr_gone/ })).toBeTruthy();
    });

    it('reports how many matches the limit hides', () => {
        render(<Harness limit={2} />);

        expect(screen.getAllByRole('option')).toHaveLength(2);
        expect(screen.getByText(/more_not_shown:{"count":1}/)).toBeTruthy();
    });
});
