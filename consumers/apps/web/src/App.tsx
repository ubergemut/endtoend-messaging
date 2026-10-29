import { useEffect, useMemo, useRef, useState } from 'react'
import type { GroupView as GroupRecord } from '@e2ee/protocol/standalone'
import type { FriendRequestView, PublicMessage, PendingSendView, MessagingGrant } from '@e2ee/protocol/standalone'
import type { BrowserSession as Engine } from './browserSession.ts'
import { AppearanceBar } from './AppearanceBar.tsx'
import { readAppearance, writeAppearance, type Appearance } from './appearance.ts'
import { Api } from './api.ts'
import { acquireHostGrant, loadAgentConfig, revokeHostGrant, type AgentConfig } from './runtimeConfig.ts'
import { connectBrowserAgent, readAttachment } from './browserSession.ts'
import { CryptoCheck } from './cryptoCheck.tsx'
import { fileTooLarge } from './media.ts'
import type { Attachment, ChatMessage, Vault } from './vault.ts'
import { clearStaySession, readStayChoice, readStaySession, writeStay, STAYS, type StayChoice } from './stay.ts'

type Account = { id: string; handle: string; displayName: string }
type Friend = Account & { identityKey: string | null }
type Session = { token: string; account: Account; grant?: MessagingGrant }

type NoticeTarget =
  | { kind: 'request' }
  | { kind: 'chat'; peerId: string | null; groupId: string | null; messageId?: string; threadId?: string }

type Notice = {
  id: string
  title: string
  detail?: string
  target: NoticeTarget
}

type LiveEvent = {
  type?: string
  actorId?: string
  requestId?: string
  fromAccountId?: string
  fromHandle?: string
  toAccountId?: string
  peerId?: string
  handle?: string
}

const NOTIFY_DISMISSED_KEY = 'endtoend-notify-dismissed'

function pageIsBackground() {
  return document.hidden || !document.hasFocus()
}

function noticePreview(message: PublicMessage) {
  const preview = (message.body || message.attachmentNames[0] || '').trim()
  if (!preview) return undefined
  return preview.length > 140 ? `${preview.slice(0, 137)}…` : preview
}

const seat = new URLSearchParams(window.location.search).get('seat') ?? ''
const TOKEN_KEY = seat ? `endtoend-token:${seat}` : 'endtoend-token'
const ACCOUNT_KEY = seat ? `endtoend-account:${seat}` : 'endtoend-account'

function shortTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

function inConversation(message: ChatMessage, peer: string | null, group: string | null) {
  if (message.expiresAt && Date.parse(message.expiresAt) <= Date.now()) return false
  if (group) return message.groupId === group
  if (peer) return message.peerId === peer && !message.groupId
  return false
}

function seenSet(vault: Vault | null) {
  if (!vault) return new Set<string>()
  if (!vault.seen) return new Set(vault.messages.map((message) => message.id))
  return new Set(vault.seen)
}

function isUnseen(message: ChatMessage, seen: Set<string>) {
  if (message.fromMe || message.system) return false
  return !seen.has(message.id)
}

function unseenCount(messages: ChatMessage[], peer: string | null, group: string | null, seen: Set<string>) {
  return messages.filter((message) => inConversation(message, peer, group) && isUnseen(message, seen)).length
}

function previewText(message: ChatMessage) {
  if (message.system) return message.body
  if (message.body) return message.body
  const mime = message.attachments?.[0]?.mime ?? ''
  if (mime.startsWith('image/')) return 'Photo'
  if (mime.startsWith('video/')) return 'Video'
  if (mime.startsWith('audio/')) return 'Audio'
  if (message.attachments?.length) return message.attachments[0].name || 'File'
  return ''
}

export function App() {
  if (window.location.hash === '#crypto-check') return <CryptoCheck />
  return <Messenger />
}

