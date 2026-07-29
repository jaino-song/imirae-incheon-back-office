import {
    Controller,
    Get,
    Post,
    Put,
    Body,
    Param,
    Req,
    ParseIntPipe,
    UseGuards,
} from "@nestjs/common";
import { Request } from "express";
import { ServiceRecordEntryService } from "application/services/service-record-entry.service";
import { ScheduleChangeService } from "application/services/schedule-change.service";
import { ServiceRecordGuard } from "infrastructure/auth/service-record.guard";
import { ServiceRecordHeaderEditGuard } from "infrastructure/auth/service-record-header-edit.guard";
import { ServiceRecordTokenContext } from "application/services/service-record-token.service";
import {
    VerifyServiceRecordPhoneDto,
    AuthorizeServiceRecordHeaderEditDto,
    SaveServiceHeaderDto,
    UpsertSessionDto,
} from "interface/dto/service-record-entry.dto";

type ServiceRecordRequest = Request & { serviceRecordContext: ServiceRecordTokenContext };

/**
 * No-login 제공기록지 endpoints (BJJ-247).
 * `link/:token` + `verify` are public (link token + phone). Everything else is behind
 * ServiceRecordGuard and reads the assignment context off the request.
 */
@Controller("service-record")
export class ServiceRecordEntryController {
    constructor(
        private readonly service: ServiceRecordEntryService,
        private readonly scheduleChangeService: ScheduleChangeService,
    ) {}

    @Get("link/:linkToken")
    linkStatus(@Param("linkToken") linkToken: string) {
        return this.service.linkStatus(linkToken);
    }

    @Post("verify")
    verify(@Body() dto: VerifyServiceRecordPhoneDto) {
        return this.service.verify(dto.linkToken, dto.phone);
    }

    @UseGuards(ServiceRecordHeaderEditGuard)
    @Post("header-edit/authorize")
    authorizeHeaderEdit(
        @Req() req: ServiceRecordRequest,
        @Body() dto: AuthorizeServiceRecordHeaderEditDto,
    ) {
        return this.service.authorizeHeaderEdit(req.serviceRecordContext, dto.linkToken);
    }

    @UseGuards(ServiceRecordHeaderEditGuard)
    @Get("context")
    getContext(@Req() req: ServiceRecordRequest) {
        return this.service.getContext(req.serviceRecordContext);
    }

    @UseGuards(ServiceRecordGuard)
    @Get("schedule-change/preview")
    previewScheduleChange(@Req() req: ServiceRecordRequest) {
        return this.scheduleChangeService.preview(req.serviceRecordContext);
    }

    @UseGuards(ServiceRecordGuard)
    @Post("schedule-change")
    createScheduleChange(@Req() req: ServiceRecordRequest) {
        return this.scheduleChangeService.createRequest(req.serviceRecordContext);
    }

    @UseGuards(ServiceRecordHeaderEditGuard)
    @Put("header")
    saveHeader(@Req() req: ServiceRecordRequest, @Body() dto: SaveServiceHeaderDto) {
        return this.service.saveHeader(req.serviceRecordContext, dto);
    }

    @UseGuards(ServiceRecordGuard)
    @Put("sessions/:index")
    saveSession(
        @Req() req: ServiceRecordRequest,
        @Param("index", ParseIntPipe) index: number,
        @Body() dto: UpsertSessionDto,
    ) {
        return this.service.upsertSession(req.serviceRecordContext, index, dto, false);
    }

    @UseGuards(ServiceRecordGuard)
    @Post("sessions/:index/submit")
    submitSession(
        @Req() req: ServiceRecordRequest,
        @Param("index", ParseIntPipe) index: number,
        @Body() dto: UpsertSessionDto,
    ) {
        return this.service.upsertSession(req.serviceRecordContext, index, dto, true);
    }

    @UseGuards(ServiceRecordGuard)
    @Post("finalize")
    finalize(@Req() req: ServiceRecordRequest) {
        return this.service.finalize(req.serviceRecordContext);
    }
}
