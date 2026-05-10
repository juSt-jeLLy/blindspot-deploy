import { AbiCoder, hexlify, parseUnits } from "ethers";
import type { Signer } from "ethers";
type RelayerSDK = typeof import("@zama-fhe/relayer-sdk/web");
type RelayerInstance = Awaited<ReturnType<RelayerSDK["createInstance"]>>;

let instancePromise: Promise<RelayerInstance> | null = null;

function getNetworkForRelayer(): string | object {
  const env = (import.meta as ImportMeta & { env?: Record<string, string> }).env;
  const envRpc = env?.VITE_SEPOLIA_RPC_URL;
  if (envRpc && envRpc.trim().length > 0) return envRpc.trim();
  if (typeof window !== "undefined") {
    const w = window as Window & { ethereum?: unknown };
    if (w.ethereum && typeof w.ethereum === "object") return w.ethereum;
  }
  throw new Error("VITE_SEPOLIA_RPC_URL is required");
}

async function getRelayerInstance(): Promise<RelayerInstance> {
    if (typeof window === "undefined") throw new Error("SSR: FHE not available");
  if (!instancePromise) {
    instancePromise = (async () => {
      const sdk = (await import("@zama-fhe/relayer-sdk/web")) as RelayerSDK;
      if (typeof sdk.initSDK !== "function" || typeof sdk.createInstance !== "function") {
        throw new Error("Relayer SDK failed to load required web exports");
      }
      await sdk.initSDK({
        tfheParams: "/zama/tfhe_bg.wasm",
        kmsParams: "/zama/kms_lib_bg.wasm",
      });
      const apiKey = (import.meta as ImportMeta & { env?: Record<string, string> }).env?.VITE_ZAMA_API_KEY;
      const sepolia = sdk.SepoliaConfig;
      const cfg = apiKey
        ? {
            ...sepolia,
            network: getNetworkForRelayer(),
            auth: {
              __type: "ApiKeyHeader" as const,
              value: apiKey,
            },
          }
        : {
            ...sepolia,
            network: getNetworkForRelayer(),
          };
      return sdk.createInstance(cfg);
    })();
  }
  return instancePromise;
}

function toUint64(value: bigint, field: string): bigint {
  const max = (1n << 64n) - 1n;
  if (value < 0n || value > max) throw new Error(`${field} is out of uint64 range`);
  return value;
}

export async function encryptOrderInputs(params: {
  contractAddress: string;
  userAddress: string;
  priceDecimal: string;
  sizeDecimal: string;
}) {
  const relayer = await getRelayerInstance();
  const price = toUint64(parseUnits(params.priceDecimal, 6), "price");
  const size = toUint64(parseUnits(params.sizeDecimal, 6), "size");

  const input = relayer.createEncryptedInput(params.contractAddress, params.userAddress);
  input.add64(price);
  input.add64(size);
  const encrypted = await input.encrypt();

  return {
    encPriceHandle: hexlify(encrypted.handles[0]),
    encSizeHandle: hexlify(encrypted.handles[1]),
    inputProof: hexlify(encrypted.inputProof),
  };
}

export async function encryptUint64Input(params: {
  contractAddress: string;
  userAddress: string;
  amountDecimal: string;
  decimals?: number;
}) {
  const relayer = await getRelayerInstance();
  const decimals = params.decimals ?? 6;
  const amount = toUint64(parseUnits(params.amountDecimal, decimals), "amount");
  const input = relayer.createEncryptedInput(params.contractAddress, params.userAddress);
  input.add64(amount);
  const encrypted = await input.encrypt();
  return {
    encHandle: hexlify(encrypted.handles[0]),
    inputProof: hexlify(encrypted.inputProof),
  };
}

export async function publicDecryptUint64Handle(handle: string) {
  const relayer = await getRelayerInstance();
  const result = (await (relayer as any).publicDecrypt([handle])) as {
    abiEncodedClearValues: string;
    decryptionProof: string;
  };
  const [value] = AbiCoder.defaultAbiCoder().decode(["uint64"], result.abiEncodedClearValues);
  return {
    clearValue: BigInt(value.toString()),
    abiEncodedClearValues: result.abiEncodedClearValues,
    decryptionProof: result.decryptionProof,
  };
}

export async function decryptHandleForUser(params: {
  handle: string;
  contractAddress: string;
  userAddress: string;
  signer: Signer;
}) {
  const relayer = await getRelayerInstance();
  const keypair = relayer.generateKeypair();
  const startTimestamp = Math.floor(Date.now() / 1000);
  const durationDays = 7;
  const eip712 = relayer.createEIP712(
    keypair.publicKey,
    [params.contractAddress],
    startTimestamp,
    durationDays,
  );

  const signature = await params.signer.signTypedData(
    eip712.domain,
    {
      UserDecryptRequestVerification: eip712.types.UserDecryptRequestVerification,
    },
    eip712.message,
  );

  const res = await relayer.userDecrypt(
    [{ handle: params.handle, contractAddress: params.contractAddress }],
    keypair.privateKey,
    keypair.publicKey,
    signature,
    [params.contractAddress],
    params.userAddress,
    startTimestamp,
    durationDays,
  );

  const value = res[params.handle] ?? res[params.handle.toLowerCase()] ?? res[params.handle.toUpperCase()];
  if (value === undefined || value === null) throw new Error("decrypt returned empty value");
  return BigInt(value as string);
}
