import Link from "next/link";

export default function Footer() {
  return (
    <footer className="mt-20 bg-[#081C41] px-6 py-12 text-white sm:rounded-t-3xl">
      <div className="mx-auto grid max-w-[1440px] gap-10 sm:grid-cols-2 lg:grid-cols-4">
        <div><Link href="/" className="text-2xl font-extrabold">Shop<span className="text-[#EC702E]">Sphere</span></Link><p className="mt-3 max-w-xs text-sm leading-6 text-white/65">Discover products for everyday living, all in one place.</p></div>
        <div><h3 className="text-sm font-bold">Explore</h3><div className="mt-4 flex flex-col gap-3 text-sm text-white/65"><Link href="/products">All products</Link><Link href="/">Home</Link></div></div>
        <div><h3 className="text-sm font-bold">Your account</h3><div className="mt-4 flex flex-col gap-3 text-sm text-white/65"><Link href="/login">Sign in</Link><Link href="/cart">Shopping cart</Link></div></div>
        <div><h3 className="text-sm font-bold">ShopSphere</h3><p className="mt-4 text-sm leading-6 text-white/65">Product availability and pricing are provided by the shop catalogue.</p></div>
      </div>
      <div className="mx-auto mt-10 max-w-[1440px] border-t border-white/15 pt-5 text-xs text-white/50">© {new Date().getFullYear()} ShopSphere. All rights reserved.</div>
    </footer>
  );
}
