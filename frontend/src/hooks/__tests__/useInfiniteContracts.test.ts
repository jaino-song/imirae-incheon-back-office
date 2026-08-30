import type { EformsignDocumentsResponse } from "@/lib/eformsign/types";
import {
  getNextContractsPageParam,
  infiniteContractsQueryKeys,
} from "../useInfiniteContracts";

function createPage({
  documentCount,
  totalRows,
  limit = 20,
  skip = 0,
}: {
  documentCount: number;
  totalRows: number;
  limit?: number;
  skip?: number;
}): EformsignDocumentsResponse {
  return {
    documents: Array.from({ length: documentCount }, (_, index) => ({
      id: `doc-${skip + index}`,
    })) as EformsignDocumentsResponse["documents"],
    total_rows: totalRows,
    limit,
    skip,
  };
}

describe("getNextContractsPageParam", () => {
  it("stops when the filtered result set is empty", () => {
    expect(
      getNextContractsPageParam(createPage({ documentCount: 0, totalRows: 0 })),
    ).toBeUndefined();
  });

  it("stops when the filtered result set contains one loaded document", () => {
    expect(
      getNextContractsPageParam(createPage({ documentCount: 1, totalRows: 1 })),
    ).toBeUndefined();
  });

  it("stops immediately when the first page contains the full result set", () => {
    expect(
      getNextContractsPageParam(createPage({ documentCount: 20, totalRows: 20 })),
    ).toBeUndefined();
  });

  it("returns the next offset while more documents remain", () => {
    expect(
      getNextContractsPageParam(createPage({ documentCount: 20, totalRows: 26 })),
    ).toBe(20);
  });

  it("stops on the final partial page without requesting an empty page", () => {
    expect(
      getNextContractsPageParam(
        createPage({ documentCount: 6, totalRows: 26, skip: 20 }),
      ),
    ).toBeUndefined();
  });

  it("stops defensively when the backend returns an empty page", () => {
    expect(
      getNextContractsPageParam(createPage({ documentCount: 0, totalRows: 40 })),
    ).toBeUndefined();
  });
});

describe("infiniteContractsQueryKeys", () => {
  it("separates section result sets", () => {
    const maternity = infiniteContractsQueryKeys.documents(null, "maternity");
    const serviceRecords = infiniteContractsQueryKeys.documents(null, "service-records");
    const noSection = infiniteContractsQueryKeys.documents(null, undefined);

    expect(maternity).not.toEqual(serviceRecords);
    expect(maternity).not.toEqual(noSection);
  });
});
