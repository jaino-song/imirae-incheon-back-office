import { ForbiddenException } from '@nestjs/common';
import { TenantGuard } from '../../../infrastructure/tenant/tenant.guard';
import { TenantContext } from '../../../infrastructure/tenant/tenant.context';
import { PrismaService } from '../../../infrastructure/database/prisma.service';
import { tenantContextStore } from '../../../infrastructure/tenant/tenant-context.store';

describe('TenantGuard', () => {
    let guard: TenantGuard;
    let tenantContext: TenantContext;
    let mockPrismaService: any;

    const createMockContext = (user: any) => ({
        switchToHttp: () => ({
            getRequest: () => ({ user }),
        }),
    });

    beforeEach(() => {
        mockPrismaService = {
            branch: {
                findUnique: jest.fn(),
            },
            user_branch: {
                findFirst: jest.fn(),
            },
        };
        tenantContext = new TenantContext();
        guard = new TenantGuard(
            mockPrismaService as unknown as PrismaService,
            tenantContext,
        );
    });

    describe('canActivate', () => {
        describe('given user with valid branchid and membership', () => {
            it('should return true and populate tenantcontext', async () => {
                // #given
                const user = {
                    userId: 'user-123',
                    branchId: 'org-123',
                    role: 'user',
                };
                const request = { user };
                const mockContext = {
                    switchToHttp: () => ({
                        getRequest: () => request,
                    }),
                };
                mockPrismaService.user_branch.findFirst.mockResolvedValue({
                    role: 'admin',
                    branch: { isActive: true },
                });

                // #when
                const result = await guard.canActivate(mockContext as any);

                // #then
                expect(result).toBe(true);
                expect(tenantContext.userId).toBe(user.userId);
                expect(tenantContext.branchId).toBe(user.branchId);
                expect(tenantContext.globalRole).toBe('user');
                expect(tenantContext.branchRole).toBe('admin');
                expect(request).toHaveProperty('tenant', {
                    userId: user.userId,
                    branchId: user.branchId,
                    globalRole: 'user',
                    branchRole: 'admin',
                });
            });
        });

        describe('given an owner and an active branch', () => {
            it('should use the verified owner tenant principal', async () => {
                const user = {
                    userId: 'owner-123',
                    branchId: 'org-123',
                    role: 'owner',
                };
                const request = { user };
                mockPrismaService.branch.findUnique.mockResolvedValue({
                    id: user.branchId,
                    isActive: true,
                });

                await guard.canActivate({
                    switchToHttp: () => ({ getRequest: () => request }),
                } as any);

                expect(request).toHaveProperty('tenant', {
                    userId: user.userId,
                    branchId: user.branchId,
                    globalRole: 'owner',
                    branchRole: 'owner',
                });
            });
        });

        describe('given user without branchid', () => {
            it('should throw forbiddenexception', async () => {
                // #given
                const user = { userId: 'user-123', role: 'user' };
                const mockContext = createMockContext(user);

                // #when & #then
                await expect(guard.canActivate(mockContext as any))
                    .rejects.toThrow(ForbiddenException);
            });
        });

        describe('given user not member of branch', () => {
            it('should throw forbiddenexception', async () => {
                // #given
                const user = {
                    userId: 'user-123',
                    branchId: 'org-123',
                    role: 'user',
                };
                const mockContext = createMockContext(user);
                mockPrismaService.user_branch.findFirst.mockResolvedValue(null);

                // #when & #then
                await expect(guard.canActivate(mockContext as any))
                    .rejects.toThrow(ForbiddenException);
            });
        });

        describe('given an active ambient tenant store', () => {
            it('should write the resolved branchId through to the ALS store', async () => {
                // #given
                const user = {
                    userId: 'user-123',
                    branchId: 'org-123',
                    role: 'user',
                };
                const request = { user };
                const mockContext = {
                    switchToHttp: () => ({
                        getRequest: () => request,
                    }),
                };
                mockPrismaService.user_branch.findFirst.mockResolvedValue({
                    role: 'admin',
                    branch: { isActive: true },
                });

                // #when
                const observedBranchId = await tenantContextStore.run(
                    { origin: 'http' },
                    async () => {
                        await guard.canActivate(mockContext as any);
                        return tenantContextStore.get()?.branchId;
                    },
                );

                // #then
                expect(observedBranchId).toBe(user.branchId);
            });
        });

        describe('given the ambient store is HTTP-origin without a branchId (the state before assignPrincipal runs)', () => {
            it('should run the user_branch membership query under a system-scope store, then restore the outer store', async () => {
                // #given
                const user = {
                    userId: 'user-123',
                    branchId: 'org-123',
                    role: 'user',
                };
                const request = { user };
                const mockContext = {
                    switchToHttp: () => ({
                        getRequest: () => request,
                    }),
                };

                let observedDuringQuery: unknown;
                mockPrismaService.user_branch.findFirst.mockImplementation(async () => {
                    // #when (observed from inside the query itself)
                    observedDuringQuery = tenantContextStore.get();
                    return { role: 'admin', branch: { isActive: true } };
                });

                // #when
                const observedAfterActivate = await tenantContextStore.run(
                    { origin: 'http' },
                    async () => {
                        const result = await guard.canActivate(mockContext as any);
                        expect(result).toBe(true);
                        return tenantContextStore.get();
                    },
                );

                // #then: the membership query itself ran under a system-scope
                // store, so the ALS store being `{ origin: "http" }` with no
                // branchId at query time doesn't trip the tenant-isolation
                // extension's http_no_tenant check.
                expect(observedDuringQuery).toEqual({ origin: 'system', systemScope: true });
                // #then: guard behavior is unchanged — the outer store is
                // restored (system scope does not leak) and still carries
                // the branchId written by assignPrincipal after the query.
                expect(observedAfterActivate).toEqual({ origin: 'http', branchId: user.branchId });
            });
        });
    });
});
