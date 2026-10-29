import { useState } from 'react'
import { connectBrowserAgent } from './browserSession.ts'

export function CryptoCheck() {
  const [result, setResult] = useState('Open the messaging agent to run a synthetic cryptographic check.')
  async function run() {
    setResult('Connecting to the messaging agent…')
    try {
      const agent = await connectBrowserAgent()
      try {
        const checked = await agent.client.call<{ ok: boolean }>('cryptoDiagnostic')
        if (!checked.ok) throw new Error('Agent cryptographic check failed')
        setResult('PASS browser PQXDH round trip')
      } finally { await agent.close(); agent.popup.close() }
    } catch (error) { setResult(`FAIL ${(error as Error).message}`) }
  }
  return <main className="auth"><h1>Crypto check</h1><button onClick={() => void run()}>Run in messaging agent</button><p id="crypto-check-result">{result}</p></main>
}
