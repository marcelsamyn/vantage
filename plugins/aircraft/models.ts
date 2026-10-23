/** Readable names for common ICAO aircraft type designators. Unknown codes fall back to the code itself. */
const MODELS: Record<string, string> = {
  A19N: "Airbus A319neo",
  A20N: "Airbus A320neo",
  A21N: "Airbus A321neo",
  A318: "Airbus A318",
  A319: "Airbus A319",
  A320: "Airbus A320",
  A321: "Airbus A321",
  A332: "Airbus A330-200",
  A333: "Airbus A330-300",
  A337: "Airbus BelugaXL",
  A338: "Airbus A330-800neo",
  A339: "Airbus A330-900neo",
  A343: "Airbus A340-300",
  A346: "Airbus A340-600",
  A359: "Airbus A350-900",
  A35K: "Airbus A350-1000",
  A388: "Airbus A380-800",
  A3ST: "Airbus Beluga",
  BCS1: "Airbus A220-100",
  BCS3: "Airbus A220-300",
  B712: "Boeing 717",
  B733: "Boeing 737-300",
  B734: "Boeing 737-400",
  B735: "Boeing 737-500",
  B736: "Boeing 737-600",
  B737: "Boeing 737-700",
  B738: "Boeing 737-800",
  B739: "Boeing 737-900",
  B37M: "Boeing 737 MAX 7",
  B38M: "Boeing 737 MAX 8",
  B39M: "Boeing 737 MAX 9",
  B3XM: "Boeing 737 MAX 10",
  B744: "Boeing 747-400",
  B748: "Boeing 747-8",
  B752: "Boeing 757-200",
  B753: "Boeing 757-300",
  B762: "Boeing 767-200",
  B763: "Boeing 767-300",
  B764: "Boeing 767-400",
  B772: "Boeing 777-200",
  B77L: "Boeing 777-200LR",
  B773: "Boeing 777-300",
  B77W: "Boeing 777-300ER",
  B778: "Boeing 777-8",
  B779: "Boeing 777-9",
  B788: "Boeing 787-8 Dreamliner",
  B789: "Boeing 787-9 Dreamliner",
  B78X: "Boeing 787-10 Dreamliner",
  E170: "Embraer E170",
  E175: "Embraer E175",
  E190: "Embraer E190",
  E195: "Embraer E195",
  E290: "Embraer E190-E2",
  E295: "Embraer E195-E2",
  E35L: "Embraer Legacy 600",
  E55P: "Embraer Phenom 300",
  E545: "Embraer Legacy 450",
  CRJ2: "Bombardier CRJ200",
  CRJ7: "Bombardier CRJ700",
  CRJ9: "Bombardier CRJ900",
  CRJX: "Bombardier CRJ1000",
  DH8D: "De Havilland Dash 8-400",
  AT72: "ATR 72",
  AT75: "ATR 72-500",
  AT76: "ATR 72-600",
  AT45: "ATR 42-500",
  AT46: "ATR 42-600",
  SU95: "Sukhoi Superjet 100",
  C25A: "Cessna Citation CJ2",
  C25B: "Cessna Citation CJ3",
  C25C: "Cessna Citation CJ4",
  C510: "Cessna Citation Mustang",
  C56X: "Cessna Citation Excel",
  C68A: "Cessna Citation Latitude",
  C700: "Cessna Citation Longitude",
  C172: "Cessna 172 Skyhawk",
  C182: "Cessna 182 Skylane",
  C208: "Cessna 208 Caravan",
  P28A: "Piper PA-28 Cherokee",
  PC12: "Pilatus PC-12",
  PC24: "Pilatus PC-24",
  SR22: "Cirrus SR22",
  SF50: "Cirrus Vision Jet",
  GLF4: "Gulfstream IV",
  GLF5: "Gulfstream V",
  GLF6: "Gulfstream G650",
  GL5T: "Bombardier Global 5000",
  GLEX: "Bombardier Global Express",
  GL7T: "Bombardier Global 7500",
  CL35: "Bombardier Challenger 350",
  CL60: "Bombardier Challenger 600",
  F2TH: "Dassault Falcon 2000",
  FA7X: "Dassault Falcon 7X",
  FA8X: "Dassault Falcon 8X",
  LJ45: "Learjet 45",
  BE20: "Beechcraft King Air 200",
  B350: "Beechcraft King Air 350",
  H25B: "Hawker 800",
  EC35: "Airbus H135 (helicopter)",
  EC45: "Airbus H145 (helicopter)",
  EC30: "Airbus H130 (helicopter)",
  EC75: "Airbus H175 (helicopter)",
  AS50: "Airbus AS350 Écureuil (helicopter)",
  A139: "Leonardo AW139 (helicopter)",
  A169: "Leonardo AW169 (helicopter)",
  A189: "Leonardo AW189 (helicopter)",
  R44: "Robinson R44 (helicopter)",
  R66: "Robinson R66 (helicopter)",
  S76: "Sikorsky S-76 (helicopter)",
  B06: "Bell 206 (helicopter)",
  B407: "Bell 407 (helicopter)",
  C130: "Lockheed C-130 Hercules",
  C30J: "Lockheed C-130J Super Hercules",
  C17: "Boeing C-17 Globemaster III",
  A400: "Airbus A400M Atlas",
  K35R: "Boeing KC-135 Stratotanker",
  A332M: "Airbus A330 MRTT",
  E3TF: "Boeing E-3 Sentry",
  P8: "Boeing P-8 Poseidon",
  F16: "General Dynamics F-16",
  EUFI: "Eurofighter Typhoon",
  GLID: "Glider",
  BALL: "Balloon",
};

export function modelName(typeCode: string | null): string | null {
  if (!typeCode) return null;
  return MODELS[typeCode] ?? typeCode;
}

/** Plain-language reading of the ADS-B emitter category. */
export function categoryName(category: string | null): string | null {
  switch (category) {
    case "A1":
      return "Light aircraft";
    case "A2":
      return "Small aircraft";
    case "A3":
      return "Airliner";
    case "A4":
      return "Large airliner (high vortex)";
    case "A5":
      return "Heavy aircraft";
    case "A6":
      return "High-performance aircraft";
    case "A7":
      return "Helicopter";
    case "B1":
      return "Glider";
    case "B2":
      return "Balloon or airship";
    case "B4":
      return "Ultralight";
    case "B6":
      return "Drone";
    case "C1":
      return "Emergency vehicle on the ground";
    case "C2":
      return "Service vehicle on the ground";
    default:
      return null;
  }
}

/** Transponder codes with a fixed international meaning. */
export function squawkMeaning(squawk: string | null): string | null {
  switch (squawk) {
    case "7500":
      return "Unlawful interference";
    case "7600":
      return "Radio failure";
    case "7700":
      return "General emergency";
    case "7000":
      return "VFR (Europe)";
    case "1200":
      return "VFR (North America)";
    case "2000":
      return "Entering controlled airspace";
    default:
      return null;
  }
}
