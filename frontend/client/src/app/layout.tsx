import type { Metadata } from "next";
import { Geist } from "next/font/google";
import "./globals.css";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { ToastContainer } from "react-toastify";

const geist = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "ShopSphere | Discover more", template: "%s | ShopSphere" },
  description: "Discover products for everyday living with ShopSphere.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body className={`${geist.variable} antialiased`}><div className="min-h-screen bg-[#FBF9F6]"><div className="mx-auto max-w-[1600px] px-4 sm:px-6 lg:px-10"><Navbar /><main className="min-h-[60vh] py-8 sm:py-10">{children}</main></div><Footer /><ToastContainer position="bottom-right" /></div></body></html>;
}
