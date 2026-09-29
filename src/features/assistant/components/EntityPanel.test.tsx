import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type EntityPanelTestEntity = {
    kind: string;
    id: string;
    displayName: string;
};
type AssistantStoreState = {
    activeSessionId: string | null;
    surfacedEntitiesBySession: Record<string, EntityPanelTestEntity[]>;
};

const storeMocks = vi.hoisted(() => ({
    assistantState: {
        activeSessionId: null,
        surfacedEntitiesBySession: {}
    } as AssistantStoreState
}));

vi.mock('@/ui/shadcn/scroll-area', async () => {
    const React = await import('react');

    return {
        ScrollArea: ({ children }: { children?: ReactNode }) =>
            React.createElement('div', null, children)
    };
});

vi.mock('@/components/user-hover-card/UserHoverCardContent', async () => {
    const React = await import('react');

    return {
        UserHoverCardContent: ({
            userId,
            seed
        }: {
            userId: string;
            seed?: { stateBucket?: unknown } | null;
        }) =>
            React.createElement('div', {
                'data-user-id': userId,
                'data-seed-state': String(seed?.stateBucket ?? '')
            })
    };
});

vi.mock('@/services/dialogService', () => ({
    openWorldDialog: vi.fn()
}));

vi.mock('@/state/assistantChatStore', () => ({
    useAssistantChatStore: <T,>(
        selector: (state: AssistantStoreState) => T
    ): T => selector(storeMocks.assistantState)
}));

vi.mock('@/state/friendRosterStore', () => ({
    useFriendRosterStore: () => {
        throw new Error('EntityPanel should not read friend roster directly');
    }
}));

import { EntityPanel } from './EntityPanel';

describe('EntityPanel', () => {
    beforeEach(() => {
        storeMocks.assistantState = {
            activeSessionId: 'ses_1',
            surfacedEntitiesBySession: {
                ses_1: [
                    {
                        kind: 'user',
                        id: 'usr_friend',
                        displayName: 'Alice'
                    }
                ]
            }
        };
    });

    it('leaves friend roster fallback to the hover card data hook', () => {
        const html = renderToStaticMarkup(<EntityPanel />);

        expect(html).toContain('data-user-id="usr_friend"');
        expect(html).toContain('data-seed-state=""');
    });
});
