import protocol from '../../../../docs/PROTOCOL.md?raw'
import { guide, guideSections, type GuideEntry } from './guide.ts'

const nav = [
  ['/why', 'Why'],
  ['/how', 'How it works'],
  ['/limits', 'Limits'],
  ['/guide', 'Guide'],
  ['/app', 'Open the app'],
] as const

function pathName() {
  const path = window.location.pathname
  if (path.length > 1 && path.endsWith('/')) return path.slice(0, -1)
  return path
}

export function Site() {
  const path = pathName()
  return (
    <div className="site">
      <header className="site-bar">
        <a className="site-mark" href="/"><span className="brand-symbol" aria-hidden="true">↗</span>EndToEnd<span className="brand-dot">.</span></a>
        <nav aria-label="Main navigation">
          {nav.map(([href, label]) => (
            <a key={href} href={href} className={href === '/app' ? 'nav-app' : undefined} aria-current={path === href || (href === '/guide' && path.startsWith('/guide/')) ? 'page' : undefined}>{label}{href === '/app' && <span aria-hidden="true"> ↗</span>}</a>
          ))}
        </nav>
      </header>
      <main>{page(path)}</main>
      <footer>
        <p>Messaging runs in the independent EndToEnd agent (AGPL-3.0-only). Private keys stay in its vault on this device.</p>
      </footer>
    </div>
  )
}

function page(path: string) {
  if (path === '/') return <Home />
  if (path === '/why') return <Why />
  if (path === '/how') return <How />
  if (path === '/limits') return <Limits />
  if (path === '/guide') return <GuideIndex />
  if (path.startsWith('/guide/')) return <GuideArticle slug={path.slice('/guide/'.length)} />
  return <Missing />
}

function Home() {
  return (
    <article className="page">
      <div className="home-hero">
      <header className="hero">
        <p className="eyebrow">On the devices in the chat</p>
        <h1>Messages the server <em>cannot read.</em></h1>
        <p className="lede">
          EndToEnd is a messenger for people who want the contents of a chat to stay on the devices in it.
          You create an account, request a friend, and talk. The server stores ciphertext.
        </p>
        <p className="actions">
          <a className="cta" href="/app">Create an account <span aria-hidden="true">↗</span></a>
          <a className="text-link" href="/why">Why this matters <span aria-hidden="true">→</span></a>
        </p>
      </header>
      <SealPath />
      </div>
      <div className="section-heading"><p className="eyebrow">Built around your devices</p><h2>Private by design.</h2></div>
      <div className="reasons">
        <section className="box">
          <span className="mark" aria-hidden="true">01</span>
          <h2>The text never goes up in the clear</h2>
          <p>Direct messages, group messages, filenames, and the optional note on a friend request are sealed before they leave the browser.</p>
        </section>
        <section className="box">
          <span className="mark" aria-hidden="true">02</span>
          <h2>Keys are born on this device</h2>
          <p>A password lets you back in on this browser. It cannot rebuild the keys on another one.</p>
        </section>
        <section className="box">
          <span className="mark" aria-hidden="true">03</span>
          <h2>You can see what the server kept</h2>
          <p>Server view shows the stored ciphertext. The envelope has no sender column, and a file row has no filename.</p>
        </section>
      </div>
    </article>
  )
}

function SealPath() {
  return (
    <div className="flow-panel">
    <div className="diagram-top"><span className="eyebrow">The message path</span><span className="diagram-status">End to end</span></div>
    <div className="flow" aria-label="A message is plaintext on each device and ciphertext on the server">
      <div className="flow-node">
        <span className="flow-kicker">Your device</span>
        <span className="device-glyph" aria-hidden="true">↗</span>
        <strong>Plaintext</strong>
      </div>
      <div className="flow-track" aria-hidden="true"><span className="flow-packet" /></div>
      <div className="flow-node">
        <span className="flow-kicker">Server</span>
        <span className="cipher-glyph" aria-hidden="true">&#123; ✳ &#125;</span>
        <strong>Ciphertext</strong>
      </div>
      <div className="flow-track" aria-hidden="true"><span className="flow-packet flow-packet-late" /></div>
      <div className="flow-node">
        <span className="flow-kicker">Their device</span>
        <span className="device-glyph" aria-hidden="true">↙</span>
        <strong>Plaintext</strong>
      </div>
    </div>
    <div className="cipher-strip" aria-hidden="true">a7f0 2c91 8e4b d603<br />0x8e 4f2a 91bc 7d00<br />b392 6a0f e817 4c2d</div>
    <p className="diagram-caption">The server stores ciphertext.</p>
    </div>
  )
}

