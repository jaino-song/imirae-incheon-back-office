import { shouldRetryQuery } from "./queryClient";

function httpError(status: number) {
    return { response: { status } };
}

describe("shouldRetryQuery", () => {
    it("never retries a 401, so an expired session cannot become a request storm", () => {
        expect(shouldRetryQuery(0, httpError(401))).toBe(false);
    });

    it("never retries a 403", () => {
        expect(shouldRetryQuery(0, httpError(403))).toBe(false);
    });

    it("still retries a transient server error exactly once", () => {
        expect(shouldRetryQuery(0, httpError(500))).toBe(true);
        expect(shouldRetryQuery(1, httpError(500))).toBe(false);
    });

    it("still retries an error carrying no response (network drop)", () => {
        expect(shouldRetryQuery(0, new Error("Network Error"))).toBe(true);
        expect(shouldRetryQuery(1, new Error("Network Error"))).toBe(false);
    });

    it("tolerates null/undefined and non-numeric statuses without throwing", () => {
        expect(shouldRetryQuery(0, null)).toBe(true);
        expect(shouldRetryQuery(0, undefined)).toBe(true);
        expect(shouldRetryQuery(0, { response: { status: "401" } })).toBe(true);
    });
});
