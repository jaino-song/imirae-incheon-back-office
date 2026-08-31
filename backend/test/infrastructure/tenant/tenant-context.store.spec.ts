import { Logger } from '@nestjs/common';
import { TenantContextStore } from '../../../infrastructure/tenant/tenant-context.store';

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('TenantContextStore', () => {
    let store: TenantContextStore;

    beforeEach(() => {
        store = new TenantContextStore();
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    describe('given a value set via setBranchId inside run', () => {
        it('should remain visible after awaits within the same run', async () => {
            // #given / #when
            await store.run({ origin: 'http' }, async () => {
                await wait(5);
                store.setBranchId('branch-1');
                await wait(5);

                // #then
                expect(store.get()?.branchId).toBe('branch-1');
                expect(store.get()?.origin).toBe('http');
            });
        });
    });

    describe('given two concurrent run contexts', () => {
        it('should never see each other\'s branchId', async () => {
            // #given
            const seenByA: Array<string | undefined> = [];
            const seenByB: Array<string | undefined> = [];

            // #when
            await Promise.all([
                store.run({ origin: 'http' }, async () => {
                    store.setBranchId('branch-a');
                    await wait(15);
                    seenByA.push(store.get()?.branchId);
                }),
                store.run({ origin: 'http' }, async () => {
                    await wait(5);
                    store.setBranchId('branch-b');
                    await wait(5);
                    seenByB.push(store.get()?.branchId);
                }),
            ]);

            // #then
            expect(seenByA).toEqual(['branch-a']);
            expect(seenByB).toEqual(['branch-b']);
        });
    });

    describe('given no active run', () => {
        it('get() should return undefined', () => {
            // #then
            expect(store.get()).toBeUndefined();
        });

        it('setBranchId should no-op without throwing', () => {
            // #when / #then
            expect(() => store.setBranchId('branch-x')).not.toThrow();
            expect(store.get()).toBeUndefined();
        });
    });

    describe('given a RAW run() call entering system scope (bypassing runSystemScope entirely)', () => {
        it('should still emit a tenant_system_scope_used audit log — the raw capability must not be audit-blind', () => {
            // #given
            const logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);

            // #when
            store.run({ origin: 'system', systemScope: true }, () => undefined);

            // #then
            expect(logSpy).toHaveBeenCalledTimes(1);
            const [payload] = logSpy.mock.calls[0] as [string];
            const parsed = JSON.parse(payload);
            expect(parsed.event).toBe('tenant_system_scope_used');
            expect(typeof parsed.callSite).toBe('string');
            expect(parsed.callSite.length).toBeGreaterThan(0);
        });

        it('should use the provided options.callSite override instead of deriving one from its own stack', () => {
            // #given
            const logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);

            // #when
            store.run(
                { origin: 'system', systemScope: true },
                () => undefined,
                { callSite: 'custom-call-site-marker' },
            );

            // #then
            const [payload] = logSpy.mock.calls[0] as [string];
            const parsed = JSON.parse(payload);
            expect(parsed.callSite).toBe('custom-call-site-marker');
        });
    });

    describe('given a run() call NOT entering system scope', () => {
        it('should not emit any audit log', () => {
            // #given
            const logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);

            // #when
            store.run({ origin: 'http' }, () => undefined);

            // #then
            expect(logSpy).not.toHaveBeenCalled();
        });
    });
});
