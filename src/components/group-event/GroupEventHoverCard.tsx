import {
    useEffect,
    useState,
    type ComponentProps,
    type ReactElement
} from 'react';

import { cn } from '@/lib/utils';
import type {
    GroupCalendarEventRecord,
    GroupCalendarGroupRecord
} from '@/repositories/vrchatToolsRepository';
import { nextHoverCardToken, useHoverCardStore } from '@/state/hoverCardStore';
import {
    HoverCard,
    HoverCardContent,
    HoverCardTrigger
} from '@/ui/shadcn/hover-card';

import { GroupEventHoverCardContent } from './GroupEventHoverCardContent';

export function GroupEventHoverCard({
    event,
    groupName,
    groupProfile,
    isFollowing,
    openDelay = 300,
    closeDelay = 120,
    side = 'top',
    align = 'start',
    children
}: {
    event: GroupCalendarEventRecord;
    groupName: string;
    groupProfile?: GroupCalendarGroupRecord | null;
    isFollowing: boolean;
    openDelay?: number;
    closeDelay?: number;
    side?: ComponentProps<typeof HoverCardContent>['side'];
    align?: ComponentProps<typeof HoverCardContent>['align'];
    children: ReactElement;
}) {
    const [open, setOpen] = useState(false);
    const [scrollClosed, setScrollClosed] = useState(false);
    const [token] = useState(nextHoverCardToken);

    useEffect(() => {
        if (!open) {
            return;
        }
        const handleScroll = (scrollEvent: Event) => {
            const target = scrollEvent.target;
            if (
                target instanceof Element &&
                target.closest('[data-slot="hover-card-content"]')
            ) {
                return;
            }
            setScrollClosed(true);
            setOpen(false);
        };
        window.addEventListener('scroll', handleScroll, true);
        return () => window.removeEventListener('scroll', handleScroll, true);
    }, [open]);

    useEffect(() => {
        if (!open) {
            return;
        }
        useHoverCardStore.getState().claim(token);
        const unsubscribe = useHoverCardStore.subscribe((state) => {
            if (state.activeToken !== token) {
                setOpen(false);
            }
        });
        return () => {
            unsubscribe();
            useHoverCardStore.getState().release(token);
        };
    }, [open, token]);

    return (
        <HoverCard
            open={open}
            onOpenChange={(next) => {
                if (next) {
                    setScrollClosed(false);
                }
                setOpen(next);
            }}
        >
            <HoverCardTrigger
                delay={openDelay}
                closeDelay={closeDelay}
                render={children}
                onPointerDownCapture={() => setOpen(false)}
            />
            <HoverCardContent
                className={cn(
                    'w-80 overflow-hidden p-0',
                    scrollClosed && 'data-closed:!animate-none'
                )}
                side={side}
                align={align}
                sideOffset={8}
            >
                <GroupEventHoverCardContent
                    event={event}
                    groupName={groupName}
                    groupProfile={groupProfile}
                    isFollowing={isFollowing}
                />
            </HoverCardContent>
        </HoverCard>
    );
}
