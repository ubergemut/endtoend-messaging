import { useEffect, useState } from 'react'

type Release = { version: string; sourceUrl: string; sourceSha256: string; licenseUrl: string; noticesUrl: string; manifestUrl: string; messagingSourceUrl?: string }

function safeLink(value: unknown) {
  if (typeof value !== 'string') throw new Error('Missing source disclosure link')
  const url = new URL(value, location.origin)
  if (url.username || url.password || !(url.protocol === 'https:' || (url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)))) throw new Error('Invalid source disclosure link')
  return url.href
}

/** The source opportunity stays visible before sign-in and throughout every application page. */
export function SourceNotice() {
  const [release, setRelease] = useState<Release | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    const controller = new AbortController()
    void fetch('/release.json', { credentials: 'omit', redirect: 'error', cache: 'no-store', signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error('Source disclosure unavailable')
        const value = await response.json()
        if (typeof value.version !== 'string' || !/^[a-f0-9]{64}$/.test(value.sourceSha256)) throw new Error('Missing exact source identity')
        setRelease({ version: value.version, sourceSha256: value.sourceSha256,
          sourceUrl: safeLink(value.sourceUrl), licenseUrl: safeLink(value.licenseUrl), noticesUrl: safeLink(value.noticesUrl), manifestUrl: safeLink(value.manifestUrl),
          ...(value.messagingSourceUrl ? { messagingSourceUrl: safeLink(value.messagingSourceUrl) } : {}) })
      }).catch(error => { if (error.name !== 'AbortError') setFailed(true) })
    return () => controller.abort()
  }, [])
  return <aside className="release-notice" aria-label="Software source and licenses">
    <span>EndToEnd frontend{release ? ` ${release.version}` : ''} · AGPL-3.0-only</span>
    <span>Copyright © 2026 EndToEnd contributors. No warranty, except as stated in the applicable licenses. You may modify and redistribute this software under AGPL-3.0-only.</span>
    {release ? <>
      <a href={release.sourceUrl} title={`SHA-256 ${release.sourceSha256}`}>Corresponding source</a>
      <a href={release.manifestUrl}>Source manifest</a>
      <a href={release.licenseUrl}>License</a>
      <a href={release.noticesUrl}>Third-party notices</a>
      {release.messagingSourceUrl ? <a href={release.messagingSourceUrl}>Messaging service source</a> : null}
    </> : <a href="/release.json">{failed ? 'Source offer unavailable — release information' : 'Source and release information'}</a>}
  </aside>
}
