// Local DB use cases - Read
export * from "./find-eformsign-doc-by-id.usecase";
export * from "./find-eformsign-doc-by-document-id.usecase";
export * from "./find-eformsign-docs-by-client-id.usecase";
export * from "./list-eformsign-docs.usecase";
export * from "./list-other-branch-document-ids.usecase";
export * from "./list-eformsign-doc-display-fields.usecase";
export * from "./get-contract-client-candidate.usecase";

// Local DB use cases - Write
export * from "./create-eformsign-doc.usecase";
export * from "./adopt-eformsign-doc.usecase";
export * from "./mirror-unassigned-eformsign-doc.usecase";
export * from "./backfill-eformsign-docs.usecase";
export * from "./update-eformsign-doc-status.usecase";
export * from "./link-document-to-client.usecase";
export * from "./link-mirrored-eformsign-doc-by-phone.usecase";
export * from "./reconcile-completed-mirrored-eformsign-doc.usecase";
export * from "./list-client-names-by-branch.usecase";
export * from "./list-review-stage-contracts.usecase";
export * from "./sync-client-end-date.usecase";
// NOTE: UpdateClientContractStatusUsecase deprecated - service status is now computed from dates

// External API use cases
export * from "./get-eformsign-access-token.usecase";
export * from "./refresh-eformsign-access-token.usecase";
export * from "./fetch-all-eformsign-docs-from-api.usecase";
export * from "./fetch-eformsign-doc-from-api.usecase";

// Contract creation
export * from "./create-and-send-contract.usecase";

// Headless dispatch (BJJ-90)
export * from "./dispatch-document-headless.usecase";
export * from "./finalize-document-headless.usecase";
