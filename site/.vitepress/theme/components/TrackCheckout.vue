<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import QRCode from 'qrcode'
import { NOMS, NanoAddress } from '@openrai/nano-core'
import * as nanocurrency from 'nanocurrency'
import { deriveAddressFromSeed } from '@nanosession/core'
import initRpow, { generate_work, validate_work } from 'nano-rspow-web'

const props = defineProps<{
  track: 'a' | 'b'
  demoServerUrl?: string
}>()

const activeServerUrl = ref(props.demoServerUrl || (import.meta.env.VITE_MAINNET_DEMO_URL as string) || 'http://localhost:3001')

type PaymentStatus = 'pending' | 'polling' | 'verifying' | 'confirmed' | 'failed' | 'expired'

interface LogEntry {
  type: 'req' | 'res' | 'info'
  content: string
}

const NETWORK = 'nano:mainnet'
const ASSET = 'XNO'

const isLoading = ref(true)
const fetchError = ref<string | null>(null)
const qrcodeDataUrl = ref('')
const countdown = ref(0)
const paymentStatus = ref<PaymentStatus>('pending')
const finalBlockHash = ref<string | null>(null)
const serverProvidedContent = ref<string | null>(null)
const globalError = ref<string | null>(null)
const payerAccount = ref('')
const pollError = ref<string | null>(null)
const isPolling = ref(false)
const httpLog = ref<LogEntry[]>([])
const paymentResponse = ref<any>(null)
const currentDeposit = ref<string | null>(null)
const currentIssued = ref<any>(null)
const activeTab = ref<'manual' | 'xnap'>('manual')

// For Track A split test with external funding of temp payer
const currentPayerForFunding = ref<string | null>(null)
const fundingSendHash = ref<string>('')
const GOOD_REP = 'nano_3arg3asgtigae3xckabaaewkx3bzsh7nwz7jkmjos79ihyaxwphhm6qgjps4'

let countdownTimer: number | null = null
let pollingTimer: number | null = null

const paymentUri = computed(() => {
  if (!currentDeposit.value || !currentIssued.value) return ''
  const amount = currentIssued.value.amount
  return `nano:${currentDeposit.value}?amount=${amount}`
})

const trackLabel = computed(() => props.track === 'a' ? 'Track A (nanoTxn)' : 'Track B (nanoSignature)')

onMounted(async () => {
  await ensureSession()
})

async function ensureSession() {
  cleanupTimers()
  paymentStatus.value = 'pending'
  finalBlockHash.value = null
  paymentResponse.value = null
  serverProvidedContent.value = null
  fetchError.value = null
  globalError.value = null
  pollError.value = null
  payerAccount.value = ''
  qrcodeDataUrl.value = ''
  httpLog.value = []
  isLoading.value = true

  try {
    const url = new URL(window.location.href)
    const depositFromUrl = url.searchParams.get('deposit')

    const endpoint = depositFromUrl
      ? `${activeServerUrl.value}/api/demo/track-${props.track}/resume?deposit=${encodeURIComponent(depositFromUrl)}`
      : `${activeServerUrl.value}/api/demo/track-${props.track}/issue`

    httpLog.value.push({ type: 'req', content: `GET ${endpoint}` })

    const res = await fetch(endpoint)
    if (res.status !== 200 && res.status !== 402) {
      throw new Error(`Unexpected server response: ${res.status}`)
    }

    const data = await res.json()

    if (data.paymentRequired) {
      const reqs = data.paymentRequired.accepts?.[0] || data.accepts?.[0]
      currentDeposit.value = reqs.payTo
      currentIssued.value = reqs
    } else if (data.issued) {
      currentDeposit.value = data.deposit
      currentIssued.value = data.issued
    } else {
      throw new Error('Malformed response from demo server')
    }

    const newUrl = new URL(window.location.href)
    newUrl.searchParams.set('deposit', currentDeposit.value!)
    history.replaceState({}, '', newUrl.toString())

    httpLog.value.push({
      type: 'res',
      content: `Track ${props.track} challenge ${data.isResume ? 'resumed' : 'issued'} for ${currentDeposit.value}`
    })

    await generateQRCode()
    startCountdown()
  } catch (error: any) {
    fetchError.value = error.message || 'Could not load payment challenge.'
  } finally {
    isLoading.value = false
  }
}