function Messenger() {
  const api = useMemo(() => new Api(), [])
  const [session, setSession] = useState<Session | null>(null)
  const [config, setConfig] = useState<AgentConfig | null>(null)
  const [vault, setVault] = useState<Vault | null>(null)
  const [step, setStep] = useState<'handle' | 'login' | 'register'>('handle')
  const [devicePhase, setDevicePhase] = useState<'pending' | 'open'>('pending')
  const [handle, setHandle] = useState('')
  const [password, setPassword] = useState('')
  const [friends, setFriends] = useState<Friend[]>([])
  const [requests, setRequests] = useState<FriendRequestView[]>([])
  const [groups, setGroups] = useState<GroupRecord[]>([])
  const [peerId, setPeerId] = useState<string | null>(null)
  const [groupId, setGroupId] = useState<string | null>(null)
  const [threadId, setThreadId] = useState<string | null>(null)
  const [threadView, setThreadView] = useState<'inline' | 'full'>('inline')
  const [threadDraft, setThreadDraft] = useState('')
  const [spotlightId, setSpotlightId] = useState<string | null>(null)
  const [atBottom, setAtBottom] = useState(true)
  const [look, setLook] = useState(0)
  const [draft, setDraft] = useState('')
  const [note, setNote] = useState('')
  const [search, setSearch] = useState('')
  const [groupName, setGroupName] = useState('')
  const [picked, setPicked] = useState<string[]>([])
  const [pendingFiles, setPendingFiles] = useState<File[]>([])
  const [pendingSends, setPendingSends] = useState<PendingSendView[]>([])
  const [addMemberId, setAddMemberId] = useState('')
  const [ttl, setTtl] = useState('0')
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [safetyPeer, setSafetyPeer] = useState<string | null>(null)
  const [safetyNumber, setSafetyNumber] = useState('')
  const [trust, setTrust] = useState<{ peerId: string; identityKey: string } | null>(null)
  const [showRequests, setShowRequests] = useState(false)
  const [showNewGroup, setShowNewGroup] = useState(false)
  const [showServer, setShowServer] = useState(false)
  const [notices, setNotices] = useState<Notice[]>([])
  const [appearance, setAppearance] = useState(readAppearance)
  const [stay, setStay] = useState<StayChoice>(() => readStayChoice(seat))
  useEffect(() => {
    const next = readAppearance()
    setAppearance(next)
    writeAppearance(next)
  }, [])
  const [notifyPrompt, setNotifyPrompt] = useState(() => {
    if (typeof Notification === 'undefined') return false
    if (Notification.permission !== 'default') return false
    return localStorage.getItem(NOTIFY_DISMISSED_KEY) !== '1'
  })
  const vaultRef = useRef(vault)
  const friendsRef = useRef(friends)
  const groupsRef = useRef(groups)
  const peerIdRef = useRef(peerId)
  const groupIdRef = useRef(groupId)
  const liveRef = useRef<(event: LiveEvent) => Promise<void>>(async () => {})
  const liveReady = useRef(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const stickToBottom = useRef(true)
  const scrollSpotlight = useRef(false)
  const seenQueue = useRef(new Set<string>())
  const seenTimer = useRef(0)
  const chainRef = useRef(Promise.resolve())
  const chainDepth = useRef(0)
  const engineRef = useRef<Engine | null>(null)
  const connectionGeneration = useRef(0)
  const connectingAbort = useRef<AbortController | null>(null)
  const sendOperations = useRef(new Map<string,string>())
  const fileIdentities = useRef(new WeakMap<File,string>())
  const desktopNotices = useRef(new Set<Notification>())
  vaultRef.current = vault
  friendsRef.current = friends
  groupsRef.current = groups
  peerIdRef.current = peerId
  groupIdRef.current = groupId

  function runExclusive<T>(work: () => Promise<T>): Promise<T> {
    if (chainDepth.current > 0) return work()
    const next = chainRef.current.then(async () => {
      chainDepth.current += 1
      try {
        return await work()
      } finally {
        chainDepth.current -= 1
      }
    })
    chainRef.current = next.then(
      () => undefined,
      () => undefined
    )
    return next
  }

  useEffect(() => {
    const close = () => {
      connectionGeneration.current += 1
      connectingAbort.current?.abort('disconnect'); connectingAbort.current = null
      const engine = engineRef.current
      engineRef.current = null
      clearPresentation()
      if (engine) void engine.close({ forget: false }).catch(() => {})
    }
    const restore = (event: PageTransitionEvent) => { if (event.persisted) close() }
    window.addEventListener('pagehide',close)
    window.addEventListener('pageshow',restore)
    return () => { window.removeEventListener('pagehide',close); window.removeEventListener('pageshow',restore) }
  }, [])

  function clearPresentation() {
    vaultRef.current = null; friendsRef.current = []; groupsRef.current = []; peerIdRef.current = null; groupIdRef.current = null
    setVault(null); setFriends([]); setGroups([]); setRequests([]); setPendingSends([])
    setPeerId(null); setGroupId(null); setThreadId(null); setThreadDraft(''); setThreadView('inline')
    setSpotlightId(null); setSafetyPeer(null); setSafetyNumber(''); setTrust(null); setNotices([])
    setDraft(''); setPendingFiles([]); setNote(''); setSearch(''); setGroupName(''); setPicked([]); setAddMemberId('')
    setShowRequests(false); setShowNewGroup(false); setShowServer(false); setDevicePhase('pending')
    window.clearTimeout(seenTimer.current); seenQueue.current.clear(); sendOperations.current.clear()
    for (const notification of desktopNotices.current) notification.close()
    desktopNotices.current.clear(); liveReady.current = false
  }

  function currentEngine(engine: Engine) { return engineRef.current === engine && !!engine.view }

  function applyEngine(engine = engineRef.current) {
    if (engineRef.current !== engine) return
    const record = engine?.view
    if (!engine || !record) return
    const next = record as Vault
    vaultRef.current = next
    setVault(next)
    friendsRef.current = engine.friendRecords
    groupsRef.current = engine.groupRecords
    setFriends(engine.friendRecords)
    setGroups(engine.groupRecords)
    setTrust(record.pendingTrust)
    setPendingSends(engine.pendingRecords)
  }

  function markSeen(ids: string[]) {
    const current = vaultRef.current
    if (!current) return
    const known = new Set(current.seen ?? [])
    for (const id of ids) {
      if (!known.has(id)) seenQueue.current.add(id)
    }
    if (!seenQueue.current.size) return
    window.clearTimeout(seenTimer.current)
    seenTimer.current = window.setTimeout(() => {
      const queued = [...seenQueue.current]
      seenQueue.current.clear()
      const engine = engineRef.current
      if (!engine || !queued.length) return
      void engine.markSeen(queued).then(() => applyEngine(engine)).catch(() => {})
    }, 200)
  }

  useEffect(() => {
    const root = scrollRef.current
    if (!root) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (document.hidden) return
        const ids = entries
          .filter((entry) => entry.isIntersecting)
          .map((entry) => (entry.target as HTMLElement).dataset.messageId)
          .filter((id): id is string => Boolean(id))
        if (ids.length) markSeen(ids)
      },
      { root, threshold: 0.5 }
    )
    for (const node of root.querySelectorAll('[data-message-id]')) observer.observe(node)
    return () => observer.disconnect()
  }, [peerId, groupId, threadId, threadView, vault?.messages.length, look])

  useEffect(() => {
    const cancellation = new AbortController()
    void loadAgentConfig(cancellation.signal).then(next => {
      if (cancellation.signal.aborted) return
      setConfig(next)
      if (next.host) return
      const stayed = readStaySession(seat)
      const token = stayed?.token ?? sessionStorage.getItem(TOKEN_KEY)
      const raw = stayed ? null : sessionStorage.getItem(ACCOUNT_KEY)
      if (token && (stayed || raw)) {
        const account = stayed?.account ?? (JSON.parse(raw as string) as Account)
        api.setToken(token)
        if (stayed) {
          sessionStorage.setItem(TOKEN_KEY, token)
          sessionStorage.setItem(ACCOUNT_KEY, JSON.stringify(account))
        }
        setSession({ token, account })
      }
    }).catch(reason => { if (!cancellation.signal.aborted) setError((reason as Error).message) })
    return () => cancellation.abort()
  }, [api])

  useEffect(() => {
    if (!session || !config || devicePhase !== 'open') return
    let stopped = false
    let socket: WebSocket | null = null
    let retryTimer = 0
    const engine = engineRef.current
    const live = (event: LiveEvent) => {
      if (!engine || !currentEngine(engine)) return
      void runExclusive(async () => { if (currentEngine(engine)) await liveRef.current(event) }).catch(reason => {
        if (currentEngine(engine)) setError((reason as Error).message)
      })
    }
    const connect = () => {
      if (stopped) return
      const endpoint = new URL('/ws', config.relayUrl)
      endpoint.protocol = endpoint.protocol === 'https:' ? 'wss:' : 'ws:'
      endpoint.searchParams.set('token', session.token)
      const next = new WebSocket(endpoint)
      socket = next
      next.onopen = () => {
        live({ type: 'sync' })
      }
      next.onmessage = (message) => {
        let event: LiveEvent = { type: 'envelope' }
        try {
          const parsed = JSON.parse(String(message.data)) as LiveEvent
          if (parsed && typeof parsed === 'object') event = parsed
        } catch {
          event = { type: 'envelope' }
        }
        live(event.type ? event : { type: 'envelope' })
      }
      next.onclose = () => {
        if (stopped || socket !== next) return
        retryTimer = window.setTimeout(connect, 1000)
      }
    }
    connect()
    return () => {
      stopped = true
      window.clearTimeout(retryTimer)
      socket?.close()
    }
    // unlock and the live handler close over the latest vault via refs
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, config, devicePhase])

  useEffect(() => {
    const timer = window.setInterval(() => {
      const engine = engineRef.current
      if (!engine?.view) return
      void engine.dropExpired().then((mediaIds) => {
        if (mediaIds.length) applyEngine(engine)
      }).catch(() => {})
    }, 1000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (spotlightId && scrollSpotlight.current) {
      scrollSpotlight.current = false
      document.getElementById(`msg-${spotlightId}`)?.scrollIntoView({ block: 'center' })
      stickToBottom.current = false
    } else if (stickToBottom.current) {
      bottomRef.current?.scrollIntoView({ block: 'end' })
    }
    const frame = window.requestAnimationFrame(() => {
      const el = scrollRef.current
      if (!el) return
      setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 64)
    })
    return () => window.cancelAnimationFrame(frame)
  }, [peerId, groupId, threadId, threadView, vault?.messages.length, spotlightId])

  useEffect(() => {
    function measure() {
      const el = scrollRef.current
      if (!el) return
      setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 64)
    }
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [peerId, groupId, threadId, threadView])

  useEffect(() => {
    function onLook() {
      if (!document.hidden) setLook((value) => value + 1)
    }
    window.addEventListener('focus', onLook)
    document.addEventListener('visibilitychange', onLook)
    return () => {
      window.removeEventListener('focus', onLook)
      document.removeEventListener('visibilitychange', onLook)
    }
  }, [])

  async function connectAgent(event: React.FormEvent) {
    event.preventDefault()
    if (!session) return
    const generation = ++connectionGeneration.current
    connectingAbort.current?.abort('disconnect')
    const cancellation = new AbortController()
    connectingAbort.current = cancellation
    setError(''); setStatus('Connect and unlock in the messaging agent window.')
    try {
      const previous = engineRef.current
      engineRef.current = null
      clearPresentation()
      const connecting = connectBrowserAgent(session.token, session.account.id, stay, cancellation.signal, session.grant)
      if (previous) await previous.close({ forget: false }).catch(() => {})
      const engine = await connecting
      if (connectingAbort.current === cancellation) connectingAbort.current = null
      if (generation !== connectionGeneration.current) { await engine.close(); engine.popup.close(); return }
      engineRef.current = engine
      engine.onInvalidated = () => { if (engineRef.current === engine) clearPresentation() }
      let polling = false
      const timer = window.setInterval(() => {
        if (engineRef.current !== engine) { clearInterval(timer); return }
        if (engine.popup.closed) { clearInterval(timer); void engine.close({ forget: false }).catch(() => {}); engineRef.current = null; connectionGeneration.current += 1; clearPresentation(); setError('The messaging agent was closed. Reconnect to continue.'); return }
        if (polling) return
        polling = true
        void engine.status().then(async state => {
          if (engineRef.current !== engine) return
          if (state.unlocked) {
            await engine.refreshView()
            if (engineRef.current !== engine) return
            applyEngine(engine); setDevicePhase('open'); setStatus(''); liveReady.current = true
          } else { engine.clearPresentation(); clearPresentation() }
        }).catch(reason => { if (engineRef.current === engine) { engine.clearPresentation(); clearPresentation(); setError((reason as Error).message) } }).finally(() => { polling = false })
      }, 1000)
    } catch (reason) { if (generation === connectionGeneration.current) { setError((reason as Error).message); setStatus('') } }
  }

  async function refreshRequests() {
    const engine = engineRef.current
    if (!engine) return
    const rows = await engine.requests()
    if (!currentEngine(engine)) return
    setRequests(rows)
    if (peerIdRef.current && !engine.friendRecords.some((friend) => friend.id === peerIdRef.current)) {
      openChat(null, null)
    }
  }

  async function refresh() {
    const engine = engineRef.current
    if (!engine) return
    const result = await engine.sync()
    if (!currentEngine(engine)) return
    applyEngine(engine)
    await refreshRequests()
    if (!currentEngine(engine)) return
    return result
  }

  function dismissNotice(id: string) {
    setNotices((current) => current.filter((item) => item.id !== id))
  }

  function followTarget(target: NoticeTarget) {
    if (target.kind === 'request') {
      if (window.innerWidth <= 800) {
        setPeerId(null)
        setGroupId(null)
        setThreadId(null)
        peerIdRef.current = null
      }
      setShowRequests(true)
      return
    }
    openChat(target.peerId, target.groupId, target.messageId)
  }

  function presentNotice(title: string, target: NoticeTarget, detail?: string) {
    const engine = engineRef.current
    const generation = connectionGeneration.current
    if (!engine || !currentEngine(engine)) return
    const id = crypto.randomUUID()
    setNotices((current) => [...current, { id, title, detail, target }].slice(-3))
    window.setTimeout(() => dismissNotice(id), 8000)
    if (!pageIsBackground()) return
    try {
      if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return
      const tag = target.kind === 'request' ? 'endtoend-request' : `endtoend-chat:${target.groupId ?? target.peerId ?? ''}`
      const note = new Notification(title, { tag })
      desktopNotices.current.add(note)
      note.onclose = () => desktopNotices.current.delete(note)
      note.onclick = () => {
        note.close()
        if (generation !== connectionGeneration.current || !currentEngine(engine)) return
        window.focus()
        followTarget(target)
      }
    } catch {
      // The in-app notice still covers this event when the window is visible.
    }
  }

  function announceMessages(messages: PublicMessage[]) {
    const latest = new Map<string, PublicMessage>()
    for (const message of messages) {
      if (message.fromMe || message.system) continue
      latest.set(message.groupId || message.peerId || message.id, message)
    }
    const visible = !pageIsBackground()
    for (const message of latest.values()) {
      const here = message.groupId
        ? message.groupId === groupIdRef.current
        : message.peerId === peerIdRef.current && !message.groupId
      if (here) setSpotlightId(message.id)
      presentNotice(
        `New message from ${message.handle || 'someone'}`,
        {
          kind: 'chat',
          peerId: message.groupId ? null : message.peerId,
          groupId: message.groupId,
          messageId: message.id,
          threadId: message.replyTo || undefined,
        },
        visible ? noticePreview(message) : undefined
      )
    }
  }

  async function submitHandle(event: React.FormEvent) {
    event.preventDefault()
    const generation = connectionGeneration.current
    setError('')
    const normalized = handle.trim().toLowerCase()
    setHandle(normalized)
    try {
      const body = await api.request<{ exists: boolean }>(`/api/auth/handle?handle=${encodeURIComponent(normalized)}`)
      if (generation !== connectionGeneration.current) return
      setPassword('')
      setStep(body.exists ? 'login' : 'register')
    } catch (reason) {
      if (generation === connectionGeneration.current) setError((reason as Error).message)
    }
  }

  async function submitAuth(event: React.FormEvent) {
    event.preventDefault()
    const generation = connectionGeneration.current
    setError('')
    try {
      const path = step === 'register' ? '/api/auth/register' : '/api/auth/login'
      const body = await api.request<{ token: string; account: Account }>(path, {
        method: 'POST',
        body: JSON.stringify({ handle, password, displayName: handle }),
      })
      if (generation !== connectionGeneration.current) return
      connectionGeneration.current += 1
      api.setToken(body.token)
      sessionStorage.setItem(TOKEN_KEY, body.token)
      sessionStorage.setItem(ACCOUNT_KEY, JSON.stringify(body.account))
      writeStay(seat, stay, {
        token: body.token,
        account: body.account,
      })
      setSession(body)
      setPassword('')
    } catch (reason) {
      if (generation === connectionGeneration.current) setError((reason as Error).message)
    }
  }

  function changeHandle() {
    connectionGeneration.current += 1
    setStep('handle')
    setPassword('')
    setError('')
  }

  async function signInWithHost(event: React.FormEvent) {
    event.preventDefault()
    if (!config?.host) return
    const generation = ++connectionGeneration.current
    connectingAbort.current?.abort('disconnect')
    const cancellation = new AbortController()
    connectingAbort.current = cancellation
    setError(''); setStatus('Connecting your host account to messaging…')
    try {
      const grant = await acquireHostGrant(config, cancellation.signal)
      if (generation !== connectionGeneration.current) return
      setSession({ token: grant.token, account: grant.account, grant })
      setStatus('')
    } catch (reason) { if (generation === connectionGeneration.current) { setError((reason as Error).message); setStatus('') } }
    finally { if (connectingAbort.current === cancellation) connectingAbort.current = null }
  }

  function chooseStay(next: StayChoice) {
    setStay(next)
    const engine = engineRef.current
    void engine?.client.call('setStay',{stay:next}).catch(reason => { if (engineRef.current === engine) setError((reason as Error).message) })
    writeStay(
      seat,
      next,
      session && !session.grant ? { token: session.token, account: session.account } : null,
    )
  }

  function logout() {
    connectionGeneration.current += 1
    connectingAbort.current?.abort('logout'); connectingAbort.current = null
    sessionStorage.removeItem(TOKEN_KEY)
    sessionStorage.removeItem(ACCOUNT_KEY)
    clearStaySession(seat)
    const previous = engineRef.current
    engineRef.current = null
    if (previous) void previous.close().catch(() => {})
    clearPresentation()
    if (session?.grant && config) void revokeHostGrant(config, session.grant).catch(() => {})
    else void api.request('/api/auth/logout', { method: 'POST', body: '{}' }).catch(() => {})
    setDevicePhase('pending')
    api.setToken(null)
    setSession(null)
    setVault(null)
    setPeerId(null)
    setGroupId(null)
    setThreadId(null)
    setThreadView('inline')
    setThreadDraft('')
    setSpotlightId(null)
    setSafetyPeer(null)
    setSafetyNumber('')
    setTrust(null)
    setFriends([])
    setRequests([])
    setGroups([])
    setNotices([])
    setDraft(''); setPendingFiles([]); setNote(''); setSearch(''); sendOperations.current.clear()
    setStep('handle')
    setPassword('')
    setError('')
    liveReady.current = false
    engineRef.current = null
  }

  function allowNotifications() {
    setNotifyPrompt(false)
    if (typeof Notification === 'undefined') return
    void Notification.requestPermission()
  }

  function dismissNotifyPrompt() {
    localStorage.setItem(NOTIFY_DISMISSED_KEY, '1')
    setNotifyPrompt(false)
  }

  function openNotice(notice: Notice) {
    dismissNotice(notice.id)
    followTarget(notice.target)
  }

  function openChat(nextPeer: string | null, nextGroup: string | null, messageId?: string) {
    setPeerId(nextPeer)
    setGroupId(nextGroup)
    setThreadDraft('')
    setShowRequests(false)
    setSafetyPeer(null)
    if (!nextPeer && !nextGroup) {
      setThreadId(null)
      setThreadView('inline')
      setSpotlightId(null)
      stickToBottom.current = true
      return
    }
    const current = vaultRef.current
    const messages = current?.messages ?? []
    const seen = seenSet(current)
    const incoming = messages.filter((message) => inConversation(message, nextPeer, nextGroup) && isUnseen(message, seen))
    const target = messageId ? messages.find((message) => message.id === messageId) : incoming[incoming.length - 1]
    const root = target?.replyTo ? messages.find((message) => message.id === target.replyTo) : undefined
    if (target && root && inConversation(root, nextPeer, nextGroup)) {
      setThreadId(root.id)
      setThreadView('full')
      setSpotlightId(target.id)
      scrollSpotlight.current = true
      stickToBottom.current = false
      return
    }
    setThreadId(null)
    setThreadView('inline')
    setSpotlightId(target?.id ?? null)
    scrollSpotlight.current = Boolean(target)
    stickToBottom.current = !target
  }

  async function sendRequest(event: React.FormEvent) {
    event.preventDefault()
    const engine = engineRef.current
    if (!engine) return
    setError('')
    try {
      await engine.requestFriend(search, note || undefined)
      if (!currentEngine(engine)) return
      setNote('')
      setSearch('')
      await refreshRequests()
    } catch (reason) {
      if (currentEngine(engine)) setError((reason as Error).message)
    }
  }

  async function respond(id: string, action: 'accept' | 'decline' | 'cancel') {
    const engine = engineRef.current
    if (!engine) return
    try {
      await engine.respondRequest(id, action)
      if (!currentEngine(engine)) return
      applyEngine(engine)
      await refreshRequests()
    } catch (reason) { if (currentEngine(engine)) setError((reason as Error).message) }
  }

  async function block(blockedHandle: string) {
    const engine = engineRef.current
    if (!engine) return
    try {
      await engine.block(blockedHandle)
      if (!currentEngine(engine)) return
      applyEngine(engine)
      await refreshRequests()
    } catch (reason) { if (currentEngine(engine)) setError((reason as Error).message) }
  }

  async function stageFiles(list: File[]) {
    const accepted: File[] = []
    for (const file of list) {
      if (fileTooLarge(file.size)) {
        setError('Files must be 25MB or smaller')
        continue
      }
      accepted.push(file)
    }
    if (accepted.length) setPendingFiles((current) => [...current, ...accepted])
  }

  function openThread(id: string, view: 'inline' | 'full') {
    setThreadId(id)
    setThreadView(view)
  }

  async function sendCurrent(event: React.FormEvent, parentId?: string) {
    event.preventDefault()
    const engine = engineRef.current
    const text = parentId ? threadDraft : draft
    const files = parentId ? [] : pendingFiles
    if (!engine || (!text.trim() && files.length === 0)) return
    setError('')
    const expiresInSeconds = ttl === '0' ? undefined : Number(ttl)
    const operationKey = JSON.stringify([peerId,groupId,parentId,text,ttl,files.map(file => {
      let id = fileIdentities.current.get(file)
      if (!id) { id = crypto.randomUUID(); fileIdentities.current.set(file,id) }
      return id
    })])
    const operationId = sendOperations.current.get(operationKey) ?? crypto.randomUUID()
    sendOperations.current.set(operationKey,operationId)
    try {
      if (files.length) {
        const prepared = await Promise.all(
          files.map(async (file) => ({
            name: file.name,
            mime: file.type || 'application/octet-stream',
            bytes: new Uint8Array(await file.arrayBuffer()),
          }))
        )
        if (!currentEngine(engine)) return
        if (groupId) await engine.sendAttachments({ groupId, body: text.trim(), replyTo: parentId, expiresInSeconds, files: prepared },operationId)
        else {
          const friend = friends.find((item) => item.id === peerId)
          if (!friend) return
          await engine.sendAttachments({ handle: friend.handle, body: text.trim(), replyTo: parentId, expiresInSeconds, files: prepared },operationId)
        }
      } else if (groupId) {
        await engine.sendGroup({ groupId, body: text.trim(), replyTo: parentId, expiresInSeconds },operationId)
      } else {
        const friend = friends.find((item) => item.id === peerId)
        if (!friend) return
        await engine.send({ handle: friend.handle, body: text.trim(), replyTo: parentId, expiresInSeconds },operationId)
      }
      if (!currentEngine(engine)) return
      applyEngine(engine)
      sendOperations.current.delete(operationKey)
      if (parentId) setThreadDraft('')
      else {
        setDraft('')
        setPendingFiles([])
      }
    } catch (reason) {
      if (!currentEngine(engine)) return
      applyEngine(engine)
      setError((reason as Error).message)
    }
  }

  async function createGroup(event: React.FormEvent) {
    event.preventDefault()
    const engine = engineRef.current
    if (!engine || !groupName || picked.length === 0) return
    setError('')
    try {
      const handles = picked
        .map((id) => friends.find((friend) => friend.id === id)?.handle)
        .filter((value): value is string => Boolean(value))
      const group = await engine.createGroup(groupName, handles)
      if (!currentEngine(engine)) return
      setGroupName('')
      setPicked([])
      setShowNewGroup(false)
      applyEngine(engine)
      openChat(null, group.id)
    } catch (reason) {
      if (currentEngine(engine)) setError((reason as Error).message)
    }
  }

  async function addMember(event: React.FormEvent) {
    event.preventDefault()
    const engine = engineRef.current
    if (!engine || !groupId || !addMemberId) return
    setError('')
    try {
      await engine.addMember(groupId, addMemberId)
      if (!currentEngine(engine)) return
      setAddMemberId('')
      applyEngine(engine)
    } catch (reason) {
      if (currentEngine(engine)) setError((reason as Error).message)
    }
  }

  async function removeMember(memberId: string) {
    const engine = engineRef.current
    if (!engine || !groupId) return
    setError('')
    try {
      await engine.removeMember(groupId, memberId)
      if (!currentEngine(engine)) return
      applyEngine(engine)
    } catch (reason) {
      if (currentEngine(engine)) setError((reason as Error).message)
    }
  }

  async function leaveGroup() {
    const engine = engineRef.current
    if (!engine || !groupId) return
    setError('')
    try {
      await engine.leaveGroup(groupId)
      if (!currentEngine(engine)) return
      applyEngine(engine)
      openChat(null, null)
    } catch (reason) {
      if (currentEngine(engine)) setError((reason as Error).message)
    }
  }

  async function unfriend() {
    const engine = engineRef.current
    const friend = friends.find((item) => item.id === peerId)
    if (!engine || !friend) return
    setError('')
    try {
      await engine.unfriend(friend.handle)
      if (!currentEngine(engine)) return
      applyEngine(engine)
      openChat(null, null)
    } catch (reason) {
      if (currentEngine(engine)) setError((reason as Error).message)
    }
  }

  async function showSafety(friend: Friend) {
    const engine = engineRef.current
    if (!engine) return
    try {
      const result = await engine.safetyNumber(friend.handle)
      if (!currentEngine(engine)) return
      setSafetyPeer(friend.id)
      setSafetyNumber(result.safetyNumber)
    } catch (reason) {
      if (currentEngine(engine)) setError((reason as Error).message)
    }
  }

  async function confirmTrust() {
    const engine = engineRef.current
    if (!engine || !trust) return
    try {
      await engine.trustIdentity()
      if (!currentEngine(engine)) return
      setTrust(null)
      applyEngine(engine)
    } catch (reason) { if (currentEngine(engine)) setError((reason as Error).message) }
  }

  async function markVerified() {
    const engine = engineRef.current
    const friend = friends.find((item) => item.id === safetyPeer)
    if (!engine || !friend) return
    try { await engine.markVerified(friend.handle); applyEngine(engine) }
    catch (reason) { if (currentEngine(engine)) setError((reason as Error).message) }
  }

  async function retryPending() {
    const engine = engineRef.current
    if (!engine) return
    setError('')
    try { await engine.retryPending(); applyEngine(engine) }
    catch (reason) { if (currentEngine(engine)) { applyEngine(engine); setError((reason as Error).message) } }
  }

  const activeGroup = groupId ? vault?.groups[groupId] : undefined
  const inChat = (message: ChatMessage) => {
    if (message.expiresAt && Date.parse(message.expiresAt) <= Date.now()) return false
    if (groupId) return message.groupId === groupId
    if (peerId) return message.peerId === peerId && !message.groupId
    return false
  }
  const visibleIds = new Set((vault?.messages ?? []).filter(inChat).map((message) => message.id))
  const conversation = (vault?.messages ?? []).filter((message) => {
    if (!inChat(message)) return false
    if (!message.replyTo) return true
    return !visibleIds.has(message.replyTo)
  })
  const threadRoot = threadId ? (vault?.messages ?? []).find((message) => message.id === threadId) : undefined
  const threadReplies = (vault?.messages ?? []).filter((message) => message.replyTo === threadId && inChat(message))
  const threadOpen = Boolean(threadId && threadRoot)
  const threadFull = threadOpen && threadView === 'full'
  const serverSample = [...(vault?.messages ?? [])].reverse().find((message) => inChat(message) && message.envelopeCiphertext)
  const incomingRequests = requests.filter((request) => request.direction === 'incoming')

  async function handleLive(event: LiveEvent) {
    const mine = Boolean(event.actorId && event.actorId === session?.account.id)
    if (event.type === 'friend-request') {
      if (!mine) presentNotice(`Friend request from ${event.fromHandle || 'someone'}`, { kind: 'request' })
      await refresh()
      return
    }
    if (event.type === 'friend-accept') {
      if (!mine) {
        presentNotice(`${event.handle || 'Someone'} accepted your request`, {
          kind: 'chat',
          peerId: event.peerId ?? null,
          groupId: null,
        })
      }
      const result = await refresh()
      if (result?.messages.length) announceMessages(result.messages)
      return
    }
    if (
      event.type === 'friend-decline' ||
      event.type === 'friend-cancel' ||
      event.type === 'friend-block' ||
      event.type === 'friend-remove' ||
      event.type === 'sync'
    ) {
      const announce = event.type === 'sync' && liveReady.current
      const result = await refresh()
      if (announce && result?.messages.length) announceMessages(result.messages)
      return
    }
    const result = await refresh()
    if (result?.messages.length) announceMessages(result.messages)
  }

  liveRef.current = handleLive

  const seen = seenSet(vault)
  const scopeUnseen = (vault?.messages ?? []).filter((message) => {
    if (!inChat(message) || !isUnseen(message, seen)) return false
    if (!threadFull || !threadId) return true
    return message.id === threadId || message.replyTo === threadId
  })
  function replyUnseenCount(parentId: string) {
    return (vault?.messages ?? []).filter((message) => message.replyTo === parentId && inChat(message) && isUnseen(message, seen)).length
  }
  function onTranscriptScroll(event: React.UIEvent<HTMLDivElement>) {
    const el = event.currentTarget
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 64
    stickToBottom.current = near
    setAtBottom(near)
  }
  function jumpToFirstUnseen() {
    const target = scopeUnseen[0]
    if (!target) return
    stickToBottom.current = false
    scrollSpotlight.current = true
    if (target.replyTo && !(threadFull && threadId === target.replyTo)) {
      const rootExists = (vault?.messages ?? []).some((message) => message.id === target.replyTo)
      if (rootExists) {
        setThreadId(target.replyTo)
        setThreadView(threadFull ? 'full' : 'inline')
      }
    }
    setSpotlightId(target.id)
  }
  function jumpToBottom() {
    scrollSpotlight.current = false
    stickToBottom.current = true
    bottomRef.current?.scrollIntoView({ block: 'end' })
    setAtBottom(true)
  }
  const jumps = <JumpBar unseen={scopeUnseen.length} atBottom={atBottom} onFirst={jumpToFirstUnseen} onBottom={jumpToBottom} />

  const conversations = [
    ...friends.map((friend) => {
      const last = [...(vault?.messages ?? [])].reverse().find((message) => message.peerId === friend.id && !message.groupId)
      return {
        key: friend.id,
        title: friend.handle,
        preview: last ? previewText(last) : 'No messages yet',
        at: last?.at ?? '',
        peerId: friend.id,
        groupId: null as string | null,
        unseen: unseenCount(vault?.messages ?? [], friend.id, null, seen),
      }
    }),
    ...groups.map((group) => {
      const name = vault?.groups[group.id]?.name ?? 'Group'
      const last = [...(vault?.messages ?? [])].reverse().find((message) => message.groupId === group.id)
      return {
        key: group.id,
        title: name,
        preview: last ? previewText(last) : 'No messages yet',
        at: last?.at ?? '',
        peerId: null as string | null,
        groupId: group.id,
        unseen: unseenCount(vault?.messages ?? [], null, group.id, seen),
      }
    }),
  ].sort((left, right) => (right.at || '').localeCompare(left.at || ''))

  function chooseAppearance(next: Appearance) {
    setAppearance(next)
    writeAppearance(next)
  }

  if (!session) {
    if (!config) return <main className="auth"><h1>EndToEnd</h1><p role="status">{error || 'Loading messaging configuration…'}</p></main>
    if (config.host) return (
      <form className="auth" onSubmit={signInWithHost}>
        <h1>EndToEnd</h1>
        <AppearanceBar value={appearance} onChange={chooseAppearance} />
        <p>Use your signed-in host account to connect messaging. Unlock your device only in the messaging agent window.</p>
        <button type="submit">Continue with host account</button>
        {status ? <p role="status">{status}</p> : null}
        {error ? <p className="error">{error}</p> : null}
      </form>
    )
    return (
      <form className="auth" onSubmit={step === 'handle' ? submitHandle : submitAuth}>
        <h1>EndToEnd</h1>
        <AppearanceBar value={appearance} onChange={chooseAppearance} />
        <StayControl value={stay} onChange={chooseStay} />
        {step === 'register' ? (
          <>
            <p>Private messages stay on the devices in the chat. Create an account, then request friends.</p>
            <p>Keys are generated on this device. A password cannot restore them on another browser.</p>
          </>
        ) : null}
        {step === 'login' ? (
          <>
            <p>This handle already has an account.</p>
            <p>A password cannot restore keys on another browser.</p>
          </>
        ) : null}
        {step === 'handle' ? <p>Enter a handle. If it is new, you will create the account next.</p> : null}
        {step === 'handle' ? (
          <label>
            Handle
            <input value={handle} onChange={(event) => setHandle(event.target.value)} autoComplete="username" autoFocus />
          </label>
        ) : (
          <p>Handle <strong>{handle}</strong></p>
        )}
        {step === 'handle' ? null : (
          <label>
            Password
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete={step === 'login' ? 'current-password' : 'new-password'}
              autoFocus
            />
          </label>
        )}
        <button type="submit">{step === 'handle' ? 'Continue' : step === 'register' ? 'Create account' : 'Log in'}</button>
        {step === 'handle' ? null : (
          <button type="button" className="quiet" onClick={changeHandle}>Change handle</button>
        )}
        {error ? <p className="error">{error}</p> : null}
      </form>
    )
  }

  if (devicePhase !== 'open') {
    return (
      <form className="auth" onSubmit={connectAgent}>
        <h1>EndToEnd</h1>
        <AppearanceBar value={appearance} onChange={chooseAppearance} />
        <StayControl value={stay} onChange={chooseStay} />
        <p>Connect your messaging agent, then unlock in its window. Keep that window open while chatting.</p>
        <button type="submit">Connect messaging agent</button>
        <button type="button" className="quiet" onClick={logout}>Log out</button>
        {status ? <p role="status">{status}</p> : null}
        {error ? <p className="error">{error}</p> : null}
      </form>
    )
  }

  const chatTitle = activeGroup?.name ?? friends.find((friend) => friend.id === peerId)?.handle
  const shownIdentity = peerId ? friends.find((friend) => friend.id === peerId)?.identityKey || vault?.peers[peerId]?.identityKey : null
  const verified = Boolean(shownIdentity && peerId && vault?.peers[peerId]?.verifiedIdentityKey === shownIdentity)

  return (
    <div className={`app${peerId || groupId ? ' chat-open' : ''}`}>
      <div className="notices" aria-live="polite">
        {notices.map((notice) => (
          <div className="notice" key={notice.id} role="status">
            <p>{notice.title}</p>
            {notice.detail ? <p>{notice.detail}</p> : null}
            <div className="row">
              <button type="button" onClick={() => openNotice(notice)}>
                {notice.target.kind === 'request' ? 'Open panel' : notice.target.threadId ? 'Open thread' : 'Open chat'}
              </button>
              <button type="button" className="quiet" onClick={() => dismissNotice(notice.id)}>Dismiss</button>
            </div>
          </div>
        ))}
      </div>
      <aside className="side">
        <AppearanceBar value={appearance} onChange={chooseAppearance} />
        <div className="row">
          <strong>{session.account.handle}</strong>
          <button type="button" className="quiet" onClick={logout}>Log out</button>
        </div>
        <StayControl value={stay} onChange={chooseStay} />
        <div className="row">
          <button type="button" className="quiet" onClick={() => window.open(`${location.origin}/app?seat=${crypto.randomUUID()}`, '_blank')}>
            Open another window
          </button>
          <button type="button" className="quiet" onClick={() => setShowRequests((current) => !current)}>
            Requests{incomingRequests.length ? ` (${incomingRequests.length})` : ''}
          </button>
        </div>
        <p>{status || 'Keys stay on this device.'}</p>
        {pendingSends.length ? (
          <section className="panel" aria-label="Pending messages">
            <strong>Pending messages</strong>
            {pendingSends.map(item => <p key={item.operationId}>
              {item.body || item.attachmentNames.join(', ') || 'Message'}{' · '}
              {item.state === 'blocked' ? 'Group membership changed. Review membership and start a new message.' : 'Saved on this device. Ready to retry.'}
            </p>)}
            {pendingSends.some(item => item.state !== 'blocked') ? <button type="button" onClick={() => void retryPending()}>Retry pending messages</button> : null}
          </section>
        ) : null}
        {notifyPrompt ? (
          <div className="notice-prompt">
            <p>Allow notifications for requests and messages.</p>
            <div className="row">
              <button type="button" onClick={() => void allowNotifications()}>Allow</button>
              <button type="button" className="quiet" onClick={dismissNotifyPrompt}>Not now</button>
            </div>
          </div>
        ) : null}
        {showRequests ? (
          <div className="panel">
            <form className="stack" onSubmit={sendRequest}>
              <input aria-label="Handle" placeholder="Handle" value={search} onChange={(event) => setSearch(event.target.value)} />
              <input aria-label="Request note" placeholder="Note (optional)" value={note} onChange={(event) => setNote(event.target.value)} />
              <button type="submit">Send request</button>
            </form>
            {requests.length === 0 ? <p>No pending requests.</p> : null}
            <div className="list">
              {requests.map((request) => (
                <div key={request.id}>
                  <div>{request.direction === 'incoming' ? request.handle : `Waiting for ${request.handle}`}</div>
                  {request.direction === 'incoming' ? (
                    <div className="row">
                      <button type="button" onClick={() => void respond(request.id, 'accept')}>Accept</button>
                      <button type="button" className="quiet" onClick={() => void respond(request.id, 'decline')}>Decline</button>
                      <button type="button" className="quiet" onClick={() => void block(request.handle)}>Block</button>
                    </div>
                  ) : (
                    <button type="button" className="quiet" onClick={() => void respond(request.id, 'cancel')}>Cancel</button>
                  )}
                  {request.note && request.direction === 'incoming' ? <p>{request.note}</p> : null}
                </div>
              ))}
            </div>
          </div>
        ) : null}
        <div className="row">
          <h2>Chats</h2>
          <button type="button" className="quiet" onClick={() => setShowNewGroup((current) => !current)}>New group</button>
        </div>
        {showNewGroup ? (
          <form className="stack" onSubmit={createGroup}>
            <input aria-label="Group name" placeholder="Group name" value={groupName} onChange={(event) => setGroupName(event.target.value)} />
            {friends.length === 0 ? <p>Add a friend before creating a group.</p> : null}
            {friends.map((friend) => (
              <label key={friend.id}>
                <input
                  type="checkbox"
                  checked={picked.includes(friend.id)}
                  onChange={(event) =>
                    setPicked(event.target.checked ? [...picked, friend.id] : picked.filter((id) => id !== friend.id))
                  }
                />
                {friend.handle}
              </label>
            ))}
            <button type="submit">Create group</button>
          </form>
        ) : null}
        {conversations.length === 0 ? <p>No chats yet. Send a friend request to start one.</p> : null}
        <div className="list">
          {conversations.map((item) => (
            <button
              type="button"
              key={item.key}
              className={item.peerId === peerId && item.groupId === groupId ? 'active convo' : 'convo'}
              onClick={() => openChat(item.peerId, item.groupId)}
            >
              <span className="convo-line">
                <span>{item.title}{item.peerId && vault?.peers[item.peerId]?.verifiedIdentityKey && vault.peers[item.peerId]?.verifiedIdentityKey === (friends.find((friend) => friend.id === item.peerId)?.identityKey || vault.peers[item.peerId]?.identityKey) ? ' · verified' : ''}</span>
                <CountBadge count={item.unseen} />
              </span>
              <small>{item.preview}{item.at ? ` · ${shortTime(item.at)}` : ''}</small>
            </button>
          ))}
        </div>
      </aside>
      <main className="main">
        <div className="transcript">
          {error ? <p className="error">{error}</p> : null}
          {trust ? (
            <div className="warning">
              <p>This contact's identity key changed. Sending stays blocked until you trust the new key on this device. Trusting it does not mark the new safety number verified.</p>
              <button type="button" onClick={() => void confirmTrust()}>Trust new identity</button>
            </div>
          ) : null}
          {!peerId && !groupId ? <p className="empty">Choose a chat, or send a friend request.</p> : null}
          {chatTitle ? (
            <div className="row header">
              <button type="button" className="quiet back" onClick={() => openChat(null, null)}>Back</button>
              <h1>{chatTitle}</h1>
              {peerId ? (
                <button type="button" className="chip" onClick={() => void showSafety(friends.find((friend) => friend.id === peerId)!)}>
                  {verified ? 'Encrypted · verified' : 'Encrypted'}
                </button>
              ) : (
                <span className="chip">Encrypted</span>
              )}
              {peerId ? (
                <button type="button" className="quiet" onClick={() => void showSafety(friends.find((friend) => friend.id === peerId)!)}>
                  Safety number
                </button>
              ) : null}
              <button type="button" className="quiet" onClick={() => setShowServer((current) => !current)}>Server view</button>
              {peerId ? <button type="button" className="quiet" onClick={() => void unfriend()}>Unfriend</button> : null}
              {groupId ? <button type="button" className="quiet" onClick={() => void leaveGroup()}>Leave</button> : null}
            </div>
          ) : null}
          {showServer && serverSample ? (
            <div className="warning">
              <p>The server stored this ciphertext. The envelope has no sender column, and a file row has no filename.</p>
              <p className="safety">{serverSample.envelopeCiphertext}</p>
              {serverSample.mediaCiphertext ? <p className="safety">{serverSample.mediaCiphertext}</p> : null}
            </div>
          ) : null}
          {safetyPeer && safetyNumber ? (
            <div className="warning">
              <p>Compare this safety number with {friends.find((friend) => friend.id === safetyPeer)?.handle} on a channel you already trust.</p>
              {trust?.peerId === safetyPeer ? <p>This number is for the replacement identity. It is not verified yet.</p> : null}
              <p className="safety">{safetyNumber}</p>
              <button type="button" onClick={() => void markVerified()}>I verified this number</button>
            </div>
          ) : null}
          {activeGroup ? (
            <div className="panel">
              <div className="list">
                {activeGroup.memberIds
                  .filter((id) => id !== session.account.id)
                  .map((id) => (
                    <div className="row" key={id}>
                      <span>{friends.find((friend) => friend.id === id)?.handle ?? id}</span>
                      <button type="button" className="quiet" onClick={() => void removeMember(id)}>Remove</button>
                    </div>
                  ))}
              </div>
              <form className="row" onSubmit={addMember}>
                <select aria-label="Add member" value={addMemberId} onChange={(event) => setAddMemberId(event.target.value)}>
                  <option value="">Add a friend</option>
                  {friends
                    .filter((friend) => !activeGroup.memberIds.includes(friend.id))
                    .map((friend) => (
                      <option key={friend.id} value={friend.id}>{friend.handle}</option>
                    ))}
                </select>
                <button type="submit">Add</button>
              </form>
            </div>
          ) : null}
          {threadFull && threadRoot ? (
            <ThreadPane
              mode="full"
              root={threadRoot}
              replies={threadReplies}
              draft={threadDraft}
              unseenReplies={replyUnseenCount(threadRoot.id)}
              spotlightId={spotlightId}
              seen={seen}
              scrollRef={scrollRef}
              bottomRef={bottomRef}
              onScroll={onTranscriptScroll}
              jumps={jumps}
              onDraft={setThreadDraft}
              onSend={(event) => void sendCurrent(event, threadRoot.id)}
              onDive={() => openThread(threadRoot.id, 'full')}
              onBack={() => setThreadView('inline')}
              onCollapse={() => {
                setThreadId(null)
                setThreadDraft('')
              }}
            />
          ) : (
            <div className="messages" ref={scrollRef} onScroll={onTranscriptScroll}>
              {conversation.map((message) => {
                const replies = (vault?.messages ?? []).filter((item) => item.replyTo === message.id && inChat(item))
                const expanded = threadId === message.id && threadView === 'inline'
                const replySpotlight = replies.some((item) => item.id === spotlightId)
                return (
                  <div key={message.id} className={message.fromMe ? 'thread-anchor mine' : 'thread-anchor'}>
                    <Bubble
                      message={message}
                      unseen={isUnseen(message, seen)}
                      spotlight={spotlightId === message.id}
                      replyUnseen={replyUnseenCount(message.id)}
                      onReply={() => openThread(message.id, 'inline')}
                    />
                    {expanded ? (
                      <ThreadPane
                        mode="inline"
                        root={message}
                        replies={replies}
                        draft={threadDraft}
                        unseenReplies={replyUnseenCount(message.id)}
                        spotlightId={spotlightId}
                        seen={seen}
                        onDraft={setThreadDraft}
                        onSend={(event) => void sendCurrent(event, message.id)}
                        onDive={() => openThread(message.id, 'full')}
                        onBack={() => setThreadView('inline')}
                        onCollapse={() => {
                          setThreadId(null)
                          setThreadDraft('')
                        }}
                      />
                    ) : replies.length > 0 ? (
                      <button
                        type="button"
                        className={replySpotlight ? 'thread-summary spotlight' : 'thread-summary'}
                        onClick={() => openThread(message.id, 'inline')}
                      >
                        {replies.length === 1 ? '1 reply' : `${replies.length} replies`}
                        <CountBadge count={replyUnseenCount(message.id)} />
                      </button>
                    ) : null}
                  </div>
                )
              })}
              <div ref={bottomRef} />
              {jumps}
            </div>
          )}
          {(peerId || groupId) && !threadFull ? (
            <form className="composer" onSubmit={(event) => void sendCurrent(event)}>
              {pendingFiles.map((file) => (
                <small key={`${file.name}-${file.size}`}>{file.name}</small>
              ))}
              <div className="row">
                <input
                  aria-label="Message"
                  placeholder="Message"
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  onPaste={(event) => {
                    const files = [...event.clipboardData.files]
                    if (!files.length) return
                    event.preventDefault()
                    void stageFiles(files)
                  }}
                />
                <label className="ttl">
                  <span>Disappearing</span>
                  <select aria-label="Disappearing" value={ttl} onChange={(event) => setTtl(event.target.value)}>
                    <option value="0">Off</option>
                    <option value="5">5 seconds</option>
                    <option value="86400">1 day</option>
                  </select>
                </label>
                <label className="quiet file">
                  Attach
                  <input
                    aria-label="Attach"
                    type="file"
                    multiple
                    hidden
                    onChange={(event) => {
                      void stageFiles([...(event.target.files ?? [])])
                      event.target.value = ''
                    }}
                  />
                </label>
                <button type="submit">Send</button>
              </div>
            </form>
          ) : null}
        </div>
      </main>
    </div>
  )
}

