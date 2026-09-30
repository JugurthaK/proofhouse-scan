// Minimal SARIF 2.1.0 shapes — only the fields proofhouse-scan reads.

export interface SarifLog {
  version: string;
  runs: SarifRun[];
}

export interface SarifRun {
  tool: {
    driver: {
      name: string;
      rules?: SarifRule[];
    };
  };
  results?: SarifResult[];
}

export interface SarifRule {
  id: string;
  name?: string;
  shortDescription?: { text?: string };
  fullDescription?: { text?: string };
  help?: { text?: string; markdown?: string };
  defaultConfiguration?: { level?: string };
  properties?: {
    tags?: string[];
    "security-severity"?: string | number;
    [key: string]: unknown;
  };
}

export interface SarifResult {
  ruleId?: string;
  ruleIndex?: number;
  level?: "error" | "warning" | "note" | "none";
  message: { text?: string; markdown?: string };
  locations?: SarifLocation[];
  partialFingerprints?: Record<string, string>;
  fingerprints?: Record<string, string>;
  properties?: Record<string, unknown>;
}

export interface SarifLocation {
  physicalLocation?: {
    artifactLocation?: { uri?: string; uriBaseId?: string };
    region?: {
      startLine?: number;
      endLine?: number;
      startColumn?: number;
      endColumn?: number;
      snippet?: { text?: string };
    };
  };
}
