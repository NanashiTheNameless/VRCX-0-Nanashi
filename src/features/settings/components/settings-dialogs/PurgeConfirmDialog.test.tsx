// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type {
    ButtonHTMLAttributes,
    ComponentProps,
    PropsWithChildren,
    ReactNode
} from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/ui/shadcn/button', () => ({
    Button: ({
        children,
        variant = 'default',
        ...props
    }: PropsWithChildren<
        ButtonHTMLAttributes<HTMLButtonElement> & { variant?: string }
    >) => (
        <button data-variant={variant} {...props}>
            {children}
        </button>
    )
}));

vi.mock('@/ui/shadcn/dialog', () => ({
    Dialog: ({
        children,
        open
    }: PropsWithChildren<{
        open: boolean;
        onOpenChange(open: boolean): void;
    }>) => (open ? <>{children}</> : null),
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

vi.mock('@/ui/shadcn/select', () => {
    type SelectProps = PropsWithChildren<{
        value?: string;
        onValueChange(value: string | null): void;
    }>;
    type SelectItemProps = PropsWithChildren<{ value: string }>;

    return {
        Select: ({ children }: SelectProps) => <div>{children}</div>,
        SelectContent: ({ children }: PropsWithChildren) => (
            <div>{children}</div>
        ),
        SelectGroup: ({ children }: PropsWithChildren) => <div>{children}</div>,
        SelectItem: ({ children, value }: SelectItemProps) => (
            <span data-value={value}>{children}</span>
        ),
        SelectTrigger: ({
            children,
            id
        }: PropsWithChildren<{ id?: string }>) => (
            <button id={id}>{children}</button>
        ),
        SelectValue: () => null
    };
});

vi.mock('../SettingsField', () => ({
    Field: ({
        children,
        label
    }: {
        children?: ReactNode;
        label?: ReactNode;
    }) => (
        <section>
            <span>{label}</span>
            {children}
        </section>
    )
}));

import { PurgeConfirmDialog } from './PurgeConfirmDialog';

type DialogProps = ComponentProps<typeof PurgeConfirmDialog>;

function createProps(overrides: Partial<DialogProps> = {}): DialogProps {
    return {
        open: true,
        onOpenChange: vi.fn(),
        period: '180',
        onPeriodChange: vi.fn(),
        inProgress: false,
        onConfirm: vi.fn(),
        ...overrides
    };
}

const cancelLabel = 'confirm.cancel_button';
const confirmLabel =
    'view.settings.advanced.advanced.database_cleanup.purge_confirm_button';

describe('PurgeConfirmDialog', () => {
    afterEach(cleanup);

    it('marks irreversible purge as destructive and preserves cancel', () => {
        const props = createProps();
        render(<PurgeConfirmDialog {...props} />);

        const cancel = screen.getByRole('button', {
            name: cancelLabel
        }) as HTMLButtonElement;
        const confirm = screen.getByRole('button', {
            name: confirmLabel
        }) as HTMLButtonElement;

        expect(cancel.getAttribute('data-variant')).toBe('outline');
        expect(confirm.getAttribute('data-variant')).toBe('destructive');
        expect(cancel.disabled).toBe(false);
        expect(confirm.disabled).toBe(false);

        fireEvent.click(cancel);
        fireEvent.click(confirm);
        expect(props.onOpenChange).toHaveBeenCalledWith(false);
        expect(props.onConfirm).toHaveBeenCalledOnce();
    });

    it('locks both dialog actions while the non-cancellable purge is running', () => {
        render(<PurgeConfirmDialog {...createProps({ inProgress: true })} />);

        expect(
            (
                screen.getByRole('button', {
                    name: cancelLabel
                }) as HTMLButtonElement
            ).disabled
        ).toBe(true);
        expect(
            (
                screen.getByRole('button', {
                    name: confirmLabel
                }) as HTMLButtonElement
            ).disabled
        ).toBe(true);
    });
});
