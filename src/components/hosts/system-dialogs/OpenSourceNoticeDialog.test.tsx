// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { OpenSourceNoticeDialog } from './OpenSourceNoticeDialog';

vi.mock('@/services/entityMediaService', () => ({
    openExternalLink: vi.fn()
}));

vi.mock('@/ui/shadcn/dialog', () => ({
    Dialog: ({ children, open }: PropsWithChildren<{ open: boolean }>) =>
        open ? <div>{children}</div> : null,
    DialogContent: ({ children }: PropsWithChildren) => <div>{children}</div>,
    DialogDescription: ({ children }: PropsWithChildren) => <p>{children}</p>,
    DialogHeader: ({ children }: PropsWithChildren) => (
        <header>{children}</header>
    ),
    DialogTitle: ({ children }: PropsWithChildren) => <h1>{children}</h1>
}));

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
});

describe('open source notices', () => {
    it('shows every license text a package points to, even when other packages share them', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValue(
                new Response(
                    JSON.stringify({
                        noticeTexts: ['MIT text', 'Apache text'],
                        entries: [
                            {
                                id: 'alpha',
                                name: 'alpha',
                                license: 'MIT OR Apache-2.0',
                                noticeTextIndexes: [0, 1]
                            },
                            {
                                id: 'beta',
                                name: 'beta',
                                license: 'Apache-2.0',
                                noticeTextIndexes: [1]
                            }
                        ]
                    })
                )
            )
        );
        render(<OpenSourceNoticeDialog open onOpenChange={vi.fn()} />);

        expect((await screen.findByText(/MIT text/)).textContent).toBe(
            'MIT text\n\nApache text'
        );

        fireEvent.click(screen.getByText('beta'));
        expect(screen.getByText('Apache text').textContent).toBe('Apache text');
    });
});
