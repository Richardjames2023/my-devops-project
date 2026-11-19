import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

export interface CustomerSupportKnowledgeBase {
  documentId: string;
  status: string;
  approved: boolean;
  content: string;
}

const DEFAULT_KNOWLEDGE_BASE_PATH = resolve(
  __dirname,
  "../../../../docs/chat/customer-support-knowledge-base.md",
);

export function parseCustomerSupportKnowledgeBase(
  markdown: string,
): CustomerSupportKnowledgeBase {
  const content = markdown.trim();

  if (!content) {
    throw new Error("Customer-support knowledge base is empty");
  }

  const documentId = content.match(
    /^-\s+\*\*Document ID:\*\*\s*(.+)$/m,
  )?.[1]?.trim();

  const status = content.match(
    /^-\s+\*\*Status:\*\*\s*(.+)$/m,
  )?.[1]?.trim();

  if (!content.startsWith("# Store Customer Support Knowledge Base")) {
    throw new Error("Invalid customer-support knowledge-base document");
  }

  if (documentId !== "CS-KB-001" || !status) {
    throw new Error("Knowledge-base metadata is missing or invalid");
  }

  return {
    documentId,
    status,
    approved: status === "Approved",
    content,
  };
}

export async function loadCustomerSupportKnowledgeBase(
  filePath = DEFAULT_KNOWLEDGE_BASE_PATH,
): Promise<CustomerSupportKnowledgeBase> {
  const markdown = await readFile(filePath, "utf8");

  return parseCustomerSupportKnowledgeBase(markdown);
}
