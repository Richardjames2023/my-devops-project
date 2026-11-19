import { describe, expect, it } from "vitest";
import {
  parseCustomerSupportKnowledgeBase,
} from "../src/modules/chat/ai/customer-support-knowledge-base";

const createDocument = (status: string) => `
# Store Customer Support Knowledge Base

- **Document ID:** CS-KB-001
- **Version:** 1.0
- **Status:** ${status}

## Purpose
Use only confirmed store policies.
`;

describe("Customer support knowledge base", () => {
  it("recognizes the existing draft as unapproved", () => {
    const result = parseCustomerSupportKnowledgeBase(
      createDocument("Draft — pending approval"),
    );

    expect(result).toMatchObject({
      documentId: "CS-KB-001",
      approved: false,
    });
  });

  it("recognizes an explicitly approved document", () => {
    const result = parseCustomerSupportKnowledgeBase(
      createDocument("Approved"),
    );

    expect(result.approved).toBe(true);
  });

  it("rejects an empty document", () => {
    expect(() =>
      parseCustomerSupportKnowledgeBase("  "),
    ).toThrow("knowledge base is empty");
  });

  it("rejects an invalid document ID", () => {
    expect(() =>
      parseCustomerSupportKnowledgeBase(
        createDocument("Approved").replace(
          "CS-KB-001",
          "CS-KB-999",
        ),
      ),
    ).toThrow("metadata is missing or invalid");
  });

  it("rejects a document without the expected title", () => {
    expect(() =>
      parseCustomerSupportKnowledgeBase(
        createDocument("Approved").replace(
          "# Store Customer Support Knowledge Base",
          "# Other Document",
        ),
      ),
    ).toThrow("Invalid customer-support knowledge-base document");
  });
});
