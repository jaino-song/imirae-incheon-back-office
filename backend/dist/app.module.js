"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppModule = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("./infrastructure/database/prisma.service");
const jwt_1 = require("@nestjs/jwt");
const jwt_strategy_1 = require("./infrastructure/auth/jwt.strategy");
const auth_controller_1 = require("./interface/controllers/auth.controller");
const kakao_strategy_1 = require("./infrastructure/auth/kakao.strategy");
const auth_service_1 = require("./application/services/auth.service");
const config_1 = require("@nestjs/config");
const passport_1 = require("@nestjs/passport");
let AppModule = class AppModule {
};
exports.AppModule = AppModule;
exports.AppModule = AppModule = __decorate([
    (0, common_1.Module)({
        imports: [
            config_1.ConfigModule.forRoot({
                isGlobal: true,
            }),
            passport_1.PassportModule,
            jwt_1.JwtModule.register({
                secret: process.env.JWT_SECRET,
                signOptions: { expiresIn: "7d" },
            }),
        ],
        controllers: [auth_controller_1.AuthController],
        providers: [auth_service_1.AuthService, kakao_strategy_1.KakaoStrategy, jwt_strategy_1.JwtStrategy, prisma_service_1.PrismaService],
    })
], AppModule);
//# sourceMappingURL=app.module.js.map