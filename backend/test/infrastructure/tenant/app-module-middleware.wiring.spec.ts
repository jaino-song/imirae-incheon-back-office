// Mutating app.module.ts's `configure()` to never actually match a route
// (wrong middleware, wrong route pattern, or the `configure()` method
// silently removed) left all 3991 existing tests green — nothing exercised
// the wiring itself. This spec covers the middleware half only (the
// DatabaseModule half is out of scope for this unit).
import {
    Controller,
    Get,
    INestApplication,
    MiddlewareConsumer,
    Module,
    NestModule,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { TenantAlsMiddleware } from '../../../infrastructure/tenant/tenant-als.middleware';
import { tenantContextStore } from '../../../infrastructure/tenant/tenant-context.store';

// `app.module.ts` cannot be imported directly in this jest project: it
// transitively imports `nanoid` (an ESM-only package) via
// infrastructure/database/repositories/chat-feedback.repository.ts, and
// jest's CommonJS transform (this project's default, non-node_modules-aware
// config) fails on that import with "Cannot use import statement outside a
// module" — verified empirically while writing this spec. Stubbing it out
// is enough to let `app.module.ts` load for the unit-level assertion below;
// the mock's return value is irrelevant since nothing in this spec touches
// chat-feedback/nanoid behavior.
jest.mock('nanoid', () => ({ nanoid: () => 'test-id' }));

const { AppModule } = require('../../../app.module') as typeof import('../../../app.module');

describe('AppModule middleware wiring', () => {
    describe('unit-level: configure()', () => {
        it('applies TenantAlsMiddleware to all routes', () => {
            // #given
            const forRoutes = jest.fn();
            const apply = jest.fn(() => ({ forRoutes }));
            const consumer = { apply } as unknown as MiddlewareConsumer;

            // #when
            const appModule = new AppModule();
            appModule.configure(consumer);

            // #then
            expect(apply).toHaveBeenCalledWith(TenantAlsMiddleware);
            expect(forRoutes).toHaveBeenCalledWith('*');
        });
    });

    describe('behavior-level: a minimal app registering TenantAlsMiddleware the same way AppModule does', () => {
        @Controller('probe')
        class ProbeController {
            @Get()
            get() {
                return { observed: tenantContextStore.get() ?? null };
            }
        }

        @Module({ controllers: [ProbeController] })
        class ProbeModule implements NestModule {
            configure(consumer: MiddlewareConsumer): void {
                consumer.apply(TenantAlsMiddleware).forRoutes('*');
            }
        }

        let app: INestApplication;

        beforeAll(async () => {
            const moduleFixture = await Test.createTestingModule({
                imports: [ProbeModule],
            }).compile();

            app = moduleFixture.createNestApplication();
            await app.init();
        });

        afterAll(async () => {
            await app.close();
        });

        it('stamps every request with { origin: "http" } (no branchId) before the handler runs', async () => {
            // #when
            const response = await request(app.getHttpServer()).get('/probe');

            // #then
            expect(response.status).toBe(200);
            expect(response.body.observed).toEqual({ origin: 'http' });
        });
    });
});
