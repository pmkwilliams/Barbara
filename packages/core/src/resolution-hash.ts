export interface ResolutionHashFields {
  resolution_rules: string | null;
  resolution_source: string | null;
  close_time: string | null;
  outcome_labels: string[];
}

export const computeResolutionHash = (fields: ResolutionHashFields): string => {
  const hasher = new Bun.CryptoHasher("sha256");
  const payload = [
    fields.resolution_rules ?? "",
    fields.resolution_source ?? "",
    fields.close_time ?? "",
    ...[...fields.outcome_labels].sort((left, right) => left.localeCompare(right))
  ].join("\0");

  hasher.update(payload);
  return hasher.digest("hex");
};