function cleanupTimers() {
  if (countdownTimer) window.clearInterval(countdownTimer)
  if (pollingTimer) window.clearInterval(pollingTimer)
  countdownTimer = null
  pollingTimer = null
}

function startCountdown() {
  if (!currentIssued.value) return
  const expires = currentIssued.value.expiresAt || (Date.now() + (currentIssued.value.maxTimeoutSeconds || 180) * 1000)
  const diff = Math.floor((new Date(expires).getTime() - Date.now()) / 1000)
  countdown.value = Math.max(diff, 0)
  updateCountdown()
  countdownTimer = window.setInterval(updateCountdown, 1000)
}

function updateCountdown() {
  if (countdown.value <= 0) {
    paymentStatus.value = 'expired'
    cleanupTimers()
    return
  }
  countdown.value -= 1
}

async function generateQRCode() {
  if (!paymentUri.value) return
  qrcodeDataUrl.value = await QRCode.toDataURL(paymentUri.value, { width: 250, margin: 2 })
}

function formatRawAmount(raw: string) {
  if (!raw || raw.length < 25) return '0.000000'
  const padded = raw.padStart(31, '0')
  const whole = padded.slice(0, -30) || '0'
  const fraction = padded.slice(-30).replace(/0+$/, '').padEnd(6, '0')
  return `${whole}.${fraction}`
}

async function startPolling() {
  if (!currentDeposit.value || !payerAccount.value) {
    pollError.value = 'Enter your nano_ address to start polling.'
    return
  }

  pollError.value = null
  paymentStatus.value = 'polling'
  isPolling.value = true
  httpLog.value.push({ type: 'info', content: `(Polling for matching send from ${payerAccount.value} to ${currentDeposit.value})` })

  const tick = async () => {
    if (!currentDeposit.value) return
    try {
      const params = new URLSearchParams({
        payerAccount: payerAccount.value,
        payTo: currentDeposit.value,
        amount: currentIssued.value?.amount || '',
      })

      const res = await fetch(`${activeServerUrl.value}/api/poll-for-demo?${params.toString()}`)
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || 'Polling failed')

      if (body.found && body.sendHash) {
        finalBlockHash.value = body.sendHash
        cleanupTimers()
        await submitProof(body.sendHash)
      }
    } catch (error: any) {
      pollError.value = error.message || 'Polling failed'
      paymentStatus.value = 'failed'
      isPolling.value = false
      cleanupTimers()
    }
  }

  await tick()
  if (paymentStatus.value === 'polling') {
    pollingTimer = window.setInterval(tick, 5000)
  }
}

async function submitProof(blockHash: string) {
  if (!currentDeposit.value || !currentIssued.value) return

  paymentStatus.value = 'verifying'
  finalBlockHash.value = blockHash

  const signaturePayload = {
    x402Version: 2,
    accepted: currentIssued.value,
    payload: {
      blockHash,
      account: payerAccount.value || 'demo-temp-payer',
    },
  }

  const signatureB64 = btoa(JSON.stringify(signaturePayload))
  httpLog.value.push({
    type: 'req',
    content: `Track ${props.track} redeem\nPAYMENT-SIGNATURE (receipt-style): ${JSON.stringify(signaturePayload, null, 2)}`
  })

  try {
    const res = await fetch(`${activeServerUrl.value}/api/demo/track-${props.track}/redeem`, {
      headers: { 'PAYMENT-SIGNATURE': signatureB64 },
    })

    const body = await res.json()
    httpLog.value.push({
      type: 'res',
      content: `HTTP/1.1 ${res.status}\n${JSON.stringify(body, null, 2)}`
    })

    if (!res.ok) {
      paymentStatus.value = 'failed'
      globalError.value = body.error || 'Payment verification failed'
      return
    }

    paymentResponse.value = body
    paymentStatus.value = 'confirmed'
    serverProvidedContent.value = body.html || null
  } catch (error: any) {
    paymentStatus.value = 'failed'
    globalError.value = error.message || 'Verification request failed'
  } finally {
    isPolling.value = false
  }
}

