import { Body, Controller, Delete, Get, Param, ParseIntPipe, Query, Patch, Post, UseGuards } from "@nestjs/common";
import { ClientService } from "application/services/client.service";
import { CreateClientDto, UpdateClientDto, TerminateServiceDto, RequestReplacementDto } from "interface/dto/client.dto";
import { JwtGuard } from "infrastructure/auth/jwt.guard";
import { CurrentTenant, TenantGuard } from "infrastructure/tenant";
import { parseInteger } from "interface/parse-integer";

@Controller("clients")
@UseGuards(JwtGuard, TenantGuard)
export class ClientController {
    constructor(private readonly clientService: ClientService) {}

    @Post()
    create(@CurrentTenant() tenant: { branchId?: string }, @Body() dto: CreateClientDto) {
        return this.clientService.create(tenant.branchId ?? "", {
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
            careCenter: dto.careCenter ?? null,
            voucherClient: dto.voucherClient,
            birthday: dto.birthday ?? null,
            dueDate: dto.dueDate ?? null,
            birthDate: dto.birthDate ?? null,
            serviceStatus: dto.serviceStatus ?? null,
            breastPump: dto.breastPump,
            eDocId: dto.eDocId ?? null,
            areaId: dto.areaId ?? null,
            suppressGreetingSms: dto.suppressGreetingSms,
            applyMessageAutomation: dto.applyMessageAutomation,
            reuseExistingClient: dto.reuseExistingClient,
            source: dto.source,
        });
    }

    @Get()
    findAll(
        @CurrentTenant() tenant: { branchId?: string },
        @Query("page") page?: string,
        @Query("limit") limit?: string,
        @Query("search") search?: string,
        @Query("filter") filter?: string,
    ) {
        if (filter) {
            return this.clientService.findByFilter(tenant.branchId ?? "", filter);
        }
        if (page !== undefined || limit !== undefined) {
            return this.clientService.findAllPaginated(
                tenant.branchId ?? "",
                parseInteger(page, "page", { defaultValue: 1, min: 1 }),
                parseInteger(limit, "limit", { defaultValue: 20, min: 1, max: 100 }),
                search,
            );
        }
        return this.clientService.findAll(tenant.branchId ?? "");
    }


    @Get("stats")
    getStats(@CurrentTenant() tenant: { branchId?: string }) {
        return this.clientService.getStats(tenant.branchId ?? "");
    }

    @Get("dashboard-overview")
    getDashboardOverview(
        @CurrentTenant() tenant: { branchId?: string },
        @Query("limit") limit?: string,
    ) {
        return this.clientService.getDashboardOverview(
            tenant.branchId ?? "",
            parseInteger(limit, "limit", { defaultValue: 50, min: 1, max: 100 }),
        );
    }

    @Get("alerts")
    getActionRequiredAlerts(
        @CurrentTenant() tenant: { branchId?: string },
        @Query("limit") limit?: string,
    ) {
        return this.clientService.getActionRequiredAlerts(
            tenant.branchId ?? "",
            parseInteger(limit, "limit", { defaultValue: 3, min: 1, max: 100 }),
        );
    }

    @Get("check-phone")
    async checkPhone(@CurrentTenant() tenant: { branchId?: string }, @Query("phone") phone?: string) {
        return { exists: await this.clientService.checkPhoneExists(tenant.branchId ?? "", phone) };
    }

    @Get(":id")
    findById(@CurrentTenant() tenant: { branchId?: string }, @Param("id", ParseIntPipe) id: number) {
        return this.clientService.findById(tenant.branchId ?? "", id);
    }

    @Patch(":id")
    update(
        @CurrentTenant() tenant: { branchId?: string },
        @Param("id", ParseIntPipe) id: number,
        @Body() dto: UpdateClientDto
    ) {
        return this.clientService.update(tenant.branchId ?? "", id, {
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
            birthday: dto.birthday,
            dueDate: dto.dueDate,
            birthDate: dto.birthDate,
            serviceStatus: dto.serviceStatus,
            breastPump: dto.breastPump,
            eDocId: dto.eDocId,
            areaId: dto.areaId,
        });
    }

    @Delete(":id")
    delete(@CurrentTenant() tenant: { branchId?: string }, @Param("id", ParseIntPipe) id: number) {
        return this.clientService.delete(tenant.branchId ?? "", id);
    }

    /**
     * Terminate a client's service
     * Sets status to 'terminated' and ends the service immediately
     */
    @Patch(":id/terminate")
    terminate(
        @CurrentTenant() tenant: { branchId?: string },
        @Param("id", ParseIntPipe) id: number,
        @Body() dto: TerminateServiceDto
    ) {
        return this.clientService.terminateService(tenant.branchId ?? "", id, dto.reason);
    }

    /**
     * Request a provider replacement for a client
     * Sets status to 'replacement_requested' and assigns new employees
     */
    @Patch(":id/request-replacement")
    requestReplacement(
        @CurrentTenant() tenant: { branchId?: string },
        @Param("id", ParseIntPipe) id: number,
        @Body() dto: RequestReplacementDto
    ) {
        return this.clientService.requestReplacement(
            tenant.branchId ?? "",
            id,
            dto.newPrimaryEmployeeId,
            dto.newSecondaryEmployeeId,
        );
    }

    /**
     * Complete a replacement and restore service to normal status
     */
    @Patch(":id/complete-replacement")
    completeReplacement(@CurrentTenant() tenant: { branchId?: string }, @Param("id", ParseIntPipe) id: number) {
        return this.clientService.completeReplacement(tenant.branchId ?? "", id);
    }
}
