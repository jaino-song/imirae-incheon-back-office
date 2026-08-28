"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Spinner } from "@/components/ui/spinner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import { Stepper, Step, StepLabel } from "@/components/ui/stepper";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
    SelectGroup,
    SelectLabel as SelectGroupLabel,
} from "@/components/ui/select";
import { AlertCircle } from "lucide-react";
import { useVoucherPriceInfos, useVoucherYears } from "@/hooks/useVoucherData";
import {
    useCreateEmployee,
    useEmployees,
    type CreateEmployeeDto,
    type Employee,
} from "@/hooks/useEmployees";
import { useCreateClient } from "@/hooks/useClients";
import type { CreateClientDto } from "@/lib/client/types";
import type { ClientRegistrationDraft } from "@/lib/client/client-registration-extraction";
import {
    buildCanonicalClientRegistrationBasics,
    formatKoreanPhoneNumber,
    getCanonicalClientRegistrationError,
    isValidCompactDateInput,
    parseCompactDateInput,
} from "@/lib/client/client-registration-formats";
import voucherOptions from "@/components/app/messages/templates/json/voucher.json";
import { WORK_AREAS, normalizeEmployeeGrade } from "@/components/app/employees/employee-form.constants";

export type CreatedClient = {
    id: number;
    name: string;
};

interface ClientRegistrationWizardProps {
    initialDraft?: ClientRegistrationDraft;
    onCreated?: (client: CreatedClient) => void;
}

const steps = ["기본 정보", "바우처 정보", "설정"] as const;

const WIZARD_MIN_HEIGHT_PX = 520;

function formatPrice(price: string): string {
    const num = parseInt(price.replace(/[,원\s]/g, ""), 10);
    if (Number.isNaN(num)) return price;
    return num.toLocaleString("ko-KR");
}

