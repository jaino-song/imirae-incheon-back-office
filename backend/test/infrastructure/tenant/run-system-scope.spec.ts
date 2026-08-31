import { Logger } from '@nestjs/common';
import { runSystemScope } from '../../../infrastructure/tenant/run-system-scope';
import { tenantContextStore } from '../../../infrastructure/tenant/tenant-context.store';

describe('runSystemScope', () => {
    afterEach(() => {
        jest.restoreAllMocks();
    });

    describe('given a callback run inside runSystemScope', () => {
        it('should see systemScope: true and origin: "system"', () => {
            // #given
            jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);

            // #when
            const observed = runSystemScope(() => tenantContextStore.get());

            // #then
            expect(observed).toEqual({ origin: 'system', systemScope: true });
        });
    });

    describe('given any invocation', () => {
        it('should emit a tenant_system_scope_used audit log event with the call site', () => {
            // #given
            const logSpy = jest
                .spyOn(Logger.prototype, 'log')
                .mockImplementation(() => undefined);

            // #when
            runSystemScope(() => undefined);

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
        it('should leave the ambient store undefined after returning', () => {
            // #given
            jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);

            // #when
            runSystemScope(() => undefined);

            // #then
            expect(tenantContextStore.get()).toBeUndefined();
        });
    });
});
