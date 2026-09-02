import {
    Controller,
    Get,
    Header,
    HttpStatus,
    Inject,
    Optional,
    Res,
} from "@nestjs/common";
import type { Response } from "express";

import { SchedulerLeaseMode, SchedulerLeaseService } from "application/services/scheduler-lease.service";
import { PrismaService } from "infrastructure/database/prisma.service";
import { ReadinessService } from "infrastructure/health/readiness.service";

interface HealthResponse {
    status: "ok";
}

interface ReadinessResponse {
    status: "ok" | "unavailable";
}

interface LeaseResponse {
    mode: SchedulerLeaseMode;
    holderId: string;
    held: boolean;
}

@Controller()
export class HealthController {
    constructor(
        // The union type compiles to `Object` in design:paramtypes, so Nest
        // needs the explicit token; without it @Optional() silently injects
        // undefined and every readiness probe answers 503.
        @Optional()
        @Inject(PrismaService)
        private readonly prisma: PrismaService | undefined,
        private readonly readiness: ReadinessService,
        private readonly schedulerLease: SchedulerLeaseService,
    ) {}

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
            if (!this.readiness.isReady()) {
                throw new Error("Application readiness has been revoked");
            }

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

    /**
     * Which host runs background schedulers right now (ADR-010). Always 200: this is
     * an observation, not a readiness signal — a passive host is healthy AND not holding.
     */
    @Get("health/lease")
    @Header("Cache-Control", "no-store")
    getLease(@Res({ passthrough: true }) response: Response): LeaseResponse {
        response.setHeader("Cache-Control", "no-store");
        const snapshot = this.schedulerLease.snapshot();
        return { mode: snapshot.mode, holderId: snapshot.holderId, held: snapshot.held };
    }
}
