import {
    Controller,
    Get,
    Header,
    HttpStatus,
    Optional,
    Res,
} from "@nestjs/common";
import type { Response } from "express";

import { PrismaService } from "infrastructure/database/prisma.service";

interface HealthResponse {
    status: "ok";
}

interface ReadinessResponse {
    status: "ok" | "unavailable";
}

@Controller()
export class HealthController {
    constructor(@Optional() private readonly prisma?: PrismaService) {}

    @Get("health")
    getHealth(): HealthResponse {
        return { status: "ok" };
    }

    @Get("health/ready")
    @Header("Cache-Control", "no-store")
    async getReadiness(
        @Res({ passthrough: true }) response: Response,
    ): Promise<ReadinessResponse> {
        response.setHeader("Cache-Control", "no-store");

        try {
            if (!this.prisma) {
                throw new Error("Database service is unavailable");
            }

            await this.prisma.$queryRaw`SELECT 1`;
            response.status(HttpStatus.OK);
            return { status: "ok" };
        } catch {
            response.status(HttpStatus.SERVICE_UNAVAILABLE);
            return { status: "unavailable" };
        }
    }
}
