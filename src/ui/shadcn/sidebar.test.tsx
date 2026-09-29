import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import {
    Sidebar,
    SidebarGroupLabel,
    SidebarMenu,
    SidebarMenuButton,
    SidebarMenuItem,
    SidebarProvider
} from './sidebar';

function getSlotClassName(markup: string, slot: string): string {
    const element = Array.from(markup.matchAll(/<[^>]+>/g))
        .map((match) => match[0])
        .find((tag) => tag.includes(`data-slot="${slot}"`));
    const className = element?.match(/class="([^"]+)"/)?.[1];
    if (!className) {
        throw new Error(`Missing ${slot} class name.`);
    }
    return className;
}

function renderSidebarTransitions(instantSidebarTransition: boolean): string {
    return renderToStaticMarkup(
        <SidebarProvider instantSidebarTransition={instantSidebarTransition}>
            <SidebarGroupLabel>Group</SidebarGroupLabel>
            <SidebarMenu>
                <SidebarMenuItem>
                    <SidebarMenuButton>Item</SidebarMenuButton>
                </SidebarMenuItem>
            </SidebarMenu>
        </SidebarProvider>
    );
}

describe('Sidebar positioning', () => {
    it('allows a layout-owned desktop sidebar to override viewport positioning', () => {
        const markup = renderToStaticMarkup(
            <SidebarProvider>
                <Sidebar className="absolute h-auto">Content</Sidebar>
            </SidebarProvider>
        );
        const className = getSlotClassName(markup, 'sidebar-container');

        expect(className).toContain('absolute');
        expect(className).toContain('inset-y-0');
        expect(className).toContain('h-auto');
        expect(className).not.toContain('fixed');
        expect(className).not.toContain('h-svh');
    });
});

describe('Sidebar transitions', () => {
    it('disables group-label and menu-button layout transitions only when instant', () => {
        const instant = renderSidebarTransitions(true);
        const animated = renderSidebarTransitions(false);

        for (const slot of ['sidebar-group-label', 'sidebar-menu-button']) {
            expect(getSlotClassName(instant, slot)).toContain(
                'transition-none'
            );
            expect(getSlotClassName(animated, slot)).not.toContain(
                'transition-none'
            );
        }
    });
});