export function ClientRegistrationWizard({
    initialDraft,
    onCreated,
}: ClientRegistrationWizardProps) {
    const createClientMutation = useCreateClient();
    const createEmployeeMutation = useCreateEmployee();
    const {
        data: employees = [],
        isLoading: isEmployeesLoading,
        isError: isEmployeesError,
    } = useEmployees();
    const [activeStep, setActiveStep] = useState(0);

    const [name, setName] = useState(initialDraft?.name ?? "");
    const [phone, setPhone] = useState(initialDraft?.phone ? formatKoreanPhoneNumber(initialDraft.phone) : "");
    const [birthday, setBirthday] = useState(initialDraft?.birthday ?? "");
    const [address, setAddress] = useState(initialDraft?.address ?? "");
    const [dueDate, setDueDate] = useState(initialDraft?.dueDate ?? "");

    const [isRegisteringEmployee, setIsRegisteringEmployee] = useState(false);
    const [employeeName, setEmployeeName] = useState(initialDraft?.employeeName ?? "");
    const [createdEmployeeId, setCreatedEmployeeId] = useState<number | null>(null);
    const [selectedEmployeeId, setSelectedEmployeeId] = useState<number | null>(null);
    const [employeePhone, setEmployeePhone] = useState("");
    const [employeeGrade, setEmployeeGrade] = useState("스탠다드");
    const [employeeWorkArea, setEmployeeWorkArea] = useState<string>(WORK_AREAS[0]);

    const [voucherClient, setVoucherClient] = useState(true);
    const { data: voucherYears = [], isLoading: isVoucherYearsLoading } = useVoucherYears();
    const [voucherYear, setVoucherYear] = useState<number | null>(null);
    const [voucherType, setVoucherType] = useState("");
    const [voucherDuration, setVoucherDuration] = useState("");
    const [fullPrice, setFullPrice] = useState("");
    const [grant, setGrant] = useState("");
    const [actualPrice, setActualPrice] = useState("");

    const resolvedVoucherYear = useMemo(() => {
        if (voucherYear !== null) return voucherYear;
        if (voucherYears.length === 0) return null;
        return Math.max(...voucherYears);
    }, [voucherYear, voucherYears]);

    const { data: voucherPriceInfos = [], isLoading: isVoucherPriceInfosLoading } = useVoucherPriceInfos(
        voucherType,
        resolvedVoucherYear ?? undefined,
    );

    const [careCenter, setCareCenter] = useState(false);
    const [breastPump, setBreastPump] = useState(false);

    const [isSubmitting, setIsSubmitting] = useState(false);
    const [submitError, setSubmitError] = useState<string | null>(null);

    const isVoucherInfoComplete =
        resolvedVoucherYear !== null &&
        voucherType.trim().length > 0 &&
        voucherDuration.trim().length > 0 &&
        fullPrice.trim().length > 0 &&
        grant.trim().length > 0 &&
        actualPrice.trim().length > 0;

    const matchingEmployees = employees.filter(
        (candidate: Employee) => candidate.name === employeeName.trim(),
    );
    const selectedEmployee = selectedEmployeeId === null
        ? undefined
        : matchingEmployees.find((employee) => employee.id === selectedEmployeeId);
    const matchedEmployee = selectedEmployee
        ?? (matchingEmployees.length === 1 ? matchingEmployees[0] : undefined);
    const hasAmbiguousEmployeeMatch = matchingEmployees.length > 1 && !selectedEmployee;
    const needsEmployeeRegistration = Boolean(employeeName)
        && !isEmployeesLoading
        && !isEmployeesError
        && matchingEmployees.length === 0
        && createdEmployeeId === null;
    const canRegisterEmployee = employeeName.trim().length >= 2
        && employeePhone.replace(/\D/g, "").length === 11
        && Boolean(employeeWorkArea);

    useEffect(() => {
        if (isRegisteringEmployee && (matchingEmployees.length > 0 || isEmployeesError)) {
            setIsRegisteringEmployee(false);
        }
    }, [isEmployeesError, isRegisteringEmployee, matchingEmployees.length]);

    const canGoNext = useMemo(() => {
        if (activeStep === 0) {
            return Boolean(name.trim() && phone.trim() && birthday.trim() && address.trim())
                && (isValidCompactDateInput(dueDate) || initialDraft?.skippedFields?.includes("dueDate"))
                && !(employeeName && (isEmployeesLoading || isEmployeesError))
                && !hasAmbiguousEmployeeMatch;
        }
        if (activeStep === 1) {
            if (!voucherClient) return true;
            return isVoucherInfoComplete;
        }
        return true;
    }, [activeStep, name, phone, birthday, address, dueDate, employeeName, hasAmbiguousEmployeeMatch, isEmployeesError, isEmployeesLoading, initialDraft?.skippedFields, voucherClient, isVoucherInfoComplete]);

    const handleNext = () => {
        if (!canGoNext) return;
        setActiveStep((s) => Math.min(s + 1, steps.length - 1));
    };

    const handleBack = () => {
        setActiveStep((s) => Math.max(s - 1, 0));
    };

    const handleVoucherYearChange = (year: string) => {
        setVoucherYear(Number(year));
        setVoucherType("");
        setVoucherDuration("");
        setFullPrice("");
        setGrant("");
        setActualPrice("");
    };

    const handleVoucherTypeChange = (type: string) => {
        setVoucherType(type);
        setVoucherDuration("");
        setFullPrice("");
        setGrant("");
        setActualPrice("");
    };

    const handleVoucherDurationChange = (duration: string) => {
        const selected = voucherPriceInfos.find((v) => v.duration === duration);
        if (!selected) return;

        setVoucherDuration(duration);
        setFullPrice(selected.fullPrice?.toString() ?? "");
        setGrant(selected.grant?.toString() ?? "");
        setActualPrice(selected.actualPrice?.toString() ?? "");
    };

    const handleSubmit = async () => {
        const basicsError = getCanonicalClientRegistrationError({ name, phone, birthday, address, dueDate });
        if (basicsError) {
            setSubmitError(basicsError);
            return;
        }

        if (voucherClient && !isVoucherInfoComplete) {
            setSubmitError("바우처 정보를 입력해주세요.");
            return;
        }

        setIsSubmitting(true);
        setSubmitError(null);

        try {
            const payload: Record<string, unknown> = {
                ...buildCanonicalClientRegistrationBasics({
                    name,
                    phone,
                    birthday,
                    address,
                    dueDate,
                }),
                careCenter,
                voucherClient,
                breastPump,
            };

            if (!isValidCompactDateInput(dueDate)) delete payload.dueDate;

            if (voucherClient) {
                payload.type = voucherType;

                const durationNumber = Number(voucherDuration);
                if (!Number.isNaN(durationNumber)) {
                    payload.duration = durationNumber;
                }

                payload.fullPrice = fullPrice;
                payload.grant = grant;
                payload.actualPrice = actualPrice;
            }

            const created = await createClientMutation.mutateAsync({
                ...payload,
                primaryEmployeeId: createdEmployeeId ?? matchedEmployee?.id ?? null,
            } as CreateClientDto);
            onCreated?.(created);
        } catch (e) {
            const msg = e instanceof Error ? e.message : "등록에 실패했습니다.";
            setSubmitError(msg);
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleEmployeeSubmit = async () => {
        if (!canRegisterEmployee) return;

        setIsSubmitting(true);
        try {
            const createdEmployee = await createEmployeeMutation.mutateAsync({
                name: employeeName.trim(),
                workArea: [employeeWorkArea],
                phone: employeePhone.replace(/\D/g, ""),
                grade: normalizeEmployeeGrade(employeeGrade),
                openToNextWork: true,
            } satisfies CreateEmployeeDto);
            setCreatedEmployeeId(createdEmployee.id);
            setIsRegisteringEmployee(false);
            handleNext();
        } catch (e) {
            const msg = e instanceof Error ? e.message : "제공인력 등록에 실패했습니다.";
            setSubmitError(msg);
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div data-component="desktop_chat_page_wizard-registration" className="flex flex-col" style={{ minHeight: WIZARD_MIN_HEIGHT_PX }}>
            <div className="mb-4">
                <h3 className="text-base font-bold mb-1">
                    산모 등록
                </h3>
                <p className="text-sm text-muted-foreground">
                    {initialDraft
                        ? "대화에서 받은 정보를 채웠어요. 부족한 항목을 입력해 주세요."
                        : "필요한 정보만 빠르게 입력해 등록할 수 있어요."}
                </p>
            </div>

            <Stepper activeStep={activeStep} className="mb-4">
                {steps.map((label, index) => (
                    <Step key={label}>
                        <StepLabel>{index + 1}</StepLabel>
                    </Step>
                ))}
            </Stepper>

            <div data-component="desktop_chat_page_wizard-registration_steps" className="flex-1 min-h-0">
                {/* Step 1: Basic Info */}
                {activeStep === 0 && !isRegisteringEmployee && (
                    <div className="grid gap-4">
                        <div className="space-y-2">
                            <Label htmlFor="name">이름</Label>
                            <Input
                                id="name"
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                autoFocus
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="dueDate">출산 예정일</Label>
                            <Input
                                id="dueDate"
                                type="text"
                                inputMode="numeric"
                                maxLength={6}
                                placeholder="YYMMDD"
                                value={dueDate}
                                onChange={(e) => setDueDate(parseCompactDateInput(e.target.value))}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="phone">연락처</Label>
                            <Input
                                id="phone"
                                value={phone}
                                onChange={(e) => setPhone(formatKoreanPhoneNumber(e.target.value))}
                                placeholder="010-1234-5678"
                                maxLength={13}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="birthday">생년월일</Label>
                            <Input
                                id="birthday"
                                value={birthday}
                                onChange={(e) => setBirthday(parseCompactDateInput(e.target.value))}
                                placeholder="YYMMDD"
                                maxLength={6}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="address">주소</Label>
                            <Input
                                id="address"
                                placeholder="상세 주소"
                                value={address}
                                onChange={(e) => setAddress(e.target.value)}
                            />
                        </div>
                        {matchingEmployees.length > 1 && (
                            <div className="space-y-2">
                                <Label htmlFor="employee-selection">제공인력 선택</Label>
                                <Select
                                    value={selectedEmployeeId?.toString() ?? ""}
                                    onValueChange={(value) => setSelectedEmployeeId(Number(value))}
                                >
                                    <SelectTrigger id="employee-selection" aria-label="제공인력 선택">
                                        <SelectValue placeholder="동명이인 중 선택" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {matchingEmployees.map((employee) => (
                                            <SelectItem key={employee.id} value={employee.id.toString()}>
                                                {employee.name} ({employee.phone})
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                        )}
                    </div>
                )}

                {isRegisteringEmployee && (
                    <div className="grid gap-4">
                        <div className="space-y-2">
                            <Label htmlFor="employee-name">제공인력 이름</Label>
                            <Input
                                id="employee-name"
                                value={employeeName}
                                onChange={(e) => setEmployeeName(e.target.value)}
                                autoFocus
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="employee-phone">연락처</Label>
                            <Input
                                id="employee-phone"
                                value={employeePhone}
                                onChange={(e) => setEmployeePhone(formatKoreanPhoneNumber(e.target.value))}
                                placeholder="010-1234-5678"
                                maxLength={13}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="employee-grade">등급</Label>
                            <Select value={employeeGrade} onValueChange={setEmployeeGrade}>
                                <SelectTrigger id="employee-grade" aria-label="등급">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {["프리미엄", "베스트", "스탠다드"].map((grade) => (
                                        <SelectItem key={grade} value={grade}>{grade}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="employee-work-area">근무 가능 지역</Label>
                            <Select value={employeeWorkArea} onValueChange={setEmployeeWorkArea}>
                                <SelectTrigger id="employee-work-area" aria-label="근무 가능 지역">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {WORK_AREAS.map((area) => (
                                        <SelectItem key={area} value={area}>{area}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                )}

                {/* Step 2: Voucher Info */}
                {activeStep === 1 && (
                    <div className="grid gap-4">
                        <div className="flex items-center space-x-2">
                            <Checkbox
                                id="voucherClient"
                                checked={voucherClient}
                                onCheckedChange={(checked) => setVoucherClient(checked === true)}
                            />
                            <Label htmlFor="voucherClient">바우처 대상</Label>
                        </div>

                        {voucherClient && (
                            <>
	                                <div className="flex gap-4 items-center flex-wrap">
	                                    <div className="space-y-2 min-w-[140px]">
	                                        <Label>바우처 연도</Label>
	                                        <Select
	                                            value={resolvedVoucherYear?.toString() ?? ""}
	                                            onValueChange={handleVoucherYearChange}
	                                            disabled={isVoucherYearsLoading}
	                                        >
	                                            <SelectTrigger className="w-[140px]" aria-label="바우처 연도">
	                                                <SelectValue placeholder="연도 선택" />
	                                            </SelectTrigger>
	                                            <SelectContent>
	                                                {voucherYears.map((year) => (
	                                                    <SelectItem key={year} value={year.toString()}>
                                                        {year}년
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                </div>

	                                <div className="space-y-2">
	                                    <Label>바우처 유형</Label>
	                                    <Select
	                                        value={voucherType}
	                                        onValueChange={handleVoucherTypeChange}
	                                        disabled={resolvedVoucherYear === null}
	                                    >
	                                        <SelectTrigger className="w-full" aria-label="바우처 유형">
	                                            <SelectValue placeholder="유형 선택" />
	                                        </SelectTrigger>
	                                        <SelectContent>
	                                            {Object.entries(voucherOptions.voucherOptions).map(([groupName, types]) => (
	                                                <SelectGroup key={groupName}>
                                                    <SelectGroupLabel>{groupName}</SelectGroupLabel>
                                                    {Object.entries(types).map(([typeValue, typeData]) => (
                                                        <SelectItem key={typeValue} value={typeValue}>
                                                            {typeData.label}
                                                        </SelectItem>
                                                    ))}
                                                </SelectGroup>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>

                                {voucherType && (
	                                    <div className="space-y-2">
	                                        <Label>기간</Label>
	                                        <Select
	                                            value={voucherDuration}
	                                            onValueChange={handleVoucherDurationChange}
	                                            disabled={isVoucherPriceInfosLoading || voucherPriceInfos.length === 0}
	                                        >
	                                            <SelectTrigger className="w-full" aria-label="기간">
	                                                <SelectValue placeholder="기간 선택" />
	                                            </SelectTrigger>
	                                            <SelectContent>
	                                                {voucherPriceInfos.map((v) => (
	                                                    <SelectItem key={v.duration} value={v.duration}>
                                                        {v.duration}일
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                )}

                                {voucherType && isVoucherPriceInfosLoading && (
                                    <div className="flex justify-center py-2">
                                        <Spinner size="sm" />
                                    </div>
                                )}

                                {voucherDuration && fullPrice && grant && actualPrice && (
                                    <>
                                        <Separator />
                                        <div className="grid gap-1.5">
                                            <p className="text-sm text-muted-foreground">
                                                총액: {formatPrice(fullPrice)}원
                                            </p>
                                            <p className="text-sm text-muted-foreground">
                                                정부지원금: {formatPrice(grant)}원
                                            </p>
                                            <p className="text-sm text-muted-foreground">
                                                본인부담금: {formatPrice(actualPrice)}원
                                            </p>
                                        </div>
                                    </>
                                )}
                            </>
                        )}
                    </div>
                )}

                {/* Step 3: Settings */}
                {activeStep === 2 && (
                    <div className="grid gap-3">
                        <div className="flex items-center space-x-2">
                            <Checkbox
                                id="careCenter"
                                checked={careCenter}
                                onCheckedChange={(checked) => setCareCenter(checked === true)}
                            />
                            <Label htmlFor="careCenter">조리원 여부</Label>
                        </div>
                        <div className="flex items-center space-x-2">
                            <Checkbox
                                id="breastPump"
                                checked={breastPump}
                                onCheckedChange={(checked) => setBreastPump(checked === true)}
                            />
                            <Label htmlFor="breastPump">유축기</Label>
                        </div>
                    </div>
                )}
            </div>

            {submitError && (
                <Alert variant="destructive" className="mt-4">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>{submitError}</AlertDescription>
                </Alert>
            )}

            {employeeName && isEmployeesError && (
                <Alert variant="destructive" className="mt-4">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>
                        제공인력 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.
                    </AlertDescription>
                </Alert>
            )}

            <div data-component="desktop_chat_page_wizard-registration_actions" className="flex justify-between mt-4">
                <Button
                    variant="outline"
                    onClick={() => {
                        if (isRegisteringEmployee) {
                            setIsRegisteringEmployee(false);
                            return;
                        }
                        handleBack();
                    }}
                    disabled={(!isRegisteringEmployee && activeStep === 0) || isSubmitting}
                >
                    이전
                </Button>

                {activeStep < steps.length - 1 ? (
                    <Button
                        onClick={() => {
                            if (!isRegisteringEmployee && needsEmployeeRegistration) {
                                setIsRegisteringEmployee(true);
                                return;
                            }
                            if (isRegisteringEmployee) {
                                void handleEmployeeSubmit();
                                return;
                            }
                            handleNext();
                        }}
                        disabled={isRegisteringEmployee
                            ? !canRegisterEmployee || isSubmitting
                            : !canGoNext || isSubmitting}
                    >
                        {isRegisteringEmployee ? "제공인력 등록" : "다음"}
                    </Button>
                ) : (
                    <Button
                        onClick={handleSubmit}
                        disabled={isSubmitting || !name.trim() || (voucherClient && !isVoucherInfoComplete)}
                    >
                        제출
                    </Button>
                )}
            </div>
        </div>
    );
}

export default ClientRegistrationWizard;
