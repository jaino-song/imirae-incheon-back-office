import fs from "node:fs";

const source = fs.readFileSync(require.resolve("./page"), "utf8");

describe("ClientsPage deletion conflicts", () => {
  it("should close the confirmation and show the backend conflict guidance", () => {
    const handler = source.slice(
      source.indexOf("const handleDeleteConfirm"),
      source.indexOf("const clearSelectedClientScheduleChange"),
    );

    expect(handler).toContain("setDeleteTargetClientId(null)");
    expect(handler).toContain("getApiErrorMessage");
    expect(source).toContain('data-component="desktop_clients_modals_delete-error-notification"');
  });
});

describe("ClientsPage visual conventions", () => {
  it("uses the standard neutral pill for overflow client statuses", () => {
    expect(source).toContain('variant="neutral"');
    expect(source).toContain(
      'data-component="desktop_clients_sections_section-content_list-section_split-layout_list-panel_content_item_status-more"',
    );
    expect(source).toContain("+{remainingClientBadges.length}");
  });

  it("uses the people icon for the empty client list", () => {
    expect(source).toContain(
      '<ListEmptyState icon={Users} message={t(locale, "clients.no-data")} />',
    );
  });

  it("uses the destructive dropdown variant for delete", () => {
    const deleteMenuItem = source.slice(
      source.indexOf('data-component="desktop_clients_sections_section-content_list-section_split-layout_detail-selection_detail-panel_header_menu_delete"'),
      source.indexOf("</DropdownMenuItem>", source.indexOf('data-component="desktop_clients_sections_section-content_list-section_split-layout_detail-selection_detail-panel_header_menu_delete"')),
    );

    expect(deleteMenuItem).toContain('variant="destructive"');
  });
});
