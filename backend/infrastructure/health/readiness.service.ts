import { Injectable } from "@nestjs/common";

@Injectable()
export class ReadinessService {
    private ready = true;

    isReady(): boolean {
        return this.ready;
    }

    markNotReady(): void {
        this.ready = false;
    }
}
