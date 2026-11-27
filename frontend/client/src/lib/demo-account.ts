export type DemoCustomer = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  createdAt: string;
};

const CUSTOMER_KEY = "ccb-demo-customer";
const SESSION_KEY = "ccb-demo-session";

const DEMO_ORDERS = [
  { id: "demo-1", orderNumber: "CCB-104583", status: "PROCESSING", totalAmount: 125000, currency: "NGN", createdAt: "2026-11-20T10:30:00.000Z", items: [{ id: "i1", productName: "Smart Watch", quantity: 2 }, { id: "i2", productName: "Laptop", quantity: 1 }] },
  { id: "demo-2", orderNumber: "CCB-104112", status: "COMPLETED", totalAmount: 210000, currency: "NGN", createdAt: "2026-11-12T10:30:00.000Z", items: [{ id: "i3", productName: "Digital Camera", quantity: 1 }] },
  { id: "demo-3", orderNumber: "CCB-103807", status: "CANCELLED", totalAmount: 28000, currency: "NGN", createdAt: "2026-11-02T10:30:00.000Z", items: [{ id: "i4", productName: "Wireless Earbuds", quantity: 2 }] },
] as const;

export function registerDemoCustomer(input: Omit<DemoCustomer, "id" | "createdAt">): DemoCustomer {
  const customer: DemoCustomer = { ...input, id: `demo-${Date.now()}`, createdAt: new Date().toISOString() };
  localStorage.setItem(CUSTOMER_KEY, JSON.stringify(customer));
  localStorage.setItem(SESSION_KEY, "active");
  return customer;
}

export function loginDemoCustomer(email: string): DemoCustomer {
  const saved = localStorage.getItem(CUSTOMER_KEY);
  let customer: DemoCustomer | null = null;
  if (saved) {
    try { customer = JSON.parse(saved) as DemoCustomer; } catch { localStorage.removeItem(CUSTOMER_KEY); }
  }
  if (!customer || customer.email.toLowerCase() !== email.trim().toLowerCase()) {
    customer = {
      id: "demo-customer-001",
      firstName: "Demo",
      lastName: "Customer",
      email: email.trim().toLowerCase(),
      phone: "",
      createdAt: new Date().toISOString(),
    };
    localStorage.setItem(CUSTOMER_KEY, JSON.stringify(customer));
  }
  localStorage.setItem(SESSION_KEY, "active");
  return customer;
}

export function getDemoCustomer(): DemoCustomer | null {
  if (typeof window === "undefined" || localStorage.getItem(SESSION_KEY) !== "active") return null;
  const value = localStorage.getItem(CUSTOMER_KEY);
  if (!value) return null;
  try { return JSON.parse(value) as DemoCustomer; } catch { return null; }
}

export function logoutDemoCustomer(): void {
  localStorage.removeItem(SESSION_KEY);
}

export function getDemoOrders() { return DEMO_ORDERS; }
export function getDemoWishlistCount() { return 4; }
export function getDemoUnreadCount() { return 2; }
