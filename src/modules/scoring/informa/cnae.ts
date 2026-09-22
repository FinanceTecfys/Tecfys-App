/** CNAE 2009 code -> scoring sector (Tecfys credit committee mapping). */
const CNAE_TO_SECTOR: Record<string, string> = {
  "8299": "Professional services",
  "4121": "Construction and materials", "4312": "Construction and materials",
  "6201": "Information technology", "6202": "Information technology", "6209": "Information technology",
  "5510": "Hotels and tourism", "5520": "Hotels and tourism", "7911": "Hotels and tourism",
  "4711": "Retail trade", "4719": "Retail trade", "4639": "Retail trade", "4634": "Retail trade",
  "4920": "Transportation and logistics", "4941": "Transportation and logistics",
  "6810": "Speculative real estate activities", "6820": "Speculative real estate activities",
  "0111": "Agriculture and fishing", "0311": "Agriculture and fishing",
  "2110": "Pharmaceuticals and biotechnology", "2120": "Pharmaceuticals and biotechnology",
  "6110": "Telecommunications", "6120": "Telecommunications",
  "3511": "Renewable energies",
  "1011": "Basic food", "1071": "Basic food",
  "2910": "Automotive", "4511": "Automotive",
  "1410": "Textile and fashion", "1413": "Textile and fashion",
  "5610": "Catering", "5611": "Catering", "5621": "Catering", "5629": "Catering", "5630": "Catering",
};

export function cnaeToSector(cnae: string | null): string {
  return (cnae && CNAE_TO_SECTOR[cnae]) || "Professional services";
}
