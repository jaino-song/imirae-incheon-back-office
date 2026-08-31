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
    });
});
