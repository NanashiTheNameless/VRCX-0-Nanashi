// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ComponentProps, PropsWithChildren, ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/ui/shadcn/button', () => ({
    Button: ({
        children,
        size: _size,
        variant: _variant,
        ...props
    }: PropsWithChildren<
        ComponentProps<'button'> & { size?: string; variant?: string }
    >) => <button {...props}>{children}</button>
}));

vi.mock('@/ui/shadcn/dialog', () => ({
    Dialog: ({ children, open }: PropsWithChildren<{ open: boolean }>) =>
        open ? <>{children}</> : null,
    DialogContent: ({ children }: PropsWithChildren) => (
        <section>{children}</section>
    ),
    DialogDescription: ({ children }: PropsWithChildren) => <p>{children}</p>,
    DialogFooter: ({ children }: PropsWithChildren) => (
        <footer>{children}</footer>
    ),
    DialogHeader: ({ children }: PropsWithChildren) => (
        <header>{children}</header>
    ),
    DialogTitle: ({ children }: PropsWithChildren) => <h1>{children}</h1>
}));

vi.mock('@/ui/shadcn/field', () => ({
    Field: ({ children }: PropsWithChildren) => <div>{children}</div>,
    FieldGroup: ({ children }: PropsWithChildren) => <div>{children}</div>,
    FieldLabel: ({ children }: PropsWithChildren<{ htmlFor?: string }>) => (
        <span>{children}</span>
    )
}));

vi.mock('@/ui/shadcn/tooltip', () => ({
    Tooltip: ({ children }: PropsWithChildren) => <>{children}</>,
    TooltipContent: ({ children }: PropsWithChildren) => (
        <span>{children}</span>
    ),
    TooltipTrigger: ({ render }: { render?: ReactNode }) => <>{render}</>
}));

import { TAG_COLORS } from '@/shared/constants/tags';

import { ManageAvatarTagsDialog } from './ManageAvatarTagsDialog';

type DialogProps = ComponentProps<typeof ManageAvatarTagsDialog>;

function createProps(overrides: Partial<DialogProps> = {}): DialogProps {
    return {
        open: true,
        avatar: {
            id: 'avtr_test',
            name: 'Test Avatar',
            $tags: [
                { tag: 'Alpha', color: TAG_COLORS[1].bg },
                { tag: 'Alpha', color: TAG_COLORS[2].bg }
            ]
        },
        onOpenChange: vi.fn(),
        onSave: vi.fn(),
        ...overrides
    };
}

describe('ManageAvatarTagsDialog', () => {
    afterEach(cleanup);

    it('keeps the first color of a duplicated initial tag', () => {
        render(<ManageAvatarTagsDialog {...createProps()} />);
        expect(screen.getAllByText('Alpha')).toHaveLength(1);
        const blue = screen.getByRole('button', {
            name: 'Blue'
        }) as HTMLButtonElement;
        expect(blue.getAttribute('aria-pressed')).toBe('true');
        expect(blue.getAttribute('data-selected')).toBe('true');
    });

    it('adds trimmed unique tags and saves the current tag payload', () => {
        const props = createProps();
        render(<ManageAvatarTagsDialog {...props} />);

        const input = screen.getByPlaceholderText(
            'view.my_avatars.label.tag_name'
        );
        fireEvent.change(input, { target: { value: '  Beta  ' } });
        fireEvent.click(
            screen.getByRole('button', { name: 'view.my_avatars.action.add' })
        );
        fireEvent.change(input, { target: { value: 'Alpha' } });
        fireEvent.click(
            screen.getByRole('button', { name: 'view.my_avatars.action.add' })
        );
        fireEvent.click(
            screen.getByRole('button', { name: 'common.actions.save' })
        );

        expect(screen.getAllByText('Alpha')).toHaveLength(1);
        expect(screen.getByText('Beta')).toBeTruthy();
        expect(props.onSave).toHaveBeenCalledWith({
            avatarId: 'avtr_test',
            tags: [
                { tag: 'Alpha', color: TAG_COLORS[1].bg },
                { tag: 'Beta', color: null }
            ]
        });
    });

    it('locks editing while saving and prevents saving without an avatar id', () => {
        const { rerender } = render(
            <ManageAvatarTagsDialog {...createProps({ saving: true })} />
        );

        expect(
            (
                screen.getByPlaceholderText(
                    'view.my_avatars.label.tag_name'
                ) as HTMLInputElement
            ).disabled
        ).toBe(true);
        for (const button of screen.getAllByRole('button')) {
            expect((button as HTMLButtonElement).disabled).toBe(true);
        }

        rerender(
            <ManageAvatarTagsDialog
                {...createProps({ avatar: { name: 'Missing id' } })}
            />
        );
        expect(
            (
                screen.getByRole('button', {
                    name: 'common.actions.save'
                }) as HTMLButtonElement
            ).disabled
        ).toBe(true);
        expect(
            (
                screen.getByRole('button', {
                    name: 'common.actions.cancel'
                }) as HTMLButtonElement
            ).disabled
        ).toBe(false);
    });
});
