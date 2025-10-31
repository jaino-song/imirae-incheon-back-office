import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { VoucherPriceInfoService } from "application/services/voucher-price-info.service";
import {
    CreateVoucherPriceInfoDto,
    UpdateVoucherPriceInfoDto,
} from "interface/dto/voucher-price-info.dto";

@Controller("voucher-price-infos")
export class VoucherPriceInfoController {
    constructor(private readonly voucherService: VoucherPriceInfoService) {}

    @Post()
    create(@Body() dto: CreateVoucherPriceInfoDto) {
        return this.voucherService.create({
            type: dto.type,
            duration: BigInt(dto.duration),
            fullPrice: dto.fullPrice,
            grant: dto.grant,
            actualPrice: dto.actualPrice,
        });
    }

    @Get()
    list() {
        return this.voucherService.list();
    }

    @Get(":id")
    findById(@Param("id") id: string) {
        return this.voucherService.findById(Number(id));
    }

    @Get("search/by-type")
    findByType(@Query("type") type: string) {
        return this.voucherService.findByType(type);
    }

    @Patch(":id")
    update(@Param("id") id: string, @Body() dto: UpdateVoucherPriceInfoDto) {
        return this.voucherService.update(Number(id), {
            type: dto.type ?? undefined,
            duration: dto.duration !== undefined ? BigInt(dto.duration) : undefined,
            fullPrice: dto.fullPrice ?? undefined,
            grant: dto.grant ?? undefined,
            actualPrice: dto.actualPrice ?? undefined,
        });
    }

    @Delete(":id")
    delete(@Param("id") id: string) {
        return this.voucherService.delete(Number(id));
    }
}

