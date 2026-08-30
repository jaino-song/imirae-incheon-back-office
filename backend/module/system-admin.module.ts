import { Module } from "@nestjs/common";

import { SystemAdminService } from "application/services/system-admin.service";
import { DatabaseModule } from "infrastructure/database/database.module";
import { OwnerGuard } from "infrastructure/auth/owner.guard";
import { SystemAdminController } from "interface/controllers/system-admin.controller";
import { AdminAuditEventWriter } from "application/services/admin-audit-event.service";

@Module({
    imports: [DatabaseModule],
    controllers: [SystemAdminController],
    providers: [SystemAdminService, OwnerGuard, AdminAuditEventWriter],
    exports: [SystemAdminService],
})
export class SystemAdminModule {}
