export default function Home() {
  return (
    <div className="flex flex-col min-h-screen">
      {/* Nav */}
      <nav className="flex items-center justify-between px-8 py-5 border-b border-zinc-200 dark:border-zinc-800">
        <span className="text-xl font-bold tracking-tight">Versacom</span>
        <div className="flex gap-6 text-sm font-medium text-zinc-600 dark:text-zinc-400">
          <a href="#features" className="hover:text-black dark:hover:text-white transition-colors">Features</a>
          <a href="#about" className="hover:text-black dark:hover:text-white transition-colors">About</a>
          <a href="#contact" className="hover:text-black dark:hover:text-white transition-colors">Contact</a>
        </div>
      </nav>

      {/* Hero */}
      <section className="flex flex-col items-center justify-center text-center px-8 py-32 flex-1">
        <h1 className="text-5xl sm:text-6xl font-bold tracking-tight max-w-2xl leading-tight">
          Communication,{" "}
          <span className="text-blue-600 dark:text-blue-400">simplified.</span>
        </h1>
        <p className="mt-6 text-lg text-zinc-600 dark:text-zinc-400 max-w-xl leading-relaxed">
          Versacom brings your team together with powerful, flexible communication tools built for the way you work.
        </p>
        <div className="flex gap-4 mt-10">
          <a
            href="#contact"
            className="px-6 py-3 rounded-full bg-blue-600 text-white font-medium hover:bg-blue-700 transition-colors"
          >
            Get Started
          </a>
          <a
            href="#features"
            className="px-6 py-3 rounded-full border border-zinc-300 dark:border-zinc-700 font-medium hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
          >
            Learn More
          </a>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="px-8 py-24 bg-zinc-50 dark:bg-zinc-900">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-3xl font-bold text-center mb-16">Why Versacom?</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-10">
            <div className="text-center">
              <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-blue-100 dark:bg-blue-900 flex items-center justify-center text-blue-600 dark:text-blue-400 text-xl font-bold">
                V
              </div>
              <h3 className="text-lg font-semibold mb-2">Versatile</h3>
              <p className="text-zinc-600 dark:text-zinc-400 text-sm leading-relaxed">
                One platform for messaging, calls, and collaboration — adapts to any workflow.
              </p>
            </div>
            <div className="text-center">
              <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-blue-100 dark:bg-blue-900 flex items-center justify-center text-blue-600 dark:text-blue-400 text-xl font-bold">
                S
              </div>
              <h3 className="text-lg font-semibold mb-2">Secure</h3>
              <p className="text-zinc-600 dark:text-zinc-400 text-sm leading-relaxed">
                End-to-end encryption and enterprise-grade security keep your data safe.
              </p>
            </div>
            <div className="text-center">
              <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-blue-100 dark:bg-blue-900 flex items-center justify-center text-blue-600 dark:text-blue-400 text-xl font-bold">
                F
              </div>
              <h3 className="text-lg font-semibold mb-2">Fast</h3>
              <p className="text-zinc-600 dark:text-zinc-400 text-sm leading-relaxed">
                Real-time performance with low latency — no lag, no delays.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* About */}
      <section id="about" className="px-8 py-24">
        <div className="max-w-2xl mx-auto text-center">
          <h2 className="text-3xl font-bold mb-6">About Versacom</h2>
          <p className="text-zinc-600 dark:text-zinc-400 leading-relaxed">
            Versacom is built for teams that need reliable, flexible communication without the complexity. Whether you&apos;re a startup or an enterprise, we provide the tools to keep everyone connected and productive.
          </p>
        </div>
      </section>

      {/* Contact / CTA */}
      <section id="contact" className="px-8 py-24 bg-blue-600 text-white text-center">
        <h2 className="text-3xl font-bold mb-4">Ready to get started?</h2>
        <p className="text-blue-100 mb-8 max-w-md mx-auto">
          Join the teams already using Versacom to communicate better.
        </p>
        <a
          href="mailto:hello@versacom.com"
          className="inline-block px-8 py-3 rounded-full bg-white text-blue-600 font-semibold hover:bg-blue-50 transition-colors"
        >
          Contact Us
        </a>
      </section>

      {/* Footer */}
      <footer className="px-8 py-6 text-center text-sm text-zinc-500 dark:text-zinc-500 border-t border-zinc-200 dark:border-zinc-800">
        &copy; 2026 Versacom. All rights reserved.
      </footer>
    </div>
  );
}
