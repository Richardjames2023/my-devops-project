import type { Metadata } from "next";
import "./globals.css";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import CustomerSupportChat from "@/components/CustomerSupportChat";
import { ToastContainer } from "react-toastify";


export const metadata: Metadata = {
  title: "ClickClickBuy",
  description: "Discover quality essentials and everyday favourites at ClickClickBuy.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <div className="storefront-shell">
          <Navbar />
          <main className="storefront-main">{children}</main>
          <div className="storefront-footer-wrap">
            <Footer />
          </div>
        </div>
        <CustomerSupportChat />
        <ToastContainer position="bottom-right" />
      </body>
    </html>
  );
}
