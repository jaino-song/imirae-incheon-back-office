import { GUARDS_METADATA } from "@nestjs/common/constants";

import { ListOutOfPocketPriceInfoUsecase } from "application/usecases/out-of-pocket-price-info/list-out-of-pocket-price-info.usecase";
import { JwtGuard } from "infrastructure/auth/jwt.guard";
import { TenantGuard } from "infrastructure/tenant";
import { OutOfPocketPriceInfoController } from "interface/controllers/out-of-pocket-price-info.controller";

describe("OutOfPocketPriceInfoController", () => {
    it("should protect the price list with authenticated tenant guards", () => {
        const guards = Reflect.getMetadata(
            GUARDS_METADATA,
            OutOfPocketPriceInfoController.prototype.list,
        ) ?? [];

        expect(guards).toContain(JwtGuard);
        expect(guards).toContain(TenantGuard);
    });

    it("should return JSON-safe price rows", async () => {
        const listUsecase = {
            execute: jest.fn().mockResolvedValue([
                { id: 1, duration: 5, fullPrice: "815000" },
            ]),
        } as unknown as ListOutOfPocketPriceInfoUsecase;
        const controller = new OutOfPocketPriceInfoController(listUsecase);

        await expect(controller.list()).resolves.toEqual([
            { id: 1, duration: 5, fullPrice: "815000" },
        ]);
    });
});
