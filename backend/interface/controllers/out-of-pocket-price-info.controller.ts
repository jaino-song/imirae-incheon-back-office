import { Controller, Get, UseGuards } from "@nestjs/common";

import { ListOutOfPocketPriceInfoUsecase } from "application/usecases/out-of-pocket-price-info/list-out-of-pocket-price-info.usecase";
import { JwtGuard } from "infrastructure/auth/jwt.guard";
import { TenantGuard } from "infrastructure/tenant";

@Controller("out-of-pocket-price-infos")
export class OutOfPocketPriceInfoController {
    constructor(private readonly listOutOfPocketPriceInfo: ListOutOfPocketPriceInfoUsecase) {}

    @Get()
    @UseGuards(JwtGuard, TenantGuard)
    list() {
        return this.listOutOfPocketPriceInfo.execute();
    }
}
