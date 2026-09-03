import {
    BadRequestException,
    Body,
    Controller,
    Get,
    GoneException,
    Headers,
    HttpCode,
    HttpException,
    HttpStatus,
    Inject,
    NotFoundException,
    Param,
    Post,
    Query,
    Res,
    UnauthorizedException,
    UseGuards,
} from "@nestjs/common";
import { Response } from "express";
import { FILE_STORAGE_PORT, FileStorageObjectNotFoundError, FileStoragePort } from "domain/ports/file-storage.port";
import { RateLimitGuard } from "infrastructure/auth/rate-limit.guard";
import { ReceiptLinkTokenService, ReceiptLinkUnusableReason } from "application/services/receipt-link-token.service";
import { VerifyReceiptBirthdayDto } from "interface/dto/receipt-link.dto";

function buildContentDisposition(type: "inline" | "attachment", filename: string): string {
    const ascii = filename.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "");
    // encodeURIComponent leaves a handful of chars RFC 5987 attr-char excludes
    // (' ( ) * !) unescaped; percent-encode those too so the ext-value is valid.
    const extValue = encodeURIComponent(filename).replace(
        /['()*!]/g,
        (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
    );
    return `${type}; filename="${ascii}"; filename*=UTF-8''${extValue}`;
}

function unusableToHttp(reason: ReceiptLinkUnusableReason): HttpException {
    return reason === "not_found" ? new NotFoundException({ reason }) : new GoneException({ reason });
}

/** Public, unauthenticated endpoints for the mother-facing receipt page. */
@Controller("receipt-links")
export class ReceiptLinkController {
    constructor(
        private readonly tokenService: ReceiptLinkTokenService,
        @Inject(FILE_STORAGE_PORT) private readonly storage: FileStoragePort,
    ) {}

    // Handler names below are deliberately prefixed (receiptStatus/receiptVerify, not
    // status/verify): RateLimitGuard buckets on `${method}:${handler.name}`
    // (rate-limit.guard.ts), so a bare "verify" here would share its rate-limit bucket with
    // ServiceRecordEntryController's own POST "verify" handler — an unrelated public endpoint.
    @Get(":token/status")
    @UseGuards(RateLimitGuard)
    async receiptStatus(@Param("token") token: string) {
        const result = await this.tokenService.getStatus(token, new Date());
        if (!result.ok) throw unusableToHttp(result.reason);
        // Explicit projection, not the raw service object: a future field added to
        // ReceiptLinkStatus (e.g. clientName, phone) must never leak to this
        // pre-verification, unauthenticated endpoint just because the service grew it.
        return {
            ok: result.ok,
            state: result.state,
            branchName: result.branchName,
            expiresAt: result.expiresAt,
            remainingAttempts: result.remainingAttempts,
            lockedUntil: result.lockedUntil,
        };
    }

    @Post(":token/verify")
    @HttpCode(200)
    @UseGuards(RateLimitGuard)
    async receiptVerify(@Param("token") token: string, @Body() body: VerifyReceiptBirthdayDto) {
        const result = await this.tokenService.verifyBirthday(token, body.birthday ?? "", new Date());
        if (result.ok) return result;
        switch (result.reason) {
            case "verification_failed":
                throw new UnauthorizedException({ reason: result.reason, remainingAttempts: result.remainingAttempts });
            case "locked":
                throw new HttpException({ reason: result.reason, lockedUntil: result.lockedUntil }, HttpStatus.LOCKED);
            case "invalid_format":
                throw new BadRequestException({ reason: result.reason });
            default:
                throw unusableToHttp(result.reason);
        }
    }

    // No RateLimitGuard here: the image endpoint is gated by the access token itself
    // (minted only after a successful birthday verification), not by request rate.
    @Get(":token/image")
    async image(
        @Param("token") token: string,
        @Query("download") download: string | undefined,
        @Headers("x-receipt-access-token") headerToken: string | undefined,
        @Headers("authorization") authorization: string | undefined,
        @Res() res: Response,
    ): Promise<void> {
        const accessToken = headerToken?.trim() || authorization?.replace(/^Bearer\s+/i, "").trim() || "";
        const access = accessToken ? await this.tokenService.resolveAccess(token, accessToken, new Date()) : null;
        if (!access) throw new UnauthorizedException({ reason: "access_required" });

        let png: Buffer;
        try {
            png = await this.storage.download(access.storagePath);
        } catch (error) {
            // The row survived (access resolved) but its storage object is gone — e.g. reaped by
            // the expiry sweep in a race with a still-live token row. Reads as "link expired",
            // not an unhandled 500.
            if (error instanceof FileStorageObjectNotFoundError) {
                throw new GoneException({ reason: "expired" });
            }
            throw error;
        }
        res.set({
            "Content-Type": "image/png",
            "Content-Length": String(png.length),
            "Content-Disposition": buildContentDisposition(download === "1" ? "attachment" : "inline", `영수증_${access.clientName}.png`),
            "Cache-Control": "private, no-store",
            "X-Content-Type-Options": "nosniff",
        });
        res.send(png);
    }
}
