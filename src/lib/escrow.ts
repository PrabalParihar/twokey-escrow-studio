import {
  BaseError,
  ContractFunctionRevertedError,
  encodeAbiParameters,
  getAddress,
  isAddress,
  keccak256,
  parseAbi,
  parseAbiParameters,
  stringToHex,
  toHex,
  zeroAddress,
  type Address,
  type Hex,
} from 'viem'
import { getUsdc, buildAddressExplorerUrl, buildTxExplorerUrl } from '@/onchain-facts'
import { AmountError, parseAmount, usdcDecimalsFor, Amount } from '@/onchain-money'

import { ACTIVE } from './networks'

/** Network this page is bound to (Arc Testnet or Arc mainnet). Switching networks reloads the page. */
export const CHAIN_ID = ACTIVE.chainId
export const NETWORK_LABEL = ACTIVE.label
export const IS_MAINNET = ACTIVE.isMainnet
export const IS_CONFIGURED = ACTIVE.configured
/** Zero address while no escrow is configured for this network; the app shows setup instead of reading it. */
export const ESCROW_ADDRESS: Address = ACTIVE.escrow ?? zeroAddress
/** Block of the deploy transaction: log scans start here. */
export const DEPLOY_BLOCK: bigint = ACTIVE.deployBlock ?? 0n
export const MAX_PENDING_PER_AGENT = 32

const usdcFact = getUsdc(CHAIN_ID)
if (!usdcFact) throw new Error(`USDC is missing for ${NETWORK_LABEL} in onchain facts`)
export const USDC_ADDRESS: Address = usdcFact.address as Address

export const escrowAbi = parseAbi([
  'function owner() view returns (address)',
  'function usdc() view returns (address)',
  'function pendingOwner() view returns (address)',
  'function paused() view returns (bool)',
  'function maxHoldDuration() view returns (uint64)',
  'function nextId() view returns (uint256)',
  'function balance() view returns (uint256)',
  'function requests(uint256 id) view returns (address agent, address payee, uint128 amount, uint64 createdAt, uint64 expiry, uint8 status, bytes32 memoRef, bytes32 termsHash)',
  'function getAgent(address agent) view returns ((bool allowed, uint128 dailyCap, uint32 pending))',
  'function getPayee(address payee) view returns ((bool pinned, uint128 perPaymentCap))',
  'function autoHeadroom(address agent) view returns (uint256)',
  'function previewAutoPay(address agent, address payee, uint256 amount) view returns (bool isAuto, uint8 reasonCode)',
  'function hashTerms(uint256 id, address agent, address payee, uint128 amount, uint64 expiry, bytes32 memoRef) view returns (bytes32)',
  'function requestPayment(address payee, uint256 amount, uint64 expiry, bytes32 memoRef) returns (uint256 id, bool paid)',
  'function approve(uint256 id, bytes32 termsHash)',
  'function reject(uint256 id)',
  'function cancel(uint256 id)',
  'function expire(uint256 id)',
  'function setAgent(address agent, bool allowed, uint128 dailyCap)',
  'function setPayee(address payee, uint128 perPaymentCap)',
  'function removePayee(address payee)',
  'function setMaxHoldDuration(uint64 duration)',
  'function withdraw(address to, uint256 amount)',
  'function pause()',
  'function unpause()',
  'function transferOwnership(address newOwner)',
  'function acceptOwnership()',
  'event PaymentRequested(uint256 indexed id, address indexed agent, address indexed payee, uint128 amount, uint64 expiry, bytes32 memoRef, bytes32 termsHash)',
  'event PaymentReleased(uint256 indexed id, address indexed payee, uint128 amount, bool isAuto)',
  'event PaymentRejected(uint256 indexed id)',
  'event PaymentCancelled(uint256 indexed id)',
  'event PaymentExpired(uint256 indexed id)',
  'event AgentSet(address indexed agent, bool allowed, uint128 dailyCap)',
  'event PayeeSet(address indexed payee, uint128 perPaymentCap)',
  'event PayeeRemoved(address indexed payee)',
  'event MaxHoldDurationSet(uint64 maxHoldDuration)',
  'event Withdrawn(address indexed to, uint256 amount)',
])

/** Constructor of the deployed contract, used to deploy from the app. */
export const escrowConstructorAbi = parseAbi(['constructor(address initialOwner, address usdc_, uint64 maxHoldDuration_)'])

export const HOLD_OPTIONS = [
  { label: '1 hour', s: 3600 },
  { label: '6 hours', s: 21600 },
  { label: '1 day', s: 86400 },
  { label: '3 days', s: 259200 },
  { label: '7 days', s: 604800 },
  { label: '30 days', s: 2592000 },
]

export const STATUS = ['None', 'Pending', 'Paid', 'Approved', 'Rejected', 'Cancelled', 'Expired'] as const
export type StatusName = (typeof STATUS)[number]

export interface EscrowRequest {
  id: bigint
  agent: Address
  payee: Address
  amount: bigint
  createdAt: bigint
  expiry: bigint
  status: StatusName
  memoRef: Hex
  termsHash: Hex
}

