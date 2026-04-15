/**
 * Colonist backstory pools — Y2K-flavored, semi-satirical, a little sad.
 * Rolled once at spawn and frozen on Identity; the UI reads them to flesh
 * out the cow's Bio tab.
 *
 * Entries may tag themselves with `titles: ['Dr.', ...]` to restrict who
 * they apply to. Prestige-title cows (Dr./Prof./Col.) roll from their
 * flavored pool 70% of the time and fall back to the generic pool the rest;
 * plain-title cows (Mr./Mrs./Ms./Mx.) ignore the flavored entries. The
 * generic pool stays funny for everyone so a Dr. can plausibly be a
 * recovering used-tire-salesman with a medical degree they regret.
 */

const TITLE_MATCH_CHANCE = 0.7;

/**
 * @typedef BackstoryEntry
 * @property {string} text
 * @property {string[]} [titles]  if present, only cows with these titles roll this entry
 */

/** @type {BackstoryEntry[]} */
const CHILDHOODS = [
  { text: 'raised on a dairy farm' },
  { text: 'latchkey kid with a Tamagotchi collection' },
  { text: 'suburban cul-de-sac rat' },
  { text: 'spent every summer at bible camp' },
  { text: 'collected Pogs, lost them all in a slammer tournament' },
  { text: 'homeschooled by conspiracy theorists' },
  { text: 'mowed lawns all summer for saxophone money' },
  { text: 'lived above a family-owned pizzeria' },
  { text: 'ran a newspaper route on a hand-me-down BMX' },
  { text: 'got grounded for burning AOL trial CDs' },
  { text: 'dropped out of the church choir after a voice crack' },
  { text: 'eldest of eleven siblings' },
  { text: 'trained as a concert pianist, quit at fourteen' },
  { text: 'placed third at the county fair pie-eating contest' },
  { text: 'won a blue ribbon for a baking-soda volcano' },
  { text: 'spent middle school in a Quake LAN basement' },
  { text: 'memorized every line of The Matrix' },
  { text: 'ran away to join a mall food court' },
  { text: 'bounced between three foster homes' },
  { text: 'raised by a single mom who sold Avon door-to-door' },
  { text: 'played Oregon Trail on the school Apple IIe' },
  { text: 'was the neighborhood babysitter' },
  { text: 'got detention for modding the library computers' },
  { text: 'sold candy bars for a fundraiser that did not exist' },
  { text: 'built ramps for their friends’ skateboards' },
  { text: 'shared a room with three brothers and a rabbit' },
  { text: 'stole answers off the back of the worksheet' },
  { text: 'watched too much daytime TV during a long flu' },
  { text: 'grew up above a laundromat' },
  { text: 'spent weekends at the roller rink' },
  { text: 'had a paper route, pocketed tips for comic books' },
  { text: 'translated for their immigrant grandparents' },
  { text: 'raised by grandparents after a messy divorce' },
  { text: 'was the tallest kid in every class photo' },
  { text: 'had one friend with a pool, held it over them' },
  { text: 'memorized every Pokémon stat from Red and Blue' },
  { text: 'spent fifth grade obsessed with The X-Files' },
  { text: 'collected Beanie Babies as an investment strategy' },
  { text: 'played T-ball on a team that never won a game' },
  { text: 'was the class clown, peaked in eighth grade' },
  { text: 'won a local spelling bee on the word "bovine"' },
  { text: 'had a parrot that outlived two of the family pets' },
  { text: 'traded Yu-Gi-Oh cards at recess for lunch money' },
  { text: 'sold friendship bracelets at summer camp' },
  { text: 'was quietly the best kid in the marching band' },
  { text: 'fell off the gymnastics team after a wrist injury' },
  { text: 'ran their parents’ answering machine prank business' },
  { text: 'got a C in every subject except shop class' },
  { text: 'grew up watching Matlock reruns with grandpa' },
  { text: 'spent every Saturday morning at a swap meet' },
  { text: 'was a Boy Scout until the canoeing incident' },
  { text: 'hosted a cable access show nobody watched' },
  { text: 'lived in a trailer park with strong community spirit' },
  { text: 'had a side hustle sweeping a Blockbuster after hours' },
  { text: 'detasseled corn every summer for minimum wage' },
  { text: 'got caught shoplifting a VHS and still feels guilty' },
  { text: 'had a coin collection their dad kept borrowing from' },
  { text: 'was a child pageant runner-up three years running' },
  { text: 'spent recess sitting under the slide reading Goosebumps' },
  { text: 'played clarinet in the middle school jazz band' },
  { text: 'was convinced they would be a figure skater' },

  { text: 'skipped two grades, still resents their parents for it', titles: ['Dr.', 'Prof.'] },
  { text: 'won the regional math olympiad three years running', titles: ['Dr.', 'Prof.'] },
  { text: 'published a science-fair paper in a local journal', titles: ['Dr.', 'Prof.'] },
  { text: 'debate team captain, three-time state champion', titles: ['Dr.', 'Prof.'] },
  { text: 'competitive chess prodigy on the regional circuit', titles: ['Dr.', 'Prof.'] },
  { text: 'built a working robot from VCR parts in seventh grade', titles: ['Dr.', 'Prof.'] },
  { text: 'got a perfect SAT and has mentioned it every year since', titles: ['Dr.', 'Prof.'] },
  { text: 'interned at a research lab at fourteen', titles: ['Dr.', 'Prof.'] },
  { text: 'youngest Quiz Bowl captain their high school ever had', titles: ['Dr.', 'Prof.'] },
  { text: 'skipped prom for an astronomy conference', titles: ['Dr.', 'Prof.'] },
  { text: 'home-built a Linux box in the garage at age twelve', titles: ['Dr.', 'Prof.'] },

  { text: 'only-child army brat who moved every two years', titles: ['Col.'] },
  { text: 'joined JROTC in seventh grade', titles: ['Col.'] },
  { text: 'Eagle Scout at thirteen', titles: ['Col.'] },
  { text: 'grew up on a Nevada air base', titles: ['Col.'] },
  { text: 'shipped to military school after the fireworks incident', titles: ['Col.'] },
  { text: 'ran a paintball league on the weekends', titles: ['Col.'] },
];

