// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ openExternalLink: vi.fn() }));

vi.mock('@/services/entityMediaService', () => ({
    openExternalLink: mocks.openExternalLink
}));

import { DOC_SOURCES } from './docsCatalog';
import { DocsPage } from './DocsPage';

function Location() {
    const location = useLocation();
    return <output data-testid="location">{location.search}</output>;
}

function renderAt(path: string) {
    return render(
        <MemoryRouter initialEntries={[path]}>
            <DocsPage />
            <Location />
        </MemoryRouter>
    );
}

describe('DocsPage', () => {
    beforeAll(() => {
        Element.prototype.scrollIntoView = vi.fn();
    });
    afterEach(() => {
        cleanup();
        mocks.openExternalLink.mockClear();
    });

    it('opens the user guide by default and lists every doc', () => {
        const { container } = renderAt('/docs');
        expect(container.querySelector('article')?.dataset.doc).toBe(
            'user_guide'
        );
        expect(
            screen.getByRole('heading', {
                level: 1,
                name: 'Using VRCX-0-Nanashi'
            })
        ).toBeTruthy();
        const list = screen.getByRole('navigation', { name: 'view.docs.list' });
        expect(list.querySelectorAll('button')).toHaveLength(
            DOC_SOURCES.length
        );
        expect(
            screen.getByRole('button', { name: 'What this fork changes' })
        ).toBeTruthy();
    });

    it('follows a link to another doc inside the viewer', () => {
        renderAt('/docs?doc=user_guide');
        fireEvent.click(screen.getAllByRole('link', { name: 'INSTALL.md' })[0]);
        expect(screen.getByTestId('location').textContent).toBe('?doc=install');
        expect(mocks.openExternalLink).not.toHaveBeenCalled();
    });

    it('opens repository files that are not docs on GitHub', () => {
        renderAt('/docs?doc=readme');
        fireEvent.click(screen.getByRole('link', { name: 'LICENSE' }));
        expect(mocks.openExternalLink).toHaveBeenCalledWith(
            expect.stringMatching(/github\.com\/.+\/blob\/master\/LICENSE$/)
        );
    });

    it('searches the docs and jumps to the matching section', () => {
        renderAt('/docs');
        fireEvent.change(
            screen.getByRole('textbox', { name: 'view.docs.search' }),
            { target: { value: 'wrist overlay pages' } }
        );
        fireEvent.click(
            screen.getByRole('button', { name: /Wrist overlay pages/ })
        );
        expect(screen.getByTestId('location').textContent).toBe(
            '?doc=features&section=wrist-overlay-pages'
        );
    });

    it('shows image alt text instead of loading images', () => {
        const { container } = renderAt('/docs?doc=readme');
        expect(container.querySelector('img')).toBeNull();
    });
});