export function toRequest(id: bigint, r: readonly [Address, Address, bigint, bigint, bigint, number, Hex, Hex]): EscrowRequest {
  return {
    id,
    agent: r[0],
    payee: r[1],
    amount: r[2],
    createdAt: r[3],
    expiry: r[4],
    status: STATUS[r[5]] ?? 'None',
    memoRef: r[6],
    termsHash: r[7],
  }
}

const TERMS_TYPEHASH = keccak256(
  stringToHex('PaymentTerms(address escrow,uint256 chainId,uint256 id,address agent,address payee,uint128 amount,uint64 expiry,bytes32 memoRef)'),
)

/** Recomputes the terms hash from the displayed fields, exactly as the contract does. */
export function computeTermsHash(r: Pick<EscrowRequest, 'id' | 'agent' | 'payee' | 'amount' | 'expiry' | 'memoRef'>): Hex {
  return keccak256(
    encodeAbiParameters(
      parseAbiParameters('bytes32, address, uint256, uint256, address, address, uint128, uint64, bytes32'),
      [TERMS_TYPEHASH, ESCROW_ADDRESS, BigInt(CHAIN_ID), r.id, r.agent, r.payee, r.amount, r.expiry, r.memoRef],
    ),
  )
}

export const memoToRef = (text: string): Hex => (text.trim() ? keccak256(toHex(text.trim())) : (`0x${'0'.repeat(64)}`))

/** Reason codes from previewAutoPay, in plain language. */
export const REASONS: Record<number, string> = {
  0: 'Pays immediately',
  1: 'The escrow is paused',
  2: 'This wallet is not an allowed agent',
  3: 'Invalid payee address',
  4: 'Invalid amount',
  5: 'Payee is not pinned, so the owner must approve',
  6: 'Over the payee per-payment cap, so the owner must approve',
  7: 'Over your rolling 24h cap, so the owner must approve',
  8: 'The escrow balance is too low right now, so it will be held',
}

const usdcDecimals = usdcDecimalsFor(CHAIN_ID)

/** Formats USDC base units with at least two decimals (cents). */
export function fmt(raw: bigint): string {
  const s = Amount.fromRaw(raw, usdcDecimals).toString()
  const [whole, frac = ''] = s.split('.')
  return `${whole}.${frac.padEnd(2, '0')}`
}

/** Parses a user-entered USDC amount; returns undefined while the input is not a valid positive amount. */
export function parseUsdcInput(value: string): bigint | undefined {
  if (!value.trim()) return undefined
  try {
    const a = parseAmount(CHAIN_ID, value.trim())
    return a.isPositive() ? a.raw : undefined
  } catch (e) {
    if (e instanceof AmountError) return undefined
    throw e
  }
}

export const parseAddressInput = (value: string): Address | undefined =>
  isAddress(value.trim()) ? getAddress(value.trim()) : undefined

export const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`
export const addressUrl = (a: string) => buildAddressExplorerUrl(CHAIN_ID, a)
export const txUrl = (h: string) => buildTxExplorerUrl(CHAIN_ID, h)
export const sameAddress = (a?: string, b?: string) => !!a && !!b && a.toLowerCase() === b.toLowerCase()

export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  if (s >= 86400) return `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h`
  if (s >= 3600) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`
  if (s >= 60) return `${Math.floor(s / 60)}m`
  return `${s}s`
}

const ERROR_TEXT: Record<string, string> = {
  AgentNotAllowed: 'This wallet is not an allowed agent.',
  TooManyPending: 'Too many held requests. Wait for the owner or cancel one.',
  NotPending: 'This request is no longer pending.',
  RequestExpired: 'This request has expired.',
  RequestNotExpired: 'This request has not expired yet.',
  TermsHashMismatch: 'The terms hash does not match. Nothing was approved.',
  InvalidExpiry: 'Expiry is outside the allowed hold window.',
  InvalidAmount: 'Invalid amount.',
  InvalidPayee: 'Invalid payee address.',
  EnforcedPause: 'The escrow is paused.',
  OwnableUnauthorizedAccount: 'Only the owner can do that.',
  NotRequestAgent: 'Only the requesting agent can cancel this.',
  InvalidMaxHoldDuration: 'Hold duration must be between 1 hour and 90 days.',
  ZeroAddress: 'Address cannot be empty.',
}

/** Turns a wallet or contract error into a short message, or undefined when the user simply cancelled. */
export function describeError(error: unknown): string | undefined {
  if (error instanceof BaseError) {
    const reverted = error.walk((e) => e instanceof ContractFunctionRevertedError)
    if (reverted instanceof ContractFunctionRevertedError) {
      const name = reverted.data?.errorName
      if (name && ERROR_TEXT[name]) return ERROR_TEXT[name]
      if (name) return `Rejected by the contract (${name}).`
    }
    if (error.name === 'UserRejectedRequestError' || /user rejected|user denied/i.test(error.message)) return undefined
    if (/insufficient funds|exceeds balance|transfer amount exceeds/i.test(error.message)) {
      return 'Not enough USDC for this transaction.'
    }
  }
  return 'The transaction failed. Please try again.'
}