function Why() {
  return (
    <article>
      <p className="eyebrow">Why it matters</p>
      <h1>Why it matters</h1>
      <p className="lede">
        A messenger that holds the plaintext can read the chat, hand it over, or lose it.
        EndToEnd is built so the contents are not there to read.
      </p>
      <div className="split">
        <section className="box box-muted">
          <h2>Holds the plaintext</h2>
          <p>Read the chat, hand it over, or lose it.</p>
        </section>
        <section className="box box-good">
          <h2>Stores ciphertext</h2>
          <p>The contents are not there to read.</p>
        </section>
      </div>
      <section className="box">
        <h2>Plaintext is not uploaded</h2>
        <p>
          A direct message is sealed with the session you open after a friendship is accepted.
          The server queues a blob for the recipient. It does not get a sender column, and it does not get the text.
        </p>
      </section>
      <section className="box">
        <h2>A friend request can carry a note before any session exists</h2>
        <p>
          Search returns an identity public key. The note is sealed to that key, so only the person you asked can open it.
          Accepting the request is what allows a session, a prekey fetch, and a send.
        </p>
      </section>
      <section className="box">
        <h2>A group is sealed to the people still in it</h2>
        <p>
          Group text uses sender keys. The group name travels inside those messages. When someone is removed or leaves,
          the people who remain rotate their keys, and the next message does not open for the person who is gone.
        </p>
      </section>
      <p className="actions"><a className="cta" href="/limits">What this does not hide</a></p>
    </article>
  )
}

function How() {
  return (
    <article>
      <p className="eyebrow">How it works</p>
      <h1>How it works</h1>
      <p className="lede">
        The browser runs the same libsignal protocol Signal uses for sessions and groups.
        The server stores public keys and ciphertext. It does not decrypt.
      </p>
      <div className="steps">
        <article className="step-card">
          <span className="step-num">01</span>
          <h2>Starting a chat</h2>
          <p>
            The first message to a friend uses PQXDH. That handshake mixes a Kyber-1024 prekey with the usual elliptic-curve keys,
            so a later break of today's elliptic-curve cryptography does not open the start of the session by itself.
          </p>
        </article>
        <article className="step-card">
          <span className="step-num">02</span>
          <h2>The messages after that</h2>
          <p>
            Later messages use the Double Ratchet, including the post-quantum ratchet state libsignal keeps in the session.
            Each message has its own key. A receipt, a reply, and a file key travel inside that same session.
          </p>
        </article>
        <article className="step-card">
          <span className="step-num">03</span>
          <h2>Groups</h2>
          <p>
            The creator sends a sender-key distribution to each member inside the direct session, along with the group name.
            Group texts are sealed with that sender key and fanned out as envelopes that carry a group id.
          </p>
        </article>
      </div>
      <p><a href="#protocol">Protocol notes</a></p>
      <div className="shot-frame">
        <pre id="protocol">{protocol}</pre>
      </div>
    </article>
  )
}

const limits = [
  'The server can see handles, who requested or accepted whom, who blocked or unfriended whom, and that a blob was delivered.',
  'This build is one device per account. A copy of this browser\'s key store can read this device\'s sessions.',
  'A password cannot restore keys on another browser.',
  'A safety number detects an identity change. It proves a person only after the two of you compare it on a channel you already trust.',
  'Disappearing messages delete this device\'s copy and the server ciphertext when the timer fires. They do not reach into someone else\'s notes.',
  'A recipient can copy, screenshot, or forward plaintext.',
  'There are no calls, no second device, and no MLS.',
]

function Limits() {
  return (
    <article>
      <p className="eyebrow">Limits</p>
      <h1>What it does not promise</h1>
      <div className="split">
        <section className="box box-good">
          <h2>Sealed</h2>
          <p>The contents of a message stay sealed.</p>
        </section>
        <section className="box box-muted">
          <h2>Visible</h2>
          <p>The fact of the conversation does not.</p>
        </section>
      </div>
      <div className="limit-grid">
        {limits.map((item) => (
          <p className="limit-card" key={item}>{item}</p>
        ))}
      </div>
      <p className="callout">A deployed server needs TLS. TLS protects the pipe. It does not replace the message cipher.</p>
    </article>
  )
}

function GuideIndex() {
  return (
    <article className="guide-home">
      <header className="guide-intro">
        <div>
          <p className="eyebrow">The EndToEnd guide</p>
          <h1>A little guidance.<br /><em>Then you're talking.</em></h1>
          <p className="lede">Each page is one screen in the app: what is on it, and how to use it.</p>
        </div>
        <a className="guide-start" href="/guide/register">
          <span className="eyebrow">Start here / 01</span>
          <strong>Create an account</strong>
          <span>Choose a handle and a password on this device.</span>
          <span className="guide-start-arrow" aria-hidden="true">↗</span>
        </a>
      </header>
      <nav className="guide-topics" aria-label="Guide topics">
        {guideSections.map(section => <a key={section.id} href={`#${section.id}`}>{section.title}<span>{String(section.slugs.length).padStart(2, '0')}</span></a>)}
      </nav>
      {guideSections.map((section, index) => (
        <section className="guide-section" id={section.id} key={section.id}>
          <header className="guide-section-heading"><span className="eyebrow">{String(index + 1).padStart(2, '0')} / Explore</span><div><h2>{section.title}</h2><p>{section.description}</p></div></header>
          <div className="guide-index">
            {section.slugs.map(slug => {
              const entry = guide.find(item => item.slug === slug)!
              return <GuideCard key={slug} entry={entry} />
            })}
          </div>
        </section>
      ))}
    </article>
  )
}

