import { ImageIcon } from 'lucide-react';
import { createPortal } from 'react-dom';

export function FileDropOverlay({
    active,
    label
}: {
    active: boolean;
    label: string;
}) {
    if (!active) {
        return null;
    }

    return createPortal(
        <div className="vrcx-0-app-overlay bg-background/85 motion-safe:animate-in motion-safe:fade-in-0 pointer-events-none fixed z-[60] flex p-3 select-none motion-safe:duration-100">
            <div className="border-foreground/25 text-foreground flex flex-1 flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed">
                <ImageIcon className="text-muted-foreground size-8" />
                <p className="text-sm font-medium">{label}</p>
            </div>
        </div>,
        document.body
    );
}
