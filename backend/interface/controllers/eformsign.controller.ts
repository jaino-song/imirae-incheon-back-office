import { Controller, Post, Body, HttpException, HttpStatus } from "@nestjs/common";
import { EformsignService } from "../../application/services/eformsign.service";
import { ContractDataDto } from "../../application/dto/contract.dto";

@Controller("api")
export class EformsignController {
    constructor(private readonly eformsignService: EformsignService) {}

    @Post("generate-signature")
    async generateSignature(@Body() body: { executionTime: number }) {
        try {
            const signature = this.eformsignService.generateSignature(body.executionTime);
            return { signature };
        } catch (error) {
            throw new HttpException(
                { error: error.message },
                HttpStatus.INTERNAL_SERVER_ERROR
            );
        }
    }

    @Post("access-token")
    async getAccessToken(@Body() body: { executionTime: number; memberEmail?: string }) {
        try {
            const result = await this.eformsignService.getAccessToken(
                body.executionTime,
                body.memberEmail
            );
            return result;
        } catch (error) {
            throw new HttpException(
                { error: error.message },
                HttpStatus.INTERNAL_SERVER_ERROR
            );
        }
    }

    @Post("refresh-token")
    async refreshAccessToken(@Body() body: { executionTime: number; refreshToken: string }) {
        try {
            const result = await this.eformsignService.refreshAccessToken(
                body.executionTime,
                body.refreshToken
            );
            return result;
        } catch (error) {
            throw new HttpException(
                { error: error.message },
                HttpStatus.INTERNAL_SERVER_ERROR
            );
        }
    }

    @Post("generate-document")
    async generateDocument(
        @Body() body: { contractData: ContractDataDto; accessToken: string; refreshToken: string }
    ) {
        try {
            const documentOptions = this.eformsignService.generateDocumentOptions(
                body.contractData,
                body.accessToken,
                body.refreshToken
            );
            return documentOptions;
        } catch (error) {
            throw new HttpException(
                { error: error.message },
                HttpStatus.INTERNAL_SERVER_ERROR
            );
        }
    }
}

