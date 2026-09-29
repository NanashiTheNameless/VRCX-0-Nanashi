// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';

import { ToolPageHeader } from './ToolPageHeader';

function CurrentPath() {
    const location = useLocation();
    return <output data-testid="current-path">{location.pathname}</output>;
}

describe('ToolPageHeader', () => {
    afterEach(cleanup);

    it('uses the tool definition title and returns to the Tools page', () => {
        render(
            <MemoryRouter initialEntries={['/tools/gallery']}>
                <ToolPageHeader toolKey="gallery" />
                <CurrentPath />
            </MemoryRouter>
        );

        expect(
            screen.getByRole('heading', {
                level: 1,
                name: 'view.tools.pictures.gallery'
            })
        ).toBeTruthy();

        fireEvent.click(
            screen.getByRole('button', { name: 'nav_tooltip.tools' })
        );

        expect(screen.getByTestId('current-path').textContent).toBe('/tools');
    });
});
