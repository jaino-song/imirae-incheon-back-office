import { Module } from "@nestjs/common";
import { DiscoveryModule } from "@nestjs/core";

import { DatabaseModule } from "infrastructure/database/database.module";
import { AgentFlagsService } from "application/agent/agent-flags.service";
import { ActionCoordinatorService } from "application/agent/action-coordinator.service";
import { AgentRateLimitService } from "application/agent/agent-rate-limit.service";
import { AgentRuntimeService } from "application/agent/agent-runtime.service";
import { AgentSessionService } from "application/agent/agent-session.service";
import { CapabilityRegistryService } from "application/agent/capability-registry.service";
import { CapabilityRouterService } from "application/agent/capability-router.service";
import { AgentTraceService } from "application/agent/agent-trace.service";
import { AGENT_SESSION_REPOSITORY } from "domain/repositories/agent-session.repository.interface";
import { OwnerGuard } from "infrastructure/auth/owner.guard";
import { PrismaAgentSessionRepository } from "infrastructure/database/repositories/prisma-agent-session.repository";
import { AgentModelFactory } from "infrastructure/agent/agent-model.factory";
import { AgentActionSweepLockService } from "infrastructure/locking/agent-action-sweep-lock.service";
import { AgentController } from "interface/controllers/agent.controller";
import { AgentActionController } from "interface/controllers/agent-action.controller";
import { ExtendedReadAgentCapabilitiesProvider } from "application/agent/extended-read-agent-capabilities.provider";
import { AgentIntelligenceService } from "application/agent/agent-intelligence.service";
import { SystemSettingModule } from "module/system-setting.module";
import { CallInboxModule } from "module/call-inbox.module";
import { ConsultationInquiryModule } from "module/consultation-inquiry.module";
import { DocumentModule } from "module/document.module";
import { AgentReleaseEvidenceService } from "application/agent/agent-release-evidence.service";
import { AgentFeedbackService } from "application/agent/agent-feedback.service";
import { SystemAdminModule } from "module/system-admin.module";

@Module({
    imports: [DiscoveryModule, SystemSettingModule, SystemAdminModule, DatabaseModule, CallInboxModule, ConsultationInquiryModule, DocumentModule],
    controllers: [AgentController, AgentActionController],
    providers: [
        AgentFlagsService,
        ActionCoordinatorService,
        AgentActionSweepLockService,
        ExtendedReadAgentCapabilitiesProvider,
        AgentIntelligenceService,
        AgentRateLimitService,
        AgentRuntimeService,
        AgentSessionService,
        CapabilityRegistryService,
        CapabilityRouterService,
        AgentTraceService,
        AgentReleaseEvidenceService,
        AgentFeedbackService,
        AgentModelFactory,
        OwnerGuard,
        { provide: AGENT_SESSION_REPOSITORY, useClass: PrismaAgentSessionRepository },
    ],
    exports: [CapabilityRegistryService],
})
export class AgentModule {}