async function restartSession() {
  if (!currentDeposit.value) return

  try {
    await fetch(`${activeServerUrl.value}/api/demo/track-${props.track}/restart`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deposit: currentDeposit.value }),
    })
  } catch {}

  const url = new URL(window.location.href)
  url.searchParams.delete('deposit')
  history.replaceState({}, '', url.toString())

  currentDeposit.value = null
  currentIssued.value = null
  paymentStatus.value = 'pending'
  finalBlockHash.value = null
  serverProvidedContent.value = null
  globalError.value = null

  await ensureSession()
}

// ================== Real client-side ephemeral payer + canonical NOMS ==================
const DEMO_SEED_LS_PREFIX = 'nanosession-demo-seed:'

interface DemoPayer { seed: string; address: string; secretKeyHex: string; }

const demoPayerReal = ref<DemoPayer | null>(null)

function h(bytes: Uint8Array) { return Array.from(bytes).map(b => b.toString(16).padStart(2,'0')).join(''); }

function loadCreatePayer(dep: string): DemoPayer {
  if (typeof window === 'undefined') return { seed: '0'.repeat(64), address: 'nano_1demo1payer1demo1only', secretKeyHex: '0'.repeat(64) }
  const k = DEMO_SEED_LS_PREFIX + dep
  const ex = localStorage.getItem(k)
  if (ex) {
    const sd = ex
    const sk = nanocurrency.deriveSecretKey(sd, 0)
    const pk = nanocurrency.derivePublicKey(sk)
    const ad = nanocurrency.deriveAddress(pk, { useNanoPrefix: true })
    return { seed: sd, address: ad, secretKeyHex: sk }
  }
  const sb = crypto.getRandomValues(new Uint8Array(32))
  const sd = h(sb)
  const sk = nanocurrency.deriveSecretKey(sd, 0)
  const pk = nanocurrency.derivePublicKey(sk)
  const ad = nanocurrency.deriveAddress(pk, { useNanoPrefix: true })
  const p = { seed: sd, address: ad, secretKeyHex: sk }
  localStorage.setItem(k, sd)
  return p
}

function getDemoPayer() {
  if (!currentDeposit.value) return null
  if (!demoPayerReal.value) demoPayerReal.value = loadCreatePayer(currentDeposit.value)
  return demoPayerReal.value
}

// nano-rspow-web for client-side PoW (exclusively, no more RPC work_generate for real flows)
let rpowReady = false
async function ensureRpow() {
  if (!rpowReady) {
    await initRpow()
    rpowReady = true
  }
}
async function generatePow(wh: string, isReceive: boolean): Promise<string> {
  await ensureRpow()
  const threshold = isReceive ? 'fffffe0000000000' : 'fffffff800000000'
  const res = await generate_work(wh, threshold)
  // Optionally: await validate_work(wh, res.nonce, threshold)
  return res.nonce
}

async function doRealTempKeyFlow() {
  if (!currentDeposit.value || !currentIssued.value) return
  const p = getDemoPayer()
  if (!p) return

  paymentStatus.value = 'polling'
  httpLog.value.push({ type: 'info', content: `Demo client: ephemeral payer ${p.address} (seed persisted in LS for this deposit)` })

  const base = `${activeServerUrl.value}/api/demo/track-${props.track}/demo-rpc`
  const payerPubkeyHex = nanocurrency.derivePublicKey(p.secretKeyHex)

  try {
    const infRes = await fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'account_info', account: p.address }) })
    const inf = await infRes.json()

    const prev = inf.frontier || '0'.repeat(64)
    const r = inf.representative || GOOD_REP
    const b = inf.balance || '0'
    const amt = currentIssued.value.amount
    const nb = (BigInt(b) - BigInt(amt)).toString()

    const wh = prev === '0'.repeat(64) ? payerPubkeyHex : prev

    // Exclusively use nano-rspow-web for client PoW (local)
    const w = await generatePow(wh, prev === '0'.repeat(64)) // receive/open if first, else send

    const payToPubkey = NanoAddress.parse(currentDeposit.value).publicKey
    const blk: any = {
      type: 'state',
      account: p.address,
      previous: prev,
      representative: r,
      balance: nb,
      link: payToPubkey,           // correct: 32-byte pubkey of destination
      link_as_account: currentDeposit.value,
      work: w,
    }

    const bh = nanocurrency.hashBlock(blk)
    blk.signature = nanocurrency.signBlock({ hash: bh, secretKey: p.secretKeyHex })

    // For Track A, do NOT process here -- submit the signed block to the facilitator (redeem) so the Facilitator can submit/broadcast it
    httpLog.value.push({ type: 'info', content: `Track A: built and signed real state block (hash=${bh}). Submitting to facilitator for broadcast and settlement confirmation.` })

    // Build the payload with the full block (per Rev 8 Track A spec)
    const pl = {
      x402Version: 2,
      accepted: currentIssued.value,
      payload: {
        block: blk,
      },
    }

    httpLog.value.push({ type: 'req', content: `Submitting REAL Track A signed block payload to redeem (Facilitator will process):\n${JSON.stringify(pl, null, 2)}` })

    const b64p = btoa(JSON.stringify(pl))
    const redRes = await fetch(`${activeServerUrl.value}/api/demo/track-a/redeem`, {
      headers: { 'PAYMENT-SIGNATURE': b64p },
    })
    const rb = await redRes.json()
    httpLog.value.push({ type: 'res', content: `Facilitator response: ${JSON.stringify(rb)}` })

    if (redRes.ok) {
      finalBlockHash.value = rb.result?.blockHash || bh
      paymentStatus.value = 'confirmed'
      serverProvidedContent.value = rb.html || null
      httpLog.value.push({ type: 'info', content: `Track A: Facilitator submitted the block and reported it settled (confirmed per block lattice).` })
    } else {
      paymentStatus.value = 'failed'
      globalError.value = rb.error || 'redeem failed'
    }

    return; // done for track a (Facilitator did process + confirmation poll)
  } catch (e: any) {
    paymentStatus.value = 'failed'
    globalError.value = 'Real demo client flow error: ' + (e.message || e)
  }
}

