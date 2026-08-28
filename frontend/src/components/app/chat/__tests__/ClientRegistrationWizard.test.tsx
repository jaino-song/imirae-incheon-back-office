import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ClientRegistrationWizard } from "../ClientRegistrationWizard";

const mockCreateClientMutateAsync = jest.fn();
const mockCreateEmployeeMutateAsync = jest.fn();
let mockEmployees: Array<{ id: number; name: string; phone?: string }> = [];
let mockEmployeesLoading = false;
let mockEmployeesFetching = false;
let mockEmployeesError = false;

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
    useEmployees: () => ({
        data: mockEmployees,
        isLoading: mockEmployeesLoading,
        isFetching: mockEmployeesFetching,
        isError: mockEmployeesError,
    }),
}));

describe("ClientRegistrationWizard", () => {
    beforeAll(() => {
        Object.defineProperty(Element.prototype, "scrollIntoView", {
            configurable: true,
            value: jest.fn(),
        });
    });

    beforeEach(() => {
        mockCreateClientMutateAsync.mockReset();
        mockCreateEmployeeMutateAsync.mockReset();
        mockEmployees = [];
        mockEmployeesLoading = false;
        mockEmployeesFetching = false;
        mockEmployeesError = false;
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

    test("requires an explicit employee choice when names are ambiguous", async () => {
        mockEmployees = [
            { id: 10, name: "김제공", phone: "010-1111-1111" },
            { id: 11, name: "김제공", phone: "010-2222-2222" },
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

        const nextButton = screen.getByRole("button", { name: "다음" });
        expect(nextButton).toBeDisabled();
        fireEvent.click(screen.getByLabelText("제공인력 선택"));
        fireEvent.click(await screen.findByRole("option", { name: "김제공 (010-2222-2222)" }));
        expect(nextButton).not.toBeDisabled();
        fireEvent.click(nextButton);
        fireEvent.click(await screen.findByRole("checkbox", { name: "바우처 대상" }));
        fireEvent.click(screen.getByRole("button", { name: "다음" }));
        fireEvent.click(screen.getByRole("button", { name: "제출" }));

        await waitFor(() => {
            expect(mockCreateClientMutateAsync).toHaveBeenCalledWith(
                expect.objectContaining({ primaryEmployeeId: 11 }),
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

    test("returns to provider resolution when a unique match disappears before submit", async () => {
        mockEmployees = [{ id: 10, name: "김제공" }];
        const initialDraft = {
            name: "홍길동",
            phone: "01012345678",
            birthday: "900101",
            address: "인천 연수구",
            dueDate: "260201",
            employeeName: "김제공",
        };
        const { rerender } = render(
            <ClientRegistrationWizard initialDraft={initialDraft} />,
        );

        fireEvent.click(screen.getByRole("button", { name: "다음" }));
        fireEvent.click(await screen.findByRole("checkbox", { name: "바우처 대상" }));
        fireEvent.click(screen.getByRole("button", { name: "다음" }));

        mockEmployees = [];
        rerender(<ClientRegistrationWizard initialDraft={initialDraft} />);
        fireEvent.click(screen.getByRole("button", { name: "제출" }));

        expect(mockCreateClientMutateAsync).not.toHaveBeenCalled();
        expect(await screen.findByText("제공인력 정보가 변경되었습니다. 제공인력을 다시 확인해 주세요."))
            .toBeInTheDocument();
        expect(screen.getByLabelText("이름")).toHaveValue("홍길동");
    });

    test("waits for employee lookup before deciding whether registration is needed", async () => {
        mockEmployeesLoading = true;
        const { rerender } = render(
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

        expect(screen.getByRole("button", { name: "다음" })).toBeDisabled();

        mockEmployeesLoading = false;
        mockEmployees = [{ id: 10, name: "김제공" }];
        rerender(
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

        const nextButton = screen.getByRole("button", { name: "다음" });
        expect(nextButton).not.toBeDisabled();
        fireEvent.click(nextButton);
        expect(await screen.findByRole("checkbox", { name: "바우처 대상" }))
            .toBeInTheDocument();
        expect(screen.queryByLabelText("제공인력 이름")).not.toBeInTheDocument();
    });

    test("waits for a background employee refetch before offering registration", async () => {
        mockEmployeesFetching = true;
        const initialDraft = {
            name: "홍길동",
            phone: "01012345678",
            birthday: "900101",
            address: "인천 연수구",
            dueDate: "260201",
            employeeName: "김제공",
        };
        const { rerender } = render(
            <ClientRegistrationWizard initialDraft={initialDraft} />,
        );

        expect(screen.getByRole("button", { name: "다음" })).toBeDisabled();
        expect(screen.queryByLabelText("제공인력 이름")).not.toBeInTheDocument();

        mockEmployeesFetching = false;
        mockEmployees = [{ id: 10, name: "김제공" }];
        rerender(<ClientRegistrationWizard initialDraft={initialDraft} />);

        const nextButton = screen.getByRole("button", { name: "다음" });
        expect(nextButton).not.toBeDisabled();
        fireEvent.click(nextButton);
        expect(await screen.findByRole("checkbox", { name: "바우처 대상" }))
            .toBeInTheDocument();
        expect(screen.queryByLabelText("제공인력 이름")).not.toBeInTheDocument();
    });

    test("disables inline employee registration while a background refetch is pending", async () => {
        const initialDraft = {
            name: "홍길동",
            phone: "01012345678",
            birthday: "900101",
            address: "인천 연수구",
            dueDate: "260201",
            employeeName: "김제공",
        };
        const { rerender } = render(
            <ClientRegistrationWizard initialDraft={initialDraft} />,
        );

        fireEvent.click(screen.getByRole("button", { name: "다음" }));
        const registerButton = await screen.findByRole("button", { name: "제공인력 등록" });
        fireEvent.change(screen.getByLabelText("연락처"), {
            target: { value: "01012345678" },
        });
        expect(registerButton).not.toBeDisabled();

        // React Query can retain the empty cache while a focus/invalidation refetch runs.
        mockEmployeesFetching = true;
        rerender(<ClientRegistrationWizard initialDraft={initialDraft} />);

        expect(screen.getByRole("button", { name: "제공인력 등록" })).toBeDisabled();
        fireEvent.click(screen.getByRole("button", { name: "제공인력 등록" }));
        expect(mockCreateEmployeeMutateAsync).not.toHaveBeenCalled();

        mockEmployeesFetching = false;
        mockEmployees = [{ id: 10, name: "김제공" }];
        rerender(<ClientRegistrationWizard initialDraft={initialDraft} />);
        expect(screen.queryByLabelText("제공인력 이름")).not.toBeInTheDocument();
    });

    test("disables final submission until a background employee refetch completes", async () => {
        mockEmployees = [{ id: 10, name: "김제공" }];
        mockCreateClientMutateAsync.mockResolvedValue({ id: 123, name: "홍길동" });
        const initialDraft = {
            name: "홍길동",
            phone: "01012345678",
            birthday: "900101",
            address: "인천 연수구",
            dueDate: "260201",
            employeeName: "김제공",
        };
        const { rerender } = render(
            <ClientRegistrationWizard initialDraft={initialDraft} />,
        );

        fireEvent.click(screen.getByRole("button", { name: "다음" }));
        fireEvent.click(await screen.findByRole("checkbox", { name: "바우처 대상" }));
        fireEvent.click(screen.getByRole("button", { name: "다음" }));

        // The list becomes stale and empty while React Query performs the refetch.
        mockEmployees = [];
        mockEmployeesFetching = true;
        rerender(<ClientRegistrationWizard initialDraft={initialDraft} />);

        const submitButton = screen.getByRole("button", { name: "제출" });
        expect(submitButton).toBeDisabled();
        fireEvent.click(submitButton);
        expect(mockCreateClientMutateAsync).not.toHaveBeenCalled();

        mockEmployees = [{ id: 10, name: "김제공" }];
        mockEmployeesFetching = false;
        rerender(<ClientRegistrationWizard initialDraft={initialDraft} />);
        expect(submitButton).not.toBeDisabled();
        fireEvent.click(submitButton);

        await waitFor(() => {
            expect(mockCreateClientMutateAsync).toHaveBeenCalledWith(
                expect.objectContaining({ primaryEmployeeId: 10 }),
            );
        });
    });

    test("blocks progression and does not offer registration when employee lookup fails", async () => {
        mockEmployeesError = true;
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

        expect(screen.getByRole("button", { name: "다음" })).toBeDisabled();
        expect(screen.getByText("제공인력 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요."))
            .toBeInTheDocument();
        expect(screen.queryByRole("checkbox", { name: "바우처 대상" }))
            .not.toBeInTheDocument();
        expect(screen.queryByLabelText("제공인력 이름")).not.toBeInTheDocument();
        expect(mockCreateEmployeeMutateAsync).not.toHaveBeenCalled();
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
