import type { PropsWithChildren } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/services/launchService', () => ({
    launchVrchat: vi.fn()
}));

vi.mock('@/services/directAccessService', () => ({
    tryOpenLaunchLocation: vi.fn()
}));

import { CurrentUserActionItems } from './FriendsSidebarActionItems';

const Container = ({ children }: PropsWithChildren) => <>{children}</>;
const CheckboxItem = ({
    children,
    closeOnClick
}: PropsWithChildren<{ closeOnClick?: boolean }>) => (
    <button data-close-on-click={closeOnClick}>{children}</button>
);
const MenuItem = ({ children }: PropsWithChildren) => (
    <button>{children}</button>
);

describe('CurrentUserActionItems', () => {
    it('closes the menu immediately when selecting a social status or recent signature', () => {
        const html = renderToStaticMarkup(
            <CurrentUserActionItems
                friend={{
                    id: 'usr_self',
                    status: 'active',
                    statusDescription: 'Current signature',
                    statusHistory: ['Previous signature']
                }}
                MenuItem={MenuItem}
                CheckboxItem={CheckboxItem}
                Group={Container}
                Separator={() => null}
                Sub={Container}
                SubTrigger={Container}
                SubContent={Container}
            />
        );

        const checkboxItems = html.match(
            /<button data-close-on-click[^>]*>.*?<\/button>/g
        );
        expect(checkboxItems).toHaveLength(5);
        for (const item of checkboxItems ?? []) {
            expect(item).toContain('data-close-on-click="true"');
        }
        expect(html).toMatch(
            /data-close-on-click="true">.*?Previous signature.*?<\/button>/
        );
    });
});

vi.mock('@/services/toastService', () => ({
    toast: { add: vi.fn(), close: vi.fn() }
}));
