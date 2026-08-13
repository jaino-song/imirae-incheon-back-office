/**
 * "This client needs action on their contract", as decided by the backend
 * (ClientService.computeActionRequired) and delivered on the client payload
 * and on `GET /clients/alerts`.
 *
 * Frontend and mobile only render this. Recomputing it client-side is what
 * previously let each dashboard disagree with the badges on the clients page.
 */
export type ActionRequiredReason = "교체 요청" | "서명 필요" | "발송 필요";

export interface ClientActionRequired {
    reason: ActionRequiredReason;
    priority: 1 | 2 | 3;
}
