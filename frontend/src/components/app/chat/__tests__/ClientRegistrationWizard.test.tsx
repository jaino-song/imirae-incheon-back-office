import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ClientRegistrationWizard } from "../ClientRegistrationWizard";

const mockCreateClientMutateAsync = jest.fn();
const mockCreateEmployeeMutateAsync = jest.fn();
let mockEmployees: Array<{ id: number; name: string }> = [];

jest.mock("@/hooks/useVoucherData", () => ({
    useAvailableClientAreas: () => ({ data: [], isLoading: false }),
    useAreaTemplates: () => ({ data: [], isLoading: false }),
    useVoucherYears: () => ({ data: [2026], isLoading: false }),
    useVoucherPriceInfos: (type: string) => {
        if (type === "A가1형") {
            return {
                data: [
                    {
                        id: 1,
                        type: "A가1형",
                        duration: "10",
                        fullPrice: "100000",
                        grant: "50000",
                        actualPrice: "50000",
                    },
                ],
                isLoading: false,
            };
        }
        return { data: [], isLoading: false };
    },
}));

jest.mock("@/hooks/useClients", () => ({
    useCreateClient: () => ({
        mutateAsync: (...args: unknown[]) => mockCreateClientMutateAsync(...args),
        isPending: false,
    }),
}));

jest.mock("@/hooks/useEmployees", () => ({
    useCreateEmployee: () => ({
        mutateAsync: (...args: unknown[]) => mockCreateEmployeeMutateAsync(...args),
        isPending: false,
    }),
    useEmployees: () => ({ data: mockEmployees }),
}));

