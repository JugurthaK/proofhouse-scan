import { describe, expect, it } from "vitest";
import { parseRepoRef } from "../src/scm/ref.js";

describe("parseRepoRef", () => {
  it("keeps owner/repo as GitHub", () => {
    expect(parseRepoRef("acme/demo.js")).toEqual({
      provider: "github",
      host: "github.com",
      path: "acme/demo.js",
      fullName: "acme/demo.js",
      owner: "acme",
      name: "demo.js",
    });
    expect(parseRepoRef("https://github.com/acme/demo.git").fullName).toBe("acme/demo");
  });

  it("parses GitLab paths and URLs, nested groups and self-managed hosts", () => {
    expect(parseRepoRef("gitlab.com/group/sub/project")).toEqual({
      provider: "gitlab",
      host: "gitlab.com",
      path: "group/sub/project",
      fullName: "gitlab.com/group/sub/project",
      owner: "group/sub",
      name: "project",
    });
    expect(parseRepoRef("https://Git.Corp.io:8443/team/svc.git").fullName).toBe(
      "git.corp.io:8443/team/svc",
    );
    expect(parseRepoRef("https://gitlab.com/group/project/-/tree/main/src").fullName).toBe(
      "gitlab.com/group/project",
    );
  });

  it("rejects malformed references", () => {
    for (const bad of [
      "not-a-slug",
      "group/sub/project", // no host
      "gitlab.com/project", // host + single segment
      "github.com/acme/demo/extra",
      "gitlab.com/group/../project",
      "acme/demo repo",
    ]) {
      expect(() => parseRepoRef(bad), bad).toThrow(/Invalid repo/);
    }
  });

  it("enforces an expected provider", () => {
    expect(() => parseRepoRef("acme/demo", "gitlab")).toThrow(/need their host/);
    expect(() => parseRepoRef("gitlab.com/acme/demo", "github")).toThrow(/Invalid repo/);
    expect(parseRepoRef("github.com/acme/demo", "github").fullName).toBe("acme/demo");
  });
});