/** @type {BackstoryEntry[]} */
const PROFESSIONS = [
  { text: 'Used Tire Salesman' },
  { text: 'Blockbuster Assistant Manager' },
  { text: 'Circuit City Sales Floor Associate' },
  { text: 'Radio Shack Battery Specialist' },
  { text: 'AOL Customer Retention Rep' },
  { text: 'DMV Window #3 Clerk' },
  { text: 'Suburban Realtor (two Mercedes)' },
  { text: 'Beanie Baby Authenticator' },
  { text: 'Compaq Help Desk, Tier 1' },
  { text: 'Mall Kiosk Ear-Piercing Technician' },
  { text: 'Hotel Continental Breakfast Attendant' },
  { text: 'Hot Topic Assistant Manager' },
  { text: 'TGI Friday’s Flair Specialist' },
  { text: 'Dot-Com Startup Foosball Coordinator' },
  { text: 'Bowling Alley Shoe Sprayer' },
  { text: 'Used Car Lot Balloon Wrangler' },
  { text: 'Strip Mall Tanning Salon Owner' },
  { text: 'Cable Company Installation Technician' },
  { text: 'Kmart Layaway Clerk' },
  { text: 'Pager Company Regional Sales Rep' },
  { text: 'Enron Junior Accountant' },
  { text: 'Funeral Home Makeup Artist' },
  { text: 'Kinko’s Print Shop Supervisor' },
  { text: 'Gas Station Attendant (scratch-off specialist)' },
  { text: 'Long-Distance Phone Card Reseller' },
  { text: 'Pyramid Scheme Upline (silver tier)' },
  { text: 'Local News Weekend Weather Guy' },
  { text: 'Trucking Dispatch Night Shift' },
  { text: 'Self-published Poet (sold 40 copies)' },
  { text: 'Pet Store Tarantula Specialist' },
  { text: 'Xerox Copier Repair Tech' },
  { text: 'Wedding DJ (one speaker blown)' },
  { text: 'Drive-Thru Coffee Stand Operator' },
  { text: 'Jiffy Lube Middle Bay Technician' },
  { text: 'Funnel Cake Cart Owner' },
  { text: 'Stadium Hot Dog Vendor' },
  { text: 'Home Shopping Network Call Screener' },
  { text: 'Unemployed, but in a cool way' },
  { text: 'Peanut Sheller' },
  { text: 'Waterbed Salesman' },
  { text: 'Motel 6 Night Clerk' },
  { text: 'State Fair Ferris Wheel Operator' },
  { text: 'Walmart Greeter Trainee' },
  { text: 'Costco Free-Sample Demonstrator' },
  { text: 'Coin Pusher Arcade Operator' },
  { text: 'Amway Distributor' },
  { text: 'Lottery Ticket Printer Technician' },
  { text: 'Carpet Remnant Warehouse Assistant Manager' },
  { text: 'Subway Sandwich Artist' },
  { text: 'Office Depot Plotter Specialist' },
  { text: 'Shoe Carnival Floor Associate' },
  { text: 'Video Store Late Fee Collector' },
  { text: 'Paintball Field Referee' },
  { text: 'Go-Kart Track Mechanic' },
  { text: 'Mall Santa’s Off-Season Understudy' },
  { text: 'Apartment Complex Courtesy Patrol Officer' },
  { text: 'Time-Share Presentation Facilitator' },
  { text: 'Bail Bondsman Apprentice' },
  { text: 'Local Radio Morning Zoo Sidekick' },
  { text: 'Tupperware Regional Rep' },
  { text: 'Herbalife Upline Consultant' },
  { text: 'Pool Cleaner (one client, very rich)' },
  { text: 'Auto Glass Repair "Technician"' },
  { text: 'Newspaper Horoscope Columnist' },
  { text: 'DishNetwork Door-to-Door Salesman' },
  { text: 'ICQ Support Hotline Operator' },
  { text: 'Pawn Shop Jewelry Appraiser' },
  { text: 'Frozen Yogurt Shop Owner (closed after six months)' },
  { text: 'Stained Glass Window Apprentice' },
  { text: 'Gold’s Gym Towel Attendant' },
  { text: 'Dollar Store Inventory Associate' },
  { text: 'Ticketmaster Phone Queue Supervisor' },
  { text: 'Mattress Warehouse Delivery Driver' },
  { text: 'Small-Town Newspaper Obituary Writer' },
  { text: 'Oil Change Quick-Lube Cashier' },
  { text: 'Spirit Halloween Seasonal Manager' },
  { text: 'Pretzel Kiosk Dough Twister' },

  { text: 'Y2K Security Analyst at IBM', titles: ['Dr.', 'Prof.'] },
  { text: 'Y2K Bug Remediation Consultant', titles: ['Dr.', 'Prof.'] },
  { text: 'Overworked Resident at St. Elsewhere', titles: ['Dr.'] },
  { text: 'Tenure-Track Poultry Geneticist', titles: ['Dr.', 'Prof.'] },
  { text: 'Community College Chem 101 Adjunct', titles: ['Dr.', 'Prof.'] },
  { text: 'Dot-Com VP of Thought Leadership', titles: ['Dr.', 'Prof.'] },
  { text: 'Strip Mall Podiatrist', titles: ['Dr.'] },
  { text: 'Veterinarian (horses only, very specific)', titles: ['Dr.'] },
  { text: 'Author of an Unread Computer Science Textbook', titles: ['Dr.', 'Prof.'] },
  { text: 'Dean’s List Tutor-for-Hire', titles: ['Dr.', 'Prof.'] },
  { text: 'RAND Corporation Night-Shift Researcher', titles: ['Dr.', 'Prof.'] },
  { text: 'Failed Philosophy PhD Turned Barista', titles: ['Dr.', 'Prof.'] },
  { text: 'Chiropractor with Questionable Credentials', titles: ['Dr.'] },
  { text: 'Six Sigma Black Belt Corporate Trainer', titles: ['Dr.', 'Prof.'] },
  { text: 'Ophthalmologist (sunglasses hustle on the side)', titles: ['Dr.'] },
  { text: 'Patent Clerk in a Dying Downtown Office', titles: ['Dr.', 'Prof.'] },
  { text: 'Adjunct Folklore Lecturer', titles: ['Prof.'] },
  { text: 'Professor Emeritus of Bovine Studies', titles: ['Prof.'] },
  { text: 'Actuary at a Small Ohio Insurance Firm', titles: ['Dr.', 'Prof.'] },
  { text: 'Veterinary Pharmacist', titles: ['Dr.'] },
  { text: 'Methodologist at a Market Research Boutique', titles: ['Dr.', 'Prof.'] },
  { text: 'Optometrist in a Retail Chain Storefront', titles: ['Dr.'] },
  { text: 'ABD Dissertation Writer (twelve years running)', titles: ['Prof.'] },

  { text: 'Retired from Fort Bragg', titles: ['Col.'] },
  { text: 'Blackwater Contractor', titles: ['Col.'] },
  { text: 'Desert Storm Veteran (now drives a Miata)', titles: ['Col.'] },
  { text: 'ROTC Instructor at a State University', titles: ['Col.'] },
  { text: 'Military Surplus Store Owner', titles: ['Col.'] },
  { text: 'Survivalist Newsletter Publisher', titles: ['Col.'] },
  { text: 'Pentagon Paper Pusher', titles: ['Col.'] },
  { text: 'Decorated Korean War Veteran (questions this himself)', titles: ['Col.'] },
  { text: 'Ex-Marine, Runs a Tuesday Bowling League', titles: ['Col.'] },
  { text: 'Airborne Ranger Reservist', titles: ['Col.'] },
  { text: 'VFW Hall President', titles: ['Col.'] },
  { text: 'Private Security Consultant (bodyguard to a minor pop star)', titles: ['Col.'] },
];

/**
 * @param {BackstoryEntry[]} pool
 * @param {string} title
 * @param {() => number} rng
 */
function pickFrom(pool, title, rng) {
  const specific = pool.filter((e) => e.titles?.includes(title));
  const useSpecific = specific.length > 0 && rng() < TITLE_MATCH_CHANCE;
  if (useSpecific) return specific[Math.floor(rng() * specific.length)].text;
  const generic = pool.filter((e) => !e.titles);
  return generic[Math.floor(rng() * generic.length)].text;
}

/**
 * @param {string} title
 * @param {() => number} [rng]
 */
export function pickChildhood(title, rng = Math.random) {
  return pickFrom(CHILDHOODS, title, rng);
}

/**
 * @param {string} title
 * @param {() => number} [rng]
 */
export function pickProfession(title, rng = Math.random) {
  return pickFrom(PROFESSIONS, title, rng);
}
