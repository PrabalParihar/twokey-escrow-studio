import type { usePublicClient } from 'wagmi'
import type { Address, Hash } from 'viem'
import { USDC_ADDRESS, NETWORK_LABEL, escrowAbi, sameAddress } from './escrow'

type Client = NonNullable<ReturnType<typeof usePublicClient>>

export class DeploymentCheckError extends Error {}

export interface CheckedDeployment {
  escrow: Address
  owner: Address
  maxHold: bigint
  deployBlock: bigint
}

/**
 * The on-chain checks behind both "paste an existing escrow" and "deploy from my wallet":
 * code exists, it uses Arc's USDC, the transaction succeeded and is what created it.
 * Throws DeploymentCheckError with a message that is safe to show.
 */
export async function checkDeployment(
  client: Client,
  escrow: Address,
  txHash: Hash,
  options: { requireDirectCreate?: boolean; expectedOwner?: Address; expectedMaxHold?: bigint } = {},
): Promise<CheckedDeployment> {
  const code = await client.getCode({ address: escrow })
  if (!code || code === '0x') throw new DeploymentCheckError(`No contract found at that address on ${NETWORK_LABEL}.`)

  let owner: Address, usdc: Address, maxHold: bigint, paused: boolean
  try {
    ;[owner, usdc, maxHold, paused] = await Promise.all([
      client.readContract({ address: escrow, abi: escrowAbi, functionName: 'owner' }),
      client.readContract({ address: escrow, abi: escrowAbi, functionName: 'usdc' }),
      client.readContract({ address: escrow, abi: escrowAbi, functionName: 'maxHoldDuration' }),
      client.readContract({ address: escrow, abi: escrowAbi, functionName: 'paused' }),
    ])
  } catch {
    throw new DeploymentCheckError('That address is a contract, but not a Twokey Escrow.')
  }
  if (!sameAddress(usdc, USDC_ADDRESS)) {
    throw new DeploymentCheckError('That contract does not use this network’s USDC, so it is not a Twokey Escrow for it.')
  }
  if (paused) throw new DeploymentCheckError('That escrow is paused already, which a fresh deployment never is.')

  const receipt = await client.getTransactionReceipt({ hash: txHash })
  if (receipt.status !== 'success') throw new DeploymentCheckError('That deploy transaction did not succeed.')
  const createdByTx = receipt.contractAddress ? sameAddress(receipt.contractAddress, escrow) : false
  const loggedByTx = receipt.logs.some((l) => sameAddress(l.address, escrow))
  if (options.requireDirectCreate ? !createdByTx : !(createdByTx || loggedByTx)) {
    throw new DeploymentCheckError('That transaction did not create this contract.')
  }

  if (options.expectedOwner && !sameAddress(owner, options.expectedOwner)) {
    throw new DeploymentCheckError('The deployed owner is not the one you chose. Do not use this contract.')
  }
  if (options.expectedMaxHold !== undefined && maxHold !== options.expectedMaxHold) {
    throw new DeploymentCheckError('The deployed hold duration is not the one you chose. Do not use this contract.')
  }

  return { escrow, owner, maxHold, deployBlock: receipt.blockNumber }
}
