import { metadata } from "../layout";

// M8: the receipt route overrides the (public) group layout's title/description, which
// would otherwise leak "서비스 제공기록지" onto this route's browser tab / share previews.
describe("receipt link layout metadata", () => {
    it("sets the tab title to 본인부담금 영수증", () => {
        expect(metadata.title).toBe("본인부담금 영수증");
    });
});
