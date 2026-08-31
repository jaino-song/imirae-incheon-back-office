import { Global, Module } from "@nestjs/common";
import { PrismaService } from "./prisma.service";
import { tenantIsolationExtension } from "./tenant-isolation.extension";

/**
 * Provides `PrismaService` via a factory that applies the tenant-isolation
 * Prisma Client extension, so every injector of `PrismaService` gets the
 * extended client.
 *
 * `createExtendedPrismaService()`'s return value is NOT `instanceof
 * PrismaService` (verified empirically against @prisma/client 6.19.1/6.19.2)
 * — `$extends()` does not subclass or copy the prototype chain, so the `as
 * unknown as PrismaService` cast below is a compile-time convenience only,
 * not a runtime fact. In particular `$on` is absent at runtime on the
 * extended client even though the cast's type says it should exist; do not
 * call it through an injected `PrismaService`.
 *
 * `PrismaService`'s `onModuleInit`/`onModuleDestroy` lifecycle hooks DO keep
 * working on the extended instance, but not because of prototype/class
 * identity: Nest's lifecycle runner duck-types the resolved provider value —
 * it calls `instance.onModuleInit()`/`onModuleDestroy()` if those are
 * functions on whatever object the factory returned, with no `instanceof`
 * check involved. `$extends()` happens to carry `onModuleInit`,
 * `onModuleDestroy`, `$connect`, and `$disconnect` through onto the
 * extended object as callable functions, so Nest finds and invokes them the
 * same as it would on the base class.
 */
export function createExtendedPrismaService(): PrismaService {
    const base = new PrismaService();
    return base.$extends(tenantIsolationExtension()) as unknown as PrismaService;
}

@Global()
@Module({
    providers: [
        {
            provide: PrismaService,
            useFactory: createExtendedPrismaService,
        },
    ],
    exports: [PrismaService],
})
export class DatabaseModule {}
