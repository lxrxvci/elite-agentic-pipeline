import Link from 'next/link'

const mondayBlue = '#6161FF'

const features = [
  {
    id: 'menu',
    title: 'Digital menu',
    description: 'Add dishes, prices, and photos. Update anytime from your dashboard.',
    icon: '🍔',
    color: 'bg-orange-100 text-orange-600',
  },
  {
    id: 'hours',
    title: 'Hours & locations',
    description: 'Show where you are today and when you open next. Customers always know where to find you.',
    icon: '🕐',
    color: 'bg-blue-100 text-blue-600',
  },
  {
    id: 'orders',
    title: 'Order links',
    description: 'Connect DoorDash, UberEats, Toast, or your own ordering page in one tap.',
    icon: '📲',
    color: 'bg-green-100 text-green-600',
  },
  {
    id: 'ai',
    title: 'AI assistant',
    description: 'Tell the AI what to change and it proposes safe, allow-listed edits you can apply in seconds.',
    icon: '✨',
    color: 'bg-violet-100 text-violet-600',
  },
]

const useCases = [
  'Food Trucks',
  'Carts',
  'Pop-ups',
  'Catering',
  'Markets',
  'Ghost Kitchens',
  'Stalls',
]

const stats = [
  { value: '5 min', label: 'to launch a site' },
  { value: '0', label: 'design skills needed' },
  { value: '100%', label: 'mobile-optimized' },
]

function CheckIcon() {
  return (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="3" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
    </svg>
  )
}

function ArrowRightIcon() {
  return (
    <svg className="h-4 w-4 transition-transform group-hover:translate-x-0.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14M12 5l7 7-7 7" />
    </svg>
  )
}

