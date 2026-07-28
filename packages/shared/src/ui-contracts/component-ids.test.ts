import {
  extendDataComponentId,
  isDataComponentDescendant,
  isValidDataComponentId,
  makeDataComponentId,
} from "./component-ids";

describe("data-component ids", () => {
  it("builds a canonical platform-rooted path", () => {
    expect(makeDataComponentId("desktop", "clients-detail", "panel")).toBe(
      "desktop_clients-detail_panel",
    );
  });

  it("extends a parent without dropping any owner segment", () => {
    expect(
      extendDataComponentId(
        "desktop_clients-detail_panel_service-records_overview-grid_header-card",
        "head",
        "title-row",
        "title",
      ),
    ).toBe(
      "desktop_clients-detail_panel_service-records_overview-grid_header-card_head_title-row_title",
    );
  });

  it("recognizes only strict descendants of a parent", () => {
    expect(
      isDataComponentDescendant(
        "mobile_clients_detail-sheet",
        "mobile_clients_detail-sheet_stack_detail-page",
      ),
    ).toBe(true);
    expect(
      isDataComponentDescendant(
        "mobile_clients_detail-sheet",
        "mobile_clients_detail-page",
      ),
    ).toBe(false);
  });

  it("rejects legacy and context-free ids", () => {
    expect(isValidDataComponentId("desktop_clients-detail_panel")).toBe(true);
    expect(isValidDataComponentId("clients-detail-panel")).toBe(false);
    expect(isValidDataComponentId("info-card-title")).toBe(false);
  });
});
