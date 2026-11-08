// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';

import {
    normalizeCustomBadges,
    type CustomBadge
} from '@/domain/badges/customBadges';

import { BadgeEditor } from './BadgeEditor';

const FIRST = 'usr_11111111-1111-1111-1111-111111111111';
const SECOND = 'usr_22222222-2222-2222-2222-222222222222';
const T = 'view.settings.appearance.user_badges';

describe('BadgeEditor', () => {
    afterEach(cleanup);

    it('builds a nested expression with the sentence builder and saves it', async () => {
        const user = userEvent.setup();
        let saved: CustomBadge | null = null;
        render(
            <BadgeEditor
                initial={{
                    id: 'b',
                    label: 'Badge',
                    icon: 'Star',
                    color: '#336699',
                    enabled: true,
                    rules: [{ kind: 'friends' }]
                }}
                onCancel={() => undefined}
                onSave={(badge) => {
                    saved = badge;
                }}
            />
        );
        // One condition decides alone, so no gate is offered yet.
        expect(
            screen.queryByRole('combobox', { name: `${T}.combine_rules` })
        ).toBeNull();
        expect(screen.getByText(`${T}.sentence.lead_one`)).toBeTruthy();

        await user.click(
            screen.getByRole('button', { name: `${T}.add_branch` })
        );
        // The new group has no enabled conditions yet, so still no gate.
        expect(
            screen.queryByRole('combobox', { name: `${T}.combine_rules` })
        ).toBeNull();
        const addInGroup = () =>
            screen.getAllByRole('combobox', { name: `${T}.add_condition` })[0];
        await user.click(addInGroup());
        await user.click(
            await screen.findByRole('option', { name: `${T}.rule.supporter` })
        );
        await user.click(addInGroup());
        await user.click(
            await screen.findByRole('option', { name: `${T}.rule.self` })
        );

        const gates = screen.getAllByRole('combobox', {
            name: `${T}.combine_rules`
        });
        expect(gates).toHaveLength(2);
        // Simple mode offers only ALL, ANY and NONE.
        await user.click(gates[0]);
        expect(
            screen.queryByRole('option', { name: `${T}.match.xor` })
        ).toBeNull();
        await user.click(
            await screen.findByRole('option', { name: `${T}.match.and` })
        );
        await user.click(
            screen.getAllByRole('checkbox', { name: `${T}.negate` })[0]
        );

        await user.click(
            screen.getByRole('button', { name: 'common.actions.save' })
        );
        expect(saved).toMatchObject({
            operator: 'and',
            rules: [
                { kind: 'friends', negated: true },
                {
                    kind: 'group',
                    operator: 'or',
                    rules: [{ kind: 'supporter' }, { kind: 'self' }]
                }
            ]
        });
        expect(normalizeCustomBadges(JSON.stringify([saved]))[0]).toEqual(
            saved
        );
    });

    it('hides a gate when a condition is turned off and restores its choice', async () => {
        const user = userEvent.setup();
        let saved: CustomBadge | null = null;
        render(
            <BadgeEditor
                initial={{
                    id: 'b',
                    label: 'Badge',
                    icon: 'Star',
                    color: '#336699',
                    enabled: true,
                    operator: 'nor',
                    rules: [{ kind: 'friends' }, { kind: 'supporter' }]
                }}
                onCancel={() => undefined}
                onSave={(badge) => {
                    saved = badge;
                }}
            />
        );
        expect(
            screen.getByRole('combobox', { name: `${T}.combine_rules` })
        ).toBeTruthy();
        const use = () =>
            screen.getAllByRole('checkbox', { name: `${T}.rule_enabled` });
        await user.click(use()[1]);
        expect(
            screen.queryByRole('combobox', { name: `${T}.combine_rules` })
        ).toBeNull();
        expect(screen.getByTestId('badge-rule-summary').textContent).toBe(
            `${T}.summary.lead`
        );
        await user.click(use()[1]);
        await user.click(
            screen.getByRole('button', { name: 'common.actions.save' })
        );
        expect(saved).toMatchObject({
            operator: 'nor',
            rules: [{ kind: 'friends' }, { kind: 'supporter', enabled: true }]
        });
    });

    it('shows every operator once advanced logic is on', async () => {
        const user = userEvent.setup();
        render(
            <BadgeEditor
                initial={{
                    id: 'b',
                    label: 'Badge',
                    icon: 'Star',
                    color: '#336699',
                    enabled: true,
                    operator: 'xor',
                    rules: [{ kind: 'friends' }, { kind: 'supporter' }]
                }}
                onCancel={() => undefined}
                onSave={() => undefined}
            />
        );
        // A badge already using XOR opens with advanced logic on.
        expect(
            (
                screen.getByRole('switch', {
                    name: `${T}.advanced`
                }) as HTMLElement
            ).getAttribute('aria-checked')
        ).toBe('true');
        await user.click(
            screen.getByRole('combobox', { name: `${T}.combine_rules` })
        );
        expect(
            await screen.findByRole('option', { name: `${T}.match.xnor` })
        ).toBeTruthy();
    });

    it('explains when the badge icon is now reserved, and only then', () => {
        const editor = (icon: string) => (
            <BadgeEditor
                initial={{
                    id: 'b',
                    label: 'Badge',
                    icon,
                    color: '#336699',
                    enabled: true,
                    rules: []
                }}
                onCancel={() => undefined}
                onSave={() => undefined}
            />
        );
        const note =
            'view.settings.appearance.user_badges.icon_now_reserved_detail';
        render(editor('ShieldUser'));
        expect(screen.getByText(note)).toBeTruthy();
        cleanup();
        render(editor('Cat'));
        expect(screen.queryByText(note)).toBeNull();
    });

    it('keeps each user list with its rule when an earlier rule is removed', () => {
        let saved: unknown = null;
        render(
            <BadgeEditor
                initial={{
                    id: 'b',
                    label: 'Badge',
                    icon: 'Star',
                    color: '#336699',
                    enabled: true,
                    rules: [
                        { kind: 'users', userIds: [FIRST] },
                        { kind: 'users', userIds: [SECOND] }
                    ]
                }}
                onCancel={() => undefined}
                onSave={(badge) => {
                    saved = badge;
                }}
            />
        );

        fireEvent.click(
            screen.getAllByRole('button', {
                name: 'view.settings.appearance.user_badges.remove_rule'
            })[0]
        );
        const boxes = screen.getAllByRole('textbox', {
            name: 'view.settings.appearance.user_badges.rule.users'
        });
        expect(boxes).toHaveLength(1);
        expect((boxes[0] as HTMLTextAreaElement).value).toBe(SECOND);

        fireEvent.blur(boxes[0]);
        fireEvent.click(
            screen.getByRole('button', { name: 'common.actions.save' })
        );
        expect(saved).toMatchObject({
            rules: [{ kind: 'users', userIds: [SECOND] }]
        });
    });
});
