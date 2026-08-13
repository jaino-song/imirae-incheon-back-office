import { Type } from "class-transformer";
import {
    ArrayNotEmpty,
    IsArray,
    IsInt,
    IsNotEmpty,
    IsNumber,
    IsOptional,
    IsString,
    Min,
    ValidateNested,
} from "class-validator";

export class GenerateSignatureRequestDto {
    @Type(() => Number)
    @IsNumber()
    @Min(0)
    executionTime!: number;
}

export class AccessTokenRequestDto extends GenerateSignatureRequestDto {
    @IsOptional()
    @IsString()
    @IsNotEmpty()
    memberEmail?: string;
}

export class RefreshTokenRequestDto extends GenerateSignatureRequestDto {
    @IsString()
    @IsNotEmpty()
    refreshToken!: string;
}

class ContractDataRequestDto {
    @IsString()
    @IsNotEmpty()
    customerName!: string;

    @IsString()
    @IsNotEmpty()
    customerContact!: string;

    @IsString()
    @IsNotEmpty()
    customerDOB!: string;

    @IsString()
    @IsNotEmpty()
    customerAddress!: string;

    @IsString()
    @IsNotEmpty()
    caretaker1Name!: string;

    @IsString()
    @IsNotEmpty()
    caretaker1Contact!: string;

    @IsString()
    @IsNotEmpty()
    type!: string;

    @IsString()
    @IsNotEmpty()
    days!: string;

    @IsString()
    @IsNotEmpty()
    area!: string;

    @IsString()
    @IsNotEmpty()
    contractDuration!: string;

    @IsString()
    @IsNotEmpty()
    startYear!: string;

    @IsString()
    @IsNotEmpty()
    startMonth!: string;

    @IsString()
    @IsNotEmpty()
    startDay!: string;

    @IsString()
    @IsNotEmpty()
    startDate!: string;

    // 계약 종료일은 이용자 서명 후 직원이 사후 입력하므로 발급 시점에는 비어 있는 것이
    // 정상이다. @IsNotEmpty()를 걸어두면 종료일 미정 계약은 generate-document가
    // 400으로 막혀 embedded iframe이 아예 열리지 않는다.
    @IsString()
    endYear!: string;

    @IsString()
    endMonth!: string;

    @IsString()
    endDay!: string;

    @IsString()
    endDate!: string;

    @IsString()
    @IsNotEmpty()
    paymentYear!: string;

    @IsString()
    @IsNotEmpty()
    paymentMonth!: string;

    @IsString()
    @IsNotEmpty()
    paymentDay!: string;

    @IsString()
    @IsNotEmpty()
    fullPrice!: string;

    @IsString()
    @IsNotEmpty()
    grant!: string;

    @IsString()
    @IsNotEmpty()
    actualPrice!: string;

    @IsOptional()
    @IsString()
    issuerPhone?: string;

    // 접수일. generateDocumentOptions는 사용하지 않지만 계약 생성 폼이 항상 함께
    // 보내므로 선언해 둬야 한다. 전역 파이프가 forbidNonWhitelisted이라 미선언
    // 속성 하나만 있어도 요청 전체가 400이 된다.
    @IsOptional()
    @IsString()
    receiptYear?: string;

    @IsOptional()
    @IsString()
    receiptMonth?: string;

    @IsOptional()
    @IsString()
    receiptDay?: string;
}

export class GenerateDocumentRequestDto {
    @ValidateNested()
    @Type(() => ContractDataRequestDto)
    contractData!: ContractDataRequestDto;

    @IsString()
    @IsNotEmpty()
    accessToken!: string;

    @IsString()
    @IsNotEmpty()
    refreshToken!: string;

    @Type(() => Number)
    @IsInt()
    @Min(1)
    clientId!: number;
}

export class DeleteDocumentsRequestDto {
    @IsArray()
    @ArrayNotEmpty()
    @IsString({ each: true })
    document_ids!: string[];
}

class RecipientPhoneDto {
    @IsString()
    @IsNotEmpty()
    countryCode!: string;

    @IsString()
    @IsNotEmpty()
    phoneNumber!: string;
}

export class ReRequestOutsiderDocumentRequestDto {
    @IsString()
    @IsNotEmpty()
    accessToken!: string;

    @IsString()
    @IsNotEmpty()
    stepType!: string;

    @IsString()
    @IsNotEmpty()
    stepSeq!: string;

    @IsOptional()
    @IsString()
    comment?: string;

    @IsOptional()
    @ValidateNested()
    @Type(() => RecipientPhoneDto)
    recipientPhone?: RecipientPhoneDto;
}
