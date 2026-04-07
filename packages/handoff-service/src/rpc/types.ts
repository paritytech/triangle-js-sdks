export type HexString = `0x${string}`;

export type PoolStatus = {
  entryCount: number;
  totalBytes: number;
  maxBytes: number;
};

export type SubmitParams = {
  data: HexString;
  recipients: HexString[];
  proof: HexString;
};

export type ClaimParams = {
  hash: HexString;
  signature: HexString;
};

export type RequestFn = <Reply>(method: string, params: unknown[]) => Promise<Reply>;
