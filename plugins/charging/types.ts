export interface ConnectorCounts { available: number; occupied: number; reserved: number; unknown: number; outOfService: number }
export interface ChargingAvailability {
  chargingAvailability: string;
  connectors: { type: string; total: number; availability: { current: ConnectorCounts; perPowerLevel: (ConnectorCounts & { powerKW: number })[] } }[];
}
export interface ChargingStation {
  id: string; name: string; lat: number; lon: number; address: string | null; website: string | null; phone: string | null;
  brands: string[]; availabilityId: string | null;
  connectors: { connectorType: string; ratedPowerKW?: number; currentA?: number; currentType?: string; voltageV?: number }[];
  availability: ChargingAvailability | null; availabilityError: string | null; checkedAt: number | null;
}
export interface ChargingReport { stations: ChargingStation[]; capped: boolean; fetchedAt: number }