function ThreadPane({
  mode,
  root,
  replies,
  draft,
  unseenReplies,
  spotlightId,
  seen,
  scrollRef,
  bottomRef,
  onScroll,
  jumps,
  onDraft,
  onSend,
  onDive,
  onBack,
  onCollapse,
}: {
  mode: 'inline' | 'full'
  root: ChatMessage
  replies: ChatMessage[]
  draft: string
  unseenReplies: number
  spotlightId: string | null
  seen: Set<string>
  scrollRef?: React.RefObject<HTMLDivElement | null>
  bottomRef?: React.RefObject<HTMLDivElement | null>
  onScroll?: (event: React.UIEvent<HTMLDivElement>) => void
  jumps?: React.ReactNode
  onDraft: (value: string) => void
  onSend: (event: React.FormEvent) => void
  onDive: () => void
  onBack: () => void
  onCollapse: () => void
}) {
  return (
    <section className={mode === 'full' ? 'thread-full' : 'thread-block'} aria-label="Thread">
      <div className="row">
        <h2>Thread</h2>
        <CountBadge count={unseenReplies} />
        {mode === 'full' ? (
          <button type="button" className="quiet" onClick={onBack}>Back to chat</button>
        ) : (
          <>
            <button type="button" className="quiet" onClick={onDive}>Open thread</button>
            <button type="button" className="quiet" onClick={onCollapse}>Collapse</button>
          </>
        )}
      </div>
      <div className="thread-replies" ref={mode === 'full' ? scrollRef : undefined} onScroll={mode === 'full' ? onScroll : undefined}>
        {mode === 'full' ? (
          <Bubble
            message={root}
            unseen={isUnseen(root, seen)}
            spotlight={spotlightId === root.id}
            replyUnseen={unseenReplies}
            onReply={() => undefined}
            showReply={false}
          />
        ) : null}
        {root.expiresAt && Date.parse(root.expiresAt) <= Date.now() ? <p>The original message expired. Replies keep its quote.</p> : null}
        {replies.map((message) => (
          <Bubble
            key={message.id}
            message={message}
            unseen={isUnseen(message, seen)}
            spotlight={spotlightId === message.id}
            onReply={() => undefined}
            showReply={false}
          />
        ))}
        {mode === 'full' ? <div ref={bottomRef} /> : null}
        {mode === 'full' ? jumps : null}
      </div>
      <form className="composer thread-composer" onSubmit={onSend}>
        <div className="row">
          <input aria-label="Reply" placeholder="Reply" value={draft} onChange={(event) => onDraft(event.target.value)} autoFocus />
          <button type="submit">Send</button>
        </div>
      </form>
    </section>
  )
}

