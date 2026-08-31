import { Injectable, NestMiddleware } from "@nestjs/common";
import { NextFunction, Request, Response } from "express";
import { tenantContextStore } from "./tenant-context.store";

/**
 * Stamps every HTTP request with an ambient `{ origin: "http" }` tenant
 * store before the rest of the request pipeline runs, so
 * `AsyncLocalStorage`-backed context (branchId, system scope) is available
 * to anything downstream — controllers, guards, the future Prisma
 * extension — without threading it through explicit parameters.
 */
@Injectable()
export class TenantAlsMiddleware implements NestMiddleware {
    use(req: Request, res: Response, next: NextFunction): void {
        tenantContextStore.run({ origin: "http" }, () => {
            next();
        });
    }
}
