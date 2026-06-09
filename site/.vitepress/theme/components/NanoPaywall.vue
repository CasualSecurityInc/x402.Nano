<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import QRCode from 'qrcode'

const props = defineProps({
  demoServerUrl: {
    type: String,
    default: () => import.meta.env.VITE_MAINNET_DEMO_URL || 'http://localhost:3001'
  }
})

type PaymentStatus = 'pending' | 'polling' | 'verifying' | 'confirmed' | 'failed' | 'expired'

interface LogEntry {
  type: 'req' | 'res' | 'info'
  content: string
}

const NETWORK = 'nano:mainnet'
const ASSET = 'XNO'

const activeServerUrl = ref(props.demoServerUrl)
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
const session = ref<null | {
  payTo: string
  amountRaw: string
  challenge: any
  expiresAt: number
}>(null)

let countdownTimer: number | null = null
let pollingTimer: number | null = null

const paymentUri = computed(() => {
  if (!session.value) return ''
  return `nano:${session.value.payTo}?amount=${session.value.amountRaw}`
})

onMounted(async () => {
  await fetchPaymentRequirements()
})

async function fetchPaymentRequirements() {
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
    const targetHost = new URL(activeServerUrl.value).host
    httpLog.value.push({ type: 'req', content: `GET /api/protected\nHost: ${targetHost}\nAccept: application/json` })

    const res = await fetch(`${activeServerUrl.value}/api/protected`)
    if (res.status !== 402) {
      throw new Error(`Unexpected server response: ${res.status}`)
    }

    const paymentRequiredB64 = res.headers.get('payment-required')
    if (!paymentRequiredB64) {
      throw new Error('Missing PAYMENT-REQUIRED header')
    }

    const reqPayload = JSON.parse(atob(paymentRequiredB64.replace(/-/g, '+').replace(/_/g, '/')))
    const reqs = reqPayload.accepts[0]
    session.value = {
      payTo: reqs.payTo,
      amountRaw: reqs.amount,
      challenge: reqs.extra.challenge,
      expiresAt: Date.now() + (reqs.maxTimeoutSeconds * 1000)
    }

    httpLog.value.push({
      type: 'res',
      content: `HTTP/1.1 402 Payment Required\nPAYMENT-REQUIRED: ${JSON.stringify(reqPayload, null, 2)}`
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
  updateCountdown()
  countdownTimer = window.setInterval(updateCountdown, 1000)
}

function updateCountdown() {
  if (!session.value) return
  const diff = Math.floor((session.value.expiresAt - Date.now()) / 1000)
  if (diff <= 0) {
    countdown.value = 0
    paymentStatus.value = 'expired'
    cleanupTimers()
    return
  }
  countdown.value = diff
}

async function generateQRCode() {
  if (!session.value) return
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
  if (!session.value || !payerAccount.value) {
    pollError.value = 'Enter your nano_ address to start polling.'
    return
  }

  pollError.value = null
  paymentStatus.value = 'polling'
  isPolling.value = true
  httpLog.value.push({ type: 'info', content: `(Polling for matching send from ${payerAccount.value} to ${session.value.payTo})` })

  const tick = async () => {
    if (!session.value) return
    try {
      const params = new URLSearchParams({
        payerAccount: payerAccount.value,
        payTo: session.value.payTo,
        amount: session.value.amountRaw,
      })

      const res = await fetch(`${activeServerUrl.value}/api/poll-for-demo?${params.toString()}`)
      const body = await res.json()
      if (!res.ok) {
        throw new Error(body.error || 'Polling failed')
      }

      if (body.found && body.sendHash) {
        finalBlockHash.value = body.sendHash
        cleanupTimers()
        await verifyPayment(body.sendHash)
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

async function verifyPayment(sendHash: string) {
  if (!session.value) return

  paymentStatus.value = 'verifying'
  finalBlockHash.value = sendHash

  const signaturePayload = {
    x402Version: 2,
    accepted: {
      scheme: 'exact',
      network: NETWORK,
      asset: ASSET,
      amount: session.value.amountRaw,
      payTo: session.value.payTo,
      maxTimeoutSeconds: Math.max(countdown.value, 1),
      extra: {
        challenge: session.value.challenge,
      },
    },
    payload: {
      challengeId: session.value.challenge.challengeId,
      sendHash,
      payerAccount: payerAccount.value,
    },
  }

  const signatureB64 = btoa(JSON.stringify(signaturePayload))
  httpLog.value.push({
    type: 'req',
    content: `GET /api/protected\nPAYMENT-SIGNATURE: ${JSON.stringify(signaturePayload, null, 2)}`
  })

  try {
    const res = await fetch(`${activeServerUrl.value}/api/protected`, {
      headers: {
        'PAYMENT-SIGNATURE': signatureB64,
      },
    })

    const body = await res.json()
    httpLog.value.push({
      type: 'res',
      content: `HTTP/1.1 ${res.status}\nPAYMENT-RESPONSE: ${res.headers.get('payment-response') || '(none)'}\n\n${JSON.stringify(body, null, 2)}`
    })

    if (!res.ok) {
      paymentStatus.value = 'failed'
      globalError.value = body.error || 'Payment verification failed'
      return
    }

    const paymentResponseHeader = res.headers.get('payment-response')
    paymentResponse.value = paymentResponseHeader ? JSON.parse(atob(paymentResponseHeader.replace(/-/g, '+').replace(/_/g, '/'))) : null
    paymentStatus.value = 'confirmed'
    serverProvidedContent.value = body.html || null
  } catch (error: any) {
    paymentStatus.value = 'failed'
    globalError.value = error.message || 'Verification request failed'
  } finally {
    isPolling.value = false
  }
}
</script>

<template>
  <div class="nano-paywall">
    <div v-if="paymentStatus === 'confirmed'" class="success-container">
      <div class="success-banner"><h2>Payment successful!</h2></div>
      <div data-testid="protected-content">
        <slot></slot>
        <div v-if="serverProvidedContent" v-html="serverProvidedContent" class="server-content"></div>
      </div>
      <div class="block-info">Block: {{ finalBlockHash }}</div>
    </div>

    <div v-else class="paywall-container" data-testid="payment-required">
      <div class="paywall-header">
        <h3>Payment Required</h3>
        <p>Send the exact amount to the destination address below using any Nano wallet, then retry with the confirmed send hash.</p>
      </div>

      <div v-if="isLoading" class="loading-state">
        <div class="spinner"></div>
        <p>Generating payment challenge...</p>
      </div>

      <div v-else-if="fetchError" class="error-state">
        <p>{{ fetchError }}</p>
        <button @click="fetchPaymentRequirements" class="retry-btn">Retry</button>
      </div>

      <div v-else-if="globalError" class="error-state">
        <p>{{ globalError }}</p>
        <button @click="fetchPaymentRequirements" class="retry-btn">Restart</button>
      </div>

      <div v-else-if="paymentStatus === 'expired'" class="expired-state">
        <p>Challenge expired. Start a new payment attempt.</p>
        <button @click="fetchPaymentRequirements" class="retry-btn">New challenge</button>
      </div>

      <div v-else-if="session" class="payment-active">
        <div class="common-info">
          <p class="payment-amount">
            Send exactly <strong data-testid="payment-amount-raw" :data-raw="session.amountRaw">{{ formatRawAmount(session.amountRaw) }} XNO</strong> to:
          </p>
          <div class="address-pane" data-testid="payment-address">{{ session.payTo }}</div>
          <div class="session-timer">Challenge expires in: <span class="mono">{{ Math.floor(countdown / 60) }}:{{ (countdown % 60).toString().padStart(2, '0') }}</span></div>
        </div>

        <div class="qr-section">
          <div class="qr-wrapper"><img v-if="qrcodeDataUrl" :src="qrcodeDataUrl" alt="Nano Payment QR Code" /></div>
          <a v-if="paymentUri" :href="paymentUri" class="wallet-link">Open in wallet app</a>
          <p class="qr-hint">After paying from your wallet, enter your <code>nano_...</code> address below and click poll. The browser will look for the matching send on-chain, then retry the protected resource request with the confirmed hash.</p>
          <p class="qr-hint">In a production client, the wallet would return the send hash directly — the polling step is a demo-only helper for external wallet payments.</p>
          <input v-model="payerAccount" class="payer-input" data-testid="payer-account-input" placeholder="nano_... your wallet address" />
          <button class="retry-btn" data-testid="start-polling" :disabled="isPolling" @click="startPolling">
            {{ isPolling ? 'Polling...' : 'Poll for matching send' }}
          </button>
          <p v-if="pollError" class="poll-error">{{ pollError }}</p>
        </div>

        <div class="global-status">
          <div v-if="paymentStatus === 'pending'" class="waiting-status" data-testid="payment-status" data-status="pending">Waiting for payment...</div>
          <div v-else-if="paymentStatus === 'polling'" class="waiting-status" data-testid="payment-status" data-status="polling">Polling for matching send...</div>
          <div v-else-if="paymentStatus === 'verifying'" class="waiting-status" data-testid="payment-status" data-status="verifying">Retrying protected resource with PAYMENT-SIGNATURE...</div>
          <div v-else-if="paymentStatus === 'failed'" class="expired-status" data-testid="payment-status" data-status="failed">Payment verification failed</div>
        </div>
      </div>
    </div>

    <div class="restart-link-container">
      <button @click="fetchPaymentRequirements" class="restart-link">Restart demo</button>
    </div>

    <div class="protocol-terminal">
      <div class="terminal-header">
        <span class="dot red"></span>
        <span class="dot yellow"></span>
        <span class="dot green"></span>
        <span class="title">Protocol Log</span>
      </div>
      <div class="terminal-body">
        <div v-for="(log, i) in httpLog" :key="i" class="log-entry">
          <span v-if="log.type === 'req'" class="req-text">→ Client Request:<br>{{ log.content }}</span>
          <span v-else-if="log.type === 'res'" class="res-text">← Server Response:<br>{{ log.content }}</span>
          <span v-else class="info-text">{{ log.content }}</span>
        </div>
        <div v-if="httpLog.length === 0" class="empty-log">Waiting for first request...</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.nano-paywall { padding-top: 1rem; padding-bottom: 2rem; }
.success-container, .paywall-container, .protocol-terminal { max-width: 40rem; margin: 0 auto 24px; border-radius: 12px; }
.success-container { background-color: rgba(34, 197, 94, 0.1); padding: 16px; border: 1px solid rgba(34, 197, 94, 0.3); }
.paywall-container { border: 1px solid var(--vp-c-divider); overflow: hidden; background-color: var(--vp-c-bg-soft); }
.paywall-header { background-color: var(--vp-c-bg-alt); border-bottom: 1px solid var(--vp-c-divider); padding: 16px 24px; text-align: center; }
.loading-state, .error-state, .expired-state { padding: 32px; text-align: center; }
.spinner { display: inline-block; width: 32px; height: 32px; border: 4px solid #3b82f6; border-top-color: transparent; border-radius: 50%; animation: spin 1s linear infinite; margin-bottom: 16px; }
@keyframes spin { to { transform: rotate(360deg); } }
.common-info { padding: 24px; border-bottom: 1px solid var(--vp-c-divider); }
.payment-amount { text-align: center; font-size: 0.875rem; margin-bottom: 16px; }
.address-pane { width: 100%; background-color: var(--vp-c-bg-alt); font-size: 0.75rem; font-family: monospace; padding: 12px; border-radius: 6px; text-align: center; word-break: break-all; margin-bottom: 16px; }
.session-timer { text-align: center; font-size: 0.875rem; color: var(--vp-c-text-3); }
.qr-section { display: flex; flex-direction: column; align-items: center; gap: 12px; padding: 24px; }
.qr-wrapper { background: white; padding: 8px; border-radius: 8px; }
.qr-wrapper img { width: 192px; height: 192px; display: block; }
.wallet-link { font-size: 0.85rem; color: var(--vp-c-brand); text-decoration: none; }
.qr-hint, .poll-error { font-size: 0.8rem; text-align: center; }
.payer-input { width: 100%; max-width: 28rem; padding: 10px 12px; border-radius: 8px; border: 1px solid var(--vp-c-divider); }
.retry-btn, .xnap-btn, .restart-link { padding: 10px 20px; font-size: 14px; font-weight: 500; background-color: #2563eb; color: white; border: none; border-radius: 6px; cursor: pointer; }
.retry-btn:disabled { opacity: 0.6; cursor: not-allowed; }
.global-status { padding: 16px; background-color: var(--vp-c-bg-alt); border-top: 1px solid var(--vp-c-divider); text-align: center; }
.waiting-status { color: var(--vp-c-brand); font-weight: 500; }
.expired-status { color: #ef4444; }
.restart-link-container { text-align: center; margin-top: 16px; }
.protocol-terminal { border: 1px solid var(--vp-c-divider); overflow: hidden; background-color: #1e1e1e; }
.terminal-header { background-color: #2d2d2d; padding: 8px 12px; display: flex; align-items: center; border-bottom: 1px solid #000; }
.terminal-header .title { color: #888; font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 600; margin-left: auto; margin-right: auto; }
.dot { display: inline-block; width: 10px; height: 10px; border-radius: 50%; margin-right: 6px; }
.dot.red { background-color: #ff5f56; }
.dot.yellow { background-color: #ffbd2e; }
.dot.green { background-color: #27c93f; }
.terminal-body { padding: 12px; max-height: 250px; overflow-y: auto; font-family: monospace; font-size: 11px; line-height: 1.4; }
.log-entry { margin-bottom: 12px; white-space: pre-wrap; word-break: break-all; }
.req-text { color: #56b6c2; }
.res-text { color: #98c379; }
.info-text, .empty-log { color: #7f848e; font-style: italic; }
</style>
