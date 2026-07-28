import { Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import { EformsignApiClient } from "infrastructure/api/eformsign-api.client";
import { EformsignApiError } from "infrastructure/api/eformsign-api.error";

describe("EformsignApiClient retry policy", () => {
    const createClient = () => {
        const values: Record<string, string> = {
            EFORMSIGN_USER_EMAIL: "member@example.com",
            EFORMSIGN_API_URL: "https://api.example.com",
            EFORMSIGN_DOC_API_URL: "https://doc-api.example.com",
            EFORMSIGN_API_KEY: "api-key",
            EFORMSIGN_PRIVATE_KEY: "private-key",
        };
        const config = {
            get: jest.fn((key: string) => values[key]),
        };
        return new EformsignApiClient(config as unknown as ConfigService);
    };

    const createDocumentPayload = {
        templateId: "template-1",
        documentName: "contract-1",
        prefillFields: [],
    };

    const listSuccessResponse = () => new Response(
        JSON.stringify({ documents: [], total_rows: 0 }),
        { status: 200 },
    );

    const createSuccessResponse = () => new Response(
        JSON.stringify({
            document: {
                id: "document-1",
                document_status: "created",
            },
        }),
        { status: 200 },
    );

    afterEach(() => {
        jest.useRealTimers();
        jest.restoreAllMocks();
    });

    it("calls fetch exactly once without retry delay on first-attempt success", async () => {
        jest.useFakeTimers();
        const warnSpy = jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
        const timeoutSpy = jest.spyOn(AbortSignal, "timeout");
        const fetchMock = jest.spyOn(global, "fetch").mockResolvedValue(listSuccessResponse());

        await expect(createClient().getCompletedDocuments("access-token")).resolves.toEqual([]);

        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(timeoutSpy).toHaveBeenCalledWith(10_000);
        expect(warnSpy).not.toHaveBeenCalled();
    });

    it("keeps the legacy list defaults when pagination arguments are omitted", async () => {
        const fetchMock = jest.spyOn(global, "fetch").mockResolvedValue(listSuccessResponse());

        await createClient().getInProgressDocuments("access-token");

        const request = fetchMock.mock.calls[0]?.[1];
        expect(JSON.parse(String(request?.body))).toEqual(expect.objectContaining({
            type: "01",
            limit: "100",
            skip: "0",
        }));
    });

    it("normalizes the vendor list response before returning it to consumers", async () => {
        const fetchMock = jest.spyOn(global, "fetch").mockResolvedValue(new Response(
            JSON.stringify({
                documents: [{
                    id: "document-201",
                    document_number: "DOC-201",
                    document_name: "문서 201",
                    template: { id: "template-1", name: "계약서" },
                    creator: { recipient_type: "01", id: "creator", name: "생성자" },
                    created_date: "1628500286702",
                    updated_date: "1628500287046",
                    current_status: {
                        status_type: 60,
                        status_doc_type: "진행중",
                        status_doc_detail: "검토 필요",
                        step_type: 5,
                        step_index: 0,
                        step_name: "계약 상",
                        step_recipients: [{
                            recipient_type: 1,
                            id: 0,
                            name: "홍길동",
                        }],
                        step_group: 3,
                    },
                }],
                total_rows: "2",
            }),
            { status: 200 },
        ));

        const page = await createClient()
            .getCompletedDocumentsPage("access-token", 75, 1_125);
        expect(page).toEqual({
            documents: [expect.objectContaining({
                id: "document-201",
                created_date: 1_628_500_286_702,
                updated_date: 1_628_500_287_046,
                current_status: expect.objectContaining({
                    status_type: "060",
                    step_type: "05",
                    step_index: "0",
                    step_recipients: [{
                        recipient_type: "1",
                        id: "0",
                        name: "홍길동",
                    }],
                }),
            })],
            total_rows: 2,
        });
        const [document] = page.documents;
        expect(document?.current_status).not.toHaveProperty("expired_date");
        expect(document?.current_status).not.toHaveProperty("_expired");

        const request = fetchMock.mock.calls[0]?.[1];
        expect(JSON.parse(String(request?.body))).toEqual(expect.objectContaining({
            type: "03",
            limit: "75",
            skip: "1125",
        }));
    });

    it.each(["", "not-a-number", "-1", null, false])(
        "rejects invalid total_rows value %p at the API boundary",
        async (totalRows) => {
            jest.spyOn(global, "fetch").mockResolvedValue(new Response(
                JSON.stringify({ documents: [], total_rows: totalRows }),
                { status: 200 },
            ));

            await expect(
                createClient().getInProgressDocumentsPage("access-token"),
            ).rejects.toThrow("Invalid eformsign total_rows");
        },
    );

    it("normalizes dates and preserves remaining expiry days on detail responses", async () => {
        jest.spyOn(global, "fetch").mockResolvedValue(new Response(
            JSON.stringify({
                id: "detail-document",
                document_number: "DOC-DETAIL",
                document_name: "상세 문서",
                template: { id: "template-1", name: "계약서" },
                creator: { recipient_type: "01", id: "creator", name: "생성자" },
                created_date: "1628500286702",
                updated_date: "1628500287046",
                current_status: {
                    status_type: 80,
                    status_doc_type: "완료",
                    status_doc_detail: "만료",
                    step_type: 5,
                    step_index: 0,
                    step_name: "완료",
                    step_recipients: [],
                    step_group: 3,
                    expired_date: "3",
                    _expired: true,
                },
            }),
            { status: 200 },
        ));

        await expect(
            createClient().getDocument("access-token", "detail-document"),
        ).resolves.toEqual(expect.objectContaining({
            created_date: 1_628_500_286_702,
            updated_date: 1_628_500_287_046,
            current_status: expect.objectContaining({
                status_type: "080",
                step_type: "05",
                step_index: "0",
                expired_date: 3,
                _expired: true,
            }),
        }));
    });

    it("preserves zero remaining expiry days as the no-expiry sentinel", async () => {
        jest.spyOn(global, "fetch").mockResolvedValue(new Response(
            JSON.stringify({
                id: "no-expiry-document",
                current_status: {
                    status_type: 60,
                    step_type: 6,
                    expired_date: 0,
                },
            }),
            { status: 200 },
        ));

        await expect(
            createClient().getDocument("access-token", "no-expiry-document"),
        ).resolves.toEqual(expect.objectContaining({
            current_status: expect.objectContaining({
                status_type: "060",
                step_type: "06",
                expired_date: 0,
            }),
        }));
    });

    it("requests rejected documents with type 04 and preserves page metadata", async () => {
        const fetchMock = jest.spyOn(global, "fetch").mockResolvedValue(new Response(
            JSON.stringify({
                documents: [{ id: "rejected-document" }],
                total_rows: 17,
            }),
            { status: 200 },
        ));

        await expect(
            createClient().getRejectedDocumentsPage("access-token", 25, 50),
        ).resolves.toEqual({
            documents: [expect.objectContaining({ id: "rejected-document" })],
            total_rows: 17,
        });

        const request = fetchMock.mock.calls[0]?.[1];
        expect(JSON.parse(String(request?.body))).toEqual(expect.objectContaining({
            type: "04",
            limit: "25",
            skip: "50",
        }));
    });

    it("keeps getAllDocuments on its existing in-progress and completed calls", async () => {
        const fetchMock = jest.spyOn(global, "fetch")
            .mockResolvedValueOnce(listSuccessResponse())
            .mockResolvedValueOnce(listSuccessResponse());

        await expect(createClient().getAllDocuments("access-token")).resolves.toEqual([]);

        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(fetchMock.mock.calls.map(([, request]) =>
            JSON.parse(String(request?.body)).type
        )).toEqual(["01", "03"]);
    });

    it("retries a 429 response and succeeds", async () => {
        jest.useFakeTimers();
        jest.spyOn(Math, "random").mockReturnValue(0);
        const warnSpy = jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
        const fetchMock = jest.spyOn(global, "fetch")
            .mockResolvedValueOnce(new Response("rate limited", { status: 429 }))
            .mockResolvedValueOnce(listSuccessResponse());

        const request = createClient().getCompletedDocuments("access-token");
        await jest.advanceTimersByTimeAsync(250);

        await expect(request).resolves.toEqual([]);
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(warnSpy).toHaveBeenCalledWith(
            "Eformsign getCompletedDocuments retry nextAttempt=2/4 waitMs=250 status=429",
        );
    });

    it("uses numeric Retry-After seconds instead of exponential backoff", async () => {
        jest.useFakeTimers();
        const fetchMock = jest.spyOn(global, "fetch")
            .mockResolvedValueOnce(new Response("rate limited", {
                status: 429,
                headers: { "Retry-After": "2" },
            }))
            .mockResolvedValueOnce(listSuccessResponse());

        const request = createClient().getCompletedDocuments("access-token");
        await jest.advanceTimersByTimeAsync(1_999);
        expect(fetchMock).toHaveBeenCalledTimes(1);

        await jest.advanceTimersByTimeAsync(1);
        await expect(request).resolves.toEqual([]);
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("uses HTTP-date Retry-After values", async () => {
        jest.useFakeTimers();
        jest.setSystemTime(new Date("2026-07-28T00:00:00.000Z"));
        const fetchMock = jest.spyOn(global, "fetch")
            .mockResolvedValueOnce(new Response("unavailable", {
                status: 503,
                headers: { "Retry-After": "Tue, 28 Jul 2026 00:00:03 GMT" },
            }))
            .mockResolvedValueOnce(listSuccessResponse());

        const request = createClient().getCompletedDocuments("access-token");
        await jest.advanceTimersByTimeAsync(2_999);
        expect(fetchMock).toHaveBeenCalledTimes(1);

        await jest.advanceTimersByTimeAsync(1);
        await expect(request).resolves.toEqual([]);
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("caps an excessive Retry-After value", async () => {
        jest.useFakeTimers();
        const fetchMock = jest.spyOn(global, "fetch")
            .mockResolvedValueOnce(new Response("rate limited", {
                status: 429,
                headers: { "Retry-After": "3600" },
            }))
            .mockResolvedValueOnce(listSuccessResponse());

        const request = createClient().getCompletedDocuments("access-token");
        await jest.advanceTimersByTimeAsync(9_999);
        expect(fetchMock).toHaveBeenCalledTimes(1);

        await jest.advanceTimersByTimeAsync(1);
        await expect(request).resolves.toEqual([]);
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("retries 5xx responses but fails 4xx responses immediately", async () => {
        jest.useFakeTimers();
        jest.spyOn(Math, "random").mockReturnValue(0);
        const fetchMock = jest.spyOn(global, "fetch")
            .mockResolvedValueOnce(new Response("unavailable", { status: 503 }))
            .mockResolvedValueOnce(listSuccessResponse())
            .mockResolvedValueOnce(new Response("bad request", { status: 400 }));
        const client = createClient();

        const retriedRequest = client.getCompletedDocuments("access-token");
        await jest.advanceTimersByTimeAsync(250);
        await expect(retriedRequest).resolves.toEqual([]);

        await expect(client.getCompletedDocuments("access-token")).rejects.toMatchObject({
            status: 400,
            message: "Failed to get completed documents: 400 - bad request",
        });
        expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it("retries a network error for idempotent requests", async () => {
        jest.useFakeTimers();
        jest.spyOn(Math, "random").mockReturnValue(0);
        const fetchMock = jest.spyOn(global, "fetch")
            .mockRejectedValueOnce(new TypeError("connection reset"))
            .mockResolvedValueOnce(listSuccessResponse());

        const request = createClient().getCompletedDocuments("access-token");
        await jest.advanceTimersByTimeAsync(250);

        await expect(request).resolves.toEqual([]);
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("retries createDocument only after 429", async () => {
        jest.useFakeTimers();
        jest.spyOn(Math, "random").mockReturnValue(0);
        const fetchMock = jest.spyOn(global, "fetch")
            .mockResolvedValueOnce(new Response("rate limited", { status: 429 }))
            .mockResolvedValueOnce(createSuccessResponse());

        const request = createClient().createDocument("access-token", createDocumentPayload);
        await jest.advanceTimersByTimeAsync(250);

        await expect(request).resolves.toEqual({
            documentId: "document-1",
            status: "created",
        });
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("does not retry createDocument after 5xx", async () => {
        const fetchMock = jest.spyOn(global, "fetch")
            .mockResolvedValue(new Response("unknown outcome", { status: 503 }));

        await expect(
            createClient().createDocument("access-token", createDocumentPayload),
        ).rejects.toMatchObject({
            status: 503,
            message: "Failed to create document: 503 - unknown outcome",
        });
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("does not retry createDocument after a network error", async () => {
        const networkError = new TypeError("connection reset");
        const fetchMock = jest.spyOn(global, "fetch").mockRejectedValue(networkError);

        await expect(
            createClient().createDocument("access-token", createDocumentPayload),
        ).rejects.toBe(networkError);
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    // Headers arrive, then the body stalls or the connection drops. fetch has already
    // resolved at that point, so this used to happen outside the retry loop entirely.
    const bodyFailureResponse = (error: Error) => new Response(
        new ReadableStream({
            start(controller) {
                controller.error(error);
            },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
    );

    it("retries a body-stream failure for idempotent requests", async () => {
        jest.useFakeTimers();
        jest.spyOn(Math, "random").mockReturnValue(0);
        jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
        const fetchMock = jest.spyOn(global, "fetch")
            .mockResolvedValueOnce(bodyFailureResponse(new TypeError("body stream reset")))
            .mockResolvedValueOnce(listSuccessResponse());

        const request = createClient().getCompletedDocuments("access-token");
        await jest.advanceTimersByTimeAsync(250);

        await expect(request).resolves.toEqual([]);
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("does not retry createDocument when the body fails", async () => {
        // A body that starts arriving and then dies is the worst case for a send: the
        // server plainly accepted the request, so the customer may already have it.
        const bodyError = new TypeError("body stream reset");
        const fetchMock = jest.spyOn(global, "fetch")
            .mockResolvedValue(bodyFailureResponse(bodyError));

        await expect(
            createClient().createDocument("access-token", createDocumentPayload),
        ).rejects.toThrow();
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("retries when reading an error response body fails", async () => {
        jest.useFakeTimers();
        jest.spyOn(Math, "random").mockReturnValue(0);
        jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
        const failingErrorBody = new Response(
            new ReadableStream({
                start(controller) {
                    controller.error(new TypeError("error body reset"));
                },
            }),
            { status: 503 },
        );
        const fetchMock = jest.spyOn(global, "fetch")
            .mockResolvedValueOnce(failingErrorBody)
            .mockResolvedValueOnce(listSuccessResponse());

        const request = createClient().getCompletedDocuments("access-token");
        await jest.advanceTimersByTimeAsync(250);

        await expect(request).resolves.toEqual([]);
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("does not retry createDocument after a timeout", async () => {
        // AbortSignal.timeout rejects with a TimeoutError rather than producing a
        // response, so this lands in the same branch as a network error — but it is the
        // case that matters most: a timed-out send may already have reached the customer.
        const timeoutError = new DOMException("The operation timed out.", "TimeoutError");
        const fetchMock = jest.spyOn(global, "fetch").mockRejectedValue(timeoutError);

        await expect(
            createClient().createDocument("access-token", createDocumentPayload),
        ).rejects.toBe(timeoutError);
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("gives createDocument a longer request timeout than the retryable calls", async () => {
        // It is the one call that never retries, so cutting it short just means giving up
        // without knowing whether the document was created. Service-record sends upload up
        // to 20 signature images.
        const timeoutSpy = jest.spyOn(AbortSignal, "timeout");
        jest.spyOn(global, "fetch").mockResolvedValue(createSuccessResponse());

        await createClient().createDocument("access-token", createDocumentPayload);

        expect(timeoutSpy).toHaveBeenCalledWith(60_000);
    });

    it("backs off exponentially when Retry-After is empty", async () => {
        // Number("") is 0, which would retry instantly with no backoff at all.
        jest.useFakeTimers();
        jest.spyOn(Math, "random").mockReturnValue(0);
        jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
        const fetchMock = jest.spyOn(global, "fetch")
            .mockResolvedValueOnce(new Response("rate limited", {
                status: 429,
                headers: { "Retry-After": "   " },
            }))
            .mockResolvedValueOnce(listSuccessResponse());

        const request = createClient().getCompletedDocuments("access-token");
        await jest.advanceTimersByTimeAsync(249);
        expect(fetchMock).toHaveBeenCalledTimes(1);

        await jest.advanceTimersByTimeAsync(1);
        await expect(request).resolves.toEqual([]);
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("throws the last HTTP error after reaching the attempt limit", async () => {
        jest.useFakeTimers();
        jest.spyOn(Math, "random").mockReturnValue(0);
        const fetchMock = jest.spyOn(global, "fetch")
            .mockResolvedValueOnce(new Response("first", { status: 503 }))
            .mockResolvedValueOnce(new Response("second", { status: 503 }))
            .mockResolvedValueOnce(new Response("third", { status: 503 }))
            .mockResolvedValueOnce(new Response("last", { status: 503 }));

        const request = createClient().getCompletedDocuments("access-token");
        const assertion = expect(request).rejects.toEqual(
            new EformsignApiError("Failed to get completed documents: 503 - last", 503),
        );
        await jest.advanceTimersByTimeAsync(1_750);

        await assertion;
        expect(fetchMock).toHaveBeenCalledTimes(4);
    });

    it("throws the last error instead of waiting beyond the total deadline", async () => {
        jest.useFakeTimers();
        const fetchMock = jest.spyOn(global, "fetch")
            .mockResolvedValueOnce(new Response("first", {
                status: 503,
                headers: { "Retry-After": "10" },
            }))
            .mockResolvedValueOnce(new Response("second", {
                status: 503,
                headers: { "Retry-After": "10" },
            }))
            .mockResolvedValueOnce(new Response("deadline", {
                status: 503,
                headers: { "Retry-After": "10" },
            }));

        const request = createClient().getCompletedDocuments("access-token");
        const assertion = expect(request).rejects.toEqual(
            new EformsignApiError("Failed to get completed documents: 503 - deadline", 503),
        );
        await jest.advanceTimersByTimeAsync(20_000);

        await assertion;
        expect(fetchMock).toHaveBeenCalledTimes(3);
    });
});