function buildAndLogReal(plh: string) {
  const p = getDemoPayer()
  if (!p || !currentIssued.value) {
    httpLog.value.push({ type: 'info', content: 'Click the demo client button to generate a real temp key and see actual signed payloads.' })
    return
  }
  if (props.track === 'b') {
    const n = currentIssued.value.extra?.nonce || '0'.repeat(64)
    const v = currentIssued.value.extra?.validBefore || Math.floor(Date.now() / 1000) + 120
    const m = `${plh}:${n}:${v}`
    const s = NOMS.signMessage(m, p.secretKeyHex)
    const pl = { x402Version: 2, accepted: currentIssued.value, payload: { blockHash: plh, account: p.address, signature: s } }
    httpLog.value.push({ type: 'info', content: `Track B - REAL NOMS-compliant payload (using browser temp key):\n${JSON.stringify(pl, null, 2)}` })
  } else {
    httpLog.value.push({ type: 'info', content: 'Track A real signed block construction + signing is exercised in the live "demo client" flow.' })
  }
}

function logRealPayloadHint() {
  getDemoPayer()
  buildAndLogReal('a'.repeat(64))
}

async function triggerRealDemoClientFlow() {
  await doRealTempKeyFlow()
}

// ===== Track A split flow for real test with funding from external wallet (e.g. dusty) =====
async function generatePayerOnly() {
  if (!currentDeposit.value) {
    await ensureSession()
  }
  const p = getDemoPayer()
  if (p) {
    currentPayerForFunding.value = p.address
    fundingSendHash.value = ''
    httpLog.value.push({ type: 'info', content: `Track A: Generated temp payer for this deposit: ${p.address} (private key in LocalStorage). Fund this address from an external wallet (e.g. dusty), then click button 2.` })
    // Make it visible in the UI via the ref
  }
}

