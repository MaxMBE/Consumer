export type CountryCode = "GT" | "EC" | "PE";

export interface CountryMeta {
  code: CountryCode;
  name: string;
  flag: string;
}

export const COUNTRIES: CountryMeta[] = [
  { code: "GT", name: "Guatemala", flag: "🇬🇹" },
  { code: "EC", name: "Ecuador",   flag: "🇪🇨" },
  { code: "PE", name: "Perú",      flag: "🇵🇪" },
];
