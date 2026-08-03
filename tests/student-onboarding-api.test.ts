import { afterEach, describe, expect, it } from "vitest";

import * as claimRoute from "@/app/api/account/claim-anonymous/route";
import * as discardRoute from "@/app/api/account/discard-anonymous/route";
import { mockPrincipal, resetAuthMocks } from "./auth-test-helpers";

afterEach(() => {
  resetAuthMocks();
});

describe("student onboarding migration routes", () => {
  it("requires authentication for both explicit migration choices", async () => {
    mockPrincipal(undefined);

    const claimResponse = await claimRoute.POST();
    const discardResponse = await discardRoute.POST();

    expect(claimResponse.status).toBe(401);
    expect(discardResponse.status).toBe(401);
  });

  it("does not expose read endpoints that could trigger migration", () => {
    expect("GET" in claimRoute).toBe(false);
    expect("GET" in discardRoute).toBe(false);
    expect(typeof claimRoute.POST).toBe("function");
    expect(typeof discardRoute.POST).toBe("function");
  });
});
