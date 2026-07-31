import {
    Body,
    Controller,
    Delete,
    ForbiddenException,
    Get,
    Param,
    Patch,
    Post,
    Query,
    Req,
    Res,
    UseGuards,
} from "@nestjs/common";
import type { Response } from "express";
import { UserService } from "application/services/user.service";
import { CreateUserDto, UpdateUserDto, ApproveUserDto } from "../dto/user.dto";
import { JwtGuard } from "infrastructure/auth/jwt.guard";
import { OwnerOrAdminGuard } from "infrastructure/auth/owner-or-admin.guard";
import { OwnerOnlyGuard } from "infrastructure/auth/owner-only.guard";

type AuthenticatedRequest = { user: { userId: string; role: string; branchId?: string } };

@Controller("users")
@UseGuards(JwtGuard, OwnerOrAdminGuard)
export class UserController {
    constructor(private readonly userService: UserService) {}

    private markLegacyUserApi(response: Response): void {
        response.setHeader("Deprecation", "true");
        response.setHeader("Sunset", "Fri, 16 Oct 2026 00:00:00 GMT");
        response.setHeader("Link", '</users/{userId}>; rel="successor-version"');
    }

    @Get()
    findDirectory(
        @Req() req: { user: { role: string; branchId?: string } },
        @Query("status") status?: string,
    ) {
        if (req.user.role !== "owner" && !req.user.branchId) {
            throw new ForbiddenException("Branch context is required");
        }

        // Owners are scoped to their selected branch too, but they must still see
        // branch-less (pending) sign-ups: a user gets no branch membership until an
        // owner/admin approves them and assigns one, so hiding branch-less users here
        // would make the approval flow unreachable for owners with a branch selected.
        return this.userService.findDirectory({
            branchId: req.user.branchId,
            includeUnassigned: req.user.role === "owner",
            status,
        });
    }

    @Post()
    create(@Body() createUserDto: CreateUserDto) {
        return this.userService.create(createUserDto);
    }

    @Get("kakao")
    findByKakaoId(@Query("kakaoId") kakaoId: string) {
        return this.userService.findByKakaoId(kakaoId);
    }

    @Get("id")
    @UseGuards(JwtGuard, OwnerOnlyGuard)
    findById(
        @Query("id") id: string,
        @Res({ passthrough: true }) response: Response,
    ) {
        this.markLegacyUserApi(response);
        return this.userService.findById(id);
    }
    
    @Patch()
    @UseGuards(JwtGuard, OwnerOnlyGuard)
    update(
        @Req() req: AuthenticatedRequest,
        @Query("id") id: string,
        @Body() updateUserDto: UpdateUserDto,
        @Res({ passthrough: true }) response: Response,
    ) {
        this.markLegacyUserApi(response);
        return this.userService.update(id, {
            name: updateUserDto.name ?? undefined,
            email: updateUserDto.email ?? undefined,
            profileImage: updateUserDto.profileImage ?? undefined,
            role: updateUserDto.role,
            callerRole: req.user.role,
        });
    }

    @Delete()
    @UseGuards(JwtGuard, OwnerOnlyGuard)
    delete(
        @Query("id") id: string,
        @Res({ passthrough: true }) response: Response,
    ) {
        this.markLegacyUserApi(response);
        return this.userService.delete(id);
    }

    @Get(":id")
    @UseGuards(JwtGuard, OwnerOnlyGuard)
    findGlobalUserById(@Param("id") id: string) {
        return this.userService.findById(id);
    }

    @Patch(":id")
    @UseGuards(JwtGuard, OwnerOnlyGuard)
    updateGlobalUser(
        @Req() req: AuthenticatedRequest,
        @Param("id") id: string,
        @Body() updateUserDto: UpdateUserDto,
    ) {
        return this.userService.update(id, {
            name: updateUserDto.name ?? undefined,
            email: updateUserDto.email ?? undefined,
            profileImage: updateUserDto.profileImage ?? undefined,
            role: updateUserDto.role,
            callerRole: req.user.role,
        });
    }

    @Delete(":id")
    @UseGuards(JwtGuard, OwnerOnlyGuard)
    deleteGlobalUser(@Param("id") id: string) {
        return this.userService.delete(id);
    }

    @Post(":id/approve")
    @UseGuards(JwtGuard, OwnerOnlyGuard)
    approve(
        @Req() req: AuthenticatedRequest,
        @Param("id") id: string,
        @Body() approveUserDto: ApproveUserDto,
    ) {
        return this.userService.approve(id, {
            role: approveUserDto.role,
            branchId: approveUserDto.branchId,
            ownerBranchId: approveUserDto.ownerBranchId,
            approvedBy: req.user.userId,
        });
    }

    @Post(":id/reject")
    @UseGuards(JwtGuard, OwnerOnlyGuard)
    reject(@Param("id") id: string) {
        return this.userService.reject(id);
    }
}
