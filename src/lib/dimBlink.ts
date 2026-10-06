export type DimBlinkOptions = {
    opacity: number;
    halfCycles: number;
    halfCycleMs: number;
};

export function dimBlink(
    element: Element,
    { opacity, halfCycles, halfCycleMs }: DimBlinkOptions
): Animation {
    return element.animate([{ opacity: 1 }, { opacity }], {
        duration: halfCycleMs,
        iterations: halfCycles,
        direction: 'alternate',
        easing: 'ease-in-out'
    });
}