export function LandingPage() {
  return (
    <div className="min-h-screen bg-white font-body text-[#0a0a0a]">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-[#e5e5e5] bg-white/95 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <Link href="/" className="flex items-center gap-2">
            <span className="text-2xl">🍴</span>
            <span className="text-xl font-bold tracking-tight">WebAgentic</span>
          </Link>
          <nav className="hidden items-center gap-8 md:flex">
            <a href="#features" className="text-sm font-medium text-[#737373] hover:text-[#0a0a0a]">
              Features
            </a>
            <a href="#how-it-works" className="text-sm font-medium text-[#737373] hover:text-[#0a0a0a]">
              How it works
            </a>
            <a href="#pricing" className="text-sm font-medium text-[#737373] hover:text-[#0a0a0a]">
              Pricing
            </a>
          </nav>
          <div className="flex items-center gap-3">
            <Link
              href="/admin/login"
              className="hidden text-sm font-medium text-[#737373] hover:text-[#0a0a0a] sm:block"
            >
              Log in
            </Link>
            <Link
              href="/admin/onboarding"
              className="group inline-flex items-center gap-2 rounded-full bg-[#6161FF] px-5 py-2.5 text-sm font-semibold text-white shadow-md shadow-[#6161FF]/25 transition hover:bg-[#4f4fdb] hover:shadow-lg hover:shadow-[#6161FF]/30"
            >
              Get Started
              <ArrowRightIcon />
            </Link>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden px-6 pt-16 pb-12 sm:pt-24 sm:pb-16">
        <div className="mx-auto grid max-w-7xl items-center gap-12 lg:grid-cols-2 lg:gap-16">
          {/* Left */}
          <div className="max-w-2xl">
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-[#e5e5e5] bg-[#fafafa] px-4 py-1.5 text-sm font-medium text-[#525252]">
              <span className="flex h-2 w-2 rounded-full" style={{ backgroundColor: mondayBlue }} />
              AI website platform
            </div>
            <h1 className="font-display text-[clamp(2.75rem,6vw,5rem)] font-bold leading-[1.05] tracking-tight text-[#0a0a0a]">
              You cook.
              <br />
              We build your site.
            </h1>
            <p className="mt-6 max-w-lg text-lg leading-relaxed text-[#525252] sm:text-xl">
              WebAgentic is the simplest way for food trucks and carts to get a professional website —
              menu, hours, locations, and AI updates, all in one place.
            </p>
            <div className="mt-8 flex flex-col items-start gap-4 sm:flex-row sm:items-center">
              <Link
                href="/admin/onboarding"
                className="group inline-flex items-center gap-2 rounded-full bg-[#6161FF] px-8 py-4 text-base font-semibold text-white shadow-xl shadow-[#6161FF]/25 transition hover:bg-[#4f4fdb] hover:shadow-2xl hover:shadow-[#6161FF]/30"
              >
                Get Started
                <ArrowRightIcon />
              </Link>
              <Link
                href="/sites/demo-truck"
                className="inline-flex items-center gap-2 text-base font-semibold text-[#0a0a0a] hover:text-[#6161FF]"
              >
                View a demo
                <ArrowRightIcon />
              </Link>
            </div>
            <p className="mt-6 flex items-center gap-2 text-sm text-[#a3a3a3]">
              <span>No credit card needed</span>
              <span className="text-[#d4d4d4]">◆</span>
              <span>Free forever plan</span>
            </p>
          </div>

          {/* Right — composite visual */}
          <div className="relative mx-auto w-full max-w-xl lg:max-w-none">
            <div className="absolute -inset-8 rounded-full bg-gradient-to-tr from-[#6161FF]/10 via-transparent to-[#ff6b5b]/10 blur-3xl" />

            {/* Main card */}
            <div className="relative rounded-3xl border border-[#e5e5e5] bg-white p-6 shadow-elevated sm:p-8">
              <div className="mb-6 flex items-center gap-2">
                <div className="h-3 w-3 rounded-full bg-red-400" />
                <div className="h-3 w-3 rounded-full bg-amber-400" />
                <div className="h-3 w-3 rounded-full bg-green-400" />
                <div className="ml-4 h-7 flex-1 rounded-lg bg-[#f5f5f5] text-center text-xs leading-7 text-[#a3a3a3]">
                  tacos-bros.webagentic.app
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="rounded-2xl bg-gradient-to-br from-orange-400 to-red-500 p-5 text-white">
                  <div className="text-3xl">🌮</div>
                  <div className="mt-4 text-lg font-bold">Tacos Bros</div>
                  <div className="text-sm opacity-90">Today: 4th & Pine</div>
                  <div className="mt-4 inline-flex items-center gap-1 rounded-full bg-white/20 px-2.5 py-1 text-xs font-medium">
                    <span className="h-1.5 w-1.5 rounded-full bg-green-300" />
                    Open now
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="rounded-2xl border border-[#e5e5e5] bg-white p-4 shadow-sm">
                    <div className="flex items-center gap-3">
                      <div className="flex h-9 w-9 items-center justify-center rounded-full bg-violet-100 text-lg">🤖</div>
                      <div>
                        <div className="text-sm font-semibold">WebAgentic AI</div>
                        <div className="text-xs text-[#a3a3a3]">Just now</div>
                      </div>
                    </div>
                    <p className="mt-3 text-sm text-[#525252]">
                      Added “Friday location at 4th & Pine, 11am–2pm”
                    </p>
                  </div>

                  <div className="rounded-2xl border border-[#e5e5e5] bg-white p-4 shadow-sm">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-semibold">Carne asada taco</span>
                      <span className="text-sm font-bold text-green-600">$4.50</span>
                    </div>
                    <div className="mt-2 h-2 w-3/4 rounded bg-[#f5f5f5]" />
                  </div>
                </div>
              </div>
            </div>

            {/* Floating avatar card */}
            <div className="absolute -top-4 -right-4 hidden rounded-2xl border border-[#e5e5e5] bg-white p-4 shadow-card sm:block">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-orange-400 to-red-500 text-lg">
                  👩‍🍳
                </div>
                <div>
                  <div className="text-sm font-semibold">Maria, Tacos Bros</div>
                  <div className="text-xs text-[#737373]">Site updated in 5 min</div>
                </div>
              </div>
            </div>

            {/* Floating stat card */}
            <div className="absolute -bottom-4 -left-4 hidden rounded-2xl border border-[#e5e5e5] bg-white p-4 shadow-card sm:block">
              <div className="flex items-center gap-2 text-sm font-semibold text-[#0a0a0a]">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-green-100 text-green-600">
                  <CheckIcon />
                </span>
                12 menu items live
              </div>
            </div>
          </div>
        </div>

        {/* Use-case pills */}
        <div className="mx-auto mt-16 flex max-w-7xl flex-wrap items-center justify-center gap-3 px-6">
          {useCases.map((useCase, index) => {
            const active = index === 0
            return (
              <button
                key={useCase}
                className={[
                  'rounded-full px-4 py-2 text-sm font-medium transition',
                  active
                    ? 'bg-[#0a0a0a] text-white'
                    : 'border border-[#e5e5e5] bg-white text-[#525252] hover:border-[#0a0a0a] hover:text-[#0a0a0a]',
                ].join(' ')}
              >
                <span className="mr-2">{active ? '●' : '○'}</span>
                {useCase}
              </button>
            )
          })}
        </div>
      </section>

      {/* Logo cloud */}
      <section className="border-y border-[#e5e5e5] bg-[#fafafa] px-6 py-10">
        <div className="mx-auto max-w-7xl text-center">
          <p className="text-sm font-semibold uppercase tracking-wider text-[#a3a3a3]">
            Trusted by food carts everywhere
          </p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-x-10 gap-y-4 opacity-60 grayscale">
            {['Tacos Bros', 'Banh Mi Express', 'Curry on Wheels', 'Pizza Cart', 'BBQ Pit Stop'].map((name) => (
              <span key={name} className="text-base font-bold text-[#404040]">
                {name}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="px-6 py-24">
        <div className="mx-auto max-w-7xl">
          <div className="mb-16 max-w-2xl">
            <h2 className="font-display text-3xl font-bold tracking-tight text-[#0a0a0a] sm:text-4xl">
              Everything you need to go live
            </h2>
            <p className="mt-4 text-lg text-[#525252]">
              No more wrestling with website builders. WebAgentic is built for mobile vendors.
            </p>
          </div>
          <div className="grid gap-6 md:grid-cols-2">
            {features.map((feature) => (
              <div
                key={feature.id}
                className="group rounded-2xl border border-[#e5e5e5] bg-white p-8 transition hover:border-[#d4d4d4] hover:shadow-elevated"
              >
                <div className={`mb-5 flex h-12 w-12 items-center justify-center rounded-xl text-2xl ${feature.color}`}>
                  {feature.icon}
                </div>
                <h3 className="mb-2 text-xl font-semibold text-[#0a0a0a]">{feature.title}</h3>
                <p className="text-[#525252]">{feature.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* AI section */}
      <section className="overflow-hidden bg-[#0a0a0a] px-6 py-24 text-white">
        <div className="mx-auto flex max-w-7xl flex-col items-center gap-12 lg:flex-row">
          <div className="flex-1">
            <h2 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">
              Update your site with a sentence
            </h2>
            <p className="mt-4 max-w-lg text-lg text-[#a3a3a3]">
              Our AI assistant understands allow-listed changes — update hours, swap a menu item, or
              add a new location safely. You review before anything goes live.
            </p>
            <ul className="mt-8 space-y-4">
              {[
                'Natural-language change requests',
                'Allow-listed operations only',
                'One-click apply or discard',
                'Full revision history',
              ].map((item) => (
                <li key={item} className="flex items-center gap-3">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-green-500 text-xs">
                    <CheckIcon />
                  </span>
                  <span className="text-[#d4d4d4]">{item}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="relative flex-1">
            <div className="absolute -inset-4 rounded-full bg-gradient-to-r from-[#6161FF] to-[#ff6b5b] opacity-20 blur-3xl" />
            <div className="relative rounded-2xl border border-[#262626] bg-[#171717] p-6 shadow-2xl">
              <div className="mb-4 flex gap-2">
                <div className="h-3 w-3 rounded-full bg-[#404040]" />
                <div className="h-3 w-3 rounded-full bg-[#404040]" />
                <div className="h-3 w-3 rounded-full bg-[#404040]" />
              </div>
              <div className="space-y-4">
                <div className="rounded-xl rounded-tl-none bg-[#262626] p-4 text-sm text-[#d4d4d4]">
                  “Add a new Friday location at 4th & Pine from 11am–2pm”
                </div>
                <div
                  className="rounded-xl rounded-tr-none p-4 text-sm text-white"
                  style={{ backgroundColor: mondayBlue }}
                >
                  Proposed: add location “4th & Pine” with Friday hours 11am–2pm. Apply?
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* How it works / Stats */}
      <section id="how-it-works" className="px-6 py-24">
        <div className="mx-auto max-w-7xl">
          <div className="mb-12 text-center">
            <h2 className="font-display text-3xl font-bold tracking-tight text-[#0a0a0a] sm:text-4xl">
              From sign-up to live in minutes
            </h2>
          </div>
          <div className="grid gap-8 rounded-3xl bg-[#fafafa] p-10 sm:grid-cols-3 sm:p-16">
            {stats.map((stat) => (
              <div key={stat.label} className="text-center">
                <div className="font-display text-4xl font-bold text-[#0a0a0a] sm:text-5xl">{stat.value}</div>
                <div className="mt-2 text-[#525252]">{stat.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Testimonial */}
      <section className="bg-[#fafafa] px-6 py-24">
        <div className="mx-auto max-w-4xl text-center">
          <div className="text-4xl text-[#6161FF]/40">“</div>
          <blockquote className="font-display text-2xl font-medium tracking-tight text-[#0a0a0a] sm:text-3xl">
            I went from no website to a site that looks like we hired a designer — in the time it
            took to prep lunch service.
          </blockquote>
          <div className="mt-8 flex items-center justify-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-orange-400 to-red-500 text-lg">
              👩‍🍳
            </div>
            <div className="text-left">
              <div className="font-semibold text-[#0a0a0a]">Maria Santos</div>
              <div className="text-sm text-[#737373]">Tacos Bros, Portland</div>
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section id="pricing" className="px-6 py-24">
        <div
          className="mx-auto max-w-5xl rounded-3xl px-6 py-16 text-center text-white sm:py-20"
          style={{ backgroundColor: mondayBlue }}
        >
          <h2 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">
            Ready to feed more customers?
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-white/80">
            Join food trucks already using WebAgentic to turn hungry browsers into loyal regulars.
          </p>
          <Link
            href="/admin/onboarding"
            className="group mt-8 inline-flex items-center gap-2 rounded-full bg-white px-8 py-4 text-base font-semibold text-[#0a0a0a] shadow-xl transition hover:bg-[#f5f5f5]"
          >
            Start building for free
            <ArrowRightIcon />
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-[#e5e5e5] px-6 py-12">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-6 sm:flex-row">
          <div className="flex items-center gap-2">
            <span className="text-xl">🍴</span>
            <span className="font-semibold">WebAgentic</span>
          </div>
          <p className="text-sm text-[#a3a3a3]">
            © {new Date().getFullYear()} WebAgentic. Built for food trucks everywhere.
          </p>
          <div className="flex gap-6">
            <Link href="/admin/login" className="text-sm text-[#737373] hover:text-[#0a0a0a]">
              Admin login
            </Link>
            <Link href="/admin/onboarding" className="text-sm text-[#737373] hover:text-[#0a0a0a]">
              Sign up
            </Link>
          </div>
        </div>
      </footer>
    </div>
  )
}
