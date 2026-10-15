import { Children, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type CapturedButton = {
    label: string;
    disabled: boolean;
    onClick?: () => void;
};

const controls = vi.hoisted(() => ({
    buttons: [] as CapturedButton[]
}));

vi.mock('react-router', () => ({
    useNavigate: () => vi.fn()
}));

vi.mock('@/repositories/vrchatMediaRepository', () => ({
    default: {
        getFileList: vi.fn(),
        collectInventoryItems: vi.fn()
    }
}));

vi.mock('@/services/boopRecentService', () => ({
    getRecentBoopEmojis: vi.fn()
}));

vi.mock('@/ui/shadcn/button', async () => {
    const React = await import('react');

    return {
        Button: ({
            children,
            disabled = false,
            onClick
        }: {
            children?: ReactNode;
            disabled?: boolean;
            onClick?: () => void;
        }) => {
            controls.buttons.push({
                label: Children.toArray(children)
                    .filter((child) => typeof child === 'string')
                    .join(''),
                disabled,
                onClick
            });
            return React.createElement(
                'button',
                { disabled, onClick },
                children
            );
        }
    };
});

vi.mock('@/ui/shadcn/dialog', async () => {
    const React = await import('react');
    const Container = ({ children }: { children?: ReactNode }) =>
        React.createElement('div', null, children);

    return {
        Dialog: Container,
        DialogContent: Container,
        DialogDescription: Container,
        DialogFooter: Container,
        DialogHeader: Container,
        DialogTitle: Container
    };
});

import { BoopEmojiDialog } from './BoopEmojiDialog';

function findButton(label: string): CapturedButton {
    const button = controls.buttons.find(
        (candidate) => candidate.label === label
    );
    expect(button).toBeDefined();
    return button!;
}

describe('BoopEmojiDialog', () => {
    beforeEach(() => {
        controls.buttons.length = 0;
    });

    it('sends a boop without an emoji when nothing is selected', async () => {
        const onSend = vi.fn();
        const html = renderToStaticMarkup(
            <BoopEmojiDialog open onOpenChange={vi.fn()} onSend={onSend} />
        );

        expect(html).toMatch(
            /aria-label="dialog\.gallery_select\.none" aria-pressed="true"/
        );
        const send = findButton('dialog.boop_dialog.send');
        expect(send.disabled).toBe(false);

        send.onClick?.();
        await vi.waitFor(() => expect(onSend).toHaveBeenCalledWith(null));
    });
});
