import { Controller, Post, Body, Get, Param, Patch, Delete } from "@nestjs/common";
import { UserService } from "application/services/user.service";
import { CreateUserDto, UpdateUserDto } from "../dto/user.dto";

@Controller("users")
export class UserController {
    constructor(private readonly userService: UserService) {}

    @Post()
    create(@Body() createUserDto: CreateUserDto) {
        return this.userService.create(createUserDto);
    }

    @Get(":id")
    findById(@Param("id") id: string) {
        return this.userService.findById(id);
    }

    @Get("kakao/:kakaoId")
    findByKakaoId(@Param("kakaoId") kakaoId: string) {
        return this.userService.findByKakaoId(kakaoId);
    }
    
    @Patch(":id")
    update(@Param("id") id: string, @Body() updateUserDto: UpdateUserDto) {
        return this.userService.update(id, updateUserDto);
    }

    @Delete(":id")
    delete(@Param("id") id: string) {
        return this.userService.delete(id);
    }
}