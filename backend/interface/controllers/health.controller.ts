import { Controller, Get } from "@nestjs/common";

interface HealthResponse {
    status: "ok";
}

@Controller()
export class HealthController {
    @Get("health")
    getHealth(): HealthResponse {
        return { status: "ok" };
    }
}
