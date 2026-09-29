// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { GroupProfileRecord } from '@/domain/entities/group';

vi.mock('react-i18next', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-i18next')>();
    return {
        ...actual,
        useTranslation: () => ({ t: (key: string) => key })
    };
});

vi.mock('@/state/vrchatConfigStore', () => ({
    useVrchatConfigStore: <T,>(selector: (state: { snapshot: null }) => T) =>
        selector({ snapshot: null })
}));

import { GroupProfileEditDialog } from './GroupProfileEditDialog';

afterEach(cleanup);

function createGroup(patch: Partial<GroupProfileRecord> = {}) {
    return {
        id: 'grp_test',
        name: 'Test Group',
        shortCode: 'TEST',
        discriminator: '1234',
        description: 'About us',
        joinState: 'open',
        languages: ['eng'],
        links: [],
        rules: 'Be kind',
        iconId: 'file_icon',
        bannerId: '',
        allowGroupJoinPrompt: true,
        ...patch
    } as GroupProfileRecord;
}

describe('GroupProfileEditDialog', () => {
    it('saves every group field with trimmed text and without blank links', async () => {
        const user = userEvent.setup();
        const onSave = vi.fn();
        render(
            <GroupProfileEditDialog
                open
                onOpenChange={vi.fn()}
                group={createGroup()}
                onSave={onSave}
            />
        );

        const name = screen.getByLabelText('dialog.group.info.name');
        await user.clear(name);
        await user.type(name, '  Renamed Group  ');
        await user.type(
            screen.getByPlaceholderText('https://example.com/1'),
            ' https://example.test '
        );
        await user.click(
            screen.getByRole('button', {
                name: 'dialog.group.edit.add_link'
            })
        );
        await user.click(
            screen.getByRole('button', { name: 'common.actions.save' })
        );

        expect(onSave).toHaveBeenCalledWith({
            name: 'Renamed Group',
            shortCode: 'TEST',
            description: 'About us',
            joinState: 'open',
            languages: ['eng'],
            rules: 'Be kind',
            links: ['https://example.test'],
            iconId: 'file_icon',
            bannerId: null,
            allowGroupJoinPrompt: true
        });
    });

    it('does not save a short code outside 3-6 letters or digits', async () => {
        const user = userEvent.setup();
        const onSave = vi.fn();
        render(
            <GroupProfileEditDialog
                open
                onOpenChange={vi.fn()}
                group={createGroup()}
                onSave={onSave}
            />
        );

        const shortCode = screen.getByLabelText('dialog.group.edit.short_code');
        await user.clear(shortCode);
        await user.type(shortCode, 'ab');
        const save = screen.getByRole('button', {
            name: 'common.actions.save'
        });

        expect((shortCode as HTMLInputElement).value).toBe('AB');
        expect(save.hasAttribute('disabled')).toBe(true);
    });

    it('only lets open groups prompt instance visitors to join', () => {
        render(
            <GroupProfileEditDialog
                open
                onOpenChange={vi.fn()}
                group={createGroup({ joinState: 'request' })}
                onSave={vi.fn()}
            />
        );

        expect(
            screen
                .getByRole('checkbox', {
                    name: 'dialog.group.edit.allow_join_prompt'
                })
                .getAttribute('aria-disabled')
        ).toBe('true');
    });
});
