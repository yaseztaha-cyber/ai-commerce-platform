"use client";

export default function MobileMenuButton() {
  return (
    <button
      className="lg:hidden p-2 rounded-md text-ink-500 hover:bg-ink-50 hover:text-ink-900"
      onClick={() => {
        document.body.classList.toggle("mobile-nav-open");
        window.dispatchEvent(new CustomEvent("toggle-mobile-nav"));
      }}
      aria-label="Open menu"
    >
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" /></svg>
    </button>
  );
}