function GuideCard({ entry }: { entry: GuideEntry }) {
  return (
    <a className="guide-card" href={`/guide/${entry.slug}`}>
      <div className={`guide-preview${entry.slug.startsWith('phone-') ? ' guide-preview-phone' : ''}`}><img src={entry.shot} alt="" loading="lazy" /></div>
      <div className="guide-label"><span>{String(guideSections.flatMap(section => [...section.slugs]).findIndex(slug => slug === entry.slug) + 1).padStart(2, '0')}</span><strong>{entry.title}</strong><span aria-hidden="true">↗</span></div>
      <p className="guide-card-description">{entry.features[0]}</p>
    </a>
  )
}

function GuideSidebar({ slug }: { slug: string }) {
  return (
    <aside className="guide-sidebar">
      <a className="guide-back" href="/guide">← All guides</a>
      <div className="guide-mobile-picker">
        <label htmlFor="guide-screen">Choose a screen</label>
        <select id="guide-screen" value={slug} onChange={event => { window.location.href = `/guide/${event.target.value}` }}>
          {guideSections.map(section => <optgroup key={section.id} label={section.title}>{section.slugs.map(item => <option key={item} value={item}>{guide.find(entry => entry.slug === item)!.title}</option>)}</optgroup>)}
        </select>
      </div>
      <nav className="guide-side-nav" aria-label="Guide screens">
        {guideSections.map(section => <div className="guide-side-group" key={section.id}><p className="eyebrow">{section.title}</p>{section.slugs.map(item => <a key={item} href={`/guide/${item}`} aria-current={item === slug ? 'page' : undefined}>{guide.find(entry => entry.slug === item)!.title}</a>)}</div>)}
      </nav>
    </aside>
  )
}

function GuideArticle({ slug }: { slug: string }) {
  const entry = guide.find((item) => item.slug === slug)
  if (!entry) return <Missing />
  const ordered = guideSections.flatMap(section => [...section.slugs])
  const position = ordered.findIndex(item => item === slug)
  const previous = guide.find(item => item.slug === ordered[position - 1])
  const next = guide.find(item => item.slug === ordered[position + 1])
  const section = guideSections.find(item => item.slugs.some(itemSlug => itemSlug === slug))!
  return (
    <div className="guide-layout">
      <GuideSidebar slug={slug} />
      <article className="guide-article">
      <header>
        <p className="eyebrow">{section.title} / {String(position + 1).padStart(2, '0')}</p>
        <h1>{entry.title}</h1>
        <p className="guide-article-meta">{entry.features.length} features <span aria-hidden="true">/</span> {entry.steps.length} steps</p>
      </header>
      <figure className={`guide-shot${slug.startsWith('phone-') ? ' guide-shot-phone' : ''}`}>
        <div className="guide-shot-bar"><span>{entry.title}</span><a href={entry.shot} target="_blank" rel="noreferrer">View full size <span aria-hidden="true">↗</span></a></div>
        <div className="guide-shot-canvas"><img src={entry.shot} alt={`${entry.title} screen in EndToEnd`} /></div>
        <figcaption>The app screen. Follow the steps below.</figcaption>
      </figure>
      <div className="article-split">
        <section>
          <h2>On this screen</h2>
          <ul className="feature-grid">
            {entry.features.map((feature) => <li key={feature}>{feature}</li>)}
          </ul>
        </section>
        <section>
          <h2>How to use it</h2>
          <ol className="timeline">
            {entry.steps.map((step, index) => (
              <li key={step}><b>{String(index + 1).padStart(2, '0')}</b><span>{step}</span></li>
            ))}
          </ol>
        </section>
      </div>
      <nav className="guide-pagination" aria-label="Previous and next guide">
        {previous ? <a href={`/guide/${previous.slug}`}><span className="eyebrow">← Previous</span><strong>{previous.title}</strong></a> : <a href="/guide"><span className="eyebrow">← Explore</span><strong>All guides</strong></a>}
        {next ? <a href={`/guide/${next.slug}`}><span className="eyebrow">Next →</span><strong>{next.title}</strong></a> : <a href="/app"><span className="eyebrow">Ready ↗</span><strong>Open the app</strong></a>}
      </nav>
    </article>
    </div>
  )
}

function Missing() {
  return (
    <article>
      <h1>That page is not here</h1>
      <p><a href="/">Back to the start</a></p>
    </article>
  )
}