async function submitSignedBlockAfterFunding() {
  if (!currentDeposit.value || !currentIssued.value || !currentPayerForFunding.value) {
    globalError.value = 'Generate payer first and fund it.'
    return
  }
  const p = getDemoPayer()
  if (!p) return

  paymentStatus.value = 'verifying'
  httpLog.value.push({ type: 'info', content: `Track A: Starting real payer flow for ${p.address} (external funding path).` })

  const base = `${activeServerUrl.value}/api/demo/track-a/demo-rpc`
  const payerPubkeyHex = nanocurrency.derivePublicKey(p.secretKeyHex)
  const amt = currentIssued.value.amount

  try {
    // 1. Query current on-chain state for the temp payer (may be "Account not found" if unfunded/unopened)
    const infRes = await fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'account_info', account: p.address }) })
    const inf = await infRes.json()
    let prev = (inf && inf.frontier) || '0'.repeat(64)
    let r = (inf && inf.representative) || GOOD_REP
    let b = (inf && inf.balance) || '0'
    if (inf && inf.error && String(inf.error).toLowerCase().includes('not found')) {
      prev = '0'.repeat(64)
      b = '0'
      r = GOOD_REP
    }

    httpLog.value.push({ type: 'info', content: `Track A: account_info -> prev=${prev.slice(0,8)}... bal=${b} rep=${r.slice(0,12)}...` })

    // 2. If funding send hash provided, perform receive/open first (pocket the external funds onto this payer's chain)
    const fHash = (fundingSendHash.value || '').trim()
    let currentPrev = prev
    let currentBal = b
    if (fHash && fHash.length === 64) {
      httpLog.value.push({ type: 'info', content: `Track A: Funding hash provided (${fHash.slice(0,10)}...). Building + processing RECEIVE block to pocket funds (lattice step: receive before spend).` })

      const recvPrev = currentPrev
      const recvBal = (BigInt(currentBal || '0') + BigInt(amt)).toString()
      const recvWh = (recvPrev === '0'.repeat(64)) ? payerPubkeyHex : recvPrev

      // Exclusively use nano-rspow-web for client PoW (local, fast, no external RPC dependency for work)
      const wRecv = await generatePow(recvWh, true /* receive/open */)

      const recvBlk: any = {
        type: 'state',
        account: p.address,
        previous: recvPrev,
        representative: r,
        balance: recvBal,
        link: fHash,  // the funding *send* block hash
        work: wRecv,
      }
      const recvHash = nanocurrency.hashBlock(recvBlk)
      recvBlk.signature = nanocurrency.signBlock({ hash: recvHash, secretKey: p.secretKeyHex })

      httpLog.value.push({ type: 'info', content: `Track A: receive block built (hash=${recvHash}). Submitting process via /demo-rpc...` })

      const procRecvRes = await fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'process', block: recvBlk }) })
      const procRecv = await procRecvRes.json()
      if (procRecv && procRecv.error) {
        throw new Error('Receive process failed: ' + procRecv.error)
      }
      const newFrontier = (procRecv && procRecv.hash) || recvHash
      httpLog.value.push({ type: 'info', content: `Track A: RECEIVE processed successfully. New frontier=${newFrontier.slice(0,10)}... bal now ~${recvBal}. Ready to send payment.` })

      currentPrev = newFrontier
      currentBal = recvBal
      // carry rep
      r = recvBlk.representative
    } else {
      httpLog.value.push({ type: 'info', content: `Track A: No funding hash provided (or already pocketed). Proceeding with current on-chain state for payment send.` })
    }

    // 3. Build the *payment* send block (Track A: client pre-signs full state block; Facilitator will submit)
    const payPrev = currentPrev
    const payBal = (BigInt(currentBal || '0') - BigInt(amt)).toString()
    if (BigInt(payBal) < 0) {
      throw new Error('Payer balance after receive is still insufficient for the exact payment amount (did the send amount match the invoice exactly?)')
    }

    const payWh = (payPrev === '0'.repeat(64)) ? payerPubkeyHex : payPrev

    // Exclusively use nano-rspow-web for client PoW
    const w = await generatePow(payWh, false /* send */)

    const payToPubkey = NanoAddress.parse(currentDeposit.value).publicKey
    const blk: any = {
      type: 'state',
      account: p.address,
      previous: payPrev,
      representative: r,
      balance: payBal,
      link: payToPubkey,           // per spec: 32B pubkey for the destination in Track A nanoTxn
      link_as_account: currentDeposit.value,
      work: w,
    }

    const bh = nanocurrency.hashBlock(blk)
    blk.signature = nanocurrency.signBlock({ hash: bh, secretKey: p.secretKeyHex })

    httpLog.value.push({ type: 'info', content: `Track A: Built and signed PAYMENT send block (hash=${bh}). Submitting full block to Facilitator /redeem so it can process + poll confirmed per lattice.` })

    const pl = {
      x402Version: 2,
      accepted: currentIssued.value,
      payload: { block: blk },
    }

    httpLog.value.push({ type: 'req', content: `REAL Track A payload (Facilitator submits this):\n${JSON.stringify(pl, null, 2)}` })

    const b64p = btoa(JSON.stringify(pl))
    const redRes = await fetch(`${activeServerUrl.value}/api/demo/track-a/redeem`, { headers: { 'PAYMENT-SIGNATURE': b64p } })
    const rb = await redRes.json()
    httpLog.value.push({ type: 'res', content: `Facilitator response (after its process + settle poll): ${JSON.stringify(rb)}` })

    if (redRes.ok) {
      finalBlockHash.value = (rb && rb.result && rb.result.blockHash) || bh
      paymentStatus.value = 'confirmed'
      serverProvidedContent.value = (rb && rb.html) || null
      httpLog.value.push({ type: 'info', content: `Track A: SUCCESS. Facilitator submitted the block and reported it settled (confirmed=true per Nano block lattice definition).` })
    } else {
      paymentStatus.value = 'failed'
      globalError.value = (rb && rb.error) || 'redeem failed'
    }
  } catch (e: any) {
    paymentStatus.value = 'failed'
    globalError.value = 'Submit after funding error: ' + (e.message || e)
    httpLog.value.push({ type: 'info', content: `Track A ERROR: ${e.message || e}` })
  }
}
</script>

