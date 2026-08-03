export const RPC_URL = "http://127.0.0.1:8545";

export const ROLE = {
  None: 0,
  Administrator: 1,
  Producer: 2,
  Transporter: 3,
  Retailer: 4,
  Regulator: 5,
} as const;

export const ROLE_NAMES = [
  "None",
  "Administrator",
  "Producer",
  "Transporter",
  "Retailer",
  "Regulator",
] as const;

export const STATUS_NAMES = [
  "None",
  "Created",
  "In Transit",
  "Delivered",
  "Flagged",
  "Recalled",
] as const;

export const QUALITY_NAMES = ["Temperature", "Inspection", "Delivery"] as const;
