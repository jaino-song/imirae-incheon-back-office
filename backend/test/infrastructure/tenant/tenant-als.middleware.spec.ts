import { TenantAlsMiddleware } from '../../../infrastructure/tenant/tenant-als.middleware';
import { tenantContextStore } from '../../../infrastructure/tenant/tenant-context.store';

describe('TenantAlsMiddleware', () => {
    let middleware: TenantAlsMiddleware;

    beforeEach(() => {
        middleware = new TenantAlsMiddleware();
    });

    describe('given a request passed through use()', () => {
        it('should make the store visible inside next() with origin "http"', () => {
            // #given
            let observed: unknown;
            const next = jest.fn(() => {
                observed = tenantContextStore.get();
            });

            // #when
            middleware.use({} as any, {} as any, next);

            // #then
            expect(next).toHaveBeenCalledTimes(1);
            expect(observed).toEqual({ origin: 'http' });
        });

        it('should not leave the store active after use() returns', () => {
            // #given
            const next = jest.fn();

            // #when
            middleware.use({} as any, {} as any, next);

            // #then
            expect(tenantContextStore.get()).toBeUndefined();
        });
    });
});
