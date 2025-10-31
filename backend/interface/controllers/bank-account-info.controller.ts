import { Controller, Post, Body, Get, Param, Patch, Delete } from "@nestjs/common";
import { BankAccountInfoService } from "application/services/bank-account-info.service";
import { CreateBankAccountInfoDto, UpdateBankAccountInfoDto } from "../dto/bank-account-info.dto";

@Controller("bank-account-infos")
export class BankAccountInfoController {
    constructor(private readonly bankAccountInfoService: BankAccountInfoService) {}

    @Post()
    create(@Body() createBankAccountInfoDto: CreateBankAccountInfoDto) {
        return this.bankAccountInfoService.create(createBankAccountInfoDto);
    }

    @Get(":area")
    findByArea(@Param("area") area: string) {
        return this.bankAccountInfoService.findByArea(area);
    }

    @Patch(":area")
    update(@Param("area") area: string, @Body() updateBankAccountInfoDto: UpdateBankAccountInfoDto) {
        return this.bankAccountInfoService.update(area, updateBankAccountInfoDto);
    }

    @Delete(":area")
    delete(@Param("area") area: string) {
        return this.bankAccountInfoService.delete(area);
    }
}