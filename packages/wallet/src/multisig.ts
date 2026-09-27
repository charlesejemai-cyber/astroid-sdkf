export interface Signer {
  key: string;
  weight: number;
}

export interface Thresholds {
  lowThreshold: number;
  medThreshold: number;
  highThreshold: number;
}

export interface ThresholdEvaluationResult {
  passed: boolean;
  accumulatedWeight: number;
  requiredThreshold: number;
  reason?: string;
}

export interface SetOptionsThresholdOptions {
  low?: number;
  medium?: number;
  high?: number;
  masterWeight?: number;
  signer?: {
    ed25519PublicKey?: string;
    weight?: number;
  };
}

export interface SetOptionsThresholdOp {
  type: 'setOptions';
  lowThreshold?: number;
  medThreshold?: number;
  highThreshold?: number;
  masterWeight?: number;
  signer?: {
    ed25519PublicKey?: string;
    weight?: number;
  };
}

export function evaluateSignerThreshold(
  signers: Signer[],
  activeSignerKeys: string[],
  thresholdKey: 'low' | 'medium' | 'high',
  thresholds: Thresholds,
): boolean {
  return evaluateSignerThresholdWithDetails(signers, activeSignerKeys, thresholdKey, thresholds)
    .passed;
}

export function evaluateSignerThresholdWithDetails(
  signers: Signer[],
  activeSignerKeys: string[],
  thresholdKey: 'low' | 'medium' | 'high',
  thresholds: Thresholds,
): ThresholdEvaluationResult {
  if (!Array.isArray(signers) || !Array.isArray(activeSignerKeys) || !thresholds) {
    return {
      passed: false,
      accumulatedWeight: 0,
      requiredThreshold: 0,
      reason: 'Invalid input arguments',
    };
  }

  const requiredThreshold =
    thresholdKey === 'low'
      ? thresholds.lowThreshold
      : thresholdKey === 'medium'
        ? thresholds.medThreshold
        : thresholds.highThreshold;

  // Deduplicate active signer keys to prevent double-counting
  const uniqueActiveKeys = new Set(activeSignerKeys);

  let accumulatedWeight = 0;
  for (const signer of signers) {
    if (signer && signer.key && uniqueActiveKeys.has(signer.key)) {
      accumulatedWeight += Number(signer.weight) || 0;
    }
  }

  const passed = accumulatedWeight >= requiredThreshold;
  const reason = passed
    ? undefined
    : `Accumulated weight ${accumulatedWeight} is less than ${thresholdKey} threshold ${requiredThreshold}`;

  return {
    passed,
    accumulatedWeight,
    requiredThreshold,
    reason,
  };
}

export function buildSetOptionsThresholdOp(
  options: SetOptionsThresholdOptions,
): SetOptionsThresholdOp {
  const op: SetOptionsThresholdOp = {
    type: 'setOptions',
  };

  if (typeof options.low === 'number') {
    op.lowThreshold = options.low;
  }
  if (typeof options.medium === 'number') {
    op.medThreshold = options.medium;
  }
  if (typeof options.high === 'number') {
    op.highThreshold = options.high;
  }
  if (typeof options.masterWeight === 'number') {
    op.masterWeight = options.masterWeight;
  }
  if (options.signer) {
    op.signer = options.signer;
  }

  return op;
}
