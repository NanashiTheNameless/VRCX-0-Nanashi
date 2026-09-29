import { vi, type Mock } from 'vitest';

export function mockBindingsModule() {
    const commandMocks = new Map<string, Mock>();
    const commands = new Proxy(
        {},
        {
            get(_target, key) {
                if (typeof key !== 'string' || key === 'then') {
                    return undefined;
                }
                let command = commandMocks.get(key);
                if (!command) {
                    command = vi.fn();
                    commandMocks.set(key, command);
                }
                return command;
            }
        }
    );
    return { commands };
}
