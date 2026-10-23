/**
 * Object profiles for the 80 classes COCO-SSD can detect. Written by hand.
 */
export const COCO_CLASSES = [
  "person", "bicycle", "car", "motorcycle", "airplane", "bus", "train", "truck", "boat", "traffic light",
  "fire hydrant", "stop sign", "parking meter", "bench", "bird", "cat", "dog", "horse", "sheep", "cow",
  "elephant", "bear", "zebra", "giraffe", "backpack", "umbrella", "handbag", "tie", "suitcase", "frisbee",
  "skis", "snowboard", "sports ball", "kite", "baseball bat", "baseball glove", "skateboard", "surfboard",
  "tennis racket", "bottle", "wine glass", "cup", "fork", "knife", "spoon", "bowl", "banana", "apple",
  "sandwich", "orange", "broccoli", "carrot", "hot dog", "pizza", "donut", "cake", "chair", "couch",
  "potted plant", "bed", "dining table", "toilet", "tv", "laptop", "mouse", "remote", "keyboard", "cell phone",
  "microwave", "oven", "toaster", "sink", "refrigerator", "book", "clock", "vase", "scissors", "teddy bear",
  "hair drier", "toothbrush",
] as const;

export type CocoClass = (typeof COCO_CLASSES)[number];

export interface ObjectProfile {
  /** Finishes the sentence "Occupation: …". */
  occupation: string;
  fact: string;
}

