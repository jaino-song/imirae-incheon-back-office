import {
    CanActivate,
    ExecutionContext,
    ForbiddenException,
    Injectable,
    Logger,
} from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { TenantContext, VerifiedTenantPrincipal } from './tenant.context';
import { tenantContextStore } from './tenant-context.store';

@Injectable()
export class TenantGuard implements CanActivate {
    private readonly logger = new Logger(TenantGuard.name);
    constructor(
        private readonly prisma: PrismaService,
        private readonly tenantContext: TenantContext,
    ) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const request = context.switchToHttp().getRequest();
        const user = request.user;

        if (!user?.branchId) {
            this.logDenial(user?.userId, undefined, "branch_not_selected");
            throw new ForbiddenException('Branch selection required');
        }

        // Owners have access to all branches without membership check
        if (user.role === 'owner') {
            const org = await this.prisma.branch.findUnique({
                where: { id: user.branchId },
                select: { id: true, isActive: true },
            });

            if (!org?.isActive) {
                this.logDenial(user.userId, user.branchId, "branch_inactive");
                throw new ForbiddenException('Branch not found');
            }

            this.assignPrincipal(request, {
                userId: user.userId,
                branchId: user.branchId,
                globalRole: user.role,
                branchRole: 'owner',
            });
            return true;
        }

        const membership = await this.prisma.user_branch.findFirst({
            where: {
                userId: user.userId,
                branchId: user.branchId,
            },
            select: {
                role: true,
                branch: {
                    select: {
                        isActive: true,
                    },
                },
            },
        });

        if (!membership?.branch.isActive) {
            this.logDenial(user.userId, user.branchId, "membership_missing");
            throw new ForbiddenException('Access denied to this branch');
        }

        this.assignPrincipal(request, {
            userId: user.userId,
            branchId: user.branchId,
            globalRole: user.role,
            branchRole: membership.role ?? 'user',
        });

        return true;
    }

    private logDenial(
        userId: string | undefined,
        branchId: string | undefined,
        reason: string,
    ): void {
        this.logger.warn(JSON.stringify({
            event: "tenant_denial",
            reason,
            userId: userId ?? null,
            branchId: branchId ?? null,
        }));
    }

    private assignPrincipal(
        request: { tenant?: VerifiedTenantPrincipal },
        principal: VerifiedTenantPrincipal,
    ): void {
        request.tenant = principal;
        this.tenantContext.assign(principal);
        tenantContextStore.setBranchId(principal.branchId);
    }
}
