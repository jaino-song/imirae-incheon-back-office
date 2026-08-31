import { Test } from "@nestjs/testing";

import { createExtendedPrismaService, DatabaseModule } from "./database.module";
import { PrismaService } from "./prisma.service";

/**
 * F1-g wiring regression: proves `DatabaseModule` actually applies the tenant-isolation
 * extension to the `PrismaService` it provides, and that the corrected docblock's claims about
 * the extended instance's runtime shape hold. Deliberately never triggers `onModuleInit()` (no
 * `$connect()`, no live DB needed): `PrismaService`'s constructor alone doesn't connect, and — as
 * asserted below — `Test.createTestingModule(...).compile()` alone doesn't invoke Nest lifecycle
 * hooks either.
 */

/** Narrow, structural view of the Prisma Client extension registry's internal shape. */
interface ExtendedClientShape {
    _extensions?: { head?: { extension?: { name?: string } } };
}

function extensionNameOf(service: PrismaService): string | undefined {
    return (service as unknown as ExtendedClientShape)._extensions?.head?.extension?.name;
}

describe("createExtendedPrismaService — the factory DatabaseModule wires up", () => {
    it("returns a PrismaService carrying the tenant-isolation extension (fails if useFactory reverts to `return base`)", () => {
        const service = createExtendedPrismaService();
        // A plain `new PrismaService()` has no `_extensions.head` at all (verified empirically
        // against @prisma/client 6.19.2) — only `$extends()` populates it, and it records the
        // extension's own registered name. Reverting `useFactory` to `return base` makes this
        // assertion fail: `extensionNameOf(base)` is `undefined`, not `"tenant-isolation"`.
        expect(extensionNameOf(service)).toBe("tenant-isolation");
    });

    it("the extended instance is NOT `instanceof PrismaService` despite the `as unknown as PrismaService` cast", () => {
        // Documents/locks in the corrected database.module.ts docblock: $extends() does not
        // subclass PrismaService, so the cast is a compile-time convenience only.
        const service = createExtendedPrismaService();
        expect(service instanceof PrismaService).toBe(false);
    });

    it("lifecycle hooks and $connect/$disconnect survive as callable functions on the extended instance", () => {
        // Proves the docblock's claim that Nest's lifecycle runner still finds these (duck-typed
        // on the resolved instance, not via `instanceof`/prototype identity). Never invoked here
        // — calling onModuleInit() would attempt a real $connect().
        const service = createExtendedPrismaService();
        const rec = service as unknown as Record<string, unknown>;
        expect(typeof rec["onModuleInit"]).toBe("function");
        expect(typeof rec["onModuleDestroy"]).toBe("function");
        expect(typeof rec["$connect"]).toBe("function");
        expect(typeof rec["$disconnect"]).toBe("function");
    });

    it("$on is absent at runtime on the extended instance, despite the PrismaService cast's type", () => {
        const service = createExtendedPrismaService();
        const rec = service as unknown as Record<string, unknown>;
        expect(rec["$on"]).toBeUndefined();
    });
});

describe("DatabaseModule — DI wiring applies the same extended factory", () => {
    it("app.get(PrismaService) resolves the tenant-isolation-extended instance, with no lifecycle hooks triggered by compile()", async () => {
        const onModuleInitSpy = jest.spyOn(PrismaService.prototype, "onModuleInit");

        const moduleRef = await Test.createTestingModule({ imports: [DatabaseModule] }).compile();
        try {
            // Guards the premise this test relies on: compiling the testing module must not have
            // attempted a real $connect() via onModuleInit — this suite has no live DB.
            expect(onModuleInitSpy).not.toHaveBeenCalled();

            const service = moduleRef.get(PrismaService);
            expect(extensionNameOf(service)).toBe("tenant-isolation");
        } finally {
            onModuleInitSpy.mockRestore();
            await moduleRef.close();
        }
    });
});