describe("ClientRegistrationWizard", () => {
    beforeEach(() => {
        mockCreateClientMutateAsync.mockReset();
        mockCreateEmployeeMutateAsync.mockReset();
        mockEmployees = [];
    });

    test("submits minimal required payload to /api/clients", async () => {
        mockCreateClientMutateAsync.mockResolvedValue({
            id: 123,
            name: "홍길동",
        });

        const onCreated = jest.fn();
        render(<ClientRegistrationWizard onCreated={onCreated} />);

        const nextButton = screen.getByRole("button", { name: "다음" });
        expect(nextButton).toBeDisabled();

        fireEvent.change(screen.getByLabelText("이름"), { target: { value: "홍길동" } });
        fireEvent.change(screen.getByLabelText("연락처"), { target: { value: "01012345678" } });
        fireEvent.change(screen.getByLabelText("생년월일"), { target: { value: "900101" } });
        fireEvent.change(screen.getByLabelText("주소"), { target: { value: "인천 연수구" } });
        fireEvent.change(screen.getByLabelText("출산 예정일"), { target: { value: "260201" } });
        expect(nextButton).not.toBeDisabled();
        fireEvent.click(nextButton);

        // Voucher step: minimal path without voucher info
        const voucherCheckbox = await screen.findByRole("checkbox", { name: "바우처 대상" });
        fireEvent.click(voucherCheckbox);

        const secondNextButton = screen.getByRole("button", { name: "다음" });
        await waitFor(() => {
            expect(secondNextButton).not.toBeDisabled();
        });
        fireEvent.click(secondNextButton);

        // Toggle careCenter on for test determinism
        const careCenterCheckbox = await screen.findByRole("checkbox", { name: "조리원 여부" });
        fireEvent.click(careCenterCheckbox);

        const submitButton = screen.getByRole("button", { name: "제출" });
        await waitFor(() => {
            expect(submitButton).not.toBeDisabled();
        });
        fireEvent.click(submitButton);

        await waitFor(() => {
            expect(mockCreateClientMutateAsync).toHaveBeenCalledTimes(1);
        });

        expect(mockCreateClientMutateAsync).toHaveBeenCalledWith({
            name: "홍길동",
            phone: "010-1234-5678",
            birthday: "900101",
            address: "인천 연수구",
            dueDate: "2026-02-01",
            careCenter: true,
            voucherClient: false,
            breastPump: false,
            primaryEmployeeId: null,
        });

        expect(onCreated).toHaveBeenCalledWith({ id: 123, name: "홍길동" });
    }, 15000);

    test("seeds fields extracted from the chat request", () => {
        render(
            <ClientRegistrationWizard
                initialDraft={{
                    name: "홍길동",
                    phone: "01012345678",
                    birthday: "900101",
                    address: "인천 연수구",
                }}
                onCreated={jest.fn()}
            />,
        );

        expect(screen.getByLabelText("이름")).toHaveValue("홍길동");
        expect(screen.getByLabelText("연락처")).toHaveValue("010-1234-5678");
        expect(screen.getByLabelText("생년월일")).toHaveValue("900101");
        expect(screen.getByLabelText("주소")).toHaveValue("인천 연수구");
        expect(screen.getByText("대화에서 받은 정보를 채웠어요. 부족한 항목을 입력해 주세요."))
            .toBeInTheDocument();
    });

    test("opens inline employee registration when the mentioned employee is not registered", async () => {
        render(
            <ClientRegistrationWizard
                initialDraft={{
                    name: "홍길동",
                    phone: "01012345678",
                    birthday: "900101",
                    address: "인천 연수구",
                    dueDate: "260201",
                    employeeName: "김제공",
                }}
                onCreated={jest.fn()}
            />,
        );

        fireEvent.click(screen.getByRole("button", { name: "다음" }));

        expect(await screen.findByLabelText("제공인력 이름")).toHaveValue("김제공");
    });

    test("enables and submits inline employee registration after required fields are complete", async () => {
        mockCreateEmployeeMutateAsync.mockResolvedValue({ id: 9, name: "김제공" });
        render(
            <ClientRegistrationWizard
                initialDraft={{
                    name: "홍길동",
                    phone: "01012345678",
                    birthday: "900101",
                    address: "인천 연수구",
                    dueDate: "260201",
                    employeeName: "김제공",
                }}
            />,
        );

        fireEvent.click(screen.getByRole("button", { name: "다음" }));
        const registerButton = await screen.findByRole("button", { name: "제공인력 등록" });
        expect(registerButton).toBeDisabled();

        fireEvent.change(screen.getByLabelText("연락처"), {
            target: { value: "01012345678" },
        });
        expect(registerButton).not.toBeDisabled();
        fireEvent.click(registerButton);

        await waitFor(() => {
            expect(mockCreateEmployeeMutateAsync).toHaveBeenCalledTimes(1);
        });
        expect(await screen.findByRole("checkbox", { name: "바우처 대상" }))
            .toBeInTheDocument();
    });

    test("does not auto-bind an employee when multiple employees share the extracted name", async () => {
        mockEmployees = [
            { id: 10, name: "김제공" },
            { id: 11, name: "김제공" },
        ];
        mockCreateClientMutateAsync.mockResolvedValue({ id: 123, name: "홍길동" });
        render(
            <ClientRegistrationWizard
                initialDraft={{
                    name: "홍길동",
                    phone: "01012345678",
                    birthday: "900101",
                    address: "인천 연수구",
                    dueDate: "260201",
                    employeeName: "김제공",
                }}
            />,
        );

        fireEvent.click(screen.getByRole("button", { name: "다음" }));
        fireEvent.click(await screen.findByRole("checkbox", { name: "바우처 대상" }));
        fireEvent.click(screen.getByRole("button", { name: "다음" }));
        fireEvent.click(screen.getByRole("button", { name: "제출" }));

        await waitFor(() => {
            expect(mockCreateClientMutateAsync).toHaveBeenCalledWith(
                expect.objectContaining({ primaryEmployeeId: null }),
            );
        });
    });

    test("auto-binds an extracted employee name only when the match is unique", async () => {
        mockEmployees = [{ id: 10, name: "김제공" }];
        mockCreateClientMutateAsync.mockResolvedValue({ id: 123, name: "홍길동" });
        render(
            <ClientRegistrationWizard
                initialDraft={{
                    name: "홍길동",
                    phone: "01012345678",
                    birthday: "900101",
                    address: "인천 연수구",
                    dueDate: "260201",
                    employeeName: "김제공",
                }}
            />,
        );

        fireEvent.click(screen.getByRole("button", { name: "다음" }));
        fireEvent.click(await screen.findByRole("checkbox", { name: "바우처 대상" }));
        fireEvent.click(screen.getByRole("button", { name: "다음" }));
        fireEvent.click(screen.getByRole("button", { name: "제출" }));

        await waitFor(() => {
            expect(mockCreateClientMutateAsync).toHaveBeenCalledWith(
                expect.objectContaining({ primaryEmployeeId: 10 }),
            );
        });
    });

    test("shows inline error on API failure", async () => {
        mockCreateClientMutateAsync.mockRejectedValue(new Error("등록 실패"));

        render(<ClientRegistrationWizard />);

        fireEvent.change(screen.getByLabelText("이름"), { target: { value: "홍길동" } });
        fireEvent.change(screen.getByLabelText("연락처"), { target: { value: "01012345678" } });
        fireEvent.change(screen.getByLabelText("생년월일"), { target: { value: "900101" } });
        fireEvent.change(screen.getByLabelText("주소"), { target: { value: "인천 연수구" } });
        fireEvent.change(screen.getByLabelText("출산 예정일"), { target: { value: "260201" } });
        fireEvent.click(screen.getByRole("button", { name: "다음" }));

        fireEvent.click(screen.getByRole("checkbox", { name: "바우처 대상" }));
        fireEvent.click(screen.getByRole("button", { name: "다음" }));
        fireEvent.click(screen.getByRole("button", { name: "제출" }));

        await expect(screen.findByText(/실패/)).resolves.toBeInTheDocument();
    });
});
