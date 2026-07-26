import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ServiceScheduleChangeModal } from "../ServiceScheduleChangeModal";

describe("ServiceScheduleChangeModal", () => {
    const defaultProps = {
        "data-component": "mobile_clients_detail-sheet_stack_detail-page_content_schedule-change-modal",
        open: true,
        sessionIndex: 3,
        currentDate: "2026-07-20",
        minimumDate: "2026-07-20",
        selectedDate: "2026-07-20",
        isPending: false,
        onDateChange: jest.fn(),
        onClose: jest.fn(),
        onSubmit: jest.fn(),
    };

    it("requires a date later than the current service date", () => {
        render(<ServiceScheduleChangeModal {...defaultProps} />);

        expect(screen.getByText("3회차 서비스 제공 날짜를 조정합니다.")).toBeInTheDocument();
        expect(screen.getByLabelText("3회차 서비스 제공 날짜")).toHaveAttribute("type", "text");
        expect(screen.getByLabelText("3회차 서비스 제공 날짜")).toHaveAttribute("inputmode", "numeric");
        expect(screen.getByLabelText("3회차 서비스 제공 날짜")).toHaveAttribute("placeholder", "YYYY-MM-DD");
        expect(screen.getByRole("button", { name: "일정 변경" })).toBeDisabled();
    });

    it("formats a typed date without opening a native date picker", () => {
        const onDateChange = jest.fn();
        render(
            <ServiceScheduleChangeModal
                {...defaultProps}
                selectedDate=""
                onDateChange={onDateChange}
            />,
        );

        fireEvent.change(screen.getByLabelText("3회차 서비스 제공 날짜"), {
            target: { value: "20260722" },
        });

        expect(onDateChange).toHaveBeenCalledWith("2026-07-22");
    });

    it("submits a postponed date", async () => {
        const user = userEvent.setup();
        const onSubmit = jest.fn();
        render(
            <ServiceScheduleChangeModal
                {...defaultProps}
                selectedDate="2026-07-21"
                onSubmit={onSubmit}
            />,
        );

        await user.click(screen.getByRole("button", { name: "일정 변경" }));

        expect(onSubmit).toHaveBeenCalledTimes(1);
    });
});