function Bubble({
  message,
  onReply,
  showReply = true,
  unseen = false,
  spotlight = false,
  replyUnseen = 0,
}: {
  message: ChatMessage
  onReply: () => void
  showReply?: boolean
  unseen?: boolean
  spotlight?: boolean
  replyUnseen?: number
}) {
  const [menu, setMenu] = useState(false)
  const speaker = message.fromMe ? 'You' : message.senderHandle
  const className = ['bubble', message.fromMe ? 'mine' : '', unseen ? 'unseen' : '', spotlight ? 'spotlight' : ''].filter(Boolean).join(' ')
  const actions = !message.system && showReply
  return (
    <div
      id={`msg-${message.id}`}
      data-message-id={message.id}
      className={className}
      onMouseLeave={() => setMenu(false)}
    >
      {actions ? (
        <div className="msg-actions">
          <button type="button" className="msg-action" aria-label="Reply" title="Reply" onClick={onReply}>
            <ReplyArrow />
          </button>
          <button
            type="button"
            className="msg-action"
            aria-label="More actions"
            title="More actions"
            aria-expanded={menu}
            aria-haspopup="menu"
            onClick={() => setMenu((open) => !open)}
          >
            <MoreDots />
          </button>
          {menu ? (
            <div className="msg-menu" role="menu">
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  onReply()
                  setMenu(false)
                }}
              >
                Reply
              </button>
              {message.body ? (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    void navigator.clipboard.writeText(message.body)
                    setMenu(false)
                  }}
                >
                  Copy message
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
      {spotlight ? <small className="flag" style={{ pointerEvents: 'none' }}>New</small> : null}
      {replyUnseen > 0 ? <CountBadge count={replyUnseen} /> : null}
      <div className="msg-copy">
        {message.groupId && speaker ? <strong>{speaker}</strong> : null}
        {message.quote ? <small className="quote">{message.quote}</small> : null}
        {message.body ? <p>{message.body}</p> : null}
        {(message.attachments ?? []).map((attachment) => (
          <AttachmentView key={attachment.mediaId} attachment={attachment} />
        ))}
        <small className="msg-time">
          {shortTime(message.at)}
          {message.fromMe && message.status ? ` · ${message.status}` : ''}
          {unseen ? ' · unseen' : ''}
        </small>
      </div>
    </div>
  )
}

function ReplyArrow() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" d="M6.2 4.2 3.2 7.2l3 3" />
      <path fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" d="M3.6 7.2h5.2a3.2 3.2 0 0 1 3.2 3.2v1.2" />
    </svg>
  )
}

