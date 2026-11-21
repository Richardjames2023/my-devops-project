import Link from "next/link";
import { Search, ShoppingBag, UserRound } from "lucide-react";

export default function Navbar() {
  return (
    <header className="sticky top-0 z-40 -mx-4 border-b border-[#EEEAE4] bg-[#FBF9F6]/95 px-4 backdrop-blur-md sm:-mx-6 sm:px-6">
      <div className="mx-auto flex max-w-[1440px] items-center justify-between gap-4 py-4">
        <Link href="/" aria-label="ShopSphere home" className="flex shrink-0 items-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#081C41] text-lg font-black text-white">S<span className="text-[#EC702E]">.</span></span>
          <span className="text-xl font-extrabold tracking-tight text-[#081C41]">Shop<span className="text-[#1D52BD]">Sphere</span></span>
        </Link>
        <nav className="hidden items-center gap-7 text-sm font-semibold text-[#373E4B] md:flex"><Link href="/" className="hover:text-[#1D52BD]">Home</Link><Link href="/products" className="hover:text-[#1D52BD]">Shop</Link></nav>
        <form action="/products" className="hidden max-w-xl flex-1 items-center rounded-full bg-[#F4F6FA] px-4 py-3 md:flex"><Search size={17} className="mr-2 shrink-0 text-[#7B8493]" /><input name="q" placeholder="Search products..." aria-label="Search products" className="w-full bg-transparent text-sm text-[#081C41] outline-none placeholder:text-[#929AA7]" /></form>
        <div className="flex items-center gap-2 sm:gap-4"><Link href="/products" className="rounded-full p-2 text-[#081C41] hover:bg-[#E9F1FE]" aria-label="Browse products"><Search size={19} /></Link><Link href="/cart" className="rounded-full p-2 text-[#081C41] hover:bg-[#FDF0E8]" aria-label="Shopping cart"><ShoppingBag size={19} /></Link><Link href="/login" className="flex items-center gap-2 rounded-full bg-[#1D52BD] px-3 py-2 text-xs font-semibold text-white hover:bg-[#153F91] sm:px-4 sm:text-sm"><UserRound size={16} /> <span className="hidden sm:inline">Sign in</span></Link></div>
      </div>
      <form action="/products" className="mx-auto flex max-w-[1440px] items-center rounded-full bg-[#F4F6FA] px-4 py-2.5 md:hidden"><Search size={16} className="mr-2 text-[#7B8493]" /><input name="q" placeholder="Search products..." aria-label="Search products" className="w-full bg-transparent text-sm outline-none placeholder:text-[#929AA7]" /></form>
      <div className="h-3 md:hidden" />
    </header>
  );
}
