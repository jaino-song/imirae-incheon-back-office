import type { Client } from "@/lib/client/types";

import {
  buildAllClientRowsForList,
  groupForClient,
} from "@/lib/client/list-helpers";

function createClient(id: number, serviceStatus: Client["serviceStatus"]): Client {
  return {
    id,
    name: `Client ${id}`,
    serviceStatus,
    startDate: `2026-06-0${id}`,
  } as Client;
}

describe("buildAllClientRowsForList", () => {
  it("keeps clients with unknown service statuses visible in the all filter", () => {
    const rows = buildAllClientRowsForList([
      createClient(1, "active"),
      createClient(2, "archived" as Client["serviceStatus"]),
    ]);

    expect(rows.map((client) => client.id)).toEqual([2, 1]);
  });
});

describe("groupForClient", () => {
  it("does not label unknown service statuses as a completed client", () => {
    expect(groupForClient(createClient(1, "archived" as Client["serviceStatus"])).badge).toBe("상태 미정");
  });
});
