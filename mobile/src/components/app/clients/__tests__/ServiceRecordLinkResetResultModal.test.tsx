import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ServiceRecordLinkResetResultModal } from "../ServiceRecordLinkResetResultModal";

describe("ServiceRecordLinkResetResultModal", () => {
    it("shows the new link without sending a message and copies it on approval", async () => {
        const user = userEvent.setup();
        const onClose = jest.fn();
        const onCopy = jest.fn();
        const serviceRecordUrl = "https://example.com/service-record/new-link";

        render(
            <ServiceRecordLinkResetResultModal
                data-component="mobile_clients_detail-sheet_stack_detail-page_content_reset-link-result-modal"
                open
                serviceRecordUrl={serviceRecordUrl}
                onClose={onClose}
                onCopy={onCopy}
            />,
        );

        expect(screen.getByText("메시지는 발송되지 않았습니다. 아래 링크를 복사해 직접 전달해 주세요.")).toBeInTheDocument();
        expect(screen.getByLabelText("제공기록지 링크")).toHaveValue(serviceRecordUrl);
        expect(screen.getByLabelText("제공기록지 링크").tagName).toBe("TEXTAREA");

        await user.click(screen.getByRole("button", { name: "링크 복사" }));
        expect(onCopy).toHaveBeenCalledWith(serviceRecordUrl);

        await user.click(screen.getByRole("button", { name: "닫기" }));
        expect(onClose).toHaveBeenCalledTimes(1);
    });
});
