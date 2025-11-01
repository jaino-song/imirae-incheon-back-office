import { Body, Controller, Delete, Get, Param, Patch, Post } from "@nestjs/common";
import { ClientService } from "application/services/client.service";
import { CreateClientDto, UpdateClientDto } from "interface/dto/client.dto";

@Controller("clients")
export class ClientController {
    constructor(private readonly clientService: ClientService) {}

    @Post()
    create(@Body() dto: CreateClientDto) {
        return this.clientService.create({
            name: dto.name,
            primaryEmployeeId: dto.primaryEmployeeId,
            secondaryEmployeeId: dto.secondaryEmployeeId ?? null,
            address: dto.address ?? null,
            phone: dto.phone ?? null,
            type: dto.type ?? null,
            duration: dto.duration ?? null,
            fullPrice: dto.fullPrice ?? null,
            grant: dto.grant ?? null,
            actualPrice: dto.actualPrice ?? null,
            startDate: dto.startDate ?? null,
            endDate: dto.endDate ?? null,
            careCenter: dto.careCenter,
            voucherClient: dto.voucherClient,
        });
    }

    @Get()
    findAll() {
        return this.clientService.findAll();
    }

    @Get(":id")
    findById(@Param("id") id: string) {
        return this.clientService.findById(Number(id));
    }

    @Patch(":id")
    update(@Param("id") id: string, @Body() dto: UpdateClientDto) {
        return this.clientService.update(Number(id), {
            name: dto.name,
            primaryEmployeeId: dto.primaryEmployeeId,
            secondaryEmployeeId: dto.secondaryEmployeeId,
            address: dto.address,
            phone: dto.phone,
            type: dto.type,
            duration: dto.duration,
            fullPrice: dto.fullPrice,
            grant: dto.grant,
            actualPrice: dto.actualPrice,
            startDate: dto.startDate,
            endDate: dto.endDate,
            careCenter: dto.careCenter,
            voucherClient: dto.voucherClient,
        });
    }

    @Delete(":id")
    delete(@Param("id") id: string) {
        return this.clientService.delete(Number(id));
    }
}