<template>
  <div class="track-checkout">
    <div v-if="paymentStatus === 'confirmed'" class="success-container">
      <div class="success-banner"><h2>Payment successful! (Track {{ track.toUpperCase() }})</h2></div>
      <div data-testid="protected-content">
        <slot></slot>
        <div v-if="serverProvidedContent" v-html="serverProvidedContent" class="server-content"></div>
      </div>
      <div class="block-info">Block: {{ finalBlockHash }}</div>
    </div>

    <div v-else class="paywall-container" data-testid="payment-required">
      <div class="paywall-header">
        <h3>{{ trackLabel }} — Payment Required</h3>
        <p>Stable per-invoice deposit. Reload-safe until you click Restart. Real client signing (temp key in LocalStorage + canonical NOMS) available via the demo client button.</p>
      </div>

      <div v-if="isLoading" class="loading-state">
        <div class="spinner"></div>
        <p>Preparing {{ trackLabel }} checkout...</p>
      </div>

      <div v-else-if="fetchError" class="error-state">
        <p>{{ fetchError }}</p>
        <button @click="ensureSession" class="retry-btn">Retry</button>
      </div>

      <div v-else-if="globalError" class="error-state">
        <p>{{ globalError }}</p>
        <button @click="ensureSession" class="retry-btn">Restart checkout</button>
      </div>

      <div v-else-if="paymentStatus === 'expired'" class="expired-state">
        <p>Challenge expired. Start a new one.</p>
        <button @click="ensureSession" class="retry-btn">New challenge</button>
      </div>

      <div v-else-if="currentDeposit && currentIssued" class="payment-active">
        <div class="common-info">
          <p class="payment-amount">
            Send exactly <strong data-testid="payment-amount-raw" :data-raw="currentIssued.amount">{{ formatRawAmount(currentIssued.amount) }} XNO</strong> to:
          </p>
          <div class="address-pane" data-testid="payment-address">{{ currentDeposit }}</div>
          <div class="session-timer">Expires in: <span class="mono">{{ Math.floor(countdown / 60) }}:{{ (countdown % 60).toString().padStart(2, '0') }}</span></div>
        </div>

        <div class="tabs">
          <button :class="['tab', { active: activeTab === 'manual' }]" @click="activeTab = 'manual'">Manual / QR (any wallet)</button>
          <button :class="['tab', { active: activeTab === 'xnap' }]" @click="activeTab = 'xnap'">MetaMask (Xnap)</button>
        </div>

        <div v-if="activeTab === 'manual'" class="qr-section">
          <div class="qr-wrapper"><img v-if="qrcodeDataUrl" :src="qrcodeDataUrl" alt="Nano Payment QR Code" /></div>
          <a v-if="paymentUri" :href="paymentUri" class="wallet-link">Open in wallet app</a>
          <p class="qr-hint">Pay with any Nano wallet to the address above. Then enter your payer address and poll. Or use the button below for the full real client experience with browser-controlled temp key + real NOMS signatures.</p>
          <input v-model="payerAccount" class="payer-input" data-testid="payer-account-input" placeholder="nano_... your wallet address" />
          <button class="retry-btn" data-testid="start-polling" :disabled="isPolling" @click="startPolling">{{ isPolling ? 'Polling...' : 'Poll for matching send' }}</button>
          <p v-if="pollError" class="poll-error">{{ pollError }}</p>
          <button class="retry-btn" @click="triggerRealDemoClientFlow" :disabled="isPolling || paymentStatus==='verifying'">Pay + prove with demo client (real temp key + signatures)</button>
          <button class="hint-btn" @click="logRealPayloadHint">Show real payload example (NOMS compliant)</button>

          <!-- For Track A real test with external funding of the temp payer (interleave with agent-browser + wallet send) -->
          <div v-if="track === 'a'" style="margin-top: 8px; font-size: 0.8rem;">
            <button class="retry-btn" data-testid="generate-payer-btn" @click="generatePayerOnly" style="background:#16a34a">1. Generate temp payer (logs address for funding)</button>
            <button class="retry-btn" data-testid="submit-after-fund-btn" @click="submitSignedBlockAfterFunding" style="background:#dc2626" :disabled="!currentPayerForFunding">2. After funding the logged payer from external wallet (e.g. dusty), Submit signed block (Facilitator broadcasts + waits for settle)</button>
            <div v-if="currentPayerForFunding" style="color:#16a34a" data-testid="payer-for-funding">Payer ready for funding: {{ currentPayerForFunding }}</div>
            <input v-model="fundingSendHash" data-testid="funding-tx-hash-input" placeholder="Paste funding SEND block hash (64 hex) here after xno-skills send from dusty" class="payer-input" style="margin-top:6px; width:100%; font-size:0.7rem;" />
            <div style="font-size:0.65rem; color:#888;">(After sending exact invoice amount to the payer addr above, paste the *send* tx hash output by the wallet CLI, then click button 2. The UI will first receive/pocket, then build the payment send for the Facilitator.)</div>
          </div>
        </div>

        <div v-else class="xnap-section">
          <p class="xnap-hint">When Xnap is installed this tab can use the snap for real sends and proofs. The button below runs the reliable browser temp-key path (real NOMS + on-chain send via proxy).</p>
          <button class="xnap-btn" @click="triggerRealDemoClientFlow">Use real temp key flow (or Xnap when available)</button>
        </div>

        <div class="global-status">
          <div v-if="paymentStatus === 'pending'" class="waiting-status" data-testid="payment-status" data-status="pending">Waiting for payment to {{ currentDeposit }}</div>
          <div v-else-if="paymentStatus === 'polling'" class="waiting-status" data-testid="payment-status" data-status="polling">Polling for matching send...</div>
          <div v-else-if="paymentStatus === 'verifying'" class="waiting-status" data-testid="payment-status" data-status="verifying">Submitting proof for Track {{ track.toUpperCase() }}...</div>
          <div v-else-if="paymentStatus === 'failed'" class="expired-status" data-testid="payment-status" data-status="failed">Payment verification failed</div>
        </div>
      </div>

      <div v-if="currentDeposit" class="restart-container">
        <button @click="restartSession" class="restart-btn">Restart session (new deposit + challenge)</button>
        <p class="restart-hint">This releases the current per-invoice deposit and starts a completely fresh checkout (real temp key is also reset for the new deposit).</p>
      </div>
    </div>

    <div class="protocol-terminal">
      <div class="terminal-header">
        <span class="dot red"></span>
        <span class="dot yellow"></span>
        <span class="dot green"></span>
        <span class="title">Protocol Log — Track {{ track.toUpperCase() }} (real NOMS where applicable)</span>
      </div>
      <div class="terminal-body">
        <div v-for="(log, i) in httpLog" :key="i" class="log-entry">
          <span v-if="log.type === 'req'" class="req-text">→ Client: {{ log.content }}</span>
          <span v-else-if="log.type === 'res'" class="res-text">← Server: {{ log.content }}</span>
          <span v-else class="info-text">{{ log.content }}</span>
        </div>
        <div v-if="httpLog.length === 0" class="empty-log">Waiting for first request...</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* (keeping the original clean styles from the good version for brevity — same as previous good renders) */
