import { render, screen } from "@testing-library/react";

import { AutomationStatusNotice } from "../automation-status-notice";
import type { ClientRegistrationPolicyAutomationStatus } from "@/services/api";

const base: ClientRegistrationPolicyAutomationStatus = {
    webhookConfigured: true,
    sweepEnabled: true,
    sweepRunnable: true,
};

function renderNotice(automation: ClientRegistrationPolicyAutomationStatus) {
    render(
        <AutomationStatusNotice
            enabled
            automation={automation}
            data-component="test-notice"
        />,
    );
}

/**
 * "웹훅 설정됨" only says the endpoint could be called. These counts are the
 * only thing on this screen that says whether deliveries actually arrive and
 * land, which is what makes a silently dropped event visible to an operator.
 */
describe("AutomationStatusNotice — webhook traffic line", () => {
    it("reports received and dropped counts when some events were dropped", () => {
        renderNotice({ ...base, webhookReceived24h: 12, webhookDropped24h: 3 });

        expect(screen.getByText(/웹훅 12건 수신 \/ 3건 미반영/)).toBeInTheDocument();
    });

    it("says everything landed when nothing was dropped", () => {
        renderNotice({ ...base, webhookReceived24h: 12, webhookDropped24h: 0 });

        expect(screen.getByText(/웹훅 12건 수신 — 모두 반영되었습니다/)).toBeInTheDocument();
    });

    /** Zero arrivals is the loudest signal of all, and reads nothing like "0건 미반영". */
    it("calls out a silent 24 hours", () => {
        renderNotice({ ...base, webhookReceived24h: 0, webhookDropped24h: 0 });

        expect(screen.getByText(/최근 24시간 수신한 웹훅 없음/)).toBeInTheDocument();
    });

    /** A backend that predates the ledger sends no counts; show no line at all. */
    it("hides the line when the backend does not report counts", () => {
        renderNotice(base);

        expect(screen.queryByText(/웹훅.*건 수신/)).not.toBeInTheDocument();
    });
});
