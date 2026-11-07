// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { BadgeEditor } from './BadgeEditor';

const FIRST = 'usr_11111111-1111-1111-1111-111111111111';
const SECOND = 'usr_22222222-2222-2222-2222-222222222222';

describe('BadgeEditor', () => {
    afterEach(cleanup);

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
