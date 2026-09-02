import { Logger } from '@nestjs/common';
import { runSystemScope } from '../../../infrastructure/tenant/run-system-scope';
import { tenantContextStore } from '../../../infrastructure/tenant/tenant-context.store';

describe('runSystemScope', () => {
    afterEach(() => {
        jest.restoreAllMocks();
    });

    describe('given a callback run inside runSystemScope', () => {
        it('should see systemScope: true and origin: "system"', async () => {
            // #given
            jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);

            // #when
            const observed = await runSystemScope(() => tenantContextStore.get());

            // #then
            expect(observed).toEqual({ origin: 'system', systemScope: true });
        });
    });

    describe('given a lazy thenable (a PrismaPromise executes only when first awaited)', () => {
        it('should trigger the thenable INSIDE the system-scope store, not after scope exit', async () => {
            // #given
            jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
            let storeAtExecution: ReturnType<typeof tenantContextStore.get>;
            const lazyQuery = {
                // Mimics PrismaPromise: the "query" runs at first .then().
                then(onFulfilled: (value: string) => unknown, onRejected?: (reason: unknown) => unknown) {
                    storeAtExecution = tenantContextStore.get();
                    return Promise.resolve('row').then(onFulfilled, onRejected);
                },
            };

            // #when — deliberately NOT awaited inside the callback, like a
            // call site doing `runSystemScope(() => prisma.model.findMany())`.
            const result = await runSystemScope(() => lazyQuery as unknown as Promise<string>);

            // #then
            expect(result).toBe('row');
            expect(storeAtExecution).toEqual({ origin: 'system', systemScope: true });
        });
    });

    describe('given any invocation', () => {
        it('should emit a tenant_system_scope_used audit log event with the call site', async () => {
            // #given
            const logSpy = jest
                .spyOn(Logger.prototype, 'log')
                .mockImplementation(() => undefined);

            // #when
            await runSystemScope(() => undefined);

            // #then
            expect(logSpy).toHaveBeenCalledTimes(1);
            const [payload] = logSpy.mock.calls[0] as [string];
            const parsed = JSON.parse(payload);
            expect(parsed.event).toBe('tenant_system_scope_used');
            expect(typeof parsed.callSite).toBe('string');
            expect(parsed.callSite.length).toBeGreaterThan(0);
        });
    });

    describe('given no active store outside runSystemScope', () => {
        it('should leave the ambient store undefined after returning', async () => {
            // #given
            jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);

            // #when
            await runSystemScope(() => undefined);

            // #then
            expect(tenantContextStore.get()).toBeUndefined();
        });
    });
});
