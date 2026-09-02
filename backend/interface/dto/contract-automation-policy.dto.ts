import { IsBoolean, IsInt, Max, Min } from "class-validator";
import {
    ContractAutoFinalizeConfig,
    DEFAULT_CONTRACT_AUTO_FINALIZE_CONFIG,
} from "domain/entities/system-setting.entity";

export class ContractAutoFinalizeConfigDto {
    enabled!: boolean;
    graceDays!: number;
    maxAttempts!: number;

    static from(config: ContractAutoFinalizeConfig): ContractAutoFinalizeConfigDto {
        const dto = new ContractAutoFinalizeConfigDto();
        dto.enabled = config.enabled;
        dto.graceDays = config.graceDays;
        dto.maxAttempts = config.maxAttempts;
        return dto;
    }
}

export class UpdateContractAutoFinalizeConfigDto {
    @IsBoolean()
    enabled!: boolean;

    @IsInt()
    @Min(0)
    @Max(30)
    graceDays!: number;

    @IsInt()
    @Min(1)
    @Max(10)
    maxAttempts!: number;
}

export class ContractAutomationPoliciesResponseDto {
    autoFinalize!: ContractAutoFinalizeConfigDto;

    static from(config: ContractAutoFinalizeConfig = DEFAULT_CONTRACT_AUTO_FINALIZE_CONFIG): ContractAutomationPoliciesResponseDto {
        const dto = new ContractAutomationPoliciesResponseDto();
        dto.autoFinalize = ContractAutoFinalizeConfigDto.from(config);
        return dto;
    }
}
