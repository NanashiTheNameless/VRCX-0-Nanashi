import { useLayoutEffect, useState, type RefObject } from 'react';

// How custom badges are drawn, from roomiest to tightest. Built-in badges are
// never part of this: they always show at the requested size.
export type CustomBadgeLevel = 'full' | 'icons' | 'folder';

export type BadgeFitInput = {
    available: number;
    others: number;
    builtin: number;
    gap: number;
    innerGap: number;
    levels: readonly { level: CustomBadgeLevel; width: number }[];
};

// Picks the first level whose badges fit beside the rest of the row without
// shrinking the name; falls back to the tightest level.
export function chooseBadgeLevel({
    available,
    others,
    builtin,
    gap,
    innerGap,
    levels
}: BadgeFitInput): CustomBadgeLevel {
    for (const { level, width } of levels) {
        const badges =
            builtin + (builtin > 0 && width > 0 ? innerGap : 0) + width;
        if (others + gap + badges <= available + 0.5) {
            return level;
        }
    }
    return levels.at(-1)?.level ?? 'folder';
}

function contentWidth(node: Node): number {
    const range = document.createRange();
    range.selectNodeContents(node);
    return range.getBoundingClientRect().width;
}

// Width a row child would take if nothing truncated it. A truncated element
// still lays its text out in full, so the text's range is wider than the box.
function naturalWidth(element: HTMLElement): number {
    const style = getComputedStyle(element);
    if (style.position === 'absolute' || style.position === 'fixed') {
        return 0;
    }
    const margins =
        (Number.parseFloat(style.marginLeft) || 0) +
        (Number.parseFloat(style.marginRight) || 0);
    const content = contentWidth(element);
    const grows = (Number.parseFloat(style.flexGrow) || 0) > 0;
    return (grows ? content : Math.max(element.offsetWidth, content)) + margins;
}

function measureRow(row: HTMLElement, wrapper: HTMLElement) {
    const style = getComputedStyle(row);
    const isRow =
        style.display.includes('flex') &&
        !style.flexDirection.startsWith('column') &&
        style.flexWrap === 'nowrap';
    if (!isRow) {
        return null;
    }
    const gap = Number.parseFloat(style.columnGap) || 0;
    const available =
        row.clientWidth -
        (Number.parseFloat(style.paddingLeft) || 0) -
        (Number.parseFloat(style.paddingRight) || 0);
    let others = 0;
    let items = 0;
    for (const node of Array.from(row.childNodes)) {
        if (node === wrapper) {
            continue;
        }
        if (node instanceof HTMLElement) {
            const width = naturalWidth(node);
            if (width > 0) {
                others += width;
                items += 1;
            }
        } else if (
            node.nodeType === Node.TEXT_NODE &&
            node.textContent?.trim()
        ) {
            others += contentWidth(node);
            items += 1;
        }
    }
    return { available, others: others + gap * Math.max(items - 1, 0), gap };
}

export function useCustomBadgeLevel({
    enabled,
    levels,
    wrapperRef,
    builtinRef,
    measureRef,
    contentKey
}: {
    enabled: boolean;
    levels: readonly CustomBadgeLevel[];
    wrapperRef: RefObject<HTMLElement | null>;
    builtinRef: RefObject<HTMLElement | null>;
    measureRef: RefObject<HTMLElement | null>;
    contentKey: string;
}): CustomBadgeLevel {
    const [level, setLevel] = useState<CustomBadgeLevel>(levels[0]);
    const levelsKey = levels.join(',');

    useLayoutEffect(() => {
        const wrapper = wrapperRef.current;
        const row = wrapper?.parentElement;
        const preferred = levelsKey.split(',')[0] as CustomBadgeLevel;
        if (
            !enabled ||
            !wrapper ||
            !row ||
            typeof ResizeObserver === 'undefined'
        ) {
            setLevel(preferred);
            return;
        }
        const update = () => {
            const measured = measureRow(row, wrapper);
            const clones = measureRef.current;
            if (!measured || !clones) {
                setLevel(preferred);
                return;
            }
            const innerGap =
                Number.parseFloat(getComputedStyle(wrapper).columnGap) || 0;
            setLevel(
                chooseBadgeLevel({
                    ...measured,
                    builtin: builtinRef.current?.offsetWidth ?? 0,
                    innerGap,
                    levels: levelsKey.split(',').map((entry) => ({
                        level: entry as CustomBadgeLevel,
                        width:
                            clones.querySelector<HTMLElement>(
                                `[data-badge-level="${entry}"]`
                            )?.offsetWidth ?? 0
                    }))
                })
            );
        };
        update();
        const observer = new ResizeObserver(update);
        observer.observe(row);
        if (measureRef.current) {
            observer.observe(measureRef.current);
        }
        void document.fonts?.ready.then(update);
        return () => observer.disconnect();
    }, [builtinRef, contentKey, enabled, levelsKey, measureRef, wrapperRef]);

    return enabled ? level : levels[0];
}
