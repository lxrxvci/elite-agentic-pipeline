import Link from 'next/link'

const features = [
  {
    title: 'AI-Powered Website Builder',
    description:
      'Describe the changes you want and our assistant proposes safe, allow-listed edits to your food truck site.',
    icon: '✨',
  },
  {
    title: 'Menu & Hours, Simplified',
    description:
      'Update menus, locations, and business hours in one place. Changes reflect instantly on your public site.',
    icon: '📍',
  },
  {
    title: 'Order & Social Links',
    description:
      'Connect DoorDash, UberEats, Instagram, and more so customers can find you wherever they already are.',
    icon: '🚀',
  },
  {
    title: 'Mobile-First Templates',
    description:
      'Choose from beautiful, fast templates built for food carts. No design or coding skills required.',
    icon: '🎨',
  },
]

const steps = [
  { number: '1', title: 'Claim your slug', description: 'Pick a unique URL like web.agenticpnw.com/sites/your-truck.' },
  { number: '2', title: 'Add your details', description: 'Upload your menu, hours, locations, and brand colors.' },
  { number: '3', title: 'Go live', description: 'Share your public site and update it anytime with AI or the dashboard.' },
]

export function LandingPage() {
  return (
    <div className="min-h-screen bg-white font-body text-fc-text-primary">
      {/* Header */}
      <header className="border-b border-fc-border bg-white/80 backdrop-blur-sm">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-2">
            <span className="text-2xl">🍴</span>
            <span className="text-xl font-bold tracking-tight">Foodcart</span>
          </div>
          <nav className="flex items-center gap-4">
            <Link
              href="/admin/login"
              className="text-sm font-medium text-fc-text-secondary hover:text-fc-text-primary"
            >
              Log in
            </Link>
            <Link
              href="/admin/onboarding"
              className="rounded-md bg-fc-interactive px-4 py-2 text-sm font-medium text-white hover:bg-fc-interactive-hover"
            >
              Get started
            </Link>
          </nav>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden bg-fc-background-subtle px-6 py-24 sm:py-32">
        <div className="mx-auto max-w-5xl text-center">
          <h1 className="font-display text-display-md text-fc-black">
            A beautiful website for every food truck
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg text-fc-text-secondary">
            Foodcart gives food trucks and carts a professional online presence in minutes —
            menus, hours, locations, and AI-assisted updates, all in one simple SaaS.
          </p>
          <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
            <Link
              href="/admin/onboarding"
              className="rounded-md bg-fc-interactive px-8 py-3 text-base font-semibold text-white shadow-elevated transition hover:bg-fc-interactive-hover"
            >
              Create your site
            </Link>
            <Link
              href="/sites/demo-truck"
              className="rounded-md border border-fc-border bg-white px-8 py-3 text-base font-semibold text-fc-text-primary transition hover:bg-fc-neutral-50"
            >
              View a demo
            </Link>
          </div>
          <p className="mt-4 text-sm text-fc-text-muted">No credit card required to start.</p>
        </div>
      </section>

      {/* Features */}
      <section className="px-6 py-20">
        <div className="mx-auto max-w-6xl">
          <div className="mb-12 text-center">
            <h2 className="font-display text-3xl font-bold text-fc-black">Everything you need</h2>
            <p className="mt-3 text-fc-text-secondary">Built specifically for mobile food vendors.</p>
          </div>
          <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
            {features.map((feature) => (
              <div
                key={feature.title}
                className="rounded-2xl border border-fc-border bg-white p-6 shadow-card transition hover:shadow-elevated"
              >
                <div className="mb-4 text-3xl">{feature.icon}</div>
                <h3 className="mb-2 text-lg font-semibold text-fc-black">{feature.title}</h3>
                <p className="text-sm leading-relaxed text-fc-text-secondary">{feature.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="bg-fc-background-subtle px-6 py-20">
        <div className="mx-auto max-w-5xl">
          <div className="mb-12 text-center">
            <h2 className="font-display text-3xl font-bold text-fc-black">Get online in 3 steps</h2>
          </div>
          <div className="grid gap-8 md:grid-cols-3">
            {steps.map((step) => (
              <div key={step.number} className="text-center">
                <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-fc-interactive text-lg font-bold text-white">
                  {step.number}
                </div>
                <h3 className="mb-2 text-lg font-semibold text-fc-black">{step.title}</h3>
                <p className="text-sm text-fc-text-secondary">{step.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="px-6 py-20">
        <div className="mx-auto max-w-4xl rounded-3xl bg-fc-black px-6 py-16 text-center text-white">
          <h2 className="font-display text-3xl font-bold">Ready to feed more customers?</h2>
          <p className="mx-auto mt-4 max-w-xl text-fc-neutral-300">
            Join food trucks already using Foodcart to turn hungry browsers into loyal regulars.
          </p>
          <Link
            href="/admin/onboarding"
            className="mt-8 inline-block rounded-md bg-fc-saffron-500 px-8 py-3 text-base font-semibold text-white transition hover:bg-fc-saffron-600"
          >
            Start building for free
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-fc-border px-6 py-10">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 sm:flex-row">
          <div className="flex items-center gap-2">
            <span className="text-xl">🍴</span>
            <span className="font-semibold">Foodcart</span>
          </div>
          <p className="text-sm text-fc-text-muted">
            © {new Date().getFullYear()} Foodcart. Built for food trucks everywhere.
          </p>
          <div className="flex gap-6">
            <Link href="/admin/login" className="text-sm text-fc-text-secondary hover:text-fc-text-primary">
              Admin login
            </Link>
            <Link href="/admin/onboarding" className="text-sm text-fc-text-secondary hover:text-fc-text-primary">
              Sign up
            </Link>
          </div>
        </div>
      </footer>
    </div>
  )
}
