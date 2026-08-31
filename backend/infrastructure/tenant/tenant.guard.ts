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
import { runSystemScope } from './run-system-scope';

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

        // Runs BEFORE assignPrincipal() writes branchId onto the ALS store
        // (it's the query that determines whether we're even allowed to set
        // it), so at this point the store is still `{ origin: "http" }` with
        // no branchId. `user_branch` IS a tenant model, so without this
        // wrapper the tenant-isolation extension would flag every
        // authenticated non-owner request as an `http_no_tenant` violation.
        // The owner path's `branch.findUnique` above is NOT a tenant model
        // (branch has no branchId column) and is deliberately left unwrapped.
        const membership = await runSystemScope(() =>
            this.prisma.user_branch.findFirst({
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
            }),
        );

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
