import { GetContractClientCandidateUsecase } from "application/usecases/eformsign-doc/get-contract-client-candidate.usecase";
import { PrismaService } from "infrastructure/database/prisma.service";

describe("GetContractClientCandidateUsecase", () => {
    const findUnique = jest.fn();
    const findEmployees = jest.fn();
    const findVoucherPrices = jest.fn();
    const createEmployee = { execute: jest.fn() };
    const prisma = {
        eformsign_doc: { findUnique },
        employee: { findMany: findEmployees, findFirst: jest.fn() },
        voucher_price_info: { findMany: findVoucherPrices },
    } as unknown as PrismaService;

    let usecase: GetContractClientCandidateUsecase;

    beforeEach(() => {
        findEmployees.mockResolvedValue([]);
        findVoucherPrices.mockResolvedValue([]);
        createEmployee.execute.mockReset();
        usecase = new GetContractClientCandidateUsecase(prisma, createEmployee as never);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    it("문서가 없으면 null을 반환한다", async () => {
        findUnique.mockResolvedValue(null);
        await expect(usecase.execute("doc-missing")).resolves.toBeNull();
        expect(findUnique).toHaveBeenCalledWith({
            where: { documentId: "doc-missing" },
            select: {
                documentId: true,
                detailPayload: true,
                customerName: true,
                customerPhone: true,
            },
        });
    });

    it("detail payload에서 후보를 추출해 직렬화한다", async () => {
        findUnique.mockResolvedValue({
            documentId: "doc-1",
            customerName: null,
            customerPhone: null,
            detailPayload: {
                id: "doc-1",
                fields: [
                    { id: "이용자 성명", value: "홍길동", type: "text" },
                    { id: "이용자 연락처", value: "010-1234-5678", type: "text" },
                    { id: "이용자 주소", value: "서울시 강남구", type: "text" },
                    { id: "이용자 생년월일", value: "900101", type: "text" },
                    { id: "출산 예정일", value: "2026-07-20", type: "text" },
                    { id: "계약 시작일", value: "2026-08-10", type: "text" },
                    { id: "계약 종료일", value: "2026-08-24", type: "text" },
                    { id: "바우처 유형", value: "A-가형", type: "text" },
                    { id: "바우처 기간", value: "10일", type: "text" },
                    { id: "총 서비스 금액", value: "1,234,000원", type: "text" },
                    { id: "정부지원금", value: "900,000원", type: "text" },
                    { id: "본인부담금", value: "334,000원", type: "text" },
                    { id: "산후조리원 이용", value: "예", type: "text" },
                    { id: "바우처 여부", value: "예", type: "text" },
                    { id: "유축기", value: "아니오", type: "text" },
                ],
                recipients: [{
                    recipient_type: "02",
                    name: "홍길동",
                    sms: "010-1234-5678",
                }],
            },
        });

        const result = await usecase.execute("doc-1");

        expect(result).toEqual({
            documentId: "doc-1",
            extracted: true,
            name: "홍길동",
            phone: "010-1234-5678",
            address: "서울시 강남구",
            birthday: "900101",
            dueDate: "2026-07-20",
            startDate: "2026-08-10",
            endDate: "2026-08-24",
            primaryEmployeeId: null,
            secondaryEmployeeId: null,
            type: "A-가형",
            duration: 10,
            fullPrice: "1234000",
            grant: "900000",
            actualPrice: "334000",
            careCenter: true,
            voucherClient: true,
            breastPump: false,
        });
    });

    it("지점 제공인력과 고유한 바우처 요금 행을 계약서 값으로 연결한다", async () => {
        findUnique.mockResolvedValue({
            documentId: "doc-live-shape",
            customerName: null,
            customerPhone: null,
            detailPayload: {
                fields: [
                    { id: "이용자 성명", value: "박지원" },
                    { id: "서비스 기간", value: "2026-08-19 ~ 2026-09-15" },
                    { id: "제공인력 1 성명", value: "김희선" },
                    { id: "제공인력 1 연락처", value: "01053309359" },
                    { id: "제공인력 2 성명", value: "이보조" },
                    { id: "총 서비스 금액", value: "2,928,000" },
                    { id: "정부지원금", value: "1,440,000" },
                    { id: "본인부담금", value: "1,488,000" },
                ],
            },
        });
        findEmployees.mockResolvedValue([
            { id: 17, name: "김희선", phone: "010-5330-9359" },
            { id: 23, name: "이보조", phone: "010-1111-2222" },
        ]);
        findVoucherPrices.mockResolvedValue([{
            type: "A통합1형",
            duration: BigInt(20),
            fullPrice: "2928000",
            grant: "1440000",
            actualPrice: "1488000",
        }]);

        await expect(usecase.execute("doc-live-shape", "branch-1")).resolves.toEqual(
            expect.objectContaining({
                primaryEmployeeId: 17,
                secondaryEmployeeId: 23,
                type: "A통합1형",
                duration: 20,
                fullPrice: "2928000",
                grant: "1440000",
                actualPrice: "1488000",
            }),
        );
        expect(findEmployees).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({ branchId: "branch-1", deletedAt: null }),
        }));
        expect(findVoucherPrices).toHaveBeenCalledWith(expect.objectContaining({
            where: { year: 2026 },
        }));
    });

    it("creates an unregistered primary provider from the document identity", async () => {
        findUnique.mockResolvedValue({
            documentId: "doc-new-provider",
            customerName: null,
            customerPhone: null,
            detailPayload: {
                fields: [
                    { id: "이용자 성명", value: "황정원" },
                    { id: "계약 시작 년도", value: "26" },
                    { id: "계약 시작 월", value: "08" },
                    { id: "계약 시작 일", value: "24" },
                    { id: "계약 종료 년도", value: "26" },
                    { id: "계약 종료 월", value: "09" },
                    { id: "계약 종료 일", value: "11" },
                    { id: "제공인력 1 성명", value: "김맹화" },
                    { id: "제공인력 1 연락처", value: "01025577430" },
                    { id: "총 서비스 금액", value: "2,196,000" },
                    { id: "정부지원금", value: "1,525,000" },
                    { id: "본인부담금", value: "671,000" },
                ],
            },
        });
        findEmployees.mockResolvedValue([]);
        createEmployee.execute.mockResolvedValue({ id: 31, name: "김맹화" });
        findVoucherPrices.mockResolvedValue([
            { type: "A통합2형", duration: BigInt(15), fullPrice: "2196000", grant: "1525000", actualPrice: "671000" },
        ]);

        await expect(usecase.execute("doc-new-provider", "branch-1")).resolves.toEqual(
            expect.objectContaining({
                name: "황정원",
                primaryEmployeeId: 31,
                type: "A통합2형",
                duration: 15,
            }),
        );
        expect(createEmployee.execute).toHaveBeenCalledWith(
            "branch-1",
            "김맹화",
            ["미지정"],
            "010-2557-7430",
            "스탠다드",
            true,
        );
    });

    it("동일 요금 행이 둘 이상이면 바우처 유형과 기간을 추측하지 않는다", async () => {
        findUnique.mockResolvedValue({
            documentId: "doc-ambiguous-price",
            customerName: null,
            customerPhone: null,
            detailPayload: {
                fields: [
                    { id: "이용자 성명", value: "박지원" },
                    { id: "계약 시작일", value: "2026-08-19" },
                    { id: "총 서비스 금액", value: "2,928,000" },
                    { id: "정부지원금", value: "1,440,000" },
                    { id: "본인부담금", value: "1,488,000" },
                ],
            },
        });
        findVoucherPrices.mockResolvedValue([
            { type: "A형", duration: BigInt(15), fullPrice: "2928000", grant: "1440000", actualPrice: "1488000" },
            { type: "B형", duration: BigInt(20), fullPrice: "2928000", grant: "1440000", actualPrice: "1488000" },
        ]);

        await expect(usecase.execute("doc-ambiguous-price", "branch-1")).resolves.toEqual(
            expect.objectContaining({ type: null, duration: null }),
        );
    });

    it("payload가 없으면 문서 컬럼 폴백을 반환한다", async () => {
        findUnique.mockResolvedValue({
            documentId: "doc-2",
            customerName: "김산모",
            customerPhone: "01098765432",
            detailPayload: null,
        });

        const result = await usecase.execute("doc-2");

        expect(result).toEqual({
            documentId: "doc-2",
            extracted: false,
            name: null,
            phone: "010-9876-5432",
            address: null,
            birthday: null,
            dueDate: null,
            startDate: null,
            endDate: null,
            primaryEmployeeId: null,
            secondaryEmployeeId: null,
            type: null,
            duration: null,
            fullPrice: null,
            grant: null,
            actualPrice: null,
            careCenter: null,
            voucherClient: false,
            breastPump: false,
        });
    });

    it("detail 전화 후보를 추출하지 못하면 상세 정보와 저장 전화번호를 함께 사용한다", async () => {
        findUnique.mockResolvedValue({
            documentId: "doc-3",
            customerName: "관리사 이름",
            customerPhone: "01011112222",
            detailPayload: {
                fields: [{ id: "이용자 성명", value: "홍길동" }],
                recipients: [{ recipient_type: "01", name: "관리사", sms: "01033334444" }],
            },
        });

        const result = await usecase.execute("doc-3");

        expect(result).toEqual({
            documentId: "doc-3",
            extracted: true,
            name: "홍길동",
            phone: "010-1111-2222",
            address: null,
            birthday: null,
            dueDate: null,
            startDate: null,
            endDate: null,
            primaryEmployeeId: null,
            secondaryEmployeeId: null,
            type: null,
            duration: null,
            fullPrice: null,
            grant: null,
            actualPrice: null,
            careCenter: null,
            voucherClient: false,
            breastPump: false,
        });
    });

    it("고객 전화 수신자를 확인하지 못해도 전자문서의 다른 고객 정보를 보존한다", async () => {
        findUnique.mockResolvedValue({
            documentId: "doc-prefill-without-phone",
            customerName: null,
            customerPhone: null,
            detailPayload: {
                fields: [
                    { id: "이용자 성명", value: "김산모" },
                    { id: "이용자 주소", value: "인천시 연수구" },
                    { id: "이용자 생년월일", value: "1991-02-03" },
                    { id: "계약 시작일", value: "2026-08-20" },
                    { id: "계약 종료일", value: "2026-09-02" },
                ],
                recipients: [{
                    recipient_type: "01",
                    name: "담당자",
                    sms: "+82 10-9999-9999",
                }],
            },
        });

        await expect(usecase.execute("doc-prefill-without-phone")).resolves.toEqual(
            expect.objectContaining({
                extracted: true,
                name: "김산모",
                phone: null,
                address: "인천시 연수구",
                birthday: "910203",
                startDate: "2026-08-20",
                endDate: "2026-09-02",
            }),
        );
    });

    it("82 국가번호 형식의 저장 전화번호를 국내 010 형식으로 반환한다", async () => {
        findUnique.mockResolvedValue({
            documentId: "doc-international-phone",
            customerName: null,
            customerPhone: "82 10 9876 5432",
            detailPayload: null,
        });

        await expect(usecase.execute("doc-international-phone")).resolves.toEqual(
            expect.objectContaining({
                extracted: false,
                phone: "010-9876-5432",
            }),
        );
    });

    it("detail payload가 배열이면 문서 컬럼 폴백을 반환한다", async () => {
        findUnique.mockResolvedValue({
            documentId: "doc-4",
            customerName: "직원 이름",
            customerPhone: "01055556666",
            detailPayload: [],
        });

        const result = await usecase.execute("doc-4");

        expect(result).toEqual({
            documentId: "doc-4",
            extracted: false,
            name: null,
            phone: "010-5555-6666",
            address: null,
            birthday: null,
            dueDate: null,
            startDate: null,
            endDate: null,
            primaryEmployeeId: null,
            secondaryEmployeeId: null,
            type: null,
            duration: null,
            fullPrice: null,
            grant: null,
            actualPrice: null,
            careCenter: null,
            voucherClient: false,
            breastPump: false,
        });
    });
});
