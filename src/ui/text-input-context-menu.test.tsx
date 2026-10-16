// @vitest-environment jsdom

import {
    act,
    cleanup,
    fireEvent,
    render,
    screen,
    waitFor
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    appGetClipboard: vi.fn(),
    writeText: vi.fn()
}));

vi.mock('@/platform/tauri/bindings', () => ({
    commands: { appGetClipboard: mocks.appGetClipboard }
}));

import { Dialog, DialogContent, DialogTitle } from '@/ui/shadcn/dialog';
import { Input } from '@/ui/shadcn/input';

describe('text input context menu', () => {
    const execCommand = vi.fn();

    beforeEach(() => {
        mocks.appGetClipboard.mockResolvedValue('pasted');
        mocks.writeText.mockResolvedValue(undefined);
        Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: { writeText: mocks.writeText }
        });
        Object.defineProperty(document, 'execCommand', {
            configurable: true,
            value: execCommand
        });
    });

    afterEach(() => {
        cleanup();
        vi.clearAllMocks();
    });

    it('pastes inside a dialog without dismissing it', async () => {
        const onOpenChange = vi.fn();
        render(
            <Dialog open onOpenChange={onOpenChange}>
                <DialogContent>
                    <DialogTitle>Title</DialogTitle>
                    <Input aria-label="field" defaultValue="" />
                </DialogContent>
            </Dialog>
        );
        const input = screen.getByLabelText('field');

        fireEvent.contextMenu(input, { clientX: 10, clientY: 10 });
        const paste = screen.getByRole('menuitem', {
            name: 'common.actions.paste'
        });
        fireEvent.pointerDown(paste, { button: 0 });
        fireEvent.mouseDown(paste, { button: 0 });
        fireEvent.pointerUp(paste, { button: 0 });
        fireEvent.mouseUp(paste, { button: 0 });
        fireEvent.click(paste);

        await waitFor(() =>
            expect(execCommand).toHaveBeenCalledWith(
                'insertText',
                false,
                'pasted'
            )
        );
        expect(onOpenChange).not.toHaveBeenCalled();
        expect(screen.queryByRole('menu')).toBeNull();

        fireEvent.pointerDown(document.body, { button: 0 });
        fireEvent.mouseDown(document.body, { button: 0 });
        fireEvent.pointerUp(document.body, { button: 0 });
        fireEvent.mouseUp(document.body, { button: 0 });
        fireEvent.click(document.body);

        expect(onOpenChange).toHaveBeenCalledWith(false, expect.anything());
    });

    it('copies only the selected text and disables editing for read-only fields', async () => {
        render(
            <Input aria-label="field" defaultValue="hello world" readOnly />
        );
        const input = screen.getByLabelText<HTMLInputElement>('field');
        input.setSelectionRange(0, 5);

        fireEvent.contextMenu(input);

        expect(
            screen.getByRole('menuitem', { name: 'common.actions.cut' })
        ).toHaveProperty('disabled', true);
        expect(
            screen.getByRole('menuitem', { name: 'common.actions.paste' })
        ).toHaveProperty('disabled', true);

        await act(async () => {
            fireEvent.click(
                screen.getByRole('menuitem', { name: 'common.actions.copy' })
            );
        });

        expect(mocks.writeText).toHaveBeenCalledWith('hello');
    });

    it('keeps the selection when cutting fails to reach the clipboard', async () => {
        mocks.writeText.mockRejectedValue(new Error('denied'));
        render(<Input aria-label="field" defaultValue="hello world" />);
        const input = screen.getByLabelText<HTMLInputElement>('field');
        input.setSelectionRange(0, 5);

        fireEvent.contextMenu(input);
        await act(async () => {
            fireEvent.click(
                screen.getByRole('menuitem', { name: 'common.actions.cut' })
            );
        });

        expect(mocks.writeText).toHaveBeenCalledWith('hello');
        expect(execCommand).not.toHaveBeenCalled();
    });

    it('closes on Escape without reaching the surrounding dialog', () => {
        const onOpenChange = vi.fn();
        render(
            <Dialog open onOpenChange={onOpenChange}>
                <DialogContent>
                    <DialogTitle>Title</DialogTitle>
                    <Input aria-label="field" />
                </DialogContent>
            </Dialog>
        );
        const input = screen.getByLabelText('field');

        fireEvent.contextMenu(input);
        fireEvent.keyDown(input, { key: 'Escape' });

        expect(screen.queryByRole('menu')).toBeNull();
        expect(onOpenChange).not.toHaveBeenCalled();
    });

    it('leaves a caller-handled context menu alone', () => {
        render(
            <Input
                aria-label="field"
                onContextMenu={(event) => event.preventDefault()}
            />
        );

        fireEvent.contextMenu(screen.getByLabelText('field'));

        expect(screen.queryByRole('menu')).toBeNull();
    });
});
