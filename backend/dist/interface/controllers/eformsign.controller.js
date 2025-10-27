"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.EformsignController = void 0;
const common_1 = require("@nestjs/common");
const eformsign_service_1 = require("../../application/services/eformsign.service");
let EformsignController = class EformsignController {
    constructor(eformsignService) {
        this.eformsignService = eformsignService;
    }
    async generateSignature(body) {
        try {
            const signature = this.eformsignService.generateSignature(body.executionTime);
            return { signature };
        }
        catch (error) {
            throw new common_1.HttpException({ error: error.message }, common_1.HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }
    async getAccessToken(body) {
        try {
            const result = await this.eformsignService.getAccessToken(body.executionTime, body.memberEmail);
            return result;
        }
        catch (error) {
            throw new common_1.HttpException({ error: error.message }, common_1.HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }
    async refreshAccessToken(body) {
        try {
            const result = await this.eformsignService.refreshAccessToken(body.executionTime, body.refreshToken);
            return result;
        }
        catch (error) {
            throw new common_1.HttpException({ error: error.message }, common_1.HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }
    async generateDocument(body) {
        try {
            const documentOptions = this.eformsignService.generateDocumentOptions(body.contractData, body.accessToken, body.refreshToken);
            return documentOptions;
        }
        catch (error) {
            throw new common_1.HttpException({ error: error.message }, common_1.HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }
};
exports.EformsignController = EformsignController;
__decorate([
    (0, common_1.Post)("generate-signature"),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], EformsignController.prototype, "generateSignature", null);
__decorate([
    (0, common_1.Post)("access-token"),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], EformsignController.prototype, "getAccessToken", null);
__decorate([
    (0, common_1.Post)("refresh-token"),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], EformsignController.prototype, "refreshAccessToken", null);
__decorate([
    (0, common_1.Post)("generate-document"),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], EformsignController.prototype, "generateDocument", null);
exports.EformsignController = EformsignController = __decorate([
    (0, common_1.Controller)("api"),
    __metadata("design:paramtypes", [eformsign_service_1.EformsignService])
], EformsignController);
//# sourceMappingURL=eformsign.controller.js.map