export const OBJECT_PROFILES = {
  person: { occupation: "going somewhere", fact: "A person is the most common thing a camera sees." },
  bicycle: { occupation: "silent commuting", fact: "Per kilometre, a cyclist spends less energy than a walker." },
  car: { occupation: "waiting at a red light", fact: "Most cars sit parked for around 95% of their lives." },
  motorcycle: { occupation: "lane filtering", fact: "The first production motorcycle, the Hildebrand & Wolfmüller, went on sale in 1894." },
  airplane: { occupation: "carrying 200 strangers", fact: "A cruising airliner covers roughly 250 metres every second." },
  bus: { occupation: "carrying forty commuters", fact: "A full bus can take dozens of cars off the road." },
  train: { occupation: "keeping to the timetable", fact: "Most of the world's railways use a track gauge of 1,435 mm." },
  truck: { occupation: "moving your parcels", fact: "Almost everything you own rode on a truck at some point." },
  boat: { occupation: "floating, professionally", fact: "Ships carry about 80% of world trade by volume." },
  "traffic light": { occupation: "directing strangers", fact: "The first electric traffic light was installed in Cleveland in 1914." },
  "fire hydrant": { occupation: "waiting, mostly", fact: "Many cities colour their hydrants to tell firefighters how much water they deliver." },
  "stop sign": { occupation: "making people hesitate", fact: "Stop signs are octagons so drivers can recognise them even from behind." },
  "parking meter": { occupation: "collecting small change", fact: "The first parking meter was installed in Oklahoma City in 1935." },
  bench: { occupation: "holding up tired people", fact: "Park benches often carry plaques for people who loved that spot." },
  bird: { occupation: "watching you back", fact: "Many birds see ultraviolet light that humans cannot." },
  cat: { occupation: "ignoring orders", fact: "Cats sleep 12 to 16 hours a day." },
  dog: { occupation: "being a good dog", fact: "A dog's nose has hundreds of millions of scent receptors. Yours has about six million." },
  horse: { occupation: "outrunning bicycles", fact: "Horses can sleep standing up because a locking mechanism holds their legs steady." },
  sheep: { occupation: "grazing professionally", fact: "Sheep can remember dozens of faces for years. VANTAGE remembers none." },
  cow: { occupation: "converting grass", fact: "A cow's stomach has four compartments." },
  elephant: { occupation: "remembering everything", fact: "Elephants can recognise themselves in a mirror." },
  bear: { occupation: "foraging", fact: "Black bears can spend months hibernating without eating or drinking." },
  zebra: { occupation: "working the stripes", fact: "No two zebras have exactly the same stripe pattern." },
  giraffe: { occupation: "scouting from above", fact: "A giraffe has seven neck vertebrae, the same number as you." },
  backpack: { occupation: "carrying someone's whole day", fact: "The usual advice is to keep a school backpack under about 10% of body weight." },
  umbrella: { occupation: "waiting for rain", fact: "Umbrellas were first used mainly for shade, in ancient Egypt, China and Mesopotamia." },
  handbag: { occupation: "guarding the essentials", fact: "\"Handbag\" began as a word for small hand-held luggage in the 1800s." },
  tie: { occupation: "looking formal", fact: "The necktie descends from cloth scarves worn by Croatian soldiers in the 1600s." },
  suitcase: { occupation: "going somewhere", fact: "Suitcases with wheels were only patented in 1970." },
  frisbee: { occupation: "interrupting picnics", fact: "The flying disc was inspired by pie tins from the Frisbie Baking Company." },
  skis: { occupation: "sliding downhill", fact: "The oldest known skis are thousands of years old." },
  snowboard: { occupation: "carving", fact: "Snowboarding became an Olympic sport at Nagano in 1998." },
  "sports ball": { occupation: "being chased", fact: "The classic football pattern has 32 panels: 12 pentagons and 20 hexagons." },
  kite: { occupation: "catching wind", fact: "Kites have flown in China for more than 2,000 years." },
  "baseball bat": { occupation: "waiting for a pitch", fact: "Major League bats must be a single piece of wood." },
  "baseball glove": { occupation: "catching things", fact: "Early baseball players caught the ball with bare hands. Gloves arrived in the 1870s." },
  skateboard: { occupation: "grinding", fact: "The first skateboards were homemade: roller-skate wheels nailed to planks." },
  surfboard: { occupation: "waiting for waves", fact: "Polynesians surfed for centuries before the sport reached California." },
  "tennis racket": { occupation: "returning serves", fact: "Wimbledon's grass courts are mown to about 8 mm." },
  bottle: { occupation: "staying hydrated", fact: "A plastic bottle can persist in the environment for centuries." },
  "wine glass": { occupation: "being swirled", fact: "Swirling wine exposes more of its surface to air, which releases its aroma." },
  cup: { occupation: "holding coffee", fact: "Coffee beans are the seeds of a fruit called the coffee cherry." },
  fork: { occupation: "pinning dinner", fact: "Forks spread slowly across Europe. Many people ate with knives and fingers into the 1600s." },
  knife: { occupation: "cutting corners", fact: "Sharp stone tools are about 2.6 million years old." },
  spoon: { occupation: "stirring", fact: "The spoon is older than the fork by thousands of years." },
  bowl: { occupation: "holding cereal", fact: "Bowls are among the earliest pottery shapes." },
  banana: { occupation: "sitting in a fruit bowl", fact: "Botanically, a banana is a berry." },
  apple: { occupation: "keeping doctors away", fact: "Apples float because about a quarter of their volume is air." },
  sandwich: { occupation: "being lunch", fact: "The sandwich is named after the 4th Earl of Sandwich, in the 18th century." },
  orange: { occupation: "being peeled", fact: "The colour is named after the fruit, not the other way round." },
  broccoli: { occupation: "being avoided", fact: "Broccoli is a cultivated form of wild cabbage." },
  carrot: { occupation: "pretending to help night vision", fact: "Early cultivated carrots were purple or yellow. Orange ones came later." },
  "hot dog": { occupation: "feeding ball games", fact: "Americans eat roughly 20 billion hot dogs a year." },
  pizza: { occupation: "feeding meetings", fact: "Pizza Margherita is said to be named after Queen Margherita of Savoy, in 1889." },
  donut: { occupation: "being a reward", fact: "The hole helps the middle cook through." },
  cake: { occupation: "marking occasions", fact: "Birthday cakes with candles are often traced to 18th-century Germany." },
  chair: { occupation: "supporting people", fact: "Ancient Egyptians already made chairs with carved legs." },
  couch: { occupation: "hosting naps", fact: "\"Couch\" comes from the French coucher, to lie down." },
  "potted plant": { occupation: "converting sunlight", fact: "Most houseplants come from forest floors, which is why they cope with dim rooms." },
  bed: { occupation: "restoring humans", fact: "People spend roughly a third of their lives asleep." },
  "dining table": { occupation: "hosting arguments", fact: "\"Room and board\" comes from tables that were once planks on trestles." },
  toilet: { occupation: "flushing", fact: "Sir John Harington built an early flush toilet for Elizabeth I around 1596." },
  tv: { occupation: "glowing at people", fact: "On an old tube TV, the whole picture was one moving dot of light." },
  laptop: { occupation: "running meetings", fact: "The GRiD Compass, from 1982, was an early clamshell laptop." },
  mouse: { occupation: "pointing", fact: "Douglas Engelbart showed the first computer mouse in 1968. It was made of wood." },
  remote: { occupation: "hiding in the couch", fact: "Zenith's Flash-Matic, from 1955, was the first wireless TV remote. It used a beam of light." },
  keyboard: { occupation: "being typed on", fact: "The QWERTY layout dates from the 1870s." },
  "cell phone": { occupation: "buzzing for attention", fact: "The first handheld mobile phone call was made in 1973." },
  microwave: { occupation: "reheating", fact: "Radar engineer Percy Spencer reportedly invented it after a chocolate bar melted in his pocket." },
  oven: { occupation: "baking", fact: "Ovens have baked bread for thousands of years." },
  toaster: { occupation: "browning", fact: "The pop-up toaster was patented in 1919." },
  sink: { occupation: "washing up", fact: "A tap left running uses around 6 to 10 litres a minute." },
  refrigerator: { occupation: "keeping cold things cold", fact: "Household fridges spread through homes in the 1920s and 1930s." },
  book: { occupation: "being read, in theory", fact: "The Gutenberg Bible was printed around 1455." },
  clock: { occupation: "keeping time", fact: "Mechanical clocks appeared in Europe around the 14th century." },
  vase: { occupation: "holding flowers", fact: "Painted Greek vases are one of our best records of daily life in ancient Greece." },
  scissors: { occupation: "cutting", fact: "Scissors are two levers sharing one pivot." },
  "teddy bear": { occupation: "comforting", fact: "Teddy bears are named after US President Theodore Roosevelt." },
  "hair drier": { occupation: "blowing hot air", fact: "The first hair dryer was invented in France in 1890." },
  toothbrush: { occupation: "guarding teeth", fact: "Bristle toothbrushes were in use in China by the late 1400s." },
} satisfies Record<CocoClass, ObjectProfile>;

const VEHICLES: ReadonlySet<string> = new Set(["car", "truck", "bus", "motorcycle", "bicycle"]);

export type ObjectGroup = "person" | "vehicle" | "object";

export function groupOf(cls: string): ObjectGroup {
  if (cls === "person") return "person";
  return VEHICLES.has(cls) ? "vehicle" : "object";
}

export function profileOf(cls: string): ObjectProfile | undefined {
  return (OBJECT_PROFILES as Record<string, ObjectProfile>)[cls];
}