.track-checkout { padding-top: 1rem; padding-bottom: 2rem; }
.paywall-container, .protocol-terminal, .success-container { max-width: 42rem; margin: 0 auto 24px; border-radius: 12px; }
.success-container { background-color: rgba(34, 197, 94, 0.1); padding: 16px; border: 1px solid rgba(34, 197, 94, 0.3); }
.paywall-container { border: 1px solid var(--vp-c-divider); overflow: hidden; background-color: var(--vp-c-bg-soft); }
.paywall-header { background-color: var(--vp-c-bg-alt); border-bottom: 1px solid var(--vp-c-divider); padding: 16px 24px; text-align: center; }
.tabs { display: flex; border-bottom: 1px solid var(--vp-c-divider); }
.tab { flex: 1; padding: 10px; background: transparent; border: none; cursor: pointer; font-weight: 500; }
.tab.active { background: var(--vp-c-bg); border-bottom: 3px solid var(--vp-c-brand-1); }
.loading-state, .error-state, .expired-state { padding: 32px; text-align: center; }
.spinner { display: inline-block; width: 32px; height: 32px; border: 4px solid #3b82f6; border-top-color: transparent; border-radius: 50%; animation: spin 1s linear infinite; margin-bottom: 16px; }
@keyframes spin { to { transform: rotate(360deg); } }
.common-info { padding: 24px; border-bottom: 1px solid var(--vp-c-divider); }
.payment-amount { text-align: center; font-size: 0.875rem; margin-bottom: 16px; }
.address-pane { width: 100%; background-color: var(--vp-c-bg-alt); font-size: 0.75rem; font-family: monospace; padding: 12px; border-radius: 6px; text-align: center; word-break: break-all; margin-bottom: 16px; }
.session-timer { text-align: center; font-size: 0.875rem; color: var(--vp-c-text-3); }
.qr-section, .xnap-section { padding: 24px; display: flex; flex-direction: column; align-items: center; gap: 12px; }
.qr-wrapper { background: white; padding: 8px; border-radius: 8px; }
.qr-wrapper img { width: 192px; height: 192px; display: block; }
.wallet-link { font-size: 0.85rem; color: var(--vp-c-brand); text-decoration: none; }
.qr-hint, .xnap-hint, .poll-error { font-size: 0.8rem; text-align: center; }
.payer-input { width: 100%; max-width: 28rem; padding: 10px 12px; border-radius: 8px; border: 1px solid var(--vp-c-divider); }
.retry-btn, .xnap-btn, .restart-btn { padding: 10px 20px; font-size: 14px; font-weight: 500; background-color: #2563eb; color: white; border: none; border-radius: 6px; cursor: pointer; }
.retry-btn:disabled { opacity: 0.6; cursor: not-allowed; }
.restart-btn { background-color: #dc2626; }
.restart-container { padding: 16px 24px; text-align: center; border-top: 1px solid var(--vp-c-divider); }
.restart-hint { font-size: 0.75rem; color: var(--vp-c-text-3); margin-top: 6px; }
.global-status { padding: 16px; background-color: var(--vp-c-bg-alt); border-top: 1px solid var(--vp-c-divider); text-align: center; }
.waiting-status { color: var(--vp-c-brand); font-weight: 500; }
.expired-status { color: #ef4444; }
.protocol-terminal { border: 1px solid var(--vp-c-divider); overflow: hidden; background-color: #1e1e1e; }
.terminal-header { background-color: #2d2d2d; padding: 8px 12px; display: flex; align-items: center; border-bottom: 1px solid #000; }
.terminal-header .title { color: #888; font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 600; margin-left: auto; margin-right: auto; }
.dot { display: inline-block; width: 10px; height: 10px; border-radius: 50%; margin-right: 6px; }
.dot.red { background-color: #ff5f56; }
.dot.yellow { background-color: #ffbd2e; }
.dot.green { background-color: #27c93f; }
.terminal-body { padding: 12px; max-height: 280px; overflow-y: auto; font-family: monospace; font-size: 11px; line-height: 1.4; }
.log-entry { margin-bottom: 12px; white-space: pre-wrap; word-break: break-all; }
.req-text { color: #56b6c2; }
.res-text { color: #98c379; }
.info-text, .empty-log, .hint-btn { color: #7f848e; font-style: italic; font-size: 0.85rem; }
.hint-btn { background: transparent; border: 1px solid #555; color: #888; padding: 4px 10px; border-radius: 4px; cursor: pointer; }
</style>