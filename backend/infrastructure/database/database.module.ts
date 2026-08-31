import { Global, Module } from "@nestjs/common";
import { PrismaService } from "./prisma.service";
import { tenantIsolationExtension } from "./tenant-isolation.extension";

/**
 * Provides `PrismaService` via a factory that applies the tenant-isolation
 * Prisma Client extension, so every injector of `PrismaService` gets the
 * extended client. `$extends()` returns a distinct object but shares the
 * base instance's prototype (verified empirically against @prisma/client
 * 6.19.1), so `PrismaService`'s `onModuleInit`/`onModuleDestroy` lifecycle
 * hooks keep working unmodified on the extended instance — Nest detects and
 * invokes them the same as it would on the base class.
 */
@Global()
@Module({
    providers: [
        {
            provide: PrismaService,
            useFactory: (): PrismaService => {
                const base = new PrismaService();
                return base.$extends(tenantIsolationExtension()) as unknown as PrismaService;
            },
        },
    ],
    exports: [PrismaService],
})
export class DatabaseModule {}
