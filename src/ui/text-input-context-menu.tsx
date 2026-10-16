import type { MouseEvent as ReactMouseEvent } from 'react';
import {
    useCallback,
    useEffect,
    useLayoutEffect,
    useRef,
    useState
} from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/utils';
import { commands } from '@/platform/tauri/bindings';

type TextControl = HTMLInputElement | HTMLTextAreaElement;

type MenuState = {
    x: number;
    y: number;
    target: TextControl;
};

const VIEWPORT_MARGIN = 8;

function selectionRange(target: TextControl): [number, number] | null {
    try {
        const { selectionStart, selectionEnd } = target;
        if (selectionStart === null || selectionEnd === null) {
            return null;
        }
        return [selectionStart, selectionEnd];
    } catch {
        return null;
    }
}

function isPassword(target: TextControl) {
    return target instanceof HTMLInputElement && target.type === 'password';
}

function TextInputContextMenu({
    x,
    y,
    target,
    onClose
}: MenuState & { onClose: () => void }) {
    const { t } = useTranslation();
    const menuRef = useRef<HTMLDivElement>(null);
    const [position, setPosition] = useState({ left: x, top: y });

    const range = selectionRange(target);
    const selectedText = range ? target.value.slice(range[0], range[1]) : '';
    const editable = !target.readOnly && !target.disabled;
    const canCopy = Boolean(selectedText) && !isPassword(target);

    useLayoutEffect(() => {
        const menu = menuRef.current;
        if (!menu) {
            return;
        }
        const { width, height } = menu.getBoundingClientRect();
        setPosition({
            left: Math.max(
                VIEWPORT_MARGIN,
                Math.min(x, window.innerWidth - width - VIEWPORT_MARGIN)
            ),
            top: Math.max(
                VIEWPORT_MARGIN,
                Math.min(y, window.innerHeight - height - VIEWPORT_MARGIN)
            )
        });
    }, [x, y]);

    useEffect(() => {
        const handlePointerDown = (event: PointerEvent) => {
            if (
                event.target instanceof Node &&
                menuRef.current?.contains(event.target)
            ) {
                return;
            }
            onClose();
        };
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
            }
            onClose();
        };
        document.addEventListener('pointerdown', handlePointerDown, true);
        document.addEventListener('keydown', handleKeyDown, true);
        document.addEventListener('scroll', onClose, true);
        window.addEventListener('resize', onClose);
        window.addEventListener('blur', onClose);
        target.addEventListener('blur', onClose);
        return () => {
            document.removeEventListener(
                'pointerdown',
                handlePointerDown,
                true
            );
            document.removeEventListener('keydown', handleKeyDown, true);
            document.removeEventListener('scroll', onClose, true);
            window.removeEventListener('resize', onClose);
            window.removeEventListener('blur', onClose);
            target.removeEventListener('blur', onClose);
        };
    }, [onClose, target]);

    async function copySelection() {
        return navigator.clipboard
            .writeText(selectedText)
            .then(() => true)
            .catch(() => false);
    }

    async function cutSelection() {
        if (!(await copySelection())) {
            return;
        }
        target.focus();
        document.execCommand('delete');
    }

    async function paste() {
        const text = await commands.appGetClipboard().catch(() => '');
        if (!text) {
            return;
        }
        target.focus();
        document.execCommand('insertText', false, text);
    }

    function selectAll() {
        target.focus();
        target.select();
    }

    const items = [
        {
            key: 'cut',
            label: t('common.actions.cut'),
            disabled: !editable || !canCopy,
            run: cutSelection
        },
        {
            key: 'copy',
            label: t('common.actions.copy'),
            disabled: !canCopy,
            run: copySelection
        },
        {
            key: 'paste',
            label: t('common.actions.paste'),
            disabled: !editable,
            run: paste
        },
        {
            key: 'select_all',
            label: t('common.actions.select_all'),
            disabled: !target.value,
            run: selectAll
        }
    ];

    return (
        <div
            ref={menuRef}
            role="menu"
            tabIndex={-1}
            data-slot="text-input-context-menu"
            className="bg-popover text-popover-foreground ring-foreground/10 fixed z-50 min-w-32 rounded-lg p-1 shadow-md ring-1"
            style={position}
            onMouseDown={(event) => event.preventDefault()}
            onContextMenu={(event) => event.preventDefault()}
        >
            {items.map((item) => (
                <button
                    key={item.key}
                    type="button"
                    role="menuitem"
                    disabled={item.disabled}
                    className={cn(
                        'hover:bg-accent hover:text-accent-foreground flex w-full items-center rounded-md px-1.5 py-1 text-left text-sm outline-none',
                        'disabled:pointer-events-none disabled:opacity-50'
                    )}
                    onClick={() => {
                        onClose();
                        void item.run();
                    }}
                >
                    {item.label}
                </button>
            ))}
        </div>
    );
}

export function useTextInputContextMenu<T extends TextControl>(
    onContextMenu?: (event: ReactMouseEvent<T>) => void
) {
    const [menu, setMenu] = useState<MenuState | null>(null);
    const closeMenu = useCallback(() => setMenu(null), []);

    function handleContextMenu(event: ReactMouseEvent<T>) {
        onContextMenu?.(event);
        if (event.defaultPrevented) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        const target = event.currentTarget;
        if (document.activeElement !== target) {
            target.focus();
        }
        setMenu({ x: event.clientX, y: event.clientY, target });
    }

    return {
        onContextMenu: handleContextMenu,
        menu: menu
            ? createPortal(
                  <TextInputContextMenu {...menu} onClose={closeMenu} />,
                  document.body
              )
            : null
    };
}
