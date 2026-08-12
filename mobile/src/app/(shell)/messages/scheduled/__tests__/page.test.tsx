import { redirect } from "next/navigation";

import ScheduledMessagesPage from "../page";

jest.mock("next/navigation", () => ({
  redirect: jest.fn(),
}));

describe("ScheduledMessagesPage", () => {
  it("redirects bookmarks and deep links to the merged history screen", () => {
    ScheduledMessagesPage();

    expect(redirect).toHaveBeenCalledWith("/messages/history");
  });
});