function MoreDots() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <circle cx="3.5" cy="8" r="1.15" fill="currentColor" />
      <circle cx="8" cy="8" r="1.15" fill="currentColor" />
      <circle cx="12.5" cy="8" r="1.15" fill="currentColor" />
    </svg>
  )
}

function StayControl({ value, onChange }: { value: StayChoice; onChange: (next: StayChoice) => void }) {
  return (
    <label className="stay">
      <span>Stay signed in</span>
      <select aria-label="Stay signed in" value={value} onChange={(event) => onChange(event.target.value as StayChoice)}>
        {STAYS.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  )
}

function CountBadge({ count }: { count: number }) {
  if (count <= 0) return null
  const label = count === 1 ? '1 unseen' : `${count} unseen`
  return (
    <span className="badge" aria-label={label}>
      {count > 99 ? '99+' : count}
    </span>
  )
}

function JumpBar({
  unseen,
  atBottom,
  onFirst,
  onBottom,
}: {
  unseen: number
  atBottom: boolean
  onFirst: () => void
  onBottom: () => void
}) {
  if (unseen <= 0 && atBottom) return null
  return (
    <div className="jumps">
      {unseen > 0 ? (
        <button type="button" onClick={onFirst}>
          First unseen
          <CountBadge count={unseen} />
        </button>
      ) : null}
      {atBottom ? null : (
        <button type="button" className="quiet" onClick={onBottom}>Jump to bottom</button>
      )}
    </div>
  )
}

function AttachmentView({ attachment }: { attachment: Attachment }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let objectUrl = ''
    let cancelled = false
    void readAttachment(attachment.mediaId).then((bytes) => {
      if (!bytes || cancelled) return
      objectUrl = URL.createObjectURL(new Blob([Uint8Array.from(bytes).buffer], { type: attachment.mime }))
      setUrl(objectUrl)
    }).catch(() => {})
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [attachment.mediaId, attachment.mime])
  if (!url) return <p>{attachment.name}</p>
  if (attachment.mime.startsWith('image/')) return <img src={url} alt={attachment.name} />
  if (attachment.mime.startsWith('video/')) return <video src={url} controls />
  if (attachment.mime.startsWith('audio/')) return <audio src={url} controls />
  return <a href={url} download={attachment.name}>{attachment.name}</a>
